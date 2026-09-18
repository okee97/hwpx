from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field
from backend.app.schemas.common import DocumentStatus, DocumentFormat

class DocumentMetadata(BaseModel):
    title: str = Field(..., description="문서 제목")
    author: Optional[str] = Field(None, description="문서 작성자/기안자")
    created_date: Optional[str] = Field(None, description="문서 생성 일시")
    modified_date: Optional[str] = Field(None, description="최종 수정 일시")
    hwp_version: str = Field("5.0.3.0", description="한글 문서 버전")
    is_compressed: bool = Field(False, description="zlib 스트림 압축 여부")
    is_encrypted: bool = Field(False, description="문서 암호화 여부")
    page_count: int = Field(1, ge=1, description="예상 페이지 수")
    paragraph_count: int = Field(0, ge=0, description="총 문단 수")
    table_count: int = Field(0, ge=0, description="총 표 개수")
    character_count: int = Field(0, ge=0, description="공백 포함 총 글자 수")
    word_count: int = Field(0, ge=0, description="총 어절/단어 수")

class DocumentBase(BaseModel):
    title: str = Field(..., description="문서명")
    file_name: str = Field(..., description="업로드된 원본 파일명")
    file_size: int = Field(..., ge=0, description="파일 크기(바이트)")
    file_format: DocumentFormat = Field(..., description="파일 포맷 (hwp / hwpx)")

class DocumentCreate(DocumentBase):
    pass

class DocumentResponse(DocumentBase):
    id: str = Field(..., description="문서 고유 식별자(UUID)")
    status: DocumentStatus = Field(DocumentStatus.UPLOADED, description="현재 처리 상태")
    error_message: Optional[str] = Field(None, description="실패 시 에러 메시지")
    metadata: Optional[DocumentMetadata] = Field(None, description="추출된 메타데이터")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="업로드 일시")
    updated_at: datetime = Field(default_factory=datetime.utcnow, description="최종 갱신 일시")

class DocumentUploadResponse(BaseModel):
    document_id: str = Field(..., description="생성된 문서 ID")
    file_name: str = Field(..., description="파일명")
    file_size: int = Field(..., description="파일 바이트 수")
    file_format: DocumentFormat = Field(..., description="문서 형식")
    status: DocumentStatus = Field(..., description="처리 상태")
    message: str = Field("문서가 성공적으로 업로드되었습니다.", description="결과 메시지")
