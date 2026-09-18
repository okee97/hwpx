import {
  ExtractedMetadata,
  ClientType,
  GoverningLaw,
  ProcurementMethod,
  CompetitionMethod,
  AwardMethod,
  EvidenceStatus,
  EvidenceQuote,
  CalculatedCandidate,
} from '../src/types/metadata';
import { DocumentBlock } from '../src/types/finding';
import { TableMatrix } from './rhwpAdapter';
import { getGeminiClient, generateContentWithFallback, isGeminiKeyConfigured } from './geminiClient';
import { buildDocumentIndex, DocumentNavigator } from './documentNavigator';

export interface MetadataExtractionInput {
  projectId: string;
  blocks: DocumentBlock[];
  tables?: TableMatrix[];
  rawText: string;
  fileName?: string;
  parsedMetadata?: any;
}

export interface AiMetadataResult {
  extracted: ExtractedMetadata;
  procurement_method_reason?: string;
  extracted_snippets?: Record<string, string>;
  is_ai_powered: boolean;
  metadata_judge_report?: string;
}

/**
 * Metadata Extractor v3:
 * 1. Document Indexer & Navigator initializes
 * 2. Specialized Scout retrieves targeted blocks & tables for 5 procurement domains
 * 3. Gemini Specialist extracts domain candidates (Demand vs Contract agency, Budget vs Calculated, Competition vs Award)
 * 4. AI Judge verifies candidate evidence against original source blocks and stamps final EvidenceStatus
 */
export async function extractMetadataWithGemini(
  input: MetadataExtractionInput
): Promise<AiMetadataResult> {
  const { projectId, blocks, tables = [], rawText, fileName = '문서.hwp' } = input;

  // Initialize Document Navigator
  const docIndex = buildDocumentIndex(blocks, tables, rawText);
  const navigator = new DocumentNavigator(docIndex);

  const gemini = getGeminiClient();

  if (gemini && isGeminiKeyConfigured()) {
    try {
      // Step 1: Autonomous Document Navigation by Domains
      // Domain 1: Overview & Agency
      const overviewBlocks = navigator.searchBlocks('사업명 과업명 용역명 수요기관 발주기관 발주처 조달청 계약담당관', { limit: 8 });
      const coverBlocks = blocks.slice(0, 15); // Cover page / early lines

      // Domain 2: Budget & Pricing
      const budgetBlocks = navigator.searchBlocks('사업예산 총예산 소요예산 추정가격 추정금액 기초금액 부가가치세 VAT', { limit: 8 });
      const budgetTables = navigator.searchTables('예산 추정가격 소요', 2);

      // Domain 3: Competition Method
      const competitionBlocks = navigator.searchBlocks('입찰방식 입찰참가자격 참가자격 일반경쟁 제한경쟁 지명경쟁 수의계약 지역제한 실적제한', { limit: 8 });

      // Domain 4: Award Method
      const awardBlocks = navigator.searchBlocks('낙찰자결정 사업자선정 제안서평가 기술평가 가격평가 협상에 의한 계약 적격심사 최저가', { limit: 8 });
      const evalTables = navigator.searchTables('평가 배점 제안서', 2);

      // Domain 5: Project Period
      const periodBlocks = navigator.searchBlocks('사업기간 과업기간 용역기간 계약기간 수행기간 착수일로부터 계약체결일로부터', { limit: 6 });

      const formatBlockList = (arr: Array<{ block_id: string; text: string; block_type?: string }>) =>
        arr.map((b) => `[${b.block_id}] (${b.block_type || 'PARAGRAPH'}) ${b.text}`).join('\n');

      const formatTableList = (tbls: TableMatrix[]) =>
        tbls
          .map(
            (t) =>
              `[표 ${t.table_id}: ${t.caption || '제목없음'}]\n` +
              t.rows.map((row) => row.join(' | ')).join('\n')
          )
          .join('\n\n');

      const dedupedOverview = Array.from(
        new Map([...coverBlocks, ...overviewBlocks].map((b) => [b.block_id, b])).values()
      );

      const evidenceDossier = `
[문서 파일명]: ${fileName}
[문서 총 문단 수]: ${blocks.length}개 / [표 개수]: ${tables.length}개

=== [1. 사업개요 / 기관 탐색 블록] ===
${formatBlockList(dedupedOverview)}

=== [2. 예산 및 가격 탐색 블록 & 표] ===
${formatBlockList(budgetBlocks)}
${formatTableList(budgetTables)}

=== [3. 입찰/경쟁형태 탐색 블록] ===
${formatBlockList(competitionBlocks)}

=== [4. 낙찰자 결정방식 / 평가기준 탐색 블록 & 표] ===
${formatBlockList(awardBlocks)}
${formatTableList(evalTables)}

=== [5. 사업기간 탐색 블록] ===
${formatBlockList(periodBlocks)}
`.trim();

      // Step 2 & 3: Metadata Specialist Candidate Extraction & AI Judge Verification in high-reasoning prompt
      const systemInstruction = `당신은 대한민국 공공계약 전문 심사관이자 'AI Metadata Judge(메타데이터 최종 판정관)'입니다.
제공된 Document Navigator 탐색 자료를 엄밀하게 대조하여 사업의 핵심 메타데이터를 확정하십시오.

[엄격한 판정 원칙]
1. [기관의 엄격한 분리]:
   - demand_agency: 과업의 실수요자/발주부서 (예: '서울특별시 강남구', '행정안전부 디지털정부국')
   - contract_agency: 입찰 공고 및 계약 체결 주체 (예: '조달청', '자체발주')
   - client_name: 수요기관명을 기본값으로 채우십시오.

2. [경쟁방법 vs 낙찰방법의 분리]:
   - competition_method:
     * "RESTRICTED_COMPETITIVE": 제한경쟁입찰 (지역/실적/면허/중소기업 제한)
     * "OPEN_COMPETITIVE": 일반경쟁입찰
     * "NOMINATED_COMPETITIVE": 지명경쟁입찰
     * "PRIVATE_CONTRACT": 수의계약
     * "UNKNOWN": 문서에 명시되지 않음
   - award_method:
     * "NEGOTIATION": 협상에 의한 계약 (기술 80~90% + 가격 10~20%)
     * "QUALIFICATION_REVIEW": 적격심사 (최저가 + 이행능력심사)
     * "LOWEST_PRICE": 최저가낙찰제
     * "TWO_STAGE": 2단계 경쟁
     * "SPEC_PRICE_SIMULTANEOUS": 규격·가격 동시입찰
     * "UNKNOWN": 문서에 명시되지 않음

3. [사업예산과 추정가격의 엄격한 구분 (가상값 및 임의계산 금지)]:
   - budget_amount: 문서 본문이나 표에 명시된 총 사업예산(원 단위 정수).
   - estimated_price: 문서에 명시적으로 '추정가격'이라는 단어와 함께 적힌 금액만 기재하십시오.
     * 문서에 '추정가격' 숫자가 없으면 반드시 null로 두십시오.
     * 부가가치세 10%를 역산한 금액은 절대로 estimated_price에 덮어쓰지 말고, calculated_candidates 목록에 참고 계산값으로만 넣으십시오!

4. [증거 상태 판정 (Evidence Status)]:
   - "EXPLICIT": 문서 본문/표에 단어 및 금액이 직접 적혀있음
   - "INFERRED": 명시적 표제어는 없으나 문맥상 명백하게 도출됨 (예: 강남구청 -> 지자체 -> 지방계약법)
   - "CALCULATED": 부가세 역산 등 계산에 의해 산출된 참고값
   - "CONFLICT": 문서 내 앞뒤 조항이 서로 모순되거나 금액/방식이 상충함
   - "UNVERIFIED": 문서에서 확인할 수 없음 (가짜 값 생성 엄금)

반드시 유효한 JSON 포맷으로만 응답하십시오.`;

      const userPrompt = `다음 Document Navigator 탐색 자료를 바탕으로 AI Judge 판정을 수행하고 JSON을 출력하십시오:

${evidenceDossier}

응답 JSON 스키마:
{
  "project_name": "사업명",
  "client_name": "수요기관명",
  "demand_agency": "수요기관",
  "contract_agency": "계약기관 (예: 조달청 또는 자체발주)",
  "client_type": "LOCAL_GOVERNMENT" | "CENTRAL_GOVERNMENT" | "PUBLIC_INSTITUTION" | "EDUCATIONAL" | "OTHER" | "UNKNOWN",
  "governing_law": "LOCAL_CONTRACT_ACT" | "STATE_CONTRACT_ACT" | "PUBLIC_ENTERPRISE_RULE" | "OTHER" | "UNKNOWN",
  "competition_method": "RESTRICTED_COMPETITIVE" | "OPEN_COMPETITIVE" | "NOMINATED_COMPETITIVE" | "PRIVATE_CONTRACT" | "UNKNOWN",
  "award_method": "NEGOTIATION" | "QUALIFICATION_REVIEW" | "LOWEST_PRICE" | "TWO_STAGE" | "SPEC_PRICE_SIMULTANEOUS" | "OTHER" | "UNKNOWN",
  "procurement_method_reason": "경쟁방법과 낙찰방법을 판정한 구체적 근거 및 문서 위치",
  "budget_amount": 1500000000 또는 null,
  "estimated_price": 1363636364 또는 null (문서에 명시된 경우만),
  "calculated_candidates": [
    {
      "label": "총사업예산 기준 부가세 10% 제외 추정 공급가액",
      "amount": 1363636364,
      "note": "총예산 ÷ 1.1 참고 계산값 (문서 미기재 시 참고용)"
    }
  ],
  "project_period": "착수일로부터 8개월" 또는 null,
  "judge_summary": "AI Judge의 종합 검증 소견",
  "evidence_status": {
    "project_name": "EXPLICIT",
    "client_name": "EXPLICIT",
    "client_type": "INFERRED",
    "governing_law": "INFERRED",
    "competition_method": "EXPLICIT",
    "award_method": "EXPLICIT",
    "budget_amount": "EXPLICIT",
    "estimated_price": "EXPLICIT" | "UNVERIFIED",
    "project_period": "EXPLICIT"
  },
  "evidence_quotes": {
    "competition_method": { "block_id": "블록ID", "quote": "원문 인용", "status": "EXPLICIT" },
    "award_method": { "block_id": "블록ID", "quote": "원문 인용", "status": "EXPLICIT" },
    "budget_amount": { "block_id": "블록ID", "quote": "원문 인용", "status": "EXPLICIT" },
    "project_period": { "block_id": "블록ID", "quote": "원문 인용", "status": "EXPLICIT" }
  }
}`;

      const { text, modelUsed } = await generateContentWithFallback(
        {
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          config: {
            // @ts-ignore
            systemInstruction,
            responseMimeType: 'application/json',
            temperature: 0.1,
          },
        },
        ['gemini-3.8-flash', 'gemini-3.1-flash-lite'],
        22000
      );

      let parsed: any = null;
      try {
        const cleaned = text.trim().replace(/^```json/i, '').replace(/```$/, '').trim();
        parsed = JSON.parse(cleaned);
      } catch (pe) {
        console.warn('[Gemini Metadata Judge Parse Warning]', pe);
      }

      if (parsed && typeof parsed === 'object') {
        const rawBudget =
          typeof parsed.budget_amount === 'number' && parsed.budget_amount > 0
            ? parsed.budget_amount
            : null;
        const rawEstimated =
          typeof parsed.estimated_price === 'number' && parsed.estimated_price > 0
            ? parsed.estimated_price
            : null;

        // Calculated candidates (never overwrite estimated_price)
        let calcCandidates: CalculatedCandidate[] = [];
        if (Array.isArray(parsed.calculated_candidates) && parsed.calculated_candidates.length > 0) {
          calcCandidates = parsed.calculated_candidates;
        } else if (rawBudget && !rawEstimated) {
          calcCandidates.push({
            label: '총사업예산 기준 부가세(10%) 역산 공급가액',
            amount: Math.round(rawBudget / 1.1),
            note: '총사업예산 ÷ 1.1 참고 계산값 (문서 내 추정가격 미기재)',
          });
        }

        const derivedProcurementMethod: ProcurementMethod =
          parsed.award_method === 'NEGOTIATION'
            ? 'NEGOTIATION'
            : parsed.competition_method === 'RESTRICTED_COMPETITIVE'
            ? 'RESTRICTED_COMPETITIVE'
            : parsed.competition_method === 'OPEN_COMPETITIVE'
            ? 'OPEN_COMPETITIVE'
            : parsed.competition_method === 'PRIVATE_CONTRACT'
            ? 'PRIVATE_CONTRACT'
            : 'UNKNOWN';

        const extracted: ExtractedMetadata = {
          project_id: projectId,
          project_name: parsed.project_name || fileName.replace(/\.[^/.]+$/, ''),
          client_name: parsed.client_name || parsed.demand_agency || null,
          demand_agency: parsed.demand_agency || parsed.client_name || null,
          contract_agency: parsed.contract_agency || null,
          client_type: (parsed.client_type as ClientType) || 'UNKNOWN',
          governing_law: (parsed.governing_law as GoverningLaw) || 'UNKNOWN',
          procurement_method: derivedProcurementMethod,
          competition_method: (parsed.competition_method as CompetitionMethod) || 'UNKNOWN',
          award_method: (parsed.award_method as AwardMethod) || 'UNKNOWN',
          procurement_method_reason: parsed.procurement_method_reason || 'AI Judge 문서 원문 대조 완료',
          budget_amount: rawBudget,
          estimated_price: rawEstimated, // 문서에 적혀있지 않으면 null 유지!
          calculated_candidates: calcCandidates,
          derived_estimated_price: calcCandidates[0]?.amount || null,
          derivation_note: calcCandidates[0]?.note || null,
          project_period: parsed.project_period || null,
          confidence_scores: {
            project_name: 0.95,
            client_name: 0.95,
            governing_law: 0.95,
            procurement_method: 0.95,
            competition_method: 0.95,
            award_method: 0.95,
            budget_amount: rawBudget ? 0.95 : 0.0,
            project_period: parsed.project_period ? 0.95 : 0.0,
          },
          evidence_status: parsed.evidence_status || {
            competition_method: parsed.competition_method !== 'UNKNOWN' ? 'EXPLICIT' : 'UNVERIFIED',
            award_method: parsed.award_method !== 'UNKNOWN' ? 'EXPLICIT' : 'UNVERIFIED',
            budget_amount: rawBudget ? 'EXPLICIT' : 'UNVERIFIED',
            estimated_price: rawEstimated ? 'EXPLICIT' : 'UNVERIFIED',
            project_period: parsed.project_period ? 'EXPLICIT' : 'UNVERIFIED',
          },
          evidence_quotes: parsed.evidence_quotes || {},
          source_references: {
            project_name: 'overview',
            client_name: 'overview',
            competition_method: parsed.evidence_quotes?.competition_method?.block_id || 'competition',
            award_method: parsed.evidence_quotes?.award_method?.block_id || 'award',
            budget_amount: parsed.evidence_quotes?.budget_amount?.block_id || 'budget',
            project_period: parsed.evidence_quotes?.project_period?.block_id || 'period',
          },
          is_ai_powered: true,
          analysis_engine: 'AI',
          model_used: modelUsed,
          fallback_used: modelUsed !== 'gemini-3.8-flash',
          requires_user_confirmation: true,
          extracted_at: new Date().toISOString(),
          status: 'AI_JUDGE_VERIFIED',
        };

        return {
          extracted,
          procurement_method_reason: parsed.procurement_method_reason,
          metadata_judge_report: parsed.judge_summary,
          is_ai_powered: true,
        };
      }
    } catch (aiErr: any) {
      const msg = aiErr?.message || String(aiErr);
      if (msg.includes('GEMINI_API_KEY') || msg.includes('API key') || msg.includes('API_KEY_INVALID')) {
        console.log('[MetadataExtractor v3] Gemini API 키 인증 불가로 안전한 규칙 기반 정밀 추출기로 전환합니다.');
      } else {
        console.log(`[MetadataExtractor v3] 규칙 기반 정밀 추출기로 전환합니다 (${msg.slice(0, 80)})`);
      }
    }
  }

  // Heuristic Fallback with Navigator
  return extractMetadataWithNavigatorFallback(navigator, projectId, fileName);
}

/**
 * Honest, non-fabricating fallback extractor using Document Navigator
 */
function extractMetadataWithNavigatorFallback(
  navigator: DocumentNavigator,
  projectId: string,
  fileName: string
): AiMetadataResult {
  // 1. Overview matches
  const overviewMatches = navigator.searchBlocks('사업명 과업명 수요기관 발주기관', { limit: 3 });
  let foundProjectName = fileName.replace(/\.[^/.]+$/, '');
  let foundClientName = '';

  for (const m of overviewMatches) {
    if (m.text.includes('사업명') || m.text.includes('과업명')) {
      const match = m.text.match(/(?:사업명|과업명)\s*[:：]\s*([^\n\r,]+)/);
      if (match && match[1]) foundProjectName = match[1].trim();
    }
    if (m.text.includes('수요기관') || m.text.includes('발주기관')) {
      const match = m.text.match(/(?:수요기관|발주기관|발주처)\s*[:：]\s*([^\n\r,]+)/);
      if (match && match[1]) foundClientName = match[1].trim();
    }
  }

  // 2. Budget matches (strict number parsing, NO fake 550,000,000)
  const budgetMatches = navigator.searchBlocks('사업예산 총예산 소요예산', { limit: 3 });
  let foundBudget: number | null = null;
  let budgetQuote: EvidenceQuote | undefined;

  for (const m of budgetMatches) {
    const numMatch = m.text.replace(/,/g, '').match(/(\d{6,13})\s*원/);
    if (numMatch && numMatch[1]) {
      foundBudget = parseInt(numMatch[1], 10);
      budgetQuote = {
        block_id: m.block_id,
        quote: m.text.slice(0, 100),
        status: 'EXPLICIT',
      };
      break;
    }
  }

  // 3. Competition method
  const compMatches = navigator.searchBlocks('일반경쟁 제한경쟁 지명경쟁 수의계약', { limit: 3 });
  let compMethod: CompetitionMethod = 'UNKNOWN';
  let compQuote: EvidenceQuote | undefined;

  for (const m of compMatches) {
    if (m.text.includes('제한경쟁')) {
      compMethod = 'RESTRICTED_COMPETITIVE';
      compQuote = { block_id: m.block_id, quote: m.text.slice(0, 100), status: 'EXPLICIT' };
      break;
    } else if (m.text.includes('일반경쟁')) {
      compMethod = 'OPEN_COMPETITIVE';
      compQuote = { block_id: m.block_id, quote: m.text.slice(0, 100), status: 'EXPLICIT' };
      break;
    } else if (m.text.includes('수의계약')) {
      compMethod = 'PRIVATE_CONTRACT';
      compQuote = { block_id: m.block_id, quote: m.text.slice(0, 100), status: 'EXPLICIT' };
      break;
    }
  }

  // 4. Award method
  const awardMatches = navigator.searchBlocks('협상에 의한 계약 적격심사 최저가', { limit: 3 });
  let awardMethod: AwardMethod = 'UNKNOWN';
  let awardQuote: EvidenceQuote | undefined;

  for (const m of awardMatches) {
    if (m.text.includes('협상에 의한 계약') || m.text.includes('협상에의한계약')) {
      awardMethod = 'NEGOTIATION';
      awardQuote = { block_id: m.block_id, quote: m.text.slice(0, 100), status: 'EXPLICIT' };
      break;
    } else if (m.text.includes('적격심사')) {
      awardMethod = 'QUALIFICATION_REVIEW';
      awardQuote = { block_id: m.block_id, quote: m.text.slice(0, 100), status: 'EXPLICIT' };
      break;
    }
  }

  // Calculated candidate
  const calcCandidates: CalculatedCandidate[] = [];
  if (foundBudget) {
    calcCandidates.push({
      label: '총사업예산 기준 부가세(10%) 역산 공급가액',
      amount: Math.round(foundBudget / 1.1),
      note: '총사업예산 ÷ 1.1 참고 계산값 (문서 내 추정가격 미기재)',
    });
  }

  const derivedProc: ProcurementMethod =
    awardMethod === 'NEGOTIATION'
      ? 'NEGOTIATION'
      : compMethod === 'RESTRICTED_COMPETITIVE'
      ? 'RESTRICTED_COMPETITIVE'
      : compMethod === 'OPEN_COMPETITIVE'
      ? 'OPEN_COMPETITIVE'
      : 'UNKNOWN';

  const extracted: ExtractedMetadata = {
    project_id: projectId,
    project_name: foundProjectName,
    client_name: foundClientName || null,
    demand_agency: foundClientName || null,
    contract_agency: null,
    client_type: 'UNKNOWN',
    governing_law: 'UNKNOWN',
    procurement_method: derivedProc,
    competition_method: compMethod,
    award_method: awardMethod,
    procurement_method_reason: 'Document Navigator 키워드 탐색 결과',
    budget_amount: foundBudget,
    estimated_price: null, // 명시 없으면 null 유지
    calculated_candidates: calcCandidates,
    derived_estimated_price: calcCandidates[0]?.amount || null,
    derivation_note: calcCandidates[0]?.note || null,
    project_period: null,
    confidence_scores: {
      project_name: 0.7,
      client_name: foundClientName ? 0.7 : 0.0,
      governing_law: 0.0,
      procurement_method: 0.7,
      competition_method: compMethod !== 'UNKNOWN' ? 0.8 : 0.0,
      award_method: awardMethod !== 'UNKNOWN' ? 0.8 : 0.0,
      budget_amount: foundBudget ? 0.85 : 0.0,
      project_period: 0.0,
    },
    evidence_status: {
      competition_method: compMethod !== 'UNKNOWN' ? 'EXPLICIT' : 'UNVERIFIED',
      award_method: awardMethod !== 'UNKNOWN' ? 'EXPLICIT' : 'UNVERIFIED',
      budget_amount: foundBudget ? 'EXPLICIT' : 'UNVERIFIED',
      estimated_price: 'UNVERIFIED',
      project_period: 'UNVERIFIED',
    },
    evidence_quotes: {
      ...(compQuote ? { competition_method: compQuote } : {}),
      ...(awardQuote ? { award_method: awardQuote } : {}),
      ...(budgetQuote ? { budget_amount: budgetQuote } : {}),
    },
    source_references: {},
    is_ai_powered: false,
    analysis_engine: 'RULE_FALLBACK',
    requires_user_confirmation: true,
    extracted_at: new Date().toISOString(),
    status: 'NAVIGATOR_FALLBACK_EXTRACTED',
  };

  return {
    extracted,
    procurement_method_reason: 'Navigator 폴백 탐색 완료',
    is_ai_powered: false,
  };
}
