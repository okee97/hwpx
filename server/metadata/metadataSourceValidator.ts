import { DocumentBlock } from '../../src/types/finding';
import { TableMatrix } from '../rhwpAdapter';
import {
  ExtractedMetadata,
  EvidenceStatus,
  EvidenceQuote,
  CalculatedCandidate,
  CompetitionMethod,
  AwardMethod,
  ClientType,
  GoverningLaw,
} from '../../src/types/metadata';
import {
  JudgeDecisionPayload,
  SourceValidationResult,
  SourceValidationStats,
} from './metadataSchemas';

/**
 * Normalizes text for strict but whitespace-tolerant substring matching.
 * Collapses multiple whitespaces, replaces linebreaks and non-breaking spaces,
 * and strips outer quotation marks.
 */
export function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .replace(/[\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Strips cosmetic surrounding punctuation or quotes often added by LLMs.
 */
export function cleanQuoteString(raw: string): string {
  if (!raw) return '';
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^["'“”‘’「」『』\[\]]+/, '').replace(/["'“”‘’「」『』\[\]]+$/, '');
  return cleaned.trim();
}

/**
 * Extracts all numeric values (both raw digits with commas and Korean units like 억, 만, 천)
 * to verify whether a candidate numeric amount actually exists within an evidence quote.
 */
export function quoteContainsNumber(quote: string, targetAmount: number): boolean {
  if (!quote || targetAmount === null || targetAmount === undefined || isNaN(targetAmount)) {
    return false;
  }

  const norm = normalizeText(quote).replace(/,/g, '');

  // 1. Direct digit string match (e.g. "1100000000" in text)
  const targetStr = targetAmount.toString();
  if (norm.includes(targetStr)) {
    return true;
  }

  // 2. Formatted with commas (e.g. "1,100,000,000")
  const withCommas = targetAmount.toLocaleString('ko-KR');
  if (normalizeText(quote).includes(withCommas)) {
    return true;
  }

  // 3. Korean unit expressions:
  // e.g. 1500000000 -> 15억 or 15억원
  // 1100000000 -> 11억
  // 250000000 -> 2억 5000만, 2.5억
  if (targetAmount >= 100000000) {
    const eok = Math.floor(targetAmount / 100000000);
    const remainder = targetAmount % 100000000;
    if (remainder === 0) {
      if (new RegExp(`${eok}\\s*억`).test(norm)) return true;
    } else {
      const man = Math.floor(remainder / 10000);
      if (new RegExp(`${eok}\\s*억\\s*${man}\\s*만`).test(norm)) return true;
      const decimalEok = (targetAmount / 100000000).toFixed(1);
      if (new RegExp(`${decimalEok.replace('.', '[.,]')}\\s*억`).test(norm)) return true;
    }
  } else if (targetAmount >= 10000) {
    const man = Math.floor(targetAmount / 10000);
    if (new RegExp(`${man}\\s*만`).test(norm)) return true;
  }

  return false;
}

/**
 * Calculates a principled, non-hardcoded confidence score based on verified evidence status.
 */
export function calculateConfidence(status: EvidenceStatus, hasValidEvidence: boolean): number {
  switch (status) {
    case 'EXPLICIT':
      return hasValidEvidence ? 0.95 : 0.0;
    case 'INFERRED':
      return hasValidEvidence ? 0.8 : 0.5;
    case 'CALCULATED':
      return 0.8;
    case 'CONFLICT':
      return 0.3;
    case 'UNVERIFIED':
    default:
      return 0.0;
  }
}

/**
 * Deterministic rules to infer client type and governing law from verified agency names.
 */
export function inferClientTypeAndLaw(agencyName?: string | null): {
  clientType: ClientType;
  governingLaw: GoverningLaw;
  confidence: number;
} {
  if (!agencyName || agencyName.trim().length === 0) {
    return { clientType: 'UNKNOWN', governingLaw: 'UNKNOWN', confidence: 0.0 };
  }

  const name = normalizeText(agencyName);

  // Local government patterns
  const localGovKeywords = [
    '시청', '구청', '군청', '도청', '특별시', '광역시', '특별자치',
    '교육청', '주민센터', '행정복지센터', '자치구', '시·도',
  ];
  if (localGovKeywords.some((kw) => name.includes(kw))) {
    return {
      clientType: 'LOCAL_GOVERNMENT',
      governingLaw: 'LOCAL_CONTRACT_ACT',
      confidence: 0.95,
    };
  }

  // Public enterprise / institution patterns
  const publicInstKeywords = [
    '공사', '공단', '재단', '진흥원', '연구원', '병원', '원수원',
    '센터', '협회', '학회', '대학교', '기술원', '개발원', '정보원',
  ];
  if (publicInstKeywords.some((kw) => name.includes(kw))) {
    return {
      clientType: 'PUBLIC_INSTITUTION',
      governingLaw: 'PUBLIC_ENTERPRISE_RULE',
      confidence: 0.9,
    };
  }

  // Central government ministry / agency patterns
  const centralKeywords = [
    '부', '처', '청', '위원회', '원', '국', '기획단', '추진단',
  ];
  if (centralKeywords.some((kw) => name.endsWith(kw) || name.includes(kw))) {
    return {
      clientType: 'CENTRAL_GOVERNMENT',
      governingLaw: 'STATE_CONTRACT_ACT',
      confidence: 0.95,
    };
  }

  return { clientType: 'UNKNOWN', governingLaw: 'UNKNOWN', confidence: 0.4 };
}

/**
 * Semantic Decision Grounding check for Competition Method.
 * Ensures that if RESTRICTED_COMPETITIVE is chosen, the quote genuinely mentions restriction terms,
 * and does not just state "일반경쟁입찰".
 */
export function checkCompetitionMethodGrounding(
  method: CompetitionMethod,
  quote: string
): { valid: boolean; reason?: string } {
  const norm = normalizeText(quote);

  if (method === 'RESTRICTED_COMPETITIVE') {
    const restrictionKeywords = [
      '제한경쟁', '제한 경쟁', '지역제한', '실적제한', '중소기업자간',
      '참가자격을 제한', '자격을 제한', '제한적', '제한입찰',
    ];
    const hasRestriction = restrictionKeywords.some((kw) => norm.includes(kw));
    if (!hasRestriction) {
      if (norm.includes('일반경쟁') || norm.includes('일반 경쟁')) {
        return {
          valid: false,
          reason: `원문에는 '일반경쟁'만 명시되어 있으나 '제한경쟁'으로 잘못 판정됨`,
        };
      }
      return {
        valid: false,
        reason: `원문 인용구에 제한경쟁 관련 표제어(제한경쟁, 지역제한, 실적제한 등)가 없음`,
      };
    }
    return { valid: true };
  }

  if (method === 'OPEN_COMPETITIVE') {
    const openKeywords = ['일반경쟁', '일반 경쟁', '일반입찰'];
    const hasOpen = openKeywords.some((kw) => norm.includes(kw));
    if (!hasOpen) {
      return { valid: false, reason: `원문 인용구에 일반경쟁 관련 표제어가 없음` };
    }
    return { valid: true };
  }

  if (method === 'NOMINATED_COMPETITIVE') {
    const hasNom = norm.includes('지명경쟁') || norm.includes('지명 경쟁') || norm.includes('지명입찰');
    if (!hasNom) {
      return { valid: false, reason: `원문 인용구에 지명경쟁 관련 표제어가 없음` };
    }
    return { valid: true };
  }

  if (method === 'PRIVATE_CONTRACT') {
    const hasPrivate = norm.includes('수의계약') || norm.includes('수의 계약');
    if (!hasPrivate) {
      return { valid: false, reason: `원문 인용구에 수의계약 관련 표제어가 없음` };
    }
    return { valid: true };
  }

  return { valid: true };
}

/**
 * Semantic Decision Grounding check for Award Method.
 */
export function checkAwardMethodGrounding(
  method: AwardMethod,
  quote: string
): { valid: boolean; reason?: string } {
  const norm = normalizeText(quote);

  if (method === 'NEGOTIATION') {
    const negKeywords = [
      '협상에 의한', '협상에의한', '협상 계약', '협상에 의한 계약',
      '기술능력평가', '기술평가', '종합평가', '협상적격자',
    ];
    const hasNeg = negKeywords.some((kw) => norm.includes(kw));
    if (!hasNeg) {
      return { valid: false, reason: `원문 인용구에 협상계약 관련 표제어(협상에 의한 계약 등)가 없음` };
    }
    return { valid: true };
  }

  if (method === 'QUALIFICATION_REVIEW') {
    const hasQual = norm.includes('적격심사') || norm.includes('적격 심사');
    if (!hasQual) {
      return { valid: false, reason: `원문 인용구에 적격심사 관련 표제어가 없음` };
    }
    return { valid: true };
  }

  if (method === 'LOWEST_PRICE') {
    const hasLowest = norm.includes('최저가') || norm.includes('최저가낙찰');
    if (!hasLowest) {
      return { valid: false, reason: `원문 인용구에 최저가 관련 표제어가 없음` };
    }
    return { valid: true };
  }

  if (method === 'TWO_STAGE') {
    const has2Stage = norm.includes('2단계') || norm.includes('이단계') || norm.includes('규격가격분리');
    if (!has2Stage) {
      return { valid: false, reason: `원문 인용구에 2단계입찰 관련 표제어가 없음` };
    }
    return { valid: true };
  }

  return { valid: true };
}

/**
 * Semantic Decision Grounding check for Estimated Price.
 * Requires both the numeric amount AND an explicit "추정가격" heading/keyword in the quote.
 */
export function checkEstimatedPriceGrounding(
  amount: number,
  quote: string
): { valid: boolean; reason?: string } {
  const norm = normalizeText(quote);
  const hasHeading =
    norm.includes('추정가격') ||
    norm.includes('추정 가격') ||
    norm.includes('추정금액') ||
    norm.includes('추정 금액');

  if (!hasHeading) {
    return {
      valid: false,
      reason: `원문 인용구에 '추정가격' 명시적 표제어가 없음 (단순 예산 금액 인용 거부)`,
    };
  }

  const hasNum = quoteContainsNumber(quote, amount);
  if (!hasNum) {
    return {
      valid: false,
      reason: `원문 인용구에 추정가격 금액(${amount}원)이 존재하지 않음`,
    };
  }

  return { valid: true };
}

/**
 * Semantic Decision Grounding check for Agency Names.
 * Verifies that the extracted agency name (or key tokens of it) actually appears in the quote.
 */
export function checkAgencyNameGrounding(
  agencyName: string,
  quote: string
): { valid: boolean; reason?: string } {
  if (!agencyName || agencyName.trim().length === 0) {
    return { valid: false, reason: '기관명이 비어있음' };
  }

  const normAgency = normalizeText(agencyName).replace(/\s+/g, '');
  const normQuote = normalizeText(quote).replace(/\s+/g, '');

  if (normQuote.includes(normAgency)) {
    return { valid: true };
  }

  // Token based match (e.g. "행정안전부" in "수요기관: 행정안전부 디지털정부국")
  const tokens = agencyName.split(/\s+/).filter((t) => t.length >= 2);
  const matchedTokens = tokens.filter((t) => normQuote.includes(t));
  if (matchedTokens.length > 0) {
    return { valid: true };
  }

  return {
    valid: false,
    reason: `기관명 '${agencyName}'이 인용구에 존재하지 않음`,
  };
}

/**
 * Deterministic Source Validator v4 (Pure Backend Code - NO LLM)
 *
 * Enforces strict two-tier verification:
 * 1. Evidence Authenticity: Checks if block_id exists and normalized quote is an exact substring.
 * 2. Decision Grounding: Checks if the judge's semantic decision is genuinely supported by the quote.
 *
 * CRITICAL ZERO-TOLERANCE RULE:
 * If an explicit decision fails evidence or grounding validation, the candidate value
 * is immediately reset to UNKNOWN / null so users are never misled.
 */
export function validateJudgeDecision(
  judgeDecision: JudgeDecisionPayload,
  blocks: DocumentBlock[],
  tables: TableMatrix[] = [],
  projectId: string,
  modelUsed?: string
): SourceValidationResult {
  const blockMap = new Map<string, DocumentBlock>();
  blocks.forEach((b) => blockMap.set(b.block_id, b));

  const tableMap = new Map<string, TableMatrix>();
  tables.forEach((t) => tableMap.set(t.table_id, t));

  const stats: SourceValidationStats = {
    total_evidence_checked: 0,
    verified_evidence_count: 0,
    rejected_missing_blocks: 0,
    demoted_quote_mismatches: 0,
    numeric_mismatches_rejected: 0,
    decision_grounding_mismatches: 0,
  };

  const validationLogs: string[] = [];

  const evidenceStatus: Record<string, EvidenceStatus> = {};
  const evidenceQuotes: Record<string, EvidenceQuote> = {};
  const sourceReferences: Record<string, string> = {};
  const confidenceScores: Record<string, number> = {};

  // Helper to validate evidence array and optional semantic grounding
  const validateFieldEvidence = (
    fieldKey: string,
    initialStatus: EvidenceStatus,
    evidenceList: Array<{ block_id: string; quote: string; table_id?: string }>,
    options?: {
      numericCheckValue?: number | null;
      semanticCheck?: (quote: string) => { valid: boolean; reason?: string };
    }
  ): { status: EvidenceStatus; verifiedQuote: EvidenceQuote | null } => {
    let finalStatus: EvidenceStatus = initialStatus;
    let primaryQuote: EvidenceQuote | null = null;
    let hasSemanticConflict = false;

    if (!evidenceList || evidenceList.length === 0) {
      if (initialStatus === 'EXPLICIT') {
        finalStatus = 'UNVERIFIED';
        stats.demoted_quote_mismatches++;
        validationLogs.push(`[${fieldKey}] EXPLICIT 근거 목록이 비어있어 UNVERIFIED로 강등됨`);
      }
      return { status: finalStatus, verifiedQuote: null };
    }

    for (const ev of evidenceList) {
      stats.total_evidence_checked++;
      const blockId = ev.block_id;
      const rawQuote = cleanQuoteString(ev.quote);

      if (!blockId) {
        stats.rejected_missing_blocks++;
        validationLogs.push(`[${fieldKey}] block_id 누락으로 증거 거부`);
        continue;
      }

      let isSubstring = false;
      let matchedId = blockId;

      const realBlock = blockMap.get(blockId);
      if (realBlock) {
        const normBlockText = normalizeText(realBlock.text);
        const normQuote = normalizeText(rawQuote);
        if (normQuote && normQuote.length >= 2 && normBlockText.includes(normQuote)) {
          isSubstring = true;
        }
      } else if (ev.table_id && tableMap.has(ev.table_id)) {
        const tbl = tableMap.get(ev.table_id)!;
        const tableNorm = normalizeText(
          tbl.caption + ' ' + tbl.rows.map((r) => r.join(' ')).join(' ')
        );
        const quoteNorm = normalizeText(rawQuote);
        if (quoteNorm.length >= 2 && tableNorm.includes(quoteNorm)) {
          isSubstring = true;
          matchedId = ev.table_id;
        }
      }

      if (!isSubstring) {
        if (!realBlock && (!ev.table_id || !tableMap.has(ev.table_id))) {
          stats.rejected_missing_blocks++;
          validationLogs.push(`[${fieldKey}] 존재하지 않는 block_id '${blockId}' 거부됨`);
        } else {
          stats.demoted_quote_mismatches++;
          validationLogs.push(
            `[${fieldKey}] 인용구 원문 불일치 거부 (${blockId}): "${rawQuote.slice(0, 30)}..."`
          );
        }
        continue;
      }

      // Numeric check
      if (options?.numericCheckValue !== undefined && options?.numericCheckValue !== null && options.numericCheckValue > 0) {
        const hasNum = quoteContainsNumber(rawQuote, options.numericCheckValue);
        if (!hasNum) {
          stats.numeric_mismatches_rejected++;
          validationLogs.push(
            `[${fieldKey}] 숫자 불일치 (${options.numericCheckValue}원이 인용구에 없음): "${rawQuote}"`
          );
          continue;
        }
      }

      // Semantic Grounding check
      if (options?.semanticCheck) {
        const semResult = options.semanticCheck(rawQuote);
        if (!semResult.valid) {
          stats.decision_grounding_mismatches++;
          hasSemanticConflict = true;
          validationLogs.push(
            `[${fieldKey}] 판단-근거 의미 불일치 거부: ${semResult.reason} (인용: "${rawQuote.slice(0, 40)}")`
          );
          continue;
        }
      }

      // Genuine evidence verified!
      stats.verified_evidence_count++;
      primaryQuote = {
        block_id: matchedId,
        quote: rawQuote,
        status: finalStatus,
        table_id: ev.table_id,
      };
      break;
    }

    if (!primaryQuote) {
      if (hasSemanticConflict) {
        finalStatus = 'CONFLICT';
        validationLogs.push(`[${fieldKey}] 원문 인용구와 AI 판단 간 의미적 상충 발생으로 CONFLICT 설정`);
      } else if (initialStatus === 'EXPLICIT') {
        finalStatus = 'UNVERIFIED';
        validationLogs.push(`[${fieldKey}] 유효한 원문 인용구가 없어 EXPLICIT에서 UNVERIFIED로 강등`);
      }
    }

    return { status: finalStatus, verifiedQuote: primaryQuote };
  };

  // 1. Project Name
  let finalProjectName: string | null = judgeDecision.project_name.value || null;
  const projNameVal = validateFieldEvidence(
    'project_name',
    judgeDecision.project_name.status,
    judgeDecision.project_name.evidence
  );
  evidenceStatus.project_name = projNameVal.status;
  if (projNameVal.verifiedQuote) {
    evidenceQuotes.project_name = projNameVal.verifiedQuote;
  } else if (judgeDecision.project_name.status === 'EXPLICIT') {
    // If claimed explicit but falsified, clear value
    finalProjectName = null;
  }
  confidenceScores.project_name = calculateConfidence(projNameVal.status, !!projNameVal.verifiedQuote);
  sourceReferences.project_name = projNameVal.verifiedQuote?.block_id || 'overview';

  // 2. Demand Agency (수요기관)
  let finalDemandAgency: string | null = judgeDecision.demand_agency.value || null;
  const demandVal = validateFieldEvidence(
    'demand_agency',
    judgeDecision.demand_agency.status,
    judgeDecision.demand_agency.evidence,
    {
      semanticCheck: finalDemandAgency ? (q) => checkAgencyNameGrounding(finalDemandAgency!, q) : undefined,
    }
  );
  evidenceStatus.demand_agency = demandVal.status;
  if (demandVal.verifiedQuote) {
    evidenceQuotes.demand_agency = demandVal.verifiedQuote;
  } else if (judgeDecision.demand_agency.status === 'EXPLICIT') {
    finalDemandAgency = null;
  }
  confidenceScores.demand_agency = calculateConfidence(demandVal.status, !!demandVal.verifiedQuote);
  sourceReferences.demand_agency = demandVal.verifiedQuote?.block_id || 'agency';

  // 3. Contract Agency (계약/공고기관)
  let finalContractAgency: string | null = judgeDecision.contract_agency.value || null;
  const contractVal = validateFieldEvidence(
    'contract_agency',
    judgeDecision.contract_agency.status,
    judgeDecision.contract_agency.evidence,
    {
      semanticCheck: finalContractAgency ? (q) => checkAgencyNameGrounding(finalContractAgency!, q) : undefined,
    }
  );
  evidenceStatus.contract_agency = contractVal.status;
  if (contractVal.verifiedQuote) {
    evidenceQuotes.contract_agency = contractVal.verifiedQuote;
  } else if (judgeDecision.contract_agency.status === 'EXPLICIT') {
    finalContractAgency = null;
  }
  confidenceScores.contract_agency = calculateConfidence(contractVal.status, !!contractVal.verifiedQuote);
  sourceReferences.contract_agency = contractVal.verifiedQuote?.block_id || 'contract_agency';

  // Client Name: Default to demand_agency
  const finalClientName = finalDemandAgency || judgeDecision.client_name?.value || null;
  evidenceStatus.client_name = evidenceStatus.demand_agency || judgeDecision.client_name?.status || 'UNVERIFIED';
  confidenceScores.client_name = confidenceScores.demand_agency || 0.0;
  if (evidenceQuotes.demand_agency) evidenceQuotes.client_name = evidenceQuotes.demand_agency;

  // 4. Client Type & Governing Law: Grounded deterministic mapping based on verified agency
  const inferredAgencyRules = inferClientTypeAndLaw(finalDemandAgency || finalContractAgency);
  let finalClientType: ClientType = 'UNKNOWN';
  let finalGoverningLaw: GoverningLaw = 'UNKNOWN';

  if (inferredAgencyRules.clientType !== 'UNKNOWN') {
    finalClientType = inferredAgencyRules.clientType;
    finalGoverningLaw = inferredAgencyRules.governingLaw;
    evidenceStatus.client_type = 'INFERRED';
    evidenceStatus.governing_law = 'INFERRED';
    confidenceScores.client_type = inferredAgencyRules.confidence;
    confidenceScores.governing_law = inferredAgencyRules.confidence;
  } else if (judgeDecision.client_type.value && judgeDecision.client_type.value !== 'UNKNOWN') {
    finalClientType = judgeDecision.client_type.value;
    finalGoverningLaw = judgeDecision.governing_law.value || 'UNKNOWN';
    evidenceStatus.client_type = judgeDecision.client_type.status;
    evidenceStatus.governing_law = judgeDecision.governing_law.status;
    confidenceScores.client_type = 0.5;
    confidenceScores.governing_law = 0.5;
  } else {
    evidenceStatus.client_type = 'UNVERIFIED';
    evidenceStatus.governing_law = 'UNVERIFIED';
    confidenceScores.client_type = 0.0;
    confidenceScores.governing_law = 0.0;
  }

  // 5. Competition Method (경쟁방법) - Strict Decision Grounding
  let finalCompetitionMethod: CompetitionMethod = judgeDecision.competition_method.value || 'UNKNOWN';
  const compVal = validateFieldEvidence(
    'competition_method',
    judgeDecision.competition_method.status,
    judgeDecision.competition_method.evidence,
    {
      semanticCheck: (quote) => checkCompetitionMethodGrounding(finalCompetitionMethod, quote),
    }
  );
  evidenceStatus.competition_method = compVal.status;
  if (compVal.verifiedQuote) {
    evidenceQuotes.competition_method = compVal.verifiedQuote;
  } else {
    // If validation fails (or falsified), reset value to UNKNOWN
    finalCompetitionMethod = 'UNKNOWN';
  }
  confidenceScores.competition_method = calculateConfidence(compVal.status, !!compVal.verifiedQuote);
  sourceReferences.competition_method = compVal.verifiedQuote?.block_id || 'competition';

  // 6. Award Method (낙찰방법) - Strict Decision Grounding
  let finalAwardMethod: AwardMethod = judgeDecision.award_method.value || 'UNKNOWN';
  const awardVal = validateFieldEvidence(
    'award_method',
    judgeDecision.award_method.status,
    judgeDecision.award_method.evidence,
    {
      semanticCheck: (quote) => checkAwardMethodGrounding(finalAwardMethod, quote),
    }
  );
  evidenceStatus.award_method = awardVal.status;
  if (awardVal.verifiedQuote) {
    evidenceQuotes.award_method = awardVal.verifiedQuote;
  } else {
    // If validation fails, reset value to UNKNOWN
    finalAwardMethod = 'UNKNOWN';
  }
  confidenceScores.award_method = calculateConfidence(awardVal.status, !!awardVal.verifiedQuote);
  sourceReferences.award_method = awardVal.verifiedQuote?.block_id || 'award';

  // 7. Budget Amount
  let validBudget: number | null = judgeDecision.budget_amount.value;
  const budgetVal = validateFieldEvidence(
    'budget_amount',
    judgeDecision.budget_amount.status,
    judgeDecision.budget_amount.evidence,
    { numericCheckValue: validBudget }
  );
  evidenceStatus.budget_amount = budgetVal.status;
  if (budgetVal.verifiedQuote) {
    evidenceQuotes.budget_amount = budgetVal.verifiedQuote;
  } else {
    validBudget = null;
  }
  confidenceScores.budget_amount = calculateConfidence(budgetVal.status, !!budgetVal.verifiedQuote);
  sourceReferences.budget_amount = budgetVal.verifiedQuote?.block_id || 'budget';

  // 8. Estimated Price (Strict: Requires number AND explicit '추정가격' keyword in quote)
  let validEstimated: number | null = judgeDecision.estimated_price.value;
  const estVal = validateFieldEvidence(
    'estimated_price',
    judgeDecision.estimated_price.status,
    judgeDecision.estimated_price.evidence,
    {
      numericCheckValue: validEstimated,
      semanticCheck: validEstimated ? (q) => checkEstimatedPriceGrounding(validEstimated!, q) : undefined,
    }
  );
  evidenceStatus.estimated_price = estVal.status;
  if (estVal.verifiedQuote) {
    evidenceQuotes.estimated_price = estVal.verifiedQuote;
  } else {
    validEstimated = null;
  }
  confidenceScores.estimated_price = calculateConfidence(estVal.status, !!estVal.verifiedQuote);
  sourceReferences.estimated_price = estVal.verifiedQuote?.block_id || 'estimated';

  // 9. Project Period
  let validPeriod: string | null = judgeDecision.project_period.value || null;
  const periodVal = validateFieldEvidence(
    'project_period',
    judgeDecision.project_period.status,
    judgeDecision.project_period.evidence
  );
  evidenceStatus.project_period = periodVal.status;
  if (periodVal.verifiedQuote) {
    evidenceQuotes.project_period = periodVal.verifiedQuote;
  } else if (judgeDecision.project_period.status === 'EXPLICIT') {
    validPeriod = null;
  }
  confidenceScores.project_period = calculateConfidence(periodVal.status, !!periodVal.verifiedQuote);
  sourceReferences.project_period = periodVal.verifiedQuote?.block_id || 'period';

  // Calculated Candidates (Ensure valid math, never overwriting estimated_price)
  const calcCandidates: CalculatedCandidate[] = [...(judgeDecision.calculated_candidates || [])];
  if (validBudget && !validEstimated && calcCandidates.length === 0) {
    calcCandidates.push({
      label: '총사업예산 기준 부가세(10%) 역산 공급가액',
      amount: Math.round(validBudget / 1.1),
      note: '총사업예산 ÷ 1.1 참고 계산값 (문서 내 추정가격 미기재)',
    });
  }

  // Derive legacy procurement_method for backward compatibility
  const derivedProcurementMethod =
    finalAwardMethod === 'NEGOTIATION'
      ? 'NEGOTIATION'
      : finalCompetitionMethod === 'RESTRICTED_COMPETITIVE'
      ? 'RESTRICTED_COMPETITIVE'
      : finalCompetitionMethod === 'OPEN_COMPETITIVE'
      ? 'OPEN_COMPETITIVE'
      : finalCompetitionMethod === 'PRIVATE_CONTRACT'
      ? 'PRIVATE_CONTRACT'
      : 'UNKNOWN';

  const validatedMetadata: ExtractedMetadata = {
    project_id: projectId,
    project_name: finalProjectName,
    client_name: finalClientName,
    demand_agency: finalDemandAgency,
    contract_agency: finalContractAgency,
    client_type: finalClientType,
    governing_law: finalGoverningLaw,
    procurement_method: derivedProcurementMethod,
    competition_method: finalCompetitionMethod,
    award_method: finalAwardMethod,
    procurement_method_reason: judgeDecision.procurement_method_reason || 'Source Validator 검증 완료',
    budget_amount: validBudget,
    estimated_price: validEstimated,
    vat_included: judgeDecision.vat_included?.value ?? null,
    calculated_candidates: calcCandidates,
    derived_estimated_price: calcCandidates[0]?.amount || null,
    derivation_note: calcCandidates[0]?.note || null,
    project_period: validPeriod,
    confidence_scores: confidenceScores,
    evidence_status: evidenceStatus,
    evidence_quotes: evidenceQuotes,
    source_references: sourceReferences,
    is_ai_powered: true,
    analysis_engine: 'AI',
    model_used: modelUsed || 'gemini-3.8-flash',
    fallback_used: false,
    requires_user_confirmation: true,
    extracted_at: new Date().toISOString(),
    status: 'SOURCE_VALIDATED',
  };

  return {
    validatedMetadata,
    validationStats: stats,
    validationLogs,
  };
}
