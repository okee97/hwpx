import { getGeminiClient, generateContentWithFallback, isGeminiKeyConfigured } from './geminiClient';

import { AuthoritativeMetadata } from '../src/types/metadata';
import { DocumentBlock, Finding, NativeLocator, SourceRef } from '../src/types/finding';

export interface FairnessAgentInput {
  projectId: string;
  authoritativeMetadata: AuthoritativeMetadata | null;
  blocks: DocumentBlock[];
  ruleFindingsSummary: Array<{ rule_id: string; title: string; block_id: string }>;
}

export interface FairnessRawOutputItem {
  rule_id?: string;
  rule_name?: string;
  title: string;
  block_id: string;
  matched_keyword?: string;
  original_text: string;
  basis: string;
  recommendation: string;
  severity?: 'CRITICAL' | 'WARNING' | 'INFO';
}

/**
 * 02_AI_REVIEW_SPEC.md 준수: 공정성 검토 에이전트
 * - 계약 당사자 간 불공정 독소조항, 과도한 지체상금, 일방적 권리 귀속, 무상 유지보수 강요 등 탐지
 * - 법 위반 단정 금지: '검토 필요' 문구 및 상호협의 권고안 생성
 * - 카테고리: FAIRNESS 고정
 */
export async function runFairnessReviewAgent(input: FairnessAgentInput): Promise<Finding[]> {
  const { projectId, authoritativeMetadata, blocks, ruleFindingsSummary } = input;
  const gemini = getGeminiClient();

  const clientName = authoritativeMetadata?.client_name || '수요기관';
  const governingLaw = authoritativeMetadata?.governing_law || '계약법령';

  let rawItems: FairnessRawOutputItem[] = [];

  if (gemini && isGeminiKeyConfigured()) {
    try {
      const systemPrompt = `당신은 공공계약 및 소프트웨어 사업 제안요청서 전문 공정성 검토관(Fairness Review Specialist)입니다.
수요기관과 제안업체(수급인) 간의 불공정 거래 조항, 일방적 위험 전가, 과도한 지체상금 및 무상 하자보수 강요 조항을 검토합니다.

[중요 제약사항]
1. 법 위반을 단정("위법하다", "불법이다", "무효이다")하지 마십시오.
2. 반드시 "검토 필요", "상호협의 권고", "공정거래 가이드라인 준수 권고"의 온건하고 균형 잡힌 어조로 작성하십시오.
3. 오직 본문에 실제로 존재하는 블록의 내용만을 근거로 지적하십시오. 허위 인용은 엄격히 금지됩니다.
4. 이미 규칙 엔진에서 탐지된 항목(${JSON.stringify(ruleFindingsSummary)})은 중복 지적하지 마십시오.
5. 출력은 반드시 지정된 JSON Array 포맷으로만 반환하십시오.`;

      const userContent = `[확정 사업 메타데이터]
- 수요기관: ${clientName} (${authoritativeMetadata?.client_type || '공공기관'})
- 적용법령: ${governingLaw}
- 계약방법: ${authoritativeMetadata?.procurement_method || '협상에 의한 계약'}

[검토 대상 문서 블록 (총 ${blocks.length}개)]
${blocks
  .slice(0, 40)
  .map((b) => `[ID: ${b.block_id}] ${b.text}`)
  .join('\n')}

[요청사항]
위 문서 블록 중에서 아래 공정성 검토 대상 조항을 찾아 JSON 배열로 응답하십시오:
1. 지식재산권 일방 귀속 조항 (공동 소유 원칙 위배 가능성)
2. 과도한 지체상금률 또는 무조건적 대금 삭감 조항
3. 무상 유지보수 강요 또는 과업 범위 외 무한 지원 요구 조항
4. 발주기관의 일방적 계약 해제·해지권 유보 조항

응답 JSON 스키마:
[
  {
    "rule_id": "FAIR-IP-001",
    "rule_name": "지식재산권 일방적 귀속 조항 검토",
    "title": "산출물 지식재산권 단독 소유 조항 (상호협의 필요)",
    "block_id": "해당 block_id",
    "matched_keyword": "핵심 키워드",
    "original_text": "인용한 원문 텍스트",
    "basis": "법적·지침상 검토 필요 배경 ('검토 필요' 어조)",
    "recommendation": "상호협의를 위한 구체적 수정 권고안",
    "severity": "WARNING"
  }
]`;

      const result = await generateContentWithFallback({
        contents: [
          { role: 'user', parts: [{ text: `${systemPrompt}\n\n${userContent}` }] },
        ],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      });

      const responseText = result.text || '';
      const parsed = JSON.parse(responseText);
      if (Array.isArray(parsed)) {
        rawItems = parsed;
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid')) {
        console.warn('[Gemini Fairness Agent] API key not valid; using domain heuristic engine.');
      } else {
        console.warn('[Gemini Fairness Agent] Using domain heuristic engine:', msg.slice(0, 120));
      }
    }

  }

  // Fallback / Domain Heuristic Engine for Korean Public Procurement Fairness
  if (rawItems.length === 0) {
    rawItems = runHeuristicFairnessAudit(blocks, ruleFindingsSummary);
  }

  // Schema Validation and Conversion to Finding
  const validatedFindings: Finding[] = [];
  const blockMap = new Map<string, DocumentBlock>();
  blocks.forEach((b) => blockMap.set(b.block_id, b));

  for (const item of rawItems) {
    // Basic finding schema validation
    if (!item.title || !item.basis || !item.recommendation) continue;

    // Soft-phrasing enforcement
    let basis = item.basis;
    if (!basis.includes('검토 필요') && !basis.includes('상호협의') && !basis.includes('권고')) {
      basis = `${basis}에 따라 관련 조항에 대한 추가 검토가 필요합니다.`;
    }

    let recommendation = item.recommendation;
    if (!recommendation.includes('상호협의') && !recommendation.includes('협의')) {
      recommendation = `당사자 간 상호협의를 통해 ${recommendation}`;
    }

    const targetBlock = item.block_id ? blockMap.get(item.block_id) : undefined;
    const blockId = targetBlock ? targetBlock.block_id : (blocks[0]?.block_id || 'para_fair_1');
    const locator: NativeLocator = targetBlock?.native_locator || { section_index: 0, paragraph_index: 0 };
    const originalText = item.original_text || targetBlock?.text || '검토 대상 원문';

    const findingId = `finding-fairness-${(item.rule_id || 'FAIR-001').toLowerCase()}-${blockId}`;

    validatedFindings.push({
      finding_id: findingId,
      project_id: projectId,
      rule_id: item.rule_id || 'FAIR-COMMON-001',
      rule_name: item.rule_name || '공정거래 가이드라인 검토',
      category: 'FAIRNESS',
      severity: item.severity === 'CRITICAL' ? 'CRITICAL' : 'WARNING',
      title: item.title,
      original_text: originalText,
      matched_keyword: item.matched_keyword || '공정성 검토 조항',
      source_refs: [
        {
          block_id: blockId,
          native_locator: locator,
          text: originalText,
        },
      ],
      basis,
      recommendation,
      decision: 'PENDING',
      decision_reason: null,
      decided_at: null,
      created_at: new Date().toISOString(),
    });
  }

  return validatedFindings;
}

/**
 * 도메인 기반 공정성 검토 휴리스틱 규칙 (공공SW사업 계약예규 및 하도급 가이드라인 기준)
 */
function runHeuristicFairnessAudit(
  blocks: DocumentBlock[],
  alreadyDetected: Array<{ rule_id: string; title: string; block_id: string }>
): FairnessRawOutputItem[] {
  const results: FairnessRawOutputItem[] = [];
  const handledBlocks = new Set(alreadyDetected.map((d) => d.block_id));

  for (const block of blocks) {
    const text = block.text;

    // 1. 지식재산권 일방적 귀속 탐지
    if (
      (text.includes('지식재산권') || text.includes('저작권') || text.includes('소유권')) &&
      (text.includes('발주기관에 귀속') || text.includes('수요기관에 귀속') || text.includes('전부 귀속') || text.includes('일체 귀속'))
    ) {
      if (!handledBlocks.has(block.block_id)) {
        results.push({
          rule_id: 'FAIR-IP-001',
          rule_name: '지식재산권 귀속 조항 공정성 검토',
          title: '지식재산권 일방적 귀속 조항 (공동 소유 협의 권고)',
          block_id: block.block_id,
          matched_keyword: '발주기관에 귀속',
          original_text: text,
          basis:
            '기획재정부 계약예규 용역계약일반조건 제56조에 따르면 계약목적물의 지식재산권은 발주기관과 계약상대자가 공동으로 소유하는 것이 원칙이므로, 단독 귀속 규정은 계약상대자의 권익을 제한할 우려가 있어 검토가 필요합니다.',
          recommendation:
            "'본 사업의 결과물로 발생하는 지식재산권은 발주기관과 계약상대자가 공동으로 소유함을 원칙으로 하며, 세부 배분 사항은 상호 협의하여 결정한다'로 수정을 권고합니다.",
          severity: 'WARNING',
        });
        handledBlocks.add(block.block_id);
      }
    }

    // 2. 무상 유지보수 또는 무한 하자보수 강요 조항
    if (
      (text.includes('하자보수') || text.includes('유지관리') || text.includes('무상')) &&
      (text.includes('무상으로 지원') || text.includes('무상으로 수행') || text.includes('추가 비용 없이') || text.includes('일체의 경비는 사업자'))
    ) {
      if (!handledBlocks.has(block.block_id)) {
        results.push({
          rule_id: 'FAIR-MAINT-001',
          rule_name: '무상 유지보수 강요 조항 검토',
          title: '과업 외 무상 지원 및 일방적 비용 전가 조항 (검토 필요)',
          block_id: block.block_id,
          matched_keyword: '무상으로 지원',
          original_text: text,
          basis:
            '소프트웨어 진흥법 제48조(소프트웨어사업 불공정행위의 금지) 및 공공SW사업 과업심의위원회 운영기준에 의거하여, 과업내용서에 명시되지 않은 추가 요구를 무상으로 강요하거나 수급인에게 일체의 경비를 전가하는 조항은 상호협의 및 적정 대가 지급 여부의 검토가 필요합니다.',
          recommendation:
            "무상 지원 범위를 법정 무상 하자보수 기간(1년 이내, 개발 하자 한정)으로 명확히 한정하고, 추가 요구사항은 '과업심의위원회 및 상호협의를 거쳐 적정 대가를 지급한다'로 수정할 것을 권고합니다.",
          severity: 'WARNING',
        });
        handledBlocks.add(block.block_id);
      }
    }

    // 3. 일방적 계약 해제 및 손해배상 전가 조항
    if (
      (text.includes('해제') || text.includes('해지')) &&
      (text.includes('이의를 제기할 수 없다') || text.includes('일방적으로 해제') || text.includes('손해배상을 청구할 수 없다'))
    ) {
      if (!handledBlocks.has(block.block_id)) {
        results.push({
          rule_id: 'FAIR-TERM-001',
          rule_name: '일방적 계약 해제권 유보 조항 검토',
          title: '계약상대자의 이의제기권을 배제하는 일방적 해제 조항 (검토 필요)',
          block_id: block.block_id,
          matched_keyword: '이의를 제기할 수 없다',
          original_text: text,
          basis:
            '약관의 규제에 관한 법률 제6조(일반원칙) 및 계약예규 일반조건에 따라 상대방의 정당한 항변권과 손해배상 청구권을 원천 차단하는 조항은 불공정 소지가 있으므로 법률적 검토가 필요합니다.',
          recommendation:
            "'계약 해제 또는 해지 사유 발생 시 사전에 14일 이상의 유예기간을 두어 서면 통지하고, 당사자 간 소명 및 상호협의 절차를 거친다'로 변경할 것을 권고합니다.",
          severity: 'WARNING',
        });
        handledBlocks.add(block.block_id);
      }
    }
  }

  return results;
}
