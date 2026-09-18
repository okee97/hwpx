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
} from '../../src/types/metadata';

export interface ExplorerEvidenceCandidate {
  block_id: string;
  quote: string;
  reason: string;
  table_id?: string;
  cell_coordinate?: { row: number; col: number };
}

export interface ExplorerDossier {
  project_identity: ExplorerEvidenceCandidate[];
  agency: ExplorerEvidenceCandidate[];
  budget: ExplorerEvidenceCandidate[];
  competition_method: ExplorerEvidenceCandidate[];
  award_method: ExplorerEvidenceCandidate[];
  period: ExplorerEvidenceCandidate[];
  additional_evidence?: ExplorerEvidenceCandidate[];
  tables_summary?: Array<{
    table_id: string;
    caption: string;
    rows: string[][];
  }>;
}

export interface ToolCallRequest {
  tool:
    | 'get_document_outline'
    | 'search_blocks'
    | 'get_block'
    | 'get_neighbors'
    | 'get_section'
    | 'search_tables'
    | 'get_table';
  args: Record<string, any>;
  reason: string;
}

export interface SpecialistCandidate<T> {
  value: T;
  status: EvidenceStatus;
  evidence: Array<{
    block_id: string;
    quote: string;
    table_id?: string;
  }>;
  reasoning_summary: string;
  conflict_notes?: string;
}

export interface ProjectAgencySpecialistResult {
  project_name: SpecialistCandidate<string>;
  client_name: SpecialistCandidate<string | null>;
  demand_agency: SpecialistCandidate<string | null>;
  contract_agency: SpecialistCandidate<string | null>;
  client_type: SpecialistCandidate<ClientType>;
  governing_law: SpecialistCandidate<GoverningLaw>;
}

export interface ProcurementSpecialistResult {
  competition_method: SpecialistCandidate<CompetitionMethod>;
  award_method: SpecialistCandidate<AwardMethod>;
}

export interface BudgetPriceSpecialistResult {
  budget_amount: SpecialistCandidate<number | null>;
  estimated_price: SpecialistCandidate<number | null>;
  vat_included: SpecialistCandidate<boolean | null>;
  calculated_candidates: CalculatedCandidate[];
}

export interface PeriodSpecialistResult {
  project_period: SpecialistCandidate<string | null>;
  start_condition?: string;
  end_condition?: string;
}

export interface ConsistencySpecialistResult {
  has_conflicts: boolean;
  detected_conflicts: Array<{
    field: string;
    description: string;
    conflicting_values: string[];
    evidence: Array<{ block_id: string; quote: string }>;
  }>;
  consistency_summary: string;
}

export interface SpecialistResultsBundle {
  project_agency: ProjectAgencySpecialistResult;
  procurement: ProcurementSpecialistResult;
  budget_price: BudgetPriceSpecialistResult;
  period: PeriodSpecialistResult;
  consistency: ConsistencySpecialistResult;
}

export interface EvidenceMemoryItem {
  round: number;
  source_type: 'block' | 'table' | 'neighbors';
  id: string; // block_id or table_id
  content: string; // full or substantial text (up to 400-500 chars)
  locator?: string;
  relevance_hint?: string;
}

export interface JudgeDecisionField<T> {
  value: T;
  status: EvidenceStatus;
  evidence: Array<{
    block_id: string;
    quote: string;
    table_id?: string;
  }>;
  reasoning_summary: string;
}

export interface JudgeDecisionPayload {
  project_name: JudgeDecisionField<string>;
  client_name: JudgeDecisionField<string | null>;
  demand_agency: JudgeDecisionField<string | null>;
  contract_agency: JudgeDecisionField<string | null>;
  client_type: JudgeDecisionField<ClientType>;
  governing_law: JudgeDecisionField<GoverningLaw>;
  competition_method: JudgeDecisionField<CompetitionMethod>;
  award_method: JudgeDecisionField<AwardMethod>;
  procurement_method_reason: string;
  budget_amount: JudgeDecisionField<number | null>;
  estimated_price: JudgeDecisionField<number | null>;
  vat_included?: JudgeDecisionField<boolean | null>;
  calculated_candidates: CalculatedCandidate[];
  project_period: JudgeDecisionField<string | null>;
  judge_summary: string;
  needs_more_evidence?: boolean;
  missing_domains?: string[];
  suggested_queries?: string[];
}

export interface SourceValidationStats {
  total_evidence_checked: number;
  verified_evidence_count: number;
  rejected_missing_blocks: number;
  demoted_quote_mismatches: number;
  numeric_mismatches_rejected: number;
  decision_grounding_mismatches: number;
}

export interface SourceValidationResult {
  validatedMetadata: ExtractedMetadata;
  validationStats: SourceValidationStats;
  validationLogs: string[];
}

export interface PipelineExecutionStats {
  exploration_rounds: number;
  tool_calls_count: number;
  specialists_count: number;
  judge_executed: boolean;
  judge_reexploration_triggered: boolean;
  source_validator: SourceValidationStats;
  models_used: {
    explorer?: string;
    specialists?: string;
    judge?: string;
  };
  duration_ms: number;
}

export interface MetadataV4Result {
  extracted: ExtractedMetadata;
  pipelineStats: PipelineExecutionStats;
  procurement_method_reason?: string;
  metadata_judge_report?: string;
  is_ai_powered: boolean;
}

export const METADATA_MODELS = {
  explorer: ['gemini-3.8-flash', 'gemini-3.1-flash-lite'],
  specialists: ['gemini-3.8-flash', 'gemini-3.1-flash-lite'],
  judge: ['gemini-3.8-flash', 'gemini-2.5-flash'],
};
