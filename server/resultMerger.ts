import { DocumentBlock, Finding, SourceRef } from '../src/types/finding';

export interface MergerValidationResult {
  findings: Finding[];
  mergedCount: number;
  filteredByValidatorCount: number;
}

function normalizeForComparison(t: string): string {
  return (t || '')
    .replace(/[\s\u00A0\u200B\r\n\t]+/g, ' ')
    .trim();
}

/**
 * Result Merger & Source Validator
 * 1. Source Validator: AI 인용문이 실제 DocumentBlock에 존재하는지 엄격 검증 (허위 인용 필터링)
 *    - 원칙: block_id 존재 AND original_text가 실제 block의 substring일 것을 기본 조건으로 설정
 * 2. Result Merger: Rule Engine, Fairness, General Agent 간 동일 블록/동일 지적사항 중복 병합
 */
export function mergeAndValidateFindings(
  rawFindings: Finding[],
  documentBlocks: DocumentBlock[]
): MergerValidationResult {
  const blockMap = new Map<string, DocumentBlock>();
  documentBlocks.forEach((b) => blockMap.set(b.block_id, b));

  let filteredByValidatorCount = 0;
  const validatedFindings: Finding[] = [];

  // 1. Source Validator (원문 검증 및 허위 인용/환각 엄격 필터링)
  for (const finding of rawFindings) {
    let isValid = false;
    const validatedRefs: SourceRef[] = [];
    const quote = normalizeForComparison(finding.original_text || '');

    // Check existing source_refs
    for (const ref of finding.source_refs) {
      const realBlock = blockMap.get(ref.block_id);
      if (realBlock) {
        const realText = normalizeForComparison(realBlock.text);

        // 엄격한 substring 검증: 공백 정규화 후 실질적 일치 확인
        const isSubstring = quote.length >= 4 && realText.includes(quote);
        const isReverseSubstring = quote.length > 25 && quote.includes(realText);
        const hasKeywordMatch =
          Boolean(finding.matched_keyword &&
          finding.matched_keyword.trim().length >= 3 &&
          realText.includes(normalizeForComparison(finding.matched_keyword)) &&
          (quote.length === 0 || realText.includes(quote.slice(0, 15))));

        if (isSubstring || isReverseSubstring || hasKeywordMatch) {
          isValid = true;
          validatedRefs.push({
            block_id: realBlock.block_id,
            native_locator: realBlock.native_locator,
            text: realBlock.text,
          });
        }
      }
    }

    // If source_ref block_id was fabricated or unmatched, attempt strict recovery by searching documentBlocks
    if (!isValid && quote.length >= 8) {
      const candidate = documentBlocks.find((b) => {
        const candidateNorm = normalizeForComparison(b.text);
        return candidateNorm.includes(quote);
      });

      if (candidate) {
        isValid = true;
        validatedRefs.push({
          block_id: candidate.block_id,
          native_locator: candidate.native_locator,
          text: candidate.text,
        });
      }
    }

    if (isValid && validatedRefs.length > 0) {
      finding.source_refs = validatedRefs;
      // Update original_text to the true block text if finding had a snippet
      if (validatedRefs[0].text) {
        finding.original_text = validatedRefs[0].text;
      }
      validatedFindings.push(finding);
    } else {
      // Filter out hallucinated/invalid source finding as per prompt requirements
      filteredByValidatorCount++;
    }
  }

  // 2. Result Merger (Deduplicate across Rule, Fairness, AI_REVIEW)
  const mergedMap = new Map<string, Finding>();
  let mergedCount = 0;

  for (const f of validatedFindings) {
    const primaryBlockId = f.source_refs[0]?.block_id || 'unknown';
    // Grouping key by block_id and issue theme (e.g. resident number, auto-renew, IP, maintenance, period)
    const issueKey = getIssueKey(f, primaryBlockId);

    if (mergedMap.has(issueKey)) {
      const existing = mergedMap.get(issueKey)!;
      mergedCount++;

      // Merge source_refs
      const existingBlockIds = new Set(existing.source_refs.map((s) => s.block_id));
      for (const ref of f.source_refs) {
        if (!existingBlockIds.has(ref.block_id)) {
          existing.source_refs.push(ref);
        }
      }

      // Prioritize severity (CRITICAL > HIGH/WARNING > INFO)
      if (getSeverityRank(f.severity) > getSeverityRank(existing.severity)) {
        existing.severity = f.severity;
      }

      // Prioritize category: RULE_FIX > FAIRNESS > AI_REVIEW > RULE_WARN
      if (getCategoryRank(f.category) > getCategoryRank(existing.category)) {
        existing.category = f.category;
        existing.rule_id = f.rule_id;
        existing.rule_name = f.rule_name;
      }

      // Preserve any non-pending decision
      if (f.decision !== 'PENDING' && existing.decision === 'PENDING') {
        existing.decision = f.decision;
        existing.decision_reason = f.decision_reason;
        existing.decided_at = f.decided_at;
      }
    } else {
      mergedMap.set(issueKey, { ...f });
    }
  }

  return {
    findings: Array.from(mergedMap.values()),
    mergedCount,
    filteredByValidatorCount,
  };
}

function getIssueKey(f: Finding, blockId: string): string {
  if (f.rule_id.startsWith('RULE-KEYWORD-001') || f.matched_keyword?.includes('주민등록번호')) {
    return `issue_resident_num_${blockId}`;
  }
  if (f.rule_id.startsWith('RULE-KEYWORD-002') || f.matched_keyword?.includes('자동연장')) {
    return `issue_auto_renew_${blockId}`;
  }
  if (f.rule_id.startsWith('RULE-META-001') || f.matched_keyword?.includes('국가계약법')) {
    return `issue_governing_law_${blockId}`;
  }
  if (f.rule_id.includes('IP') || f.title.includes('지식재산권')) {
    return `issue_ip_rights_${blockId}`;
  }
  if (f.rule_id.includes('MAINT') || f.title.includes('하자보수')) {
    return `issue_maintenance_${blockId}`;
  }
  return `${blockId}_${f.rule_id}`;
}

function getSeverityRank(sev: string): number {
  switch (sev) {
    case 'CRITICAL':
    case 'HIGH':
      return 3;
    case 'WARNING':
    case 'MEDIUM':
      return 2;
    case 'INFO':
    case 'LOW':
      return 1;
    default:
      return 0;
  }
}

function getCategoryRank(cat: string): number {
  switch (cat) {
    case 'RULE_FIX':
      return 4;
    case 'FAIRNESS':
      return 3;
    case 'AI_REVIEW':
      return 2;
    case 'RULE_WARN':
    case 'RULE_RECOMMEND':
      return 1;
    default:
      return 0;
  }
}
