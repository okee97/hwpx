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
import { MetadataOrchestrator } from './metadata/metadataOrchestrator';
import { PipelineExecutionStats } from './metadata/metadataSchemas';

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
  pipelineStats?: PipelineExecutionStats;
}

/**
 * Metadata Extractor v4 Entry Point
 *
 * Coordinates:
 * HWP/HWPX Parser
 *     ↓
 * Document IR / Document Navigator
 *     ↓
 * [AI Stage 1] Metadata Explorer (iterative tool-calling loop)
 *     ↓
 * [AI Stage 2] Domain Specialists (5 independent specialists)
 *     ↓
 * [AI Stage 3] Metadata Judge (independent cross-specialist evaluation)
 *     ↓
 * [Deterministic] Source Validator (strict backend substring & numeric checks)
 *     ↓
 * ExtractedMetadata
 */
export async function extractMetadataWithGemini(
  input: MetadataExtractionInput
): Promise<AiMetadataResult> {
  const orchestrator = new MetadataOrchestrator();
  const result = await orchestrator.execute({
    projectId: input.projectId,
    blocks: input.blocks,
    tables: input.tables || [],
    rawText: input.rawText,
    fileName: input.fileName,
    parsedMetadata: input.parsedMetadata,
  });

  return {
    extracted: result.extracted,
    procurement_method_reason: result.procurement_method_reason,
    metadata_judge_report: result.metadata_judge_report,
    is_ai_powered: result.is_ai_powered,
    pipelineStats: result.pipelineStats,
  };
}
