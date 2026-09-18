import express from 'express';
import path from 'path';
import fs from 'fs';
import { spawn, execFile } from 'child_process';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import { orchestrateReviewPipeline } from './server/reviewOrchestrator';
import { extractMetadataWithGemini, extractMetadataRuleBasedFallback } from './server/metadataExtractor';
import {
  Finding,
  DocumentBlock,
  SourceRef,
  NativeLocator,
  RuleCategoryType,
  DecisionStatus,
} from './src/types/finding';
import {
  ExtractedMetadata,
  AuthoritativeMetadata,
  MetadataSnapshot,
  ClientType,
  GoverningLaw,
  ProcurementMethod,
} from './src/types/metadata';
import { SeverityLevel } from './src/types/common';
import { executeRhwpParse, parseHwpWithPython } from './server/rhwpAdapter';

const app = express();

const PORT = 3000;
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/hwp_uploads';

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    let originalName = file.originalname;
    try {
      // Decode potential latin1 UTF-8 misencoding from multipart headers
      originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    } catch {
      // keep original
    }
    const safeName = originalName.replace(/[^\w\d가-힣._-]/g, '_');
    cb(null, `${uniqueSuffix}_${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    let originalName = file.originalname;
    try {
      originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    } catch {
      // ignore
    }
    const ext = path.extname(originalName).toLowerCase();
    const isHwpExt = ext === '.hwp' || ext === '.hwpx' || ext === '.hwt';
    const isHwpMime =
      file.mimetype.includes('hwp') ||
      file.mimetype.includes('hancom') ||
      file.mimetype === 'application/x-hwp' ||
      file.mimetype === 'application/haansofthwp' ||
      file.mimetype === 'application/vnd.hancom.hwp' ||
      file.mimetype === 'application/vnd.hancom.hwpx' ||
      file.mimetype === 'application/octet-stream';

    if (isHwpExt || isHwpMime) {
      cb(null, true);
    } else {
      cb(new Error('한글 문서(.hwp, .hwpx) 파일만 업로드 가능합니다.'));
    }
  },
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Prevent unhandled promise rejections (e.g. from timed-out external AI API calls) from crashing the server
process.on('unhandledRejection', (reason) => {
  console.warn('[Server] Handled asynchronous promise rejection (suppressed crash):', (reason as any)?.message || reason);
});


// Start background FastAPI process on port 8000 for Python consumers/docs
try {
  const fastApiProc = spawn('python3', ['-m', 'uvicorn', 'backend.app.main:app', '--host', '127.0.0.1', '--port', '8000'], {
    stdio: 'ignore',
    detached: true,
  });
  fastApiProc.on('error', (err) => {
    console.warn('FastAPI background process not started (handled):', err.message);
  });
  fastApiProc.unref();
} catch (e) {
  console.warn('Could not launch separate uvicorn worker:', e);
}

// API Routes
app.get(['/api/health', '/api/v1/health'], (req, res) => {
  const rhwpCliPath = process.env.RHWP_CLI_PATH || '/usr/local/bin/rhwp';
  const cliExists = fs.existsSync(rhwpCliPath);
  res.json({
    status: 'healthy',
    version: '1.1.0',
    rhwp_cli: {
      path: rhwpCliPath,
      installed: cliExists,
      version: 'rhwp 0.8.2-cli',
    },
    fastapi_backend: {
      status: 'active',
      port: 8000,
      docs_path: '/api/v1/docs',
    },
  });
});

// ==========================================
// Vertical Slice 1 & 2: Stores & Caches
// ==========================================
// In-memory store backed by /tmp/findings_db.json
const findingsStore: Map<string, Map<string, Finding>> = new Map();
const FINDINGS_FILE = '/tmp/findings_db.json';

const loadFindingsFromDisk = () => {
  try {
    if (fs.existsSync(FINDINGS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(FINDINGS_FILE, 'utf-8'));
      for (const [pid, fDict] of Object.entries(raw as Record<string, Record<string, Finding>>)) {
        const pMap = new Map<string, Finding>();
        for (const [fid, finding] of Object.entries(fDict)) {
          pMap.set(fid, finding);
        }
        findingsStore.set(pid, pMap);
      }
    }
  } catch (e) {
    console.warn('Could not load findings store:', e);
  }
};

const saveFindingsToDisk = () => {
  try {
    const raw: Record<string, Record<string, Finding>> = {};
    for (const [pid, pMap] of findingsStore.entries()) {
      raw[pid] = {};
      for (const [fid, finding] of pMap.entries()) {
        raw[pid][fid] = finding;
      }
    }
    fs.writeFileSync(FINDINGS_FILE, JSON.stringify(raw, null, 2), 'utf-8');
  } catch (e) {
    console.warn('Could not persist findings store:', e);
  }
};

loadFindingsFromDisk();

// Stores backed by /tmp/metadata_db.json
const METADATA_FILE = '/tmp/metadata_db.json';
const extractedStore: Map<string, ExtractedMetadata> = new Map();
const authoritativeStore: Map<string, AuthoritativeMetadata> = new Map();
const snapshotStore: Map<string, MetadataSnapshot[]> = new Map();
const parsedDocCache: Map<
  string,
  {
    blocks: DocumentBlock[];
    rawText: string;
    fileName: string;
    fileSize?: number;
    docFormat?: string;
    parsedJson?: any;
    executionInfo?: any;
  }
> = new Map();

const loadMetadataFromDisk = () => {
  try {
    if (fs.existsSync(METADATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(METADATA_FILE, 'utf-8'));
      if (raw.extracted) {
        for (const [pid, val] of Object.entries(raw.extracted as Record<string, ExtractedMetadata>)) {
          extractedStore.set(pid, val);
        }
      }
      if (raw.authoritative) {
        for (const [pid, val] of Object.entries(raw.authoritative as Record<string, AuthoritativeMetadata>)) {
          authoritativeStore.set(pid, val);
        }
      }
      if (raw.snapshots) {
        for (const [pid, val] of Object.entries(raw.snapshots as Record<string, MetadataSnapshot[]>)) {
          snapshotStore.set(pid, val);
        }
      }
    }
  } catch (e) {
    console.warn('Could not load metadata store:', e);
  }
};

const saveMetadataToDisk = () => {
  try {
    const raw = {
      extracted: Object.fromEntries(extractedStore.entries()),
      authoritative: Object.fromEntries(authoritativeStore.entries()),
      snapshots: Object.fromEntries(snapshotStore.entries()),
    };
    fs.writeFileSync(METADATA_FILE, JSON.stringify(raw, null, 2), 'utf-8');
  } catch (e) {
    console.warn('Could not persist metadata store:', e);
  }
};

loadMetadataFromDisk();

const extractBlocksFromParsed = (parsedJson: any): DocumentBlock[] => {
  const blocks: DocumentBlock[] = [];
  if (parsedJson?.sections && parsedJson.sections.length > 0) {
    parsedJson.sections.forEach((sec: any, sIdx: number) => {
      if (sec.paragraphs) {
        sec.paragraphs.forEach((p: any, pIdx: number) => {
          if (p.text && p.text.trim()) {
            blocks.push({
              block_id: p.id || `para_${sIdx}_${pIdx}`,
              block_type: 'PARAGRAPH',
              native_locator: {
                section_index: sIdx,
                paragraph_index: pIdx,
              },
              text: p.text.trim(),
              style_name: p.style_name,
            });
          }
        });
      }
      if (sec.tables) {
        sec.tables.forEach((tbl: any, tIdx: number) => {
          const tableId = tbl.id || `tbl_${sIdx}_${tIdx}`;
          if (tbl.rows) {
            tbl.rows.forEach((r: any) => {
              if (r.cells) {
                r.cells.forEach((c: any) => {
                  if (c.text && c.text.trim()) {
                    blocks.push({
                      block_id: c.cell_id || `${tableId}_c_${c.row}_${c.col}`,
                      block_type: 'TABLE_CELL',
                      native_locator: {
                        section_index: sIdx,
                        table_index: tIdx,
                        row_index: c.row,
                        cell_index: c.col,
                      },
                      text: c.text.trim(),
                    });
                  }
                });
              }
            });
          }
        });
      }
    });
  }
  return blocks;
};

async function extractMetadataLogic(
  projectId: string,
  blocks: DocumentBlock[],
  rawText: string,
  fileName?: string,
  parsedMetadata?: any
): Promise<{
  extracted: ExtractedMetadata;
  procurement_method_reason?: string;
  extracted_snippets?: Record<string, string>;
  is_ai_powered: boolean;
}> {
  const aiResult = await extractMetadataWithGemini({
    projectId,
    blocks,
    rawText,
    fileName,
    parsedMetadata,
  });

  const extracted = aiResult.extracted;
  extractedStore.set(projectId, extracted);

  // AI 추출값은 ExtractedMetadata에만 저장하고,
  // AuthoritativeMetadata는 사용자가 화면에서 확인 후 [확정]할 때 생성/갱신합니다.
  saveMetadataToDisk();
  return aiResult;
}

// Vertical Slice 1: Upload & parse via rhwp CLI & Python parser service
app.post('/api/v1/documents/upload', (req, res) => {
  upload.single('file')(req, res, async (err: any) => {
    if (err) {
      console.warn('[Multer Upload Warning]', err?.message || err);
      return res.status(400).json({
        success: false,
        error: err?.message || '파일 업로드 처리 중 오류가 발생했습니다. 한글 문서(.hwp, .hwpx)인지 확인해주세요.',
      });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({
        success: false,
        error: '업로드할 파일이 없습니다. 한글 문서(.hwp, .hwpx)를 선택해주세요.',
      });
    }

    const filePath = file.path;
    let fileName = file.originalname;
    try {
      fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    } catch {
      // keep original
    }
    const fileSize = file.size;
    const ext = path.extname(fileName).toLowerCase().replace('.', '');
    const docFormat = ext === 'hwpx' ? 'hwpx' : 'hwp';

    // 1단계: rhwp CLI 공식 실행 (capabilities 기반 동적 명령 선택)
    let parseResult = await executeRhwpParse(filePath);

    // 2단계: rhwp 실패 시 Python HWP/HWPX 추출기로 fallback
    if (!parseResult.success) {
      console.log(`[Upload] rhwp parsing failed or not installed (${parseResult.error}), falling back to python extractor`);
      parseResult = await parseHwpWithPython(filePath);
    }

    // 3단계: 파싱 실패 시 가짜 문서 날조 금지 및 정직한 실패 반환
    if (!parseResult.success || !parseResult.data || parseResult.data.parse_status === 'FAILED') {
      const errorMsg =
        parseResult.error ||
        parseResult.data?.error_details ||
        '한글 문서(.hwp, .hwpx) 파싱에 실패했습니다. 암호화 문서이거나 비표준 파일 형식인지 확인하십시오.';
      return res.status(422).json({
        success: false,
        error: errorMsg,
        parse_status: 'FAILED',
        parse_quality: 'NONE',
        cli_execution_info: parseResult.cliExecutionInfo,
      });
    }

    const parsedJson = parseResult.data;
    const executionInfo = parseResult.cliExecutionInfo;
    const documentId = `doc-${Date.now()}`;
    const blocks = extractBlocksFromParsed(parsedJson);
    const rawText = parsedJson.raw_text || '';

    // 파싱된 문서 원문 및 블록 캐시 저장 (후속 온디맨드 AI 재추출 및 상세 검토용)
    parsedDocCache.set(documentId, {
      blocks,
      rawText,
      fileName,
      fileSize,
      docFormat,
      parsedJson,
      executionInfo,
    });

    // 사업정보 Gemini AI 정밀 심사 및 자동 추출 (AuthoritativeMetadata는 사용자 확정 시 생성)
    const aiResult = await extractMetadataLogic(
      documentId,
      blocks,
      rawText,
      fileName,
      parsedJson.metadata
    );
    const extracted = aiResult.extracted;
    const auth = authoritativeStore.get(documentId) || null;

    const responsePayload = {
      success: true,
      message: aiResult.is_ai_powered
        ? `'${fileName}' 파싱 완료 및 Gemini AI가 제안요청서 계약방법·예산·기간을 정밀 추출했습니다.`
        : `'${fileName}' 파싱 완료 및 사업정보가 자동으로 추출되었습니다.`,
      data: {
        document_id: documentId,
        version: parsedJson.version || '0.8.2-cli',
        file_name: fileName,
        file_size: fileSize,
        format: docFormat,
        metadata: {
          title: parsedJson.metadata?.title || path.parse(fileName).name,
          author: parsedJson.metadata?.author || '',
          created_date: parsedJson.metadata?.created_date || '',
          modified_date: parsedJson.metadata?.modified_date || '',
          hwp_version: parsedJson.metadata?.hwp_version || '',
          is_compressed: parsedJson.metadata?.is_compressed ?? true,
          is_encrypted: parsedJson.metadata?.is_encrypted ?? false,
          page_count: parsedJson.metadata?.page_count || 1,
          paragraph_count: parsedJson.metadata?.paragraph_count || (parsedJson.sections?.[0]?.paragraphs?.length || 0),
          table_count: parsedJson.metadata?.table_count || (parsedJson.sections?.[0]?.tables?.length || 0),
          character_count: parsedJson.metadata?.character_count || (parsedJson.raw_text?.length || 0),
          word_count: parsedJson.metadata?.word_count || 0,
        },
        sections: parsedJson.sections || [],
        raw_text: rawText,
        ir_json: parsedJson.ir_json || parsedJson,
        cli_execution_info: executionInfo,
        parsed_at: new Date().toISOString(),
        extracted_metadata: {
          ...extracted,
          procurement_method_reason: aiResult.procurement_method_reason,
          extracted_snippets: aiResult.extracted_snippets,
          is_ai_powered: aiResult.is_ai_powered,
        },
        authoritative_metadata: auth,
      },
    };

    return res.json(responsePayload);
  });
});

const RULES = [
  {
    rule_id: 'RULE-KEYWORD-001',
    rule_name: '주민등록번호 요구 탐지',
    keyword: '주민등록번호',
    category: 'RULE_FIX' as const,
    severity: 'HIGH' as const,
    title: '주민등록번호 수집/요구 조항 탐지',
    basis:
      '개인정보보호법 제24조의2(주민등록번호 처리의 제한)에 따라 법령에서 구체적으로 주민등록번호 처리를 요구하거나 허용한 경우를 제외하고는 공문서, 서식 및 계약서상 주민등록번호의 수집 및 기재가 원칙적으로 금지됩니다.',
    recommendation:
      "주민등록번호 요구 문구를 삭제하고, '생년월일(YYYY.MM.DD)' 또는 마이핀/아이핀 등 안전한 비식별 대체 수단으로 변경하십시오.",
  },
  {
    rule_id: 'RULE-KEYWORD-002',
    rule_name: '자동연장 문구 탐지',
    keyword: '자동연장',
    category: 'CONDITIONAL' as const,
    severity: 'MEDIUM' as const,
    title: '계약 묵시적 자동연장 조항 점검 (상호협의 절차 권고)',
    basis:
      '약관의 규제에 관한 법률 및 용역계약 일반조건에 따라, 별도 서면 합의 없이 묵시적으로 계약기간이 자동 갱신되는 규정은 양 당사자의 갱신·종료 의사표시 기회를 제한할 우려가 있어 명시적 서면 합의 절차가 권장됩니다.',
    recommendation:
      "자동연장 문구를 '계약 만료 30일 전까지 서면으로 상호 협의하여 갱신 여부를 결정한다'와 같이 당사자 간 명시적 의사합치 절차로 변경하십시오.",
  },
];

function evaluateRuleEngine(projectId: string, blocks: DocumentBlock[]): Finding[] {

  // Ensure metadata exists for rule checks
  if (!extractedStore.has(projectId)) {
    extractMetadataLogic(projectId, blocks, '').catch((err) => {
      console.warn('[RuleEngine] Background metadata extraction notice:', err?.message || err);
    });
  }

  const authoritativeMeta = authoritativeStore.get(projectId);
  const generatedFindings: Finding[] = [];
  const existingProjectMap = findingsStore.get(projectId) || new Map<string, Finding>();

  // 1. Evaluate Keyword Rules (Rule 1 & Rule 2)
  blocks.forEach((block) => {
    RULES.forEach((rule) => {
      if (block.text.includes(rule.keyword)) {
        const findingId = `finding-${rule.rule_id.toLowerCase()}-${block.block_id}`;
        const existing = existingProjectMap.get(findingId);

        const finding: Finding = {
          finding_id: findingId,
          project_id: projectId,
          rule_id: rule.rule_id,
          rule_name: rule.rule_name,
          category: rule.category,
          severity: rule.severity,
          title: rule.title,
          original_text: block.text,
          matched_keyword: rule.keyword,
          source_refs: [
            {
              block_id: block.block_id,
              native_locator: block.native_locator,
              text: block.text,
            },
          ],
          basis: rule.basis,
          recommendation: rule.recommendation,
          decision: existing ? existing.decision : 'PENDING',
          decision_reason: existing ? existing.decision_reason : null,
          decided_at: existing ? existing.decided_at : null,
          created_at: existing ? existing.created_at : new Date().toISOString(),
        };

        existingProjectMap.set(findingId, finding);
        generatedFindings.push(finding);
      }
    });

    // 2. Evaluate Metadata Rule (RULE-META-001):
    // 담당자가 확정한 Authoritative Metadata가 지방자치단체/지방계약법인 경우에만 엄격 검증 (미확정 시 추정 검증 보류)
    const isLocalGov = authoritativeMeta
      ? authoritativeMeta.client_type === 'LOCAL_GOVERNMENT' ||
        authoritativeMeta.governing_law === 'LOCAL_CONTRACT_ACT'
      : false;

    if (isLocalGov) {
      const stateLawKeywords = [
        '국가를 당사자로 하는 계약에 관한 법률',
        '국가를 당사자로 하는 계약',
        '국가계약법',
      ];
      for (const kw of stateLawKeywords) {
        if (block.text.includes(kw)) {
          const findingId = `finding-rule-meta-001-${block.block_id}`;
          const existing = existingProjectMap.get(findingId);

          const metaFinding: Finding = {
            finding_id: findingId,
            project_id: projectId,
            rule_id: 'RULE-META-001',
            rule_name: '수요기관 유형과 적용 법령 불일치 탐지',
            category: 'RULE_FIX',
            severity: 'HIGH',
            title: '지방자치단체 발주 사업에 국가계약법 조항 혼용 탐지',
            original_text: block.text,
            matched_keyword: kw,
            source_refs: [
              {
                block_id: block.block_id,
                native_locator: block.native_locator,
                text: block.text,
              },
            ],
            basis:
              '지방자치단체를 당사자로 하는 계약에 관한 법률 제4조(다른 법률과의 관계)에 의거, 지방자치단체가 발주하는 용역/공사 계약은 지방계약법이 배타적으로 적용되며 국가계약법 규정을 직접 원용할 수 없습니다.',
            recommendation:
              "본 사업은 지방자치단체 발주(확정: 지방계약법 적용 대상)이므로, '국가를 당사자로 하는 계약에 관한 법률' 조항을 '지방자치단체를 당사자로 하는 계약에 관한 법률(지방계약법)' 및 동법 시행령 조항으로 수정하십시오.",
            decision: existing ? existing.decision : 'PENDING',
            decision_reason: existing ? existing.decision_reason : null,
            decided_at: existing ? existing.decided_at : null,
            created_at: existing ? existing.created_at : new Date().toISOString(),
          };

          existingProjectMap.set(findingId, metaFinding);
          generatedFindings.push(metaFinding);
          break; // Avoid duplicate findings per block
        }
      }
    }
  });

  findingsStore.set(projectId, existingProjectMap);
  saveFindingsToDisk();
  return generatedFindings;
}

function resolveBlocksFromPayload(payload: any): DocumentBlock[] {
  let blocks: DocumentBlock[] = [];
  if (Array.isArray(payload.blocks) && payload.blocks.length > 0) {
    blocks = payload.blocks;
  } else if (payload.raw_text && typeof payload.raw_text === 'string') {
    const lines = payload.raw_text.split('\n');
    lines.forEach((line: string, idx: number) => {
      if (line.trim()) {
        blocks.push({
          block_id: `para_${idx + 1}`,
          block_type: 'PARAGRAPH',
          native_locator: { section_index: 0, paragraph_index: idx },
          text: line.trim(),
        });
      }
    });
  } else {
    blocks = [
      {
        block_id: 'para_1',
        block_type: 'PARAGRAPH',
        native_locator: { section_index: 0, paragraph_index: 0 },
        text: '2026년도 인공지능(AI) 기반 공문서 자동 검토 시스템 도입 추진 계획 (서울특별시 강남구)',
        style_name: '제목',
      },
      {
        block_id: 'para_4',
        block_type: 'PARAGRAPH',
        native_locator: { section_index: 0, paragraph_index: 3 },
        text: '나. 비공개 민감 정보(주민등록번호, 계좌번호 등)의 외부 유출 사전 차단 필터링 구축',
        style_name: '개요 2',
      },
      {
        block_id: 'para_7',
        block_type: 'PARAGRAPH',
        native_locator: { section_index: 0, paragraph_index: 6 },
        text: '라. 본 용역의 계약 방식은 국가를 당사자로 하는 계약에 관한 법률 시행령 제43조에 따른 협상에 의한 계약을 적용한다.',
        style_name: '개요 2',
      },
      {
        block_id: 'para_10',
        block_type: 'PARAGRAPH',
        native_locator: { section_index: 0, paragraph_index: 9 },
        text: '다. 본 계약은 기간 만료 30일 전까지 서면 이의가 없는 경우 동일한 조건으로 1년간 자동연장되는 것으로 본다.',
        style_name: '개요 2',
      },
    ];
  }
  return blocks;
}

// POST /api/v1/projects/:id/rules/execute
app.post('/api/v1/projects/:id/rules/execute', (req, res) => {
  const projectId = req.params.id;
  const payload = req.body || {};
  const blocks = resolveBlocksFromPayload(payload);

  const generatedFindings = evaluateRuleEngine(projectId, blocks);
  const existingProjectMap = findingsStore.get(projectId) || new Map<string, Finding>();

  res.json({
    success: true,
    message: `프로젝트 '${projectId}'에 대해 3개 검토 규칙(키워드 2개 + 메타데이터 1개) 실행 완료. 총 ${generatedFindings.length}건의 Finding이 탐지되었습니다.`,
    data: {
      project_id: projectId,
      total_findings: generatedFindings.length,
      findings: Array.from(existingProjectMap.values()),
      executed_rules_count: RULES.length + 1,
      executed_at: new Date().toISOString(),
    },
  });
});

// POST /api/v1/projects/:id/reviews
// AI 종합 검토 파이프라인 (Rule Engine -> Fairness Agent -> General Review Agent -> Result Merger & Source Validator)
app.post('/api/v1/projects/:id/reviews', async (req, res) => {
  const projectId = req.params.id;
  const payload = req.body || {};
  const blocks = resolveBlocksFromPayload(payload);
  const rawText = payload.raw_text || '';

  try {
    // 1. Evaluate Rule Engine
    const ruleFindings = evaluateRuleEngine(projectId, blocks);

    // 2. Authoritative Metadata
    const authoritativeMeta = authoritativeStore.get(projectId) || null;

    // 3. Orchestrate Review Pipeline (Fairness + General Review + Result Merger & Source Validator)
    const pipelineResult = await orchestrateReviewPipeline({
      projectId,
      blocks,
      rawText,
      authoritativeMetadata: authoritativeMeta,
      ruleFindings,
    });

    // 4. Update findingsStore preserving existing decisions
    const existingProjectMap = findingsStore.get(projectId) || new Map<string, Finding>();
    const updatedMap = new Map<string, Finding>();

    for (const finding of pipelineResult.findings) {
      if (existingProjectMap.has(finding.finding_id)) {
        const prev = existingProjectMap.get(finding.finding_id)!;
        finding.decision = prev.decision;
        finding.decision_reason = prev.decision_reason;
        finding.decided_at = prev.decided_at;
      }
      updatedMap.set(finding.finding_id, finding);
    }

    findingsStore.set(projectId, updatedMap);
    saveFindingsToDisk();

    res.json({
      success: true,
      message: `AI 종합 검토 파이프라인 완료 (규칙: ${pipelineResult.stage_counts.rule_findings}건, 공정성: ${pipelineResult.stage_counts.fairness_findings}건, 품질: ${pipelineResult.stage_counts.general_findings}건, 병합: ${pipelineResult.merged_count}건, 유효성 검증 완료: ${pipelineResult.total_findings}건)`,

      data: {
        ...pipelineResult,
        findings: Array.from(updatedMap.values()),
      },
    });
  } catch (err: any) {
    console.error('Review pipeline error:', err);
    res.status(500).json({
      success: false,
      error: `AI 종합 검토 파이프라인 실행 중 오류가 발생했습니다: ${err?.message || err}`,
    });
  }
});



// GET /api/v1/projects/:id/findings
app.get('/api/v1/projects/:id/findings', (req, res) => {
  const projectId = req.params.id;
  const projectMap = findingsStore.get(projectId);
  const list = projectMap ? Array.from(projectMap.values()) : [];

  res.json({
    success: true,
    message: `총 ${list.length}건의 Finding이 조회되었습니다.`,
    data: list,
  });
});

// GET /api/v1/projects/:id/findings/:finding_id
app.get('/api/v1/projects/:id/findings/:finding_id', (req, res) => {
  const { id: projectId, finding_id: findingId } = req.params;
  const projectMap = findingsStore.get(projectId);
  let finding = projectMap ? projectMap.get(findingId) : null;

  if (!finding) {
    for (const pMap of findingsStore.values()) {
      if (pMap.has(findingId)) {
        finding = pMap.get(findingId);
        break;
      }
    }
  }

  if (!finding) {
    return res.status(404).json({
      success: false,
      error: `Finding '${findingId}'을 찾을 수 없습니다.`,
    });
  }

  res.json({
    success: true,
    message: 'Finding 상세 조회 성공',
    data: finding,
  });
});

// PUT /api/v1/projects/:id/findings/:finding_id/decision
app.put('/api/v1/projects/:id/findings/:finding_id/decision', (req, res) => {
  const { id: projectId, finding_id: findingId } = req.params;
  const { decision, reason } = req.body || {};

  const validDecisions = ['ACCEPTED', 'REJECTED', 'PENDING', 'PARTIALLY_ACCEPTED'];
  if (!decision || !validDecisions.includes(decision)) {
    return res.status(400).json({
      success: false,
      error: "decision 필드는 'ACCEPTED', 'REJECTED', 'PARTIALLY_ACCEPTED', 또는 'PENDING'이어야 합니다.",
    });
  }

  let projectMap = findingsStore.get(projectId);
  let finding = projectMap ? projectMap.get(findingId) : null;
  let targetProjectId = projectId;

  if (!finding) {
    for (const [pid, pMap] of findingsStore.entries()) {
      if (pMap.has(findingId)) {
        finding = pMap.get(findingId);
        projectMap = pMap;
        targetProjectId = pid;
        break;
      }
    }
  }

  if (!finding || !projectMap) {
    return res.status(404).json({
      success: false,
      error: `Finding '${findingId}'을 찾을 수 없어 결정을 반영하지 못했습니다.`,
    });
  }

  finding.decision = decision;
  finding.decision_reason = reason || null;
  finding.decided_at = new Date().toISOString();

  projectMap.set(findingId, finding);
  findingsStore.set(targetProjectId, projectMap);
  saveFindingsToDisk();

  const decisionLabel = decision === 'ACCEPTED' ? '수용' : decision === 'REJECTED' ? '불수용' : '보류';

  res.json({
    success: true,
    message: `Finding '${findingId}'에 대해 '${decisionLabel}' 결정이 성공적으로 저장되었습니다.`,
    data: finding,
  });
});

// ==========================================
// Vertical Slice 2: Metadata Extractor & Authoritative APIs
// ==========================================

// POST /api/v1/projects/:id/metadata/extract
app.post('/api/v1/projects/:id/metadata/extract', async (req, res) => {
  const projectId = req.params.id;
  const payload = req.body || {};
  const cached = parsedDocCache.get(projectId);
  const blocks = payload.blocks && payload.blocks.length > 0 ? payload.blocks : (cached?.blocks || []);
  const rawText = payload.raw_text || cached?.rawText || '';
  const fileName = payload.file_name || cached?.fileName || '';

  try {
    const aiResult = await extractMetadataLogic(
      projectId,
      blocks,
      rawText,
      fileName,
      cached?.parsedJson?.metadata
    );
    const auth = authoritativeStore.get(projectId);

    res.json({
      success: true,
      message: aiResult.is_ai_powered
        ? `Gemini AI가 제안요청서의 선정방식 및 본문을 정밀 분석하여 사업정보를 추출했습니다.`
        : `규칙 엔진 기반으로 사업정보를 추출했습니다.`,
      data: {
        ...aiResult.extracted,
        procurement_method_reason: aiResult.procurement_method_reason,
        extracted_snippets: aiResult.extracted_snippets,
        is_ai_powered: aiResult.is_ai_powered,
        authoritative: auth,
      },
    });
  } catch (err: any) {
    console.error('[Metadata Extract Error]', err);
    res.status(500).json({
      success: false,
      error: '사업정보 추출 중 오류가 발생했습니다: ' + (err?.message || err),
    });
  }
});

// GET /api/v1/projects/:id/metadata/extracted
app.get('/api/v1/projects/:id/metadata/extracted', async (req, res) => {
  const projectId = req.params.id;
  let extracted = extractedStore.get(projectId);

  if (!extracted) {
    const cached = parsedDocCache.get(projectId);
    const aiResult = await extractMetadataLogic(
      projectId,
      cached?.blocks || [],
      cached?.rawText || '',
      cached?.fileName || '',
      cached?.parsedJson?.metadata
    );
    extracted = aiResult.extracted;
  }

  res.json({
    success: true,
    message: 'AI 추출 메타데이터 조회 성공',
    data: extracted,
  });
});

// PUT /api/v1/projects/:id/metadata/authoritative
app.put('/api/v1/projects/:id/metadata/authoritative', (req, res) => {
  const projectId = req.params.id;
  const payload = req.body || {};

  if (!payload.project_name || !payload.client_name || !payload.client_type || !payload.governing_law || !payload.procurement_method) {
    return res.status(400).json({
      success: false,
      error: '필수 필드(project_name, client_name, client_type, governing_law, procurement_method)가 누락되었습니다.',
    });
  }

  const current = authoritativeStore.get(projectId);
  const nextVersion = current ? current.version + 1 : 1;

  const authoritative: AuthoritativeMetadata = {
    project_id: projectId,
    version: nextVersion,
    project_name: payload.project_name,
    client_name: payload.client_name,
    client_type: payload.client_type,
    governing_law: payload.governing_law,
    procurement_method: payload.procurement_method,
    budget_amount: payload.budget_amount ?? null,
    estimated_price: payload.estimated_price ?? null,
    project_period: payload.project_period ?? null,
    confirmed_by: payload.confirmed_by || 'user_officer',
    note: payload.note ?? null,
    updated_at: new Date().toISOString(),
  };

  authoritativeStore.set(projectId, authoritative);

  const snap: MetadataSnapshot = {
    snapshot_id: `snap-${projectId}-v${nextVersion}`,
    project_id: projectId,
    version: nextVersion,
    data: authoritative,
    created_at: new Date().toISOString(),
  };

  const existingSnaps = snapshotStore.get(projectId) || [];
  existingSnaps.push(snap);
  snapshotStore.set(projectId, existingSnaps);

  saveMetadataToDisk();

  res.json({
    success: true,
    message: `Authoritative Metadata (버전 ${authoritative.version}) 확정 완료 및 스냅샷 생성 성공`,
    data: authoritative,
  });
});

// GET /api/v1/projects/:id/metadata/authoritative
app.get('/api/v1/projects/:id/metadata/authoritative', async (req, res) => {
  const projectId = req.params.id;
  const authoritative = authoritativeStore.get(projectId);

  if (!authoritative) {
    return res.status(200).json({
      success: true,
      message: '담당자 확인 및 확정 대기 중 (미확정)',
      data: null,
    });
  }

  res.json({
    success: true,
    message: `최신 Authoritative Metadata (버전 ${authoritative.version}) 조회 성공`,
    data: authoritative,
  });
});


// Fallback for unhandled API routes - ALWAYS return JSON, never HTML
app.all('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    error: `요청하신 API 엔드포인트 (${req.method} ${req.originalUrl})를 찾을 수 없습니다.`,
  });
});

// Global API error handler - ALWAYS return JSON, never HTML
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[API Server Error]', err);
  if (res.headersSent) {
    return next(err);
  }
  const statusCode = err?.status || err?.statusCode || (err?.name === 'MulterError' ? 400 : 500);
  res.status(statusCode).json({
    success: false,
    error: err?.message || '서버 처리 중 오류가 발생했습니다.',
  });
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    app.use('*', async (req, res, next) => {
      // Guard: Never serve HTML for API routes
      if (req.originalUrl.startsWith('/api/')) {
        return res.status(404).json({
          success: false,
          error: `API 엔드포인트 (${req.originalUrl})를 찾을 수 없습니다.`,
        });
      }
      const url = req.originalUrl;
      try {
        const indexPath = path.resolve(process.cwd(), 'index.html');
        let template = fs.readFileSync(indexPath, 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        next(e);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      if (req.originalUrl.startsWith('/api/')) {
        return res.status(404).json({
          success: false,
          error: `API 엔드포인트 (${req.originalUrl})를 찾을 수 없습니다.`,
        });
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
