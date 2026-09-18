import { DocumentFormat, TextAlignment } from './common';
import { DocumentMetadata } from './document';
import { ExtractedMetadata, AuthoritativeMetadata } from './metadata';

export interface HwpTextRun {
  text: string;
  font_family: string;
  font_size: number;
  is_bold: boolean;
  is_italic: boolean;
  color: string;
}

export interface HwpParagraph {
  id: string;
  section_index: number;
  paragraph_index: number;
  text: string;
  style_name: string;
  align: TextAlignment;
  text_runs: HwpTextRun[];
}

export interface HwpCell {
  row: number;
  col: number;
  row_span: number;
  col_span: number;
  text: string;
  is_header: boolean;
}

export interface HwpTable {
  id: string;
  section_index: number;
  row_count: number;
  col_count: number;
  cells: HwpCell[];
}

export interface HwpSection {
  index: number;
  page_count: number;
  paragraphs: HwpParagraph[];
  tables: HwpTable[];
}

export interface CliExecutionInfo {
  command: string;
  exit_code: number;
  duration_ms: number;
  cli_version: string;
}

export interface HwpParseResult {
  document_id: string;
  version: string;
  file_name: string;
  file_size: number;
  format: DocumentFormat;
  metadata: DocumentMetadata;
  sections: HwpSection[];
  raw_text: string;
  ir_json: Record<string, unknown>;
  cli_execution_info?: CliExecutionInfo | null;
  parsed_at: string;
  extracted_metadata?: ExtractedMetadata;
  authoritative_metadata?: AuthoritativeMetadata;
}

