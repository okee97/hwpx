import { AuthoritativeMetadata } from '../src/types/metadata';
import { DocumentBlock, Finding, ReviewPipelineResponse } from '../src/types/finding';
import { runFairnessReviewAgent } from './fairnessAgent';
import { runGeneralReviewAgent } from './generalReviewAgent';
import { mergeAndValidateFindings } from './resultMerger';

export interface OrchestratorInput {
  projectId: string;
  blocks: DocumentBlock[];
  rawText?: string;
  authoritativeMetadata: AuthoritativeMetadata | null;
  ruleFindings: Finding[];
}

/**
 * ReviewOrchestrator
 * 전체 AI 종합 검토 파이프라인 제어기:
 * 1. Rule Engine Findings 접수 (Keyword + Metadata 룰)
 * 2. Fairness Review Agent 실행 (공정성, 상호협의 권고)
 * 3. General Review Agent 실행 (모순/누락/과업-내역 불일치, 중복방지 컨텍스트 적용)
 * 4. Result Merger & Source Validator (허위인용 필터링 및 지적사항 병합)
 */
export async function orchestrateReviewPipeline(
  input: OrchestratorInput
): Promise<ReviewPipelineResponse> {
  const { projectId, blocks, rawText = '', authoritativeMetadata, ruleFindings } = input;

  // Step 1: Rule Findings Summary for Anti-Duplication Context
  const ruleSummary = ruleFindings.map((rf) => ({
    rule_id: rf.rule_id,
    title: rf.title,
    block_id: rf.source_refs[0]?.block_id || '',
    matched_keyword: rf.matched_keyword,
  }));

  // Step 2: Fairness Review Agent
  const fairnessFindings = await runFairnessReviewAgent({
    projectId,
    authoritativeMetadata,
    blocks,
    ruleFindingsSummary: ruleSummary,
  });

  // Step 3: General Review Agent (with Anti-Duplication Context from Rules + Fairness)
  const antiDuplicationContext = [
    ...ruleSummary,
    ...fairnessFindings.map((ff) => ({
      rule_id: ff.rule_id,
      title: ff.title,
      block_id: ff.source_refs[0]?.block_id || '',
      matched_keyword: ff.matched_keyword,
    })),
  ];

  const generalFindings = await runGeneralReviewAgent({
    projectId,
    authoritativeMetadata,
    blocks,
    rawText,
    antiDuplicationContext,
  });

  // Step 4: Result Merger & Source Validator
  const combinedRawFindings = [...ruleFindings, ...fairnessFindings, ...generalFindings];
  const { findings, mergedCount, filteredByValidatorCount } = mergeAndValidateFindings(
    combinedRawFindings,
    blocks
  );

  return {
    project_id: projectId,
    total_findings: findings.length,
    findings,
    merged_count: mergedCount,
    filtered_by_validator_count: filteredByValidatorCount,
    stage_counts: {
      rule_findings: ruleFindings.length,
      fairness_findings: fairnessFindings.length,
      general_findings: generalFindings.length,
    },
    executed_at: new Date().toISOString(),
  };

}
