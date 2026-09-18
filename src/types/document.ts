import { DocumentStatus, DocumentFormat } from './common';

export interface DocumentMetadata {
  title: string;
  author?: string | null;
  created_date?: string | null;
  modified_date?: string | null;
  hwp_version: string;
  is_compressed: boolean;
  is_encrypted: boolean;
  page_count: number;
  paragraph_count: number;
  table_count: number;
  character_count: number;
  word_count: number;
}

export interface DocumentBase {
  title: string;
  file_name: string;
  file_size: number;
  file_format: DocumentFormat;
}

export interface DocumentCreate extends DocumentBase {}

export interface DocumentResponse extends DocumentBase {
  id: string;
  status: DocumentStatus;
  error_message?: string | null;
  metadata?: DocumentMetadata | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentUploadResponse {
  document_id: string;
  file_name: string;
  file_size: number;
  file_format: DocumentFormat;
  status: DocumentStatus;
  message: string;
}
