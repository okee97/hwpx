from datetime import datetime
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from backend.app.schemas.common import DocumentFormat, TextAlignment
from backend.app.schemas.document import DocumentMetadata

class HwpTextRun(BaseModel):
    text: str = Field(..., description="문자열 텍스트 조각")
    font_family: str = Field("한컴바탕", description="글꼴명")
    font_size: float = Field(10.5, description="폰트 크기 (pt)")
    is_bold: bool = Field(False, description="굵게(Bold) 속성")
    is_italic: bool = Field(False, description="기울임(Italic) 속성")
    color: str = Field("#111827", description="글자 색상 (HEX 코드)")

class HwpParagraph(BaseModel):
    id: str = Field(..., description="문단 고유 식별자 (예: para_1)")
    section_index: int = Field(0, ge=0, description="구역 번호")
    paragraph_index: int = Field(..., ge=0, description="구역 내 문단 인덱스")
    text: str = Field(..., description="문단 전체 평문 텍스트")
    style_name: str = Field("본문", description="한글 스타일 서식명 (예: 제목, 개요 1, 본문)")
    align: TextAlignment = Field(TextAlignment.JUSTIFY, description="문단 정렬")
    text_runs: List[HwpTextRun] = Field(default_factory=list, description="인라인 텍스트 런 목록")

class HwpCell(BaseModel):
    row: int = Field(..., ge=0, description="행 인덱스 (0부터 시작)")
    col: int = Field(..., ge=0, description="열 인덱스 (0부터 시작)")
    row_span: int = Field(1, ge=1, description="행 병합 수")
    col_span: int = Field(1, ge=1, description="열 병합 수")
    text: str = Field(..., description="셀 텍스트 내용")
    is_header: bool = Field(False, description="테이블 헤더 여부")

class HwpTable(BaseModel):
    id: str = Field(..., description="표 고유 식별자 (예: table_1)")
    section_index: int = Field(0, ge=0, description="표가 위치한 구역 번호")
    row_count: int = Field(..., ge=1, description="표의 총 행 수")
    col_count: int = Field(..., ge=1, description="표의 총 열 수")
    cells: List[HwpCell] = Field(default_factory=list, description="표 셀 목록")

class HwpSection(BaseModel):
    index: int = Field(0, ge=0, description="구역 번호 (Section Index)")
    page_count: int = Field(1, ge=1, description="해당 구역의 예상 페이지 수")
    paragraphs: List[HwpParagraph] = Field(default_factory=list, description="구역 내 문단 목록")
    tables: List[HwpTable] = Field(default_factory=list, description="구역 내 표 목록")

class CliExecutionInfo(BaseModel):
    command: str = Field(..., description="실행된 rhwp CLI 명령어")
    exit_code: int = Field(0, description="프로세스 종료 코드")
    duration_ms: float = Field(..., description="파싱 소요 시간 (밀리초)")
    cli_version: str = Field("rhwp 0.8.2-cli", description="CLI 도구 버전")

class HwpParseResult(BaseModel):
    document_id: str = Field(..., description="대상 문서 ID")
    version: str = Field("0.8.2-cli", description="파서 버전")
    file_name: str = Field(..., description="파싱된 원본 파일명")
    file_size: int = Field(..., ge=0, description="파일 바이트 수")
    format: DocumentFormat = Field(..., description="문서 포맷 (hwp / hwpx)")
    metadata: DocumentMetadata = Field(..., description="추출된 문서 메타데이터")
    sections: List[HwpSection] = Field(default_factory=list, description="문서 구역 및 구조")
    raw_text: str = Field(..., description="문서 전체 평문 텍스트")
    ir_json: Dict[str, Any] = Field(default_factory=dict, description="rhwp 중간 표현식(IR) 원본 데이터")
    cli_execution_info: Optional[CliExecutionInfo] = Field(None, description="CLI 실행 세부 정보")
    parsed_at: datetime = Field(default_factory=datetime.utcnow, description="파싱 완료 시각")
