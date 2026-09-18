import {
  ExtractedMetadata,
  ClientType,
  GoverningLaw,
  ProcurementMethod,
  CompetitionMethod,
  AwardMethod,
  EvidenceStatus,
  EvidenceQuote,
} from '../src/types/metadata';
import { DocumentBlock } from '../src/types/finding';
import { getGeminiClient, generateContentWithFallback, isGeminiKeyConfigured } from './geminiClient';

export interface MetadataExtractionInput {
  projectId: string;
  blocks: DocumentBlock[];
  rawText: string;
  fileName?: string;
  parsedMetadata?: any;
}

export interface AiMetadataResult {
  extracted: ExtractedMetadata;
  procurement_method_reason?: string;
  extracted_snippets?: Record<string, string>;
  is_ai_powered: boolean;
}

/**
 * AI Document Mapper:
 * Scans all document blocks to scout target blocks for 5 core domains:
 * 1. Overview & Demand Agency (사업개요, 사업명, 수요기관)
 * 2. Budget & Pricing (사업예산, 추정가격, 부가세)
 * 3. Competition Method (입찰/경쟁 형태: 일반경쟁, 제한경쟁, 지명경쟁, 수의계약)
 * 4. Award Method (낙찰자 결정방식: 협상에 의한 계약, 적격심사, 최저가 등)
 * 5. Project Period (사업기간, 과업기간)
 */
function scoutTargetBlocks(blocks: DocumentBlock[], rawText: string) {
  // If no blocks provided, synthesize paragraph blocks from rawText
  const activeBlocks: DocumentBlock[] =
    blocks && blocks.length > 0
      ? blocks
      : rawText
          .split('\n')
          .map((line, idx) => ({
            block_id: `para_gen_${idx + 1}`,
            block_type: 'PARAGRAPH' as const,
            text: line.trim(),
            native_locator: { section_index: 0, paragraph_index: idx },
          }))
          .filter((b) => b.text.length > 0);

  const overviewBlocks: DocumentBlock[] = [];
  const budgetBlocks: DocumentBlock[] = [];
  const competitionBlocks: DocumentBlock[] = [];
  const awardBlocks: DocumentBlock[] = [];
  const periodBlocks: DocumentBlock[] = [];

  const overviewRegex = /(?:사업명|과업명|용역명|수요기관|발주기관|발주처|공고명|추진배경|사업목적)/;
  const budgetRegex = /(?:사업예산|총예산|소요예산|예산액|추정가격|추정금액|배정예산|부가세|VAT|원\s*\(VAT|단위\s*:\s*원)/;
  const competitionRegex = /(?:입찰\s*방식|경쟁\s*형태|입찰\s*참가\s*자격|일반경쟁|제한경쟁|지명경쟁|수의계약|중소기업자간경쟁|지역제한)/;
  const awardRegex = /(?:낙찰자\s*결정|사업자\s*선정|선정\s*방식|협상에\s*의한\s*계약|적격심사|최저가|기술평가|가격평가|제안서\s*평가|기술능력평가|종합평가)/;
  const periodRegex = /(?:사업기간|과업기간|용역기간|계약기간|수행기간|착수일로부터|계약체결일로부터)/;

  activeBlocks.forEach((block, idx) => {
    // Early document blocks (first 25 blocks) are often title/overview
    if (idx < 25) {
      overviewBlocks.push(block);
    }
    if (overviewRegex.test(block.text) && !overviewBlocks.includes(block)) {
      overviewBlocks.push(block);
    }
    if (budgetRegex.test(block.text)) {
      budgetBlocks.push(block);
    }
    if (competitionRegex.test(block.text)) {
      competitionBlocks.push(block);
    }
    if (awardRegex.test(block.text)) {
      awardBlocks.push(block);
    }
    if (periodRegex.test(block.text)) {
      periodBlocks.push(block);
    }
  });

  // Limit counts to keep prompt dense and precise
  return {
    activeBlocks,
    overviewBlocks: overviewBlocks.slice(0, 30),
    budgetBlocks: budgetBlocks.slice(0, 30),
    competitionBlocks: competitionBlocks.slice(0, 30),
    awardBlocks: awardBlocks.slice(0, 30),
    periodBlocks: periodBlocks.slice(0, 20),
  };
}

/**
 * Metadata Extractor v2 Architecture:
 * 1. AI Document Mapper (Target blocks identification across full document)
 * 2. Specialized Multi-Domain Extraction with Zero Bias (No default assumptions)
 * 3. AI Judge & Source Verification (Verifies quotes and block_ids against real document)
 * 4. Separate competition_method vs award_method
 */
export async function extractMetadataWithGemini(
  input: MetadataExtractionInput
): Promise<AiMetadataResult> {
  const { projectId, blocks, rawText = '', fileName = '', parsedMetadata } = input;
  const gemini = getGeminiClient();

  const cleanFileName = fileName
    .replace(/\.(hwp|hwpx|hwt)$/i, '')
    .replace(/[_-]/g, ' ')
    .trim();
  const docTitle = parsedMetadata?.title || cleanFileName || '공공 사업 문서';

  // Step 1: Scout target blocks across the entire document
  const scouted = scoutTargetBlocks(blocks, rawText);
  const { activeBlocks, overviewBlocks, budgetBlocks, competitionBlocks, awardBlocks, periodBlocks } = scouted;

  if (gemini && isGeminiKeyConfigured()) {
    try {
      const formatBlocks = (arr: DocumentBlock[]) =>
        arr.map((b) => `[${b.block_id}] ${b.text}`).join('\n');

      const targetedContext = `
[문서 기본 메타데이터]
- 파일명: ${fileName}
- 파서 감지 제목: ${docTitle}
- 전체 블록 수: ${activeBlocks.length}개

=== [도메인 1: 사업개요 / 발주기관 후보 블록 (${overviewBlocks.length}건)] ===
${formatBlocks(overviewBlocks) || '(감지된 후보 블록 없음)'}

=== [도메인 2: 예산 및 추정가격 후보 블록 (${budgetBlocks.length}건)] ===
${formatBlocks(budgetBlocks) || '(감지된 후보 블록 없음)'}

=== [도메인 3: 입찰(경쟁)방법 후보 블록 (${competitionBlocks.length}건)] ===
${formatBlocks(competitionBlocks) || '(감지된 후보 블록 없음)'}

=== [도메인 4: 낙찰자 결정방법 / 제안서 평가 후보 블록 (${awardBlocks.length}건)] ===
${formatBlocks(awardBlocks) || '(감지된 후보 블록 없음)'}

=== [도메인 5: 사업기간 후보 블록 (${periodBlocks.length}건)] ===
${formatBlocks(periodBlocks) || '(감지된 후보 블록 없음)'}
`.trim();

      const systemInstruction = `당신은 대한민국 공공조달 및 제안요청서(RFP) 계약심사 수석 행정관이자 객관적 AI 검토관입니다.
제공된 공문서의 후보 블록들을 정밀 대조하여 사업정보 메타데이터를 객관적으로 추출하십시오.

[절대 준수 판정 원칙]
1. 편향 및 추정 배제 (NO BIAS):
   - "정보화 사업은 대개 협상계약이다"와 같은 관행이나 편견에 기대지 마십시오.
   - 반드시 문서에 직접 기재된 표현만을 근거로 삼으십시오.
   - 문서에 명확한 근거가 없으면 망설이지 말고 반드시 "UNKNOWN" 또는 null을 선택하십시오.

2. 경쟁방법(competition_method)과 낙찰방법(award_method)의 명확한 분리:
   - 대한민국 공공계약에서 경쟁방식과 낙찰방식은 별개의 독립된 축입니다.
   - [경쟁방법 competition_method]:
     * "OPEN_COMPETITIVE": 일반경쟁입찰
     * "RESTRICTED_COMPETITIVE": 제한경쟁입찰 (지역제한, 실적제한, 중소기업자간경쟁 등)
     * "NOMINATED_COMPETITIVE": 지명경쟁입찰
     * "PRIVATE_CONTRACT": 수의계약 (단순 조항 언급이 아닌 본 용역의 주 계약방식인 경우)
     * "UNKNOWN": 문서 미기재
   - [낙찰자 결정방법 award_method]:
     * "NEGOTIATION": 협상에 의한 계약 (기술평가 80~90% + 가격평가 10~20%)
     * "QUALIFICATION_REVIEW": 적격심사 (최저가 입찰 후 이행능력 심사)
     * "LOWEST_PRICE": 최저가낙찰제
     * "TWO_STAGE": 2단계 경쟁
     * "SPEC_PRICE_SIMULTANEOUS": 규격·가격 동시입찰
     * "OTHER": 기타
     * "UNKNOWN": 문서 미기재

3. 사업예산 (budget_amount) & 추정가격 (estimated_price):
   - 문서에 실제로 적혀있는 숫자(원 단위 정수)만 추출하십시오.
   - 예산이 없으면 550,000,000원 등 가짜 숫자를 임의로 만들어내지 말고 null로 반환하십시오.
   - 추정가격이 문서에 별도로 기재되어 있으면 그 숫자를 반환하고, 기재되어 있지 않으면 null로 반환하십시오.
   - vat_included: 예산에 부가가치세가 포함되어 있는지 boolean (true/false/null).

4. 증거 및 상태 판정 (Evidence Status):
   - 각 필드마다 아래 상태값 중 하나를 반드시 부여하십시오:
     * "EXPLICIT": 문서에 명확하게 단어와 숫자가 적혀있음
     * "INFERRED": 명시적 항목은 없으나 문맥상 확실하게 도출됨
     * "CALCULATED": 산출 공식에 의해 역산됨
     * "CONFLICT": 문서 내 앞뒤 조항이 서로 모순되거나 상충함
     * "UNVERIFIED": 확인 불가
   - 각 필드 판단에 결정적 역할을 한 블록의 [block_id]와 원문 문장(quote)을 정확히 기재하십시오.

반드시 유효한 JSON 형식으로만 응답하십시오.`;

      const userPrompt = `다음 공문서 후보 블록들을 정밀 분석하여 JSON 객체를 출력하십시오:

${targetedContext}

응답 JSON 구조:
{
  "project_name": "사업명 텍스트",
  "client_name": "수요기관명 (예: 서울특별시 강남구)",
  "client_type": "LOCAL_GOVERNMENT" | "CENTRAL_GOVERNMENT" | "PUBLIC_INSTITUTION" | "EDUCATIONAL" | "OTHER" | "UNKNOWN",
  "governing_law": "LOCAL_CONTRACT_ACT" | "STATE_CONTRACT_ACT" | "PUBLIC_ENTERPRISE_RULE" | "OTHER" | "UNKNOWN",
  "competition_method": "OPEN_COMPETITIVE" | "RESTRICTED_COMPETITIVE" | "NOMINATED_COMPETITIVE" | "PRIVATE_CONTRACT" | "UNKNOWN",
  "award_method": "NEGOTIATION" | "QUALIFICATION_REVIEW" | "LOWEST_PRICE" | "TWO_STAGE" | "SPEC_PRICE_SIMULTANEOUS" | "OTHER" | "UNKNOWN",
  "procurement_method_reason": "경쟁방법과 낙찰방법을 판정한 구체적 근거 설명",
  "budget_amount": 1450000000 또는 null,
  "estimated_price": 1318181818 또는 null,
  "vat_included": true | false | null,
  "project_period": "착수일로부터 10개월" 또는 null,
  "evidence_status": {
    "project_name": "EXPLICIT",
    "client_name": "EXPLICIT",
    "client_type": "INFERRED",
    "governing_law": "INFERRED",
    "competition_method": "EXPLICIT",
    "award_method": "EXPLICIT",
    "budget_amount": "EXPLICIT",
    "project_period": "EXPLICIT"
  },
  "evidence_quotes": {
    "competition_method": {
      "block_id": "블록ID",
      "quote": "원문 인용문",
      "status": "EXPLICIT"
    },
    "award_method": {
      "block_id": "블록ID",
      "quote": "원문 인용문",
      "status": "EXPLICIT"
    },
    "budget_amount": {
      "block_id": "블록ID",
      "quote": "원문 인용문",
      "status": "EXPLICIT"
    },
    "project_period": {
      "block_id": "블록ID",
      "quote": "원문 인용문",
      "status": "EXPLICIT"
    }
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
        18000
      );
      const fallbackUsed = modelUsed !== 'gemini-3.8-flash';

      let parsed: any = null;
      try {
        const cleaned = text.trim().replace(/^```json/i, '').replace(/```$/, '').trim();
        parsed = JSON.parse(cleaned);
      } catch (pe) {
        console.warn('[Gemini Metadata Parse Warning]', pe);
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

        // Derived estimated price (only if raw budget exists and explicit estimate doesn't)
        const derivedEst = !rawEstimated && rawBudget ? Math.round(rawBudget / 1.1) : null;
        const derivationNote = derivedEst
          ? '총사업예산 기반 역산 (부가가치세 10% 제외 공급가액: 예산 ÷ 1.1 반올림)'
          : null;

        const validatedClientType = validateClientType(parsed.client_type, parsed.client_name);
        const validatedGovLaw = validateGoverningLaw(parsed.governing_law, validatedClientType);
        const validatedCompMethod = validateCompetitionMethod(parsed.competition_method);
        const validatedAwardMethod = validateAwardMethod(parsed.award_method);

        // Map combined legacy procurement_method for backward compatibility
        const legacyProcMethod: ProcurementMethod =
          validatedAwardMethod === 'NEGOTIATION'
            ? 'NEGOTIATION'
            : validatedCompMethod === 'RESTRICTED_COMPETITIVE'
            ? 'RESTRICTED_COMPETITIVE'
            : validatedCompMethod === 'OPEN_COMPETITIVE'
            ? 'OPEN_COMPETITIVE'
            : validatedCompMethod === 'PRIVATE_CONTRACT'
            ? 'PRIVATE_CONTRACT'
            : 'UNKNOWN';

        // Source Validator: Verify evidence quotes against activeBlocks
        const blockTextMap = new Map<string, string>();
        activeBlocks.forEach((b) => blockTextMap.set(b.block_id, b.text));

        const validatedEvidenceQuotes: Record<string, EvidenceQuote> = {};
        if (parsed.evidence_quotes && typeof parsed.evidence_quotes === 'object') {
          for (const [key, val] of Object.entries(parsed.evidence_quotes)) {
            const eq = val as any;
            if (eq && typeof eq === 'object') {
              const blkId = eq.block_id;
              const quote = eq.quote || '';
              const realText = blkId ? blockTextMap.get(blkId) : null;
              const isRealMatch = realText ? realText.includes(quote.slice(0, 15)) : false;

              validatedEvidenceQuotes[key] = {
                block_id: blkId,
                quote,
                note: eq.note || (isRealMatch ? '원문 대조 일치' : '블록 참조'),
                status: (eq.status as EvidenceStatus) || (isRealMatch ? 'EXPLICIT' : 'INFERRED'),
              };
            }
          }
        }

        const evidenceStatusMap: Record<string, EvidenceStatus> = {
          project_name: (parsed.evidence_status?.project_name as EvidenceStatus) || (parsed.project_name ? 'EXPLICIT' : 'UNVERIFIED'),
          client_name: (parsed.evidence_status?.client_name as EvidenceStatus) || (parsed.client_name ? 'EXPLICIT' : 'UNVERIFIED'),
          client_type: (parsed.evidence_status?.client_type as EvidenceStatus) || (validatedClientType !== 'UNKNOWN' ? 'INFERRED' : 'UNVERIFIED'),
          governing_law: (parsed.evidence_status?.governing_law as EvidenceStatus) || (validatedGovLaw !== 'UNKNOWN' ? 'INFERRED' : 'UNVERIFIED'),
          competition_method: (parsed.evidence_status?.competition_method as EvidenceStatus) || (validatedCompMethod !== 'UNKNOWN' ? 'EXPLICIT' : 'UNVERIFIED'),
          award_method: (parsed.evidence_status?.award_method as EvidenceStatus) || (validatedAwardMethod !== 'UNKNOWN' ? 'EXPLICIT' : 'UNVERIFIED'),
          budget_amount: (parsed.evidence_status?.budget_amount as EvidenceStatus) || (rawBudget ? 'EXPLICIT' : 'UNVERIFIED'),
          estimated_price: (parsed.evidence_status?.estimated_price as EvidenceStatus) || (rawEstimated ? 'EXPLICIT' : derivedEst ? 'CALCULATED' : 'UNVERIFIED'),
          project_period: (parsed.evidence_status?.project_period as EvidenceStatus) || (parsed.project_period ? 'EXPLICIT' : 'UNVERIFIED'),
        };

        const extracted: ExtractedMetadata = {
          project_id: projectId,
          project_name: parsed.project_name || docTitle,
          client_name: parsed.client_name || null,
          client_type: validatedClientType,
          governing_law: validatedGovLaw,
          procurement_method: legacyProcMethod,
          competition_method: validatedCompMethod,
          award_method: validatedAwardMethod,
          budget_amount: rawBudget,
          estimated_price: rawEstimated,
          derived_estimated_price: derivedEst,
          derivation_note: derivationNote,
          requires_user_confirmation: true,
          project_period: parsed.project_period || null,
          is_ai_powered: true,
          analysis_engine: 'AI',
          model_used: modelUsed,
          fallback_used: fallbackUsed,
          confidence_scores: {
            project_name: parsed.project_name ? 0.95 : 0.4,
            client_name: parsed.client_name ? 0.95 : 0.3,
            client_type: validatedClientType === 'UNKNOWN' ? 0.2 : 0.92,
            governing_law: validatedGovLaw === 'UNKNOWN' ? 0.2 : 0.92,
            competition_method: validatedCompMethod === 'UNKNOWN' ? 0.2 : 0.95,
            award_method: validatedAwardMethod === 'UNKNOWN' ? 0.2 : 0.95,
            procurement_method: legacyProcMethod === 'UNKNOWN' ? 0.2 : 0.95,
            budget_amount: rawBudget ? 0.96 : 0.2,
            estimated_price: rawEstimated ? 0.92 : derivedEst ? 0.85 : 0.2,
          },
          evidence_status: evidenceStatusMap,
          evidence_quotes: validatedEvidenceQuotes,
          source_references: {
            competition_method: validatedEvidenceQuotes.competition_method?.block_id || '경쟁방식 탐색 블록',
            award_method: validatedEvidenceQuotes.award_method?.block_id || '낙찰자결정 탐색 블록',
            budget_amount: validatedEvidenceQuotes.budget_amount?.block_id || (rawBudget ? '예산 표/문단' : '미기재'),
            project_period: validatedEvidenceQuotes.project_period?.block_id || (parsed.project_period ? '사업기간 문단' : '미기재'),
          },
          extracted_at: new Date().toISOString(),
          status: 'COMPLETED',
        };

        return {
          extracted,
          procurement_method_reason: parsed.procurement_method_reason,
          extracted_snippets: {
            competition_method: validatedEvidenceQuotes.competition_method?.quote || '',
            award_method: validatedEvidenceQuotes.award_method?.quote || '',
            budget: validatedEvidenceQuotes.budget_amount?.quote || '',
            period: validatedEvidenceQuotes.project_period?.quote || '',
          },
          is_ai_powered: true,
        };
      }
    } catch (geminiErr: any) {
      console.warn('[Gemini Metadata Extraction Fallback]', geminiErr?.message || geminiErr);
    }
  }

  // Fallback to high-precision Korean procurement heuristic (Context-aware, zero-hallucination)
  const fallbackExtracted = extractMetadataRuleBasedFallback(projectId, activeBlocks, rawText, fileName, parsedMetadata);
  return {
    extracted: fallbackExtracted,
    is_ai_powered: false,
  };
}

/**
 * High-Precision Rule-Based Fallback Engine (with competition/award separation)
 */
export function extractMetadataRuleBasedFallback(
  projectId: string,
  blocks: DocumentBlock[],
  rawText: string,
  fileName?: string,
  parsedMetadata?: any
): ExtractedMetadata {
  const cleanNameFromFilename = fileName
    ? fileName
        .replace(/\.(hwp|hwpx|hwt)$/i, '')
        .replace(/[_-]/g, ' ')
        .replace(/\s*(과업지시서|제안요청서|공고서|기본계획서|RFP|규격서|최종본|최종|수정본|안내서)/gi, '')
        .trim()
    : '';

  const allLines = [
    fileName || '',
    cleanNameFromFilename,
    parsedMetadata?.title || '',
    rawText,
    ...blocks.map((b) => b.text),
  ]
    .filter(Boolean)
    .join('\n');

  // 1) 사업명
  let projectName = cleanNameFromFilename || parsedMetadata?.title || null;
  const nameMatch = allLines.match(/(?:사\s*업\s*명|과\s*업\s*명|용\s*역\s*명|공\s*고\s*명|건\s*명|문\s*서\s*명)\s*[:：]?\s*([^\n\r]+)/);
  if (nameMatch && nameMatch[1].trim().length > 3) {
    projectName = nameMatch[1].trim().replace(/^['"“‘\[]+|['"”’\]]+$/g, '').trim();
  }

  // 2) 발주기관 / 수요기관
  let clientName: string | null = null;
  const explicitClientMatch = allLines.match(
    /(?:수\s*요\s*기\s*관|발\s*주\s*기\s*관|발\s*주\s*처|공\s*고\s*기\s*관|주\s*관\s*기\s*관)\s*[:：]?\s*([가-힣A-Za-z0-9\s()]+?)(?:\r|\n|[(]|<|$)/
  );
  if (explicitClientMatch && explicitClientMatch[1].trim().length >= 2) {
    clientName = explicitClientMatch[1].trim();
  } else {
    const centralMatch = allLines.match(
      /(?:과학기술정보통신부|행정안전부|보건복지부|국토교통부|산업통상자원부|중소벤처기업부|환경부|고용노동부|교육부|문화체육관광부|국방부|외교부|통일부|법무부|기획재정부|여성가족부|해양수산부|농림축산식품부|조달청|경찰청|소방청|국세청|관세청|산림청|기상청|특허청|질병관리청|통계청|방위사업청|인사혁신처|법제처|국가보훈부|식품의약품안전처|공정거래위원회|금융위원회|방송통신위원회|개인정보보호위원회)/
    );
    const pubMatch = allLines.match(
      /(?:한국지능정보사회진흥원|정보통신산업진흥원|국민건강보험공단|한국전력공사|도로교통공단|한국토지주택공사|한국도로공사|한국가스공사|한국수자원공사|건강보험심사평가원|한국고용정보원|한국지역정보개발원|한국인터넷진흥원|[가-힣]+(?:진흥원|정보개발원|연구원|공사|공단|재단|협회|기술원))/
    );
    const localMatch = allLines.match(
      /([가-힣]+(?:특별시|광역시|특별자치시|도|특별자치도)\s+[가-힣]+(?:구|군|시))|([가-힣]+(?:구청|시청|군청|도청))/
    );

    if (centralMatch) {
      clientName = centralMatch[0].trim();
    } else if (localMatch) {
      clientName = localMatch[0].trim();
    } else if (pubMatch) {
      clientName = pubMatch[0].trim();
    }
  }

  // 3) 기관유형 및 적용법령
  let clientType: ClientType = 'UNKNOWN';
  let governingLaw: GoverningLaw = 'UNKNOWN';

  if (clientName) {
    if (/부|처|청|위원회/.test(clientName) && !/구청|시청|군청/.test(clientName)) {
      clientType = 'CENTRAL_GOVERNMENT';
      governingLaw = 'STATE_CONTRACT_ACT';
    } else if (/공사|공단|진흥원|연구원|재단|협회|센터|개발원/.test(clientName)) {
      clientType = 'PUBLIC_INSTITUTION';
      governingLaw = 'PUBLIC_ENTERPRISE_RULE';
    } else if (/교육청|학교/.test(clientName)) {
      clientType = 'EDUCATIONAL';
      governingLaw = 'LOCAL_CONTRACT_ACT';
    } else if (/구청|시청|군청|도청|광역시|특별시|자치시|자치도/.test(clientName)) {
      clientType = 'LOCAL_GOVERNMENT';
      governingLaw = 'LOCAL_CONTRACT_ACT';
    } else {
      clientType = 'OTHER';
      governingLaw = 'OTHER';
    }
  }

  // 4) 경쟁방법 (Competition Method) & 낙찰방법 (Award Method) 분리 탐색
  const procurementSectionMatch = allLines.match(
    /(?:사업자\s*선정\s*방식|입찰\s*방식|계약\s*방법|낙찰자\s*결정\s*방식|입찰\s*및\s*낙찰자)[\s\S]{1,600}/
  );
  const procurementContext = procurementSectionMatch ? procurementSectionMatch[0] : allLines;

  // 경쟁방법
  let competitionMethod: CompetitionMethod = 'UNKNOWN';
  if (/제한경쟁|중소기업자간경쟁|지역제한|실적제한/.test(procurementContext)) {
    competitionMethod = 'RESTRICTED_COMPETITIVE';
  } else if (/일반경쟁/.test(procurementContext)) {
    competitionMethod = 'OPEN_COMPETITIVE';
  } else if (/지명경쟁/.test(procurementContext)) {
    competitionMethod = 'NOMINATED_COMPETITIVE';
  } else if (/(?:계약\s*방법|입찰\s*방식)\s*[:：]?\s*수의계약/.test(procurementContext)) {
    competitionMethod = 'PRIVATE_CONTRACT';
  }

  // 낙찰자 결정방법
  let awardMethod: AwardMethod = 'UNKNOWN';
  if (/협상에\s*의한\s*계약|제안서\s*평가|기술\s*(?:능력)?\s*평가|기술평가\s*[0-9]+%|기술\s*:\s*가격/.test(procurementContext)) {
    awardMethod = 'NEGOTIATION';
  } else if (/적격심사/.test(procurementContext)) {
    awardMethod = 'QUALIFICATION_REVIEW';
  } else if (/최저가\s*낙찰제|최저가격/.test(procurementContext)) {
    awardMethod = 'LOWEST_PRICE';
  } else if (/2단계\s*경쟁|규격·가격\s*동시/.test(procurementContext)) {
    awardMethod = 'TWO_STAGE';
  }

  // 하위 호환
  const legacyProcMethod: ProcurementMethod =
    awardMethod === 'NEGOTIATION'
      ? 'NEGOTIATION'
      : competitionMethod === 'RESTRICTED_COMPETITIVE'
      ? 'RESTRICTED_COMPETITIVE'
      : competitionMethod === 'OPEN_COMPETITIVE'
      ? 'OPEN_COMPETITIVE'
      : competitionMethod === 'PRIVATE_CONTRACT'
      ? 'PRIVATE_CONTRACT'
      : 'UNKNOWN';

  // 5) 사업예산 및 추정가격
  let budgetAmount: number | null = null;
  let explicitEstimatedPrice: number | null = null;

  const eokMatch = allLines.match(/(?:사\s*업\s*예\s*산|총\s*예\s*산|예\s*산\s*액|소\s*요\s*예\s*산|사\s*업\s*비|계\s*약\s*금\s*액)\s*[:：]?\s*(?:금\s*)?([0-9]+)\s*억\s*([0-9,]+)?\s*만?\s*원?/);
  if (eokMatch) {
    const eok = parseInt(eokMatch[1], 10) * 100000000;
    let man = 0;
    if (eokMatch[2]) {
      const manStr = eokMatch[2].replace(/,/g, '');
      man = parseInt(manStr, 10) * 10000;
    }
    budgetAmount = eok + man;
  } else {
    const numMatch = allLines.match(/(?:사\s*업\s*예\s*산|총\s*예\s*산|예\s*산\s*액|소\s*요\s*예\s*산|사\s*업\s*비|추\s*정\s*금\s*액|배\s*정\s*예\s*산)\s*[:：]?\s*(?:일금\s*)?([0-9,]{4,15})\s*(?:원)?/);
    if (numMatch) {
      const parsed = parseInt(numMatch[1].replace(/,/g, ''), 10);
      if (!isNaN(parsed) && parsed >= 1000000) {
        budgetAmount = parsed;
      }
    }
  }

  const estMatch = allLines.match(/(?:추\s*정\s*가\s*격|추\s*정\s*가)\s*[:：]?\s*(?:일금\s*)?([0-9,]{4,15})\s*(?:원)?/);
  if (estMatch) {
    const parsedEst = parseInt(estMatch[1].replace(/,/g, ''), 10);
    if (!isNaN(parsedEst) && parsedEst > 0) {
      explicitEstimatedPrice = parsedEst;
    }
  }

  const derivedEstimatedPrice = !explicitEstimatedPrice && budgetAmount ? Math.round(budgetAmount / 1.1) : null;
  const derivationNote = derivedEstimatedPrice
    ? '총사업예산 기반 역산 (부가가치세 10% 제외 공식: 예산 ÷ 1.1)'
    : null;

  // 6) 사업기간
  let projectPeriod: string | null = null;
  const periodMatch = allLines.match(/(?:사\s*업\s*기\s*간|과\s*업\s*기\s*간|용\s*역\s*기\s*간|계\s*약\s*기\s*간)\s*[:：]?\s*([^\n\r]{3,60})/);
  if (periodMatch) {
    projectPeriod = periodMatch[1].trim().replace(/^['"“‘\[]+|['"”’\]]+$/g, '').trim();
  } else {
    const dateRangeMatch = allLines.match(/\d{4}[.\-/년]\s*\d{1,2}[.\-/월]\s*\d{1,2}[일]?\s*~\s*\d{4}[.\-/년]\s*\d{1,2}[.\-/월]\s*\d{1,2}[일]?/);
    if (dateRangeMatch) {
      projectPeriod = dateRangeMatch[0].trim();
    }
  }

  return {
    project_id: projectId,
    project_name: projectName,
    client_name: clientName,
    client_type: clientType,
    governing_law: governingLaw,
    procurement_method: legacyProcMethod,
    competition_method: competitionMethod,
    award_method: awardMethod,
    budget_amount: budgetAmount,
    estimated_price: explicitEstimatedPrice,
    derived_estimated_price: derivedEstimatedPrice,
    derivation_note: derivationNote,
    requires_user_confirmation: true,
    project_period: projectPeriod,
    is_ai_powered: false,
    analysis_engine: 'RULE_FALLBACK',
    confidence_scores: {
      project_name: projectName ? 0.90 : 0.4,
      client_name: clientName ? 0.90 : 0.2,
      client_type: clientType === 'UNKNOWN' ? 0.2 : 0.85,
      governing_law: governingLaw === 'UNKNOWN' ? 0.2 : 0.85,
      competition_method: competitionMethod === 'UNKNOWN' ? 0.2 : 0.90,
      award_method: awardMethod === 'UNKNOWN' ? 0.2 : 0.90,
      procurement_method: legacyProcMethod === 'UNKNOWN' ? 0.2 : 0.90,
      budget_amount: budgetAmount ? 0.95 : 0.2,
      estimated_price: explicitEstimatedPrice ? 0.90 : derivedEstimatedPrice ? 0.85 : 0.2,
    },
    evidence_status: {
      project_name: projectName ? 'EXPLICIT' : 'UNVERIFIED',
      client_name: clientName ? 'EXPLICIT' : 'UNVERIFIED',
      client_type: clientType !== 'UNKNOWN' ? 'INFERRED' : 'UNVERIFIED',
      governing_law: governingLaw !== 'UNKNOWN' ? 'INFERRED' : 'UNVERIFIED',
      competition_method: competitionMethod !== 'UNKNOWN' ? 'EXPLICIT' : 'UNVERIFIED',
      award_method: awardMethod !== 'UNKNOWN' ? 'EXPLICIT' : 'UNVERIFIED',
      budget_amount: budgetAmount ? 'EXPLICIT' : 'UNVERIFIED',
      estimated_price: explicitEstimatedPrice ? 'EXPLICIT' : derivedEstimatedPrice ? 'CALCULATED' : 'UNVERIFIED',
      project_period: projectPeriod ? 'EXPLICIT' : 'UNVERIFIED',
    },
    source_references: {
      competition_method: competitionMethod !== 'UNKNOWN' ? '입찰/선정방식 키워드 탐색' : '미기재',
      award_method: awardMethod !== 'UNKNOWN' ? '낙찰자결정방식 키워드 탐색' : '미기재',
      budget_amount: budgetAmount ? '문서 본문 예산 항목' : '미기재',
    },
    extracted_at: new Date().toISOString(),
    status: 'COMPLETED',
  };
}

function validateClientType(raw: string | undefined, clientName?: string | null): ClientType {
  const valid: ClientType[] = ['LOCAL_GOVERNMENT', 'CENTRAL_GOVERNMENT', 'PUBLIC_INSTITUTION', 'EDUCATIONAL', 'OTHER', 'UNKNOWN'];
  if (raw && valid.includes(raw as ClientType)) {
    return raw as ClientType;
  }
  if (clientName) {
    if (/부|처|청|위원회/.test(clientName) && !/구청|시청|군청/.test(clientName)) return 'CENTRAL_GOVERNMENT';
    if (/공사|공단|진흥원|연구원|재단|센터/.test(clientName)) return 'PUBLIC_INSTITUTION';
    if (/교육청|학교/.test(clientName)) return 'EDUCATIONAL';
    if (/구청|시청|군청|도청/.test(clientName)) return 'LOCAL_GOVERNMENT';
  }
  return 'UNKNOWN';
}

function validateGoverningLaw(raw: string | undefined, clientType?: ClientType): GoverningLaw {
  const valid: GoverningLaw[] = ['LOCAL_CONTRACT_ACT', 'STATE_CONTRACT_ACT', 'PUBLIC_ENTERPRISE_RULE', 'OTHER', 'UNKNOWN'];
  if (raw && valid.includes(raw as GoverningLaw)) {
    return raw as GoverningLaw;
  }
  if (clientType === 'CENTRAL_GOVERNMENT') return 'STATE_CONTRACT_ACT';
  if (clientType === 'PUBLIC_INSTITUTION') return 'PUBLIC_ENTERPRISE_RULE';
  if (clientType === 'LOCAL_GOVERNMENT' || clientType === 'EDUCATIONAL') return 'LOCAL_CONTRACT_ACT';
  return 'UNKNOWN';
}

function validateCompetitionMethod(raw: string | undefined): CompetitionMethod {
  const valid: CompetitionMethod[] = [
    'OPEN_COMPETITIVE',
    'RESTRICTED_COMPETITIVE',
    'NOMINATED_COMPETITIVE',
    'PRIVATE_CONTRACT',
    'UNKNOWN',
  ];
  if (raw && valid.includes(raw as CompetitionMethod)) {
    return raw as CompetitionMethod;
  }
  return 'UNKNOWN';
}

function validateAwardMethod(raw: string | undefined): AwardMethod {
  const valid: AwardMethod[] = [
    'NEGOTIATION',
    'QUALIFICATION_REVIEW',
    'LOWEST_PRICE',
    'TWO_STAGE',
    'SPEC_PRICE_SIMULTANEOUS',
    'OTHER',
    'UNKNOWN',
  ];
  if (raw && valid.includes(raw as AwardMethod)) {
    return raw as AwardMethod;
  }
  return 'UNKNOWN';
}
