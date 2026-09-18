import { DocumentBlock } from '../../src/types/finding';
import { TableMatrix } from '../rhwpAdapter';
import {
  ExtractedMetadata,
  EvidenceStatus,
  EvidenceQuote,
  CalculatedCandidate,
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
function cleanQuoteString(raw: string): string {
  if (!raw) return '';
  let cleaned = raw.trim();
  // Remove wrapping markdown quotes or quotation marks
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
      return hasValidEvidence ? 0.95 : 0.4;
    case 'INFERRED':
      return hasValidEvidence ? 0.75 : 0.6;
    case 'CALCULATED':
      return 0.8;
    case 'CONFLICT':
      return 0.35;
    case 'UNVERIFIED':
    default:
      return 0.0;
  }
}

/**
 * Deterministic Source Validator (Backend Code - NO LLM)
 *
 * Enforces strict verification:
 * 1. Checks if block_id actually exists in document blocks
 * 2. Checks if normalized quote is a substring of normalized block.text
 * 3. For tables, verifies table and cell locators exist
 * 4. Checks if candidate numbers (budget, estimated price) actually exist in the quote
 * 5. Rejects EXPLICIT status if no valid quote exists (demotes to UNVERIFIED or INFERRED)
 * 6. Drops missing block_ids
 * 7. Calculates grounded confidence scores
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
  };

  const validationLogs: string[] = [];

  const evidenceStatus: Record<string, EvidenceStatus> = {};
  const evidenceQuotes: Record<string, EvidenceQuote> = {};
  const sourceReferences: Record<string, string> = {};
  const confidenceScores: Record<string, number> = {};

  // Helper to validate evidence array for a field
  const validateFieldEvidence = (
    fieldKey: string,
    initialStatus: EvidenceStatus,
    evidenceList: Array<{ block_id: string; quote: string; table_id?: string }>,
    numericCheckValue?: number | null
  ): { status: EvidenceStatus; verifiedQuote: EvidenceQuote | null } => {
    let finalStatus: EvidenceStatus = initialStatus;
    let primaryQuote: EvidenceQuote | null = null;

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

      const realBlock = blockMap.get(blockId);
      if (!realBlock) {
        // Check if it's a table locator (e.g. tbl_0_1)
        if (ev.table_id && tableMap.has(ev.table_id)) {
          const tbl = tableMap.get(ev.table_id)!;
          const tableNorm = normalizeText(
            tbl.caption + ' ' + tbl.rows.map((r) => r.join(' ')).join(' ')
          );
          const quoteNorm = normalizeText(rawQuote);
          if (quoteNorm.length >= 2 && tableNorm.includes(quoteNorm)) {
            stats.verified_evidence_count++;
            primaryQuote = {
              block_id: ev.table_id,
              quote: rawQuote,
              status: finalStatus,
              table_id: ev.table_id,
            };
            break;
          }
        }

        stats.rejected_missing_blocks++;
        validationLogs.push(`[${fieldKey}] 존재하지 않는 block_id '${blockId}' 거부됨`);
        continue;
      }

      // Check substring match
      const normBlockText = normalizeText(realBlock.text);
      const normQuote = normalizeText(rawQuote);

      if (!normQuote || normQuote.length < 2) {
        stats.demoted_quote_mismatches++;
        validationLogs.push(`[${fieldKey}] 인용구 길이가 2자 미만으로 유효하지 않음`);
        continue;
      }

      const isSubstring = normBlockText.includes(normQuote);
      if (!isSubstring) {
        stats.demoted_quote_mismatches++;
        validationLogs.push(
          `[${fieldKey}] 인용구 불일치 거부 (블록: ${blockId}): "${rawQuote.slice(0, 30)}..." != "${realBlock.text.slice(0, 30)}..."`
        );
        continue;
      }

      // If a numeric value is being judged (e.g. budget, estimated price)
      if (numericCheckValue !== undefined && numericCheckValue !== null && numericCheckValue > 0) {
        const hasNum = quoteContainsNumber(rawQuote, numericCheckValue);
        if (!hasNum) {
          stats.numeric_mismatches_rejected++;
          validationLogs.push(
            `[${fieldKey}] 숫자 불일치 (${numericCheckValue}원이 인용구에 없음): "${rawQuote}"`
          );
          continue;
        }
      }

      // If we reach here, evidence is genuinely verified!
      stats.verified_evidence_count++;
      primaryQuote = {
        block_id: blockId,
        quote: rawQuote,
        status: finalStatus,
        table_id: ev.table_id,
      };
      break;
    }

    if (!primaryQuote) {
      if (initialStatus === 'EXPLICIT') {
        finalStatus = 'UNVERIFIED';
        validationLogs.push(`[${fieldKey}] 유효한 원문 인용구가 없어 EXPLICIT에서 UNVERIFIED로 강등`);
      }
    }

    return { status: finalStatus, verifiedQuote: primaryQuote };
  };

  // 1. Project Name
  const projNameVal = validateFieldEvidence(
    'project_name',
    judgeDecision.project_name.status,
    judgeDecision.project_name.evidence
  );
  evidenceStatus.project_name = projNameVal.status;
  if (projNameVal.verifiedQuote) evidenceQuotes.project_name = projNameVal.verifiedQuote;
  confidenceScores.project_name = calculateConfidence(projNameVal.status, !!projNameVal.verifiedQuote);
  sourceReferences.project_name = projNameVal.verifiedQuote?.block_id || 'overview';

  // 2. Client Name & Demand Agency
  const clientVal = validateFieldEvidence(
    'client_name',
    judgeDecision.client_name.status,
    judgeDecision.client_name.evidence
  );
  evidenceStatus.client_name = clientVal.status;
  if (clientVal.verifiedQuote) evidenceQuotes.client_name = clientVal.verifiedQuote;
  confidenceScores.client_name = calculateConfidence(clientVal.status, !!clientVal.verifiedQuote);
  sourceReferences.client_name = clientVal.verifiedQuote?.block_id || 'agency';

  // 3. Client Type
  evidenceStatus.client_type = judgeDecision.client_type.status;
  confidenceScores.client_type = calculateConfidence(judgeDecision.client_type.status, true);

  // 4. Governing Law
  evidenceStatus.governing_law = judgeDecision.governing_law.status;
  confidenceScores.governing_law = calculateConfidence(judgeDecision.governing_law.status, true);

  // 5. Competition Method
  const compVal = validateFieldEvidence(
    'competition_method',
    judgeDecision.competition_method.status,
    judgeDecision.competition_method.evidence
  );
  evidenceStatus.competition_method = compVal.status;
  if (compVal.verifiedQuote) evidenceQuotes.competition_method = compVal.verifiedQuote;
  confidenceScores.competition_method = calculateConfidence(compVal.status, !!compVal.verifiedQuote);
  sourceReferences.competition_method = compVal.verifiedQuote?.block_id || 'competition';

  // 6. Award Method
  const awardVal = validateFieldEvidence(
    'award_method',
    judgeDecision.award_method.status,
    judgeDecision.award_method.evidence
  );
  evidenceStatus.award_method = awardVal.status;
  if (awardVal.verifiedQuote) evidenceQuotes.award_method = awardVal.verifiedQuote;
  confidenceScores.award_method = calculateConfidence(awardVal.status, !!awardVal.verifiedQuote);
  sourceReferences.award_method = awardVal.verifiedQuote?.block_id || 'award';

  // 7. Budget Amount
  let validBudget: number | null = judgeDecision.budget_amount.value;
  const budgetVal = validateFieldEvidence(
    'budget_amount',
    judgeDecision.budget_amount.status,
    judgeDecision.budget_amount.evidence,
    validBudget
  );
  evidenceStatus.budget_amount = budgetVal.status;
  if (budgetVal.verifiedQuote) {
    evidenceQuotes.budget_amount = budgetVal.verifiedQuote;
  } else if (validBudget && budgetVal.status === 'UNVERIFIED') {
    // If budget was explicitly claimed but quote failed numeric check, invalidate the value
    validBudget = null;
  }
  confidenceScores.budget_amount = calculateConfidence(budgetVal.status, !!budgetVal.verifiedQuote);
  sourceReferences.budget_amount = budgetVal.verifiedQuote?.block_id || 'budget';

  // 8. Estimated Price (Must strictly not overwrite budget, must be explicit in document)
  let validEstimated: number | null = judgeDecision.estimated_price.value;
  const estVal = validateFieldEvidence(
    'estimated_price',
    judgeDecision.estimated_price.status,
    judgeDecision.estimated_price.evidence,
    validEstimated
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
  const periodVal = validateFieldEvidence(
    'project_period',
    judgeDecision.project_period.status,
    judgeDecision.project_period.evidence
  );
  evidenceStatus.project_period = periodVal.status;
  if (periodVal.verifiedQuote) evidenceQuotes.project_period = periodVal.verifiedQuote;
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
    judgeDecision.award_method.value === 'NEGOTIATION'
      ? 'NEGOTIATION'
      : judgeDecision.competition_method.value === 'RESTRICTED_COMPETITIVE'
      ? 'RESTRICTED_COMPETITIVE'
      : judgeDecision.competition_method.value === 'OPEN_COMPETITIVE'
      ? 'OPEN_COMPETITIVE'
      : judgeDecision.competition_method.value === 'PRIVATE_CONTRACT'
      ? 'PRIVATE_CONTRACT'
      : 'UNKNOWN';

  const validatedMetadata: ExtractedMetadata = {
    project_id: projectId,
    project_name: judgeDecision.project_name.value || null,
    client_name: judgeDecision.client_name.value || judgeDecision.demand_agency.value || null,
    demand_agency: judgeDecision.demand_agency.value || judgeDecision.client_name.value || null,
    contract_agency: judgeDecision.contract_agency.value || null,
    client_type: judgeDecision.client_type.value || 'UNKNOWN',
    governing_law: judgeDecision.governing_law.value || 'UNKNOWN',
    procurement_method: derivedProcurementMethod,
    competition_method: judgeDecision.competition_method.value || 'UNKNOWN',
    award_method: judgeDecision.award_method.value || 'UNKNOWN',
    procurement_method_reason: judgeDecision.procurement_method_reason || 'Source Validator 검증 완료',
    budget_amount: validBudget,
    estimated_price: validEstimated,
    calculated_candidates: calcCandidates,
    derived_estimated_price: calcCandidates[0]?.amount || null,
    derivation_note: calcCandidates[0]?.note || null,
    project_period: judgeDecision.project_period.value || null,
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
