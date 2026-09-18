import { ExtractedMetadata, AuthoritativeMetadata, ClientType, GoverningLaw, ProcurementMethod } from '../src/types/metadata';
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
 * 정교한 Gemini AI 기반 한글 공문서 메타데이터 분석기
 * - "수의계약" 단순 키워드 오인식 방지: "사업자 선정방식", "입찰 및 낙찰자 결정" 문맥을 정밀 분석하여 주 계약방법(협상에 의한 계약 등) 도출
 * - 할루시네이션(임의 가짜 숫자/기간) 금지: 문서에 명시된 실제 예산(원 단위 정수) 및 사업기간 문구만 추출
 */
export async function extractMetadataWithGemini(
  input: MetadataExtractionInput
): Promise<AiMetadataResult> {
  const { projectId, blocks, rawText = '', fileName = '', parsedMetadata } = input;
  const gemini = getGeminiClient();

  // Combine rich contextual document text
  const cleanFileName = fileName
    .replace(/\.(hwp|hwpx|hwt)$/i, '')
    .replace(/[_-]/g, ' ')
    .trim();

  // Pick representative text chunks: overview, procurement sections, budget tables
  const docTitle = parsedMetadata?.title || cleanFileName || '공공 사업 문서';
  
  // Prepare text up to 30,000 characters for Gemini Flash
  const blockLines = blocks.map((b) => `[${b.block_id}] ${b.text}`);
  const combinedText = [
    `[문서 파일명]: ${fileName}`,
    `[문서 제목 메타데이터]: ${docTitle}`,
    `[문서 본문 내용 발췌]:`,
    rawText.slice(0, 25000),
    `[문서 상세 블록 일부]:`,
    blockLines.slice(0, 80).join('\n'),
  ].join('\n\n');

  if (gemini && isGeminiKeyConfigured()) {
    try {
      const systemInstruction = `당신은 대한민국 공공조달, 제안요청서(RFP), 과업지시서, 공문서 분석 전문 수석 행정관이자 AI 계약 심사관입니다.
제공된 한글 문서의 제목, 본문, 표 데이터를 정밀하게 정독하고, 공공사업의 핵심 메타데이터 6대 요소를 정확하게 추출하십시오.

[핵심 추출 및 판정 원칙]
1. 계약방법 (procurement_method):
   - 값: "NEGOTIATION" | "RESTRICTED_COMPETITIVE" | "OPEN_COMPETITIVE" | "PRIVATE_CONTRACT"
   - ⚠️ 절대 주의: 문서 어딘가에 유찰 시 수의계약 가능성, 하도급 관련 조항, 수의계약 배제 문구 등에 "수의계약"이라는 단어가 단순히 등장한다고 해서 수의계약으로 판단하면 절대 안 됩니다!
   - 문서의 "사업자 선정 방식", "입찰 방식", "낙찰자 결정 방식", "계약방법" 절을 반드시 확인하십시오.
   - 정보화 및 소프트웨어 용역사업은 대부분 "협상에 의한 계약체결(지방계약법 시행령 제43조, 국가계약법 시행령 제43조)"이며 제안서 기술평가와 가격평가로 진행됩니다. 이 경우 반드시 "NEGOTIATION"을 선택하십시오.
   - "제한경쟁", "중소기업자간경쟁"인 경우 "RESTRICTED_COMPETITIVE", "일반경쟁"인 경우 "OPEN_COMPETITIVE", 공식 주 계약방법이 수의계약으로 정해진 경우에만 "PRIVATE_CONTRACT"를 선택하십시오.
   - procurement_method_reason에 왜 이 계약방법으로 판정했는지 명확한 근거 문장(예: "문서 제4장 사업자선정방식에 '협상에 의한 계약 체결'로 명시되어 있음")을 작성하십시오.

2. 사업예산 (budget_amount) 및 추정가격 (estimated_price):
   - 문서 본문, 개요표, 소요예산 항목에 명시된 "실제 금액(원 단위 정수)"을 추출하십시오.
   - 예: "1,450,000,000원", "15억원", "금550,000,000원" 등 -> 정수 숫자로 변환 (1450000000)
   - ⚠️ 절대 주의: 문서에 예산 금액이 전혀 적혀있지 않은 경우 절대 5억 5천만원 등 임의의 가짜 숫자를 날조하지 말고 반드시 null로 반환하십시오.
   - 추정가격(estimated_price): 문서에 별도로 기재되어 있으면 그 숫자를, 별도 기재 없이 부가세 포함 총사업예산만 있으면 공급가액(예산 / 1.1 반올림) 또는 문서상 금액을 숫자로 추출하십시오.

3. 사업기간 (project_period):
   - 문서의 "사업기간", "과업기간", "계약기간" 등에 기재된 실제 텍스트를 그대로 가져오십시오.
   - 예: "계약체결일로부터 2026년 11월 30일까지", "착수일로부터 10개월", "계약체결일로부터 180일" 등 실제 문서에 적힌 문구 그대로.
   - ⚠️ 절대 주의: 문서에 없는 경우 임의로 "계약체결일로부터 8개월" 같은 기본값을 지어내지 마십시오. 없으면 null로 반환하십시오.

4. 발주/수요기관 (client_name):
   - 실제 사업을 발주하거나 이용하는 공공기관명 (예: "서울특별시 강남구", "한국지능정보사회진흥원", "행정안전부").
   - 문서에 없으면 null.

5. 기관유형 (client_type) & 적용법령 (governing_law):
   - 지방자치단체(서울특별시, 광역시, 도청, 시청, 군청, 구청) -> client_type: "LOCAL_GOVERNMENT", governing_law: "LOCAL_CONTRACT_ACT"
   - 중앙행정기관(부, 처, 청, 위원회) -> client_type: "CENTRAL_GOVERNMENT", governing_law: "STATE_CONTRACT_ACT"
   - 공공기관, 공기업, 준정부기관, 진흥원, 공사, 공단, 연구원, 재단 -> client_type: "PUBLIC_INSTITUTION", governing_law: "PUBLIC_ENTERPRISE_RULE" 또는 "STATE_CONTRACT_ACT"
   - 교육청, 국공립학교 -> client_type: "EDUCATIONAL", governing_law: "LOCAL_CONTRACT_ACT" 또는 "STATE_CONTRACT_ACT"

6. 사업명 (project_name):
   - 문서 표지, 사업개요에 적힌 정식 사업명칭.

반드시 유효한 JSON 형식으로만 응답하십시오.`;

      const userPrompt = `아래 공문서 텍스트를 정밀 분석하여 JSON 객체를 생성하십시오.

문서 내용:
${combinedText}

응답 JSON 구조 예시:
{
  "project_name": "2026년 지능형 차세대 행정정보시스템 구축 용역",
  "client_name": "서울특별시 강남구",
  "client_type": "LOCAL_GOVERNMENT",
  "governing_law": "LOCAL_CONTRACT_ACT",
  "procurement_method": "NEGOTIATION",
  "procurement_method_reason": "제3절 사업자 선정 방식에서 '지방계약법 시행령 제43조에 따른 협상에 의한 계약 체결'이 명시되어 있으며 기술평가 90%, 가격평가 10% 구조임. (본문 단독입찰 재공고 유찰 시 수의계약 검토 문구는 주 계약방식이 아님)",
  "budget_amount": 1450000000,
  "estimated_price": 1318181818,
  "project_period": "착수일로부터 10개월",
  "confidence_scores": {
    "project_name": 0.98,
    "client_name": 0.98,
    "client_type": 0.96,
    "governing_law": 0.95,
    "procurement_method": 0.99,
    "budget_amount": 0.98,
    "estimated_price": 0.92,
    "project_period": 0.97
  },
  "source_references": {
    "project_name": "문서 표지 및 제1장 개요",
    "client_name": "사업 개요 수요기관 항목",
    "procurement_method": "사업자 선정 및 입찰 방식 절",
    "budget_amount": "사업개요 소요예산 항목",
    "project_period": "사업개요 사업기간 항목"
  },
  "extracted_snippets": {
    "procurement_method": "입찰 및 계약방법: 협상에 의한 계약",
    "budget": "사업예산: 1,450,000,000원(부가세 포함)",
    "period": "사업기간: 착수일로부터 10개월"
  }
}`;

      const { text } = await generateContentWithFallback(
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
        15000
      );

      let parsed: any = null;
      try {
        const cleaned = text.trim().replace(/^```json/i, '').replace(/```$/, '').trim();
        parsed = JSON.parse(cleaned);
      } catch (pe) {
        console.warn('[Gemini Metadata Parse Warning]', pe);
      }

      if (parsed && typeof parsed === 'object') {
        const rawBudget = typeof parsed.budget_amount === 'number' && parsed.budget_amount > 0 ? parsed.budget_amount : null;
        const rawEstimated = typeof parsed.estimated_price === 'number' && parsed.estimated_price > 0 ? parsed.estimated_price : null;
        const derivedEst = !rawEstimated && rawBudget ? Math.round(rawBudget / 1.1) : null;
        const derivationNote = derivedEst ? '총사업예산 기반 추산 (부가가치세 10% 제외 공식: 예산 / 1.1)' : null;

        const validatedClientType = validateClientType(parsed.client_type, parsed.client_name);
        const validatedGovLaw = validateGoverningLaw(parsed.governing_law, validatedClientType);
        const validatedProcMethod = validateProcurementMethod(parsed.procurement_method);

        const extracted: ExtractedMetadata = {
          project_id: projectId,
          project_name: parsed.project_name || docTitle,
          client_name: parsed.client_name || null,
          client_type: validatedClientType,
          governing_law: validatedGovLaw,
          procurement_method: validatedProcMethod,
          budget_amount: rawBudget,
          estimated_price: rawEstimated,
          derived_estimated_price: derivedEst,
          derivation_note: derivationNote,
          requires_user_confirmation: true,
          project_period: parsed.project_period || null,
          confidence_scores: {
            project_name: parsed.confidence_scores?.project_name ?? 0.98,
            client_name: parsed.confidence_scores?.client_name ?? (parsed.client_name ? 0.95 : 0.3),
            client_type: validatedClientType === 'UNKNOWN' ? 0.2 : 0.92,
            governing_law: validatedGovLaw === 'UNKNOWN' ? 0.2 : 0.92,
            procurement_method: validatedProcMethod === 'UNKNOWN' ? 0.2 : 0.95,
            budget_amount: rawBudget ? 0.95 : 0.2,
            estimated_price: rawEstimated ? 0.90 : 0.2,
          },
          source_references: parsed.source_references || {
            procurement_method: validatedProcMethod !== 'UNKNOWN' ? '사업자 선정 방식 절' : '미기재',
            budget_amount: rawBudget ? '사업예산 항목' : '미기재',
          },
          extracted_at: new Date().toISOString(),
          status: 'COMPLETED',
        };

        return {
          extracted,
          procurement_method_reason: parsed.procurement_method_reason,
          extracted_snippets: parsed.extracted_snippets,
          is_ai_powered: true,
        };
      }
    } catch (geminiErr: any) {
      const msg = geminiErr?.message || String(geminiErr);
      if (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid')) {
        console.warn('[Gemini Metadata Extraction] Gemini API key not valid; switching to rule-based fallback.');
      } else {
        console.warn('[Gemini Metadata Extraction Fallback]', msg.slice(0, 120));
      }
    }
  }

  // Fallback to high-precision Korean procurement heuristic (Context-aware, zero-hallucination)
  const fallbackExtracted = extractMetadataRuleBasedFallback(projectId, blocks, rawText, fileName, parsedMetadata);
  return {
    extracted: fallbackExtracted,
    is_ai_powered: false,
  };
}

/**
 * High-Precision Rule-Based Fallback Engine
 * - Evaluates contract method by locating the "입찰 방식 / 사업자 선정" specific section
 * - Does NOT allow spurious "수의계약" in general text to override "협상에 의한 계약"
 * - Returns null when budget/period is not actually found in text (no hardcoded 550,000,000 or 8 months)
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

  // 3) 기관유형 및 적용법령 (추정 대신 미확인 시 UNKNOWN 반환)
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

  // 4) 계약방법 (Procurement Method) - 정밀 문맥 분별 (미발견 시 UNKNOWN)
  let procurementMethod: ProcurementMethod = 'UNKNOWN';
  let confidenceMethod = 0.2;

  const procurementSectionMatch = allLines.match(
    /(?:사업자\s*선정\s*방식|입찰\s*방식|계약\s*방법|낙찰자\s*결정\s*방식|입찰\s*및\s*낙찰자)[\s\S]{1,600}/
  );
  const procurementContext = procurementSectionMatch ? procurementSectionMatch[0] : allLines;

  // 우선순위 1: 협상에 의한 계약 (공공 SW 사업의 표준)
  if (/협상에\s*의한\s*계약|제안서\s*평가|기술\s*(?:능력)?\s*평가|기술평가\s*[0-9]+%|기술\s*:\s*가격/.test(procurementContext)) {
    procurementMethod = 'NEGOTIATION';
    confidenceMethod = 0.98;
  }
  // 우선순위 2: 제한경쟁입찰
  else if (/제한경쟁|중소기업자간경쟁|지역제한/.test(procurementContext)) {
    procurementMethod = 'RESTRICTED_COMPETITIVE';
    confidenceMethod = 0.96;
  }
  // 우선순위 3: 일반경쟁입찰
  else if (/일반경쟁/.test(procurementContext)) {
    procurementMethod = 'OPEN_COMPETITIVE';
    confidenceMethod = 0.95;
  }
  // 우선순위 4: 공식 수의계약 (단순 본문 언급이 아니라 계약방법 자체로 규정된 경우에만)
  else if (/(?:계약\s*방법|입찰\s*방식)\s*[:：]?\s*수의계약|수의계약\s*체결\s*대상/.test(procurementContext)) {
    procurementMethod = 'PRIVATE_CONTRACT';
    confidenceMethod = 0.93;
  }

  // 5) 사업예산 및 추정가격 (문서에 실제로 존재하는 금액만 추출)
  // 사실 추출과 파생 계산을 명확히 구분
  let budgetAmount: number | null = null;
  let explicitEstimatedPrice: number | null = null;

  // 억원 패턴 (예: "15억원", "14억 5,000만원", "금 8억 8천만원")
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
    // 콤마 숫자 패턴 (예: "1,450,000,000원", "880,000,000원")
    const numMatch = allLines.match(/(?:사\s*업\s*예\s*산|총\s*예\s*산|예\s*산\s*액|소\s*요\s*예\s*산|사\s*업\s*비|추\s*정\s*금\s*액|배\s*정\s*예\s*산)\s*[:：]?\s*(?:일금\s*)?([0-9,]{4,15})\s*(?:원)?/);
    if (numMatch) {
      const parsed = parseInt(numMatch[1].replace(/,/g, ''), 10);
      if (!isNaN(parsed) && parsed >= 1000000) {
        budgetAmount = parsed;
      }
    }
  }

  // 별도 추정가격 표기 검사 (원문에 명시된 경우에만 추출)
  const estMatch = allLines.match(/(?:추\s*정\s*가\s*격|추\s*정\s*가)\s*[:：]?\s*(?:일금\s*)?([0-9,]{4,15})\s*(?:원)?/);
  if (estMatch) {
    const parsedEst = parseInt(estMatch[1].replace(/,/g, ''), 10);
    if (!isNaN(parsedEst) && parsedEst > 0) {
      explicitEstimatedPrice = parsedEst;
    }
  }

  // 추정가격 파생 계산 (총예산이 있고 명시적 추정가격이 없는 경우 부가세 10% 제외 계산값 분리)
  const derivedEstimatedPrice = !explicitEstimatedPrice && budgetAmount ? Math.round(budgetAmount / 1.1) : null;
  const derivationNote = derivedEstimatedPrice
    ? '총사업예산 기반 자동 산출 (부가가치세 10% 제외 공식: 예산 / 1.1)'
    : null;

  // 6) 사업기간 (문서에 실제로 존재하는 문구만 추출, 가짜 기본값 생성 금지)
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
    procurement_method: procurementMethod,
    budget_amount: budgetAmount,
    estimated_price: explicitEstimatedPrice,
    derived_estimated_price: derivedEstimatedPrice,
    derivation_note: derivationNote,
    requires_user_confirmation: true,
    project_period: projectPeriod,
    confidence_scores: {
      project_name: projectName ? 0.95 : 0.4,
      client_name: clientName ? 0.94 : 0.2,
      client_type: clientType === 'UNKNOWN' ? 0.2 : 0.90,
      governing_law: governingLaw === 'UNKNOWN' ? 0.2 : 0.90,
      procurement_method: confidenceMethod,
      budget_amount: budgetAmount ? 0.95 : 0.2,
      estimated_price: explicitEstimatedPrice ? 0.90 : 0.2,
    },
    source_references: {
      procurement_method: procurementMethod !== 'UNKNOWN' ? '사업자 선정 방식 탐색' : '미기재',
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

function validateProcurementMethod(raw: string | undefined): ProcurementMethod {
  const valid: ProcurementMethod[] = ['NEGOTIATION', 'RESTRICTED_COMPETITIVE', 'OPEN_COMPETITIVE', 'PRIVATE_CONTRACT', 'UNKNOWN'];
  if (raw && valid.includes(raw as ProcurementMethod)) {
    return raw as ProcurementMethod;
  }
  return 'UNKNOWN';
}
