import React, { useState } from 'react';
import { X, Code2, ArrowLeftRight, CheckCircle2 } from 'lucide-react';

interface SchemaComparisonModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SchemaComparisonModal: React.FC<SchemaComparisonModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [selectedSchema, setSelectedSchema] = useState<'hwp' | 'document' | 'review'>('hwp');

  if (!isOpen) return null;

  const schemaData = {
    hwp: {
      title: 'HWP 파싱 결과 스키마 (HwpParseResult)',
      pydantic: `# backend/app/schemas/hwp.py
from datetime import datetime
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field

class HwpTextRun(BaseModel):
    text: str = Field(..., description="문자열 텍스트 조각")
    font_family: str = Field("한컴바탕", description="글꼴명")
    font_size: float = Field(10.5, description="폰트 크기 (pt)")
    is_bold: bool = Field(False, description="굵게(Bold) 속성")
    is_italic: bool = Field(False, description="기울임(Italic) 속성")
    color: str = Field("#111827", description="글자 색상")

class HwpParagraph(BaseModel):
    id: str = Field(..., description="문단 고유 식별자 (예: para_1)")
    section_index: int = Field(0, ge=0)
    paragraph_index: int = Field(..., ge=0)
    text: str = Field(..., description="문단 평문 텍스트")
    style_name: str = Field("본문", description="한글 스타일 서식명")
    align: TextAlignment = Field(TextAlignment.JUSTIFY)
    text_runs: List[HwpTextRun] = Field(default_factory=list)

class HwpCell(BaseModel):
    row: int = Field(..., ge=0)
    col: int = Field(..., ge=0)
    row_span: int = Field(1, ge=1)
    col_span: int = Field(1, ge=1)
    text: str = Field(...)
    is_header: bool = Field(False)

class HwpTable(BaseModel):
    id: str = Field(...)
    section_index: int = Field(0)
    row_count: int = Field(..., ge=1)
    col_count: int = Field(..., ge=1)
    cells: List[HwpCell] = Field(default_factory=list)

class HwpSection(BaseModel):
    index: int = Field(0)
    page_count: int = Field(1)
    paragraphs: List[HwpParagraph] = Field(default_factory=list)
    tables: List[HwpTable] = Field(default_factory=list)

class HwpParseResult(BaseModel):
    document_id: str
    version: str = Field("0.8.2-cli")
    file_name: str
    file_size: int
    format: DocumentFormat
    metadata: DocumentMetadata
    sections: List[HwpSection]
    raw_text: str
    ir_json: Dict[str, Any]
    cli_execution_info: Optional[CliExecutionInfo]
    parsed_at: datetime`,
      typescript: `// src/types/hwp.ts
import { DocumentFormat, TextAlignment } from './common';
import { DocumentMetadata } from './document';

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
}`,
    },
    document: {
      title: '문서 및 메타데이터 스키마 (Document & Metadata)',
      pydantic: `# backend/app/schemas/document.py
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field
from backend.app.schemas.common import DocumentStatus, DocumentFormat

class DocumentMetadata(BaseModel):
    title: str = Field(..., description="문서 제목")
    author: Optional[str] = None
    created_date: Optional[str] = None
    modified_date: Optional[str] = None
    hwp_version: str = Field("5.0.3.0")
    is_compressed: bool = False
    is_encrypted: bool = False
    page_count: int = Field(1, ge=1)
    paragraph_count: int = 0
    table_count: int = 0
    character_count: int = 0
    word_count: int = 0

class DocumentResponse(BaseModel):
    id: str
    title: str
    file_name: str
    file_size: int
    file_format: DocumentFormat
    status: DocumentStatus
    error_message: Optional[str] = None
    metadata: Optional[DocumentMetadata] = None
    created_at: datetime
    updated_at: datetime`,
      typescript: `// src/types/document.ts
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

export interface DocumentResponse {
  id: string;
  title: string;
  file_name: string;
  file_size: number;
  file_format: DocumentFormat;
  status: DocumentStatus;
  error_message?: string | null;
  metadata?: DocumentMetadata | null;
  created_at: string;
  updated_at: string;
}`,
    },
    review: {
      title: '사전 감사 규칙 및 피드백 스키마 (ReviewRule & Violation)',
      pydantic: `# backend/app/schemas/review.py
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field
from backend.app.schemas.common import SeverityLevel

class Violation(BaseModel):
    id: str
    rule_id: str
    rule_name: str
    category: str
    severity: SeverityLevel
    paragraph_id: Optional[str] = None
    target_text: str
    message: str
    suggestion: Optional[str] = None
    start_offset: Optional[int] = None
    end_offset: Optional[int] = None

class ReviewResult(BaseModel):
    id: str
    document_id: str
    total_violations: int
    score: int
    summary: str
    categories_summary: List[CategorySummary]
    violations: List[Violation]
    reviewed_at: datetime`,
      typescript: `// src/types/review.ts
import { SeverityLevel } from './common';

export interface Violation {
  id: string;
  rule_id: string;
  rule_name: string;
  category: string;
  severity: SeverityLevel;
  paragraph_id?: string | null;
  target_text: string;
  message: string;
  suggestion?: string | null;
  start_offset?: number | null;
  end_offset?: number | null;
}

export interface ReviewResult {
  id: string;
  document_id: string;
  total_violations: number;
  score: number;
  summary: string;
  categories_summary: CategorySummary[];
  violations: Violation[];
  reviewed_at: string;
}`,
    },
  };

  const current = schemaData[selectedSchema];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center">
              <ArrowLeftRight className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                FastAPI Pydantic v2 ↔ Next.js TypeScript 타입 규격 비교
              </h3>
              <p className="text-xs text-slate-500">
                03_DATA_SCHEMA.md 에 정의된 백엔드/프론트엔드 1:1 동기화 상태
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Schema Selector Tabs */}
        <div className="flex items-center space-x-2 px-6 py-3 border-b border-slate-200 bg-white">
          <button
            onClick={() => setSelectedSchema('hwp')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              selectedSchema === 'hwp'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            HWP 파싱 결과 (hwp.py / hwp.ts)
          </button>

          <button
            onClick={() => setSelectedSchema('document')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              selectedSchema === 'document'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            문서 메타데이터 (document.py / document.ts)
          </button>

          <button
            onClick={() => setSelectedSchema('review')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              selectedSchema === 'review'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            AI 감사 결과 (review.py / review.ts)
          </button>
        </div>

        {/* Side-by-side Code Comparison */}
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Left: FastAPI Pydantic */}
          <div className="flex flex-col border border-slate-200 rounded-xl overflow-hidden bg-slate-900">
            <div className="bg-slate-800 px-4 py-2 border-b border-slate-700 flex items-center justify-between text-xs">
              <span className="font-bold text-amber-400 flex items-center">
                <Code2 className="w-3.5 h-3.5 mr-1.5" />
                FastAPI Pydantic v2 Model
              </span>
              <span className="text-[11px] font-mono text-slate-400">Python 3.11</span>
            </div>
            <pre className="flex-1 p-4 font-mono text-xs text-slate-200 leading-relaxed overflow-x-auto">
              {current.pydantic}
            </pre>
          </div>

          {/* Right: Next.js TypeScript */}
          <div className="flex flex-col border border-slate-200 rounded-xl overflow-hidden bg-slate-900">
            <div className="bg-slate-800 px-4 py-2 border-b border-slate-700 flex items-center justify-between text-xs">
              <span className="font-bold text-blue-400 flex items-center">
                <Code2 className="w-3.5 h-3.5 mr-1.5" />
                Next.js / TypeScript Interface
              </span>
              <span className="text-[11px] font-mono text-slate-400">TypeScript 5.x</span>
            </div>
            <pre className="flex-1 p-4 font-mono text-xs text-slate-200 leading-relaxed overflow-x-auto">
              {current.typescript}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-6 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center space-x-1 text-emerald-700">
            <CheckCircle2 className="w-4 h-4" />
            <span>03_DATA_SCHEMA.md 스펙에 따라 100% 타입 안전성(Type Safety) 동기화 완료</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-900 text-white font-medium hover:bg-slate-800 transition"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};
