import { DocumentBlock } from '../../src/types/finding';
import { TableMatrix } from '../rhwpAdapter';
import { DocumentNavigator, buildDocumentIndex } from '../documentNavigator';
import { isGeminiKeyConfigured, verifyGeminiApiKey } from '../geminiClient';
import { MetadataExplorer } from './metadataExplorer';
import { MetadataSpecialistsRunner } from './metadataSpecialists';
import { MetadataJudge } from './metadataJudge';
import { validateJudgeDecision, inferClientTypeAndLaw } from './metadataSourceValidator';
import {
  MetadataV4Result,
  PipelineExecutionStats,
} from './metadataSchemas';
import {
  ExtractedMetadata,
  ClientType,
  GoverningLaw,
  ProcurementMethod,
  CompetitionMethod,
  AwardMethod,
  CalculatedCandidate,
} from '../../src/types/metadata';

export interface MetadataExtractorV4Options {
  projectId: string;
  blocks: DocumentBlock[];
  tables?: TableMatrix[];
  rawText?: string;
  fileName?: string;
  parsedMetadata?: any;
}

/**
 * Metadata Extractor v4 Orchestrator
 *
 * Coordinates the full multi-stage AI Agent Pipeline:
 * [Document Navigator]
 *        ↓
 * [AI Stage 1] Metadata Explorer (iterative tool-calling)
 *        ↓
 * [AI Stage 2] Domain Specialists (5 independent specialists)
 *        ↓
 * [AI Stage 3] Metadata Judge (independent cross-specialist evaluation)
 *        ↓
 * [Deterministic] Source Validator (strict backend substring & numeric checks)
 *        ↓
 * ExtractedMetadata
 */
export class MetadataOrchestrator {
  async execute(options: MetadataExtractorV4Options): Promise<MetadataV4Result> {
    const startTime = Date.now();
    const { projectId, blocks, tables = [], rawText = '', fileName = '' } = options;

    // 1. Build Document Navigator index
    const index = buildDocumentIndex(blocks, tables, rawText);
    const navigator = new DocumentNavigator(index);

    // 2. Check Gemini availability
    const isConfigured = isGeminiKeyConfigured();
    let isKeyValid = false;
    if (isConfigured) {
      try {
        isKeyValid = await verifyGeminiApiKey();
      } catch (e) {
        isKeyValid = false;
      }
    }

    if (!isConfigured || !isKeyValid) {
      console.log('[MetadataExtractor v4] Gemini API 비활성 상태 - 신뢰할 수 있는 규칙 기반 정밀 추출기로 안전 전환');
      return this.executeFallback(navigator, projectId, fileName, startTime);
    }

    // 3. Multi-Stage AI Pipeline Execution
    try {
      // --- AI STAGE 1: Metadata Explorer ---
      const explorer = new MetadataExplorer(navigator);
      const explorerResult = await explorer.explore({
        projectId,
        fileName,
      });

      // --- AI STAGE 2: Domain Specialists ---
      const specialistsRunner = new MetadataSpecialistsRunner();
      let specialistResults = await specialistsRunner.runAll(explorerResult.dossier, fileName);

      // --- AI STAGE 3: Metadata Judge ---
      const judge = new MetadataJudge();
      let judgeResult = await judge.judge(
        explorerResult.dossier,
        specialistResults,
        fileName,
        false
      );

      let reexplorationTriggered = false;

      // Handle optional single re-exploration if critical evidence was deemed missing by Judge
      if (
        judgeResult.decision.needs_more_evidence &&
        Array.isArray(judgeResult.decision.suggested_queries) &&
        judgeResult.decision.suggested_queries.length > 0
      ) {
        console.log(
          `[MetadataExtractor v4] Judge requested targeted re-exploration: ${judgeResult.decision.suggested_queries.join(', ')}`
        );
        reexplorationTriggered = true;
        const reExplorerResult = await explorer.explore({
          projectId,
          fileName,
          focusQueries: judgeResult.decision.suggested_queries,
        });

        specialistResults = await specialistsRunner.runAll(reExplorerResult.dossier, fileName);
        judgeResult = await judge.judge(
          reExplorerResult.dossier,
          specialistResults,
          fileName,
          true
        );
      }

      // --- DETERMINISTIC STAGE 4: Source Validator ---
      const sourceValidation = validateJudgeDecision(
        judgeResult.decision,
        blocks,
        tables,
        projectId,
        judgeResult.modelUsed || explorerResult.modelUsed
      );

      const durationMs = Date.now() - startTime;
      const pipelineStats: PipelineExecutionStats = {
        exploration_rounds: explorerResult.roundsRun,
        tool_calls_count: explorerResult.toolCallsCount,
        specialists_count: 5,
        judge_executed: true,
        judge_reexploration_triggered: reexplorationTriggered,
        source_validator: sourceValidation.validationStats,
        models_used: {
          explorer: explorerResult.modelUsed,
          judge: judgeResult.modelUsed,
        },
        duration_ms: durationMs,
      };

      return {
        extracted: sourceValidation.validatedMetadata,
        pipelineStats,
        procurement_method_reason: judgeResult.decision.procurement_method_reason,
        metadata_judge_report: judgeResult.decision.judge_summary,
        is_ai_powered: true,
      };
    } catch (err: any) {
      console.warn('[MetadataExtractor v4 AI Pipeline Error, falling back safely]', err?.message || err);
      return this.executeFallback(navigator, projectId, fileName, startTime);
    }
  }

  /**
   * Safe, non-hallucinating deterministic fallback using DocumentNavigator
   */
  private executeFallback(
    navigator: DocumentNavigator,
    projectId: string,
    fileName: string,
    startTime: number
  ): MetadataV4Result {
    const overviewMatches = navigator.searchBlocks('사업명 과업명 수요기관 발주기관', { limit: 4 });
    let foundProjectName = fileName.replace(/\.[^/.]+$/, '');
    let foundClientName = '';

    for (const m of overviewMatches) {
      if (m.text.includes('사업명') || m.text.includes('과업명')) {
        const match = m.text.match(/(?:사업명|과업명)\s*[:：]\s*([^\n\r,]+)/);
        if (match && match[1]?.trim()) {
          foundProjectName = match[1].trim();
        }
      }
      if (m.text.includes('수요기관') || m.text.includes('발주기관')) {
        const match = m.text.match(/(?:수요기관|발주기관)\s*[:：]\s*([^\n\r,]+)/);
        if (match && match[1]?.trim()) {
          foundClientName = match[1].trim();
        }
      }
    }

    const budgetMatches = navigator.searchBlocks('사업예산 추정가격 소요예산 기초금액', { limit: 4 });
    let budgetAmount: number | null = null;
    let estimatedPrice: number | null = null;
    let budgetQuote: string = '';
    let budgetBlockId: string = '';

    for (const m of budgetMatches) {
      if (m.text.includes('사업예산') || m.text.includes('총사업비')) {
        const numMatch = m.text.match(/([0-9,]{4,})\s*원/);
        if (numMatch) {
          const val = parseInt(numMatch[1].replace(/,/g, ''), 10);
          if (val > 1000000) {
            budgetAmount = val;
            budgetQuote = m.text.slice(0, 100);
            budgetBlockId = m.block_id;
          }
        }
      }
      if (m.text.includes('추정가격')) {
        const numMatch = m.text.match(/추정가격\s*[:：]?\s*([0-9,]{4,})\s*원/);
        if (numMatch) {
          const val = parseInt(numMatch[1].replace(/,/g, ''), 10);
          if (val > 1000000) {
            estimatedPrice = val;
          }
        }
      }
    }

    // Check procurement method
    const compMatches = navigator.searchBlocks('일반경쟁 제한경쟁 지명경쟁 수의계약', { limit: 3 });
    let compMethod: CompetitionMethod = 'UNKNOWN';
    let compQuote = '';
    let compBlockId = '';

    for (const m of compMatches) {
      if (m.text.includes('제한경쟁')) {
        compMethod = 'RESTRICTED_COMPETITIVE';
        compQuote = '제한경쟁입찰';
        compBlockId = m.block_id;
        break;
      } else if (m.text.includes('일반경쟁')) {
        compMethod = 'OPEN_COMPETITIVE';
        compQuote = '일반경쟁입찰';
        compBlockId = m.block_id;
        break;
      }
    }

    const awardMatches = navigator.searchBlocks('협상에 의한 계약 적격심사 최저가낙찰', { limit: 3 });
    let awardMethod: AwardMethod = 'UNKNOWN';
    let awardQuote = '';
    let awardBlockId = '';

    for (const m of awardMatches) {
      if (m.text.includes('협상에 의한 계약') || m.text.includes('협상계약')) {
        awardMethod = 'NEGOTIATION';
        awardQuote = '협상에 의한 계약';
        awardBlockId = m.block_id;
        break;
      } else if (m.text.includes('적격심사')) {
        awardMethod = 'QUALIFICATION_REVIEW';
        awardQuote = '적격심사';
        awardBlockId = m.block_id;
        break;
      }
    }

    const periodMatches = navigator.searchBlocks('사업기간 과업기간 착수일로부터', { limit: 3 });
    let periodText: string | null = null;
    let periodQuote = '';
    let periodBlockId = '';

    for (const m of periodMatches) {
      const match = m.text.match(/(착수일로부터\s*[0-9가-힣\s]+|[0-9]{4}\s*년\s*[0-9]{1,2}\s*월\s*[0-9]{1,2}\s*일\s*까지|[0-9]+\s*개월)/);
      if (match) {
        periodText = match[1].trim();
        periodQuote = periodText;
        periodBlockId = m.block_id;
        break;
      }
    }

    const calcCandidates: CalculatedCandidate[] = [];
    if (budgetAmount && !estimatedPrice) {
      calcCandidates.push({
        label: '총사업예산 기준 부가세(10%) 역산 공급가액',
        amount: Math.round(budgetAmount / 1.1),
        note: '총사업예산 ÷ 1.1 참고 계산값 (문서 내 추정가격 미기재)',
      });
    }

    const agencyRule = inferClientTypeAndLaw(foundClientName);

    const extracted: ExtractedMetadata = {
      project_id: projectId,
      project_name: foundProjectName,
      client_name: foundClientName || null,
      demand_agency: foundClientName || null,
      contract_agency: null,
      client_type: agencyRule.clientType,
      governing_law: agencyRule.governingLaw,
      procurement_method: awardMethod === 'NEGOTIATION' ? 'NEGOTIATION' : compMethod === 'RESTRICTED_COMPETITIVE' ? 'RESTRICTED_COMPETITIVE' : 'UNKNOWN',
      competition_method: compMethod,
      award_method: awardMethod,
      procurement_method_reason: compMethod !== 'UNKNOWN' || awardMethod !== 'UNKNOWN'
        ? `문서 본문 검색 결과: ${compMethod !== 'UNKNOWN' ? compMethod : ''} ${awardMethod !== 'UNKNOWN' ? awardMethod : ''}`
        : '문서에서 계약방법을 명시적으로 특정할 수 없습니다.',
      budget_amount: budgetAmount,
      estimated_price: estimatedPrice,
      vat_included: null,
      calculated_candidates: calcCandidates,
      derived_estimated_price: calcCandidates[0]?.amount || null,
      derivation_note: calcCandidates[0]?.note || null,
      project_period: periodText,
      confidence_scores: {
        project_name: foundProjectName ? 0.7 : 0.0,
        client_name: foundClientName ? 0.7 : 0.0,
        governing_law: agencyRule.confidence,
        client_type: agencyRule.confidence,
        procurement_method: compMethod !== 'UNKNOWN' ? 0.7 : 0.0,
        competition_method: compMethod !== 'UNKNOWN' ? 0.7 : 0.0,
        award_method: awardMethod !== 'UNKNOWN' ? 0.7 : 0.0,
        budget_amount: budgetAmount ? 0.75 : 0.0,
        project_period: periodText ? 0.7 : 0.0,
      },
      evidence_status: {
        competition_method: compMethod !== 'UNKNOWN' ? 'EXPLICIT' : 'UNVERIFIED',
        award_method: awardMethod !== 'UNKNOWN' ? 'EXPLICIT' : 'UNVERIFIED',
        budget_amount: budgetAmount ? 'EXPLICIT' : 'UNVERIFIED',
        estimated_price: estimatedPrice ? 'EXPLICIT' : 'UNVERIFIED',
        project_period: periodText ? 'EXPLICIT' : 'UNVERIFIED',
      },
      evidence_quotes: {
        ...(compQuote ? { competition_method: { block_id: compBlockId, quote: compQuote, status: 'EXPLICIT' } } : {}),
        ...(awardQuote ? { award_method: { block_id: awardBlockId, quote: awardQuote, status: 'EXPLICIT' } } : {}),
        ...(budgetQuote ? { budget_amount: { block_id: budgetBlockId, quote: budgetQuote, status: 'EXPLICIT' } } : {}),
        ...(periodQuote ? { project_period: { block_id: periodBlockId, quote: periodQuote, status: 'EXPLICIT' } } : {}),
      },
      source_references: {
        project_name: 'overview',
        client_name: 'overview',
        competition_method: compBlockId || 'competition',
        award_method: awardBlockId || 'award',
        budget_amount: budgetBlockId || 'budget',
        project_period: periodBlockId || 'period',
      },
      is_ai_powered: false,
      analysis_engine: 'RULE_FALLBACK',
      model_used: 'rule-navigator',
      fallback_used: true,
      requires_user_confirmation: true,
      extracted_at: new Date().toISOString(),
      status: 'RULE_EXTRACTED',
    };

    return {
      extracted,
      pipelineStats: {
        exploration_rounds: 0,
        tool_calls_count: 0,
        specialists_count: 0,
        judge_executed: false,
        judge_reexploration_triggered: false,
        source_validator: {
          total_evidence_checked: Object.keys(extracted.evidence_quotes || {}).length,
          verified_evidence_count: Object.keys(extracted.evidence_quotes || {}).length,
          rejected_missing_blocks: 0,
          demoted_quote_mismatches: 0,
          numeric_mismatches_rejected: 0,
          decision_grounding_mismatches: 0,
        },
        models_used: {},
        duration_ms: Date.now() - startTime,
      },
      procurement_method_reason: extracted.procurement_method_reason,
      metadata_judge_report: '규칙 엔진 탐색 완료 (Gemini AI 미가동 또는 대체 실행)',
      is_ai_powered: false,
    };
  }
}
