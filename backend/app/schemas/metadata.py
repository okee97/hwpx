from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field

class ClientType(str, Enum):
    LOCAL_GOVERNMENT = "LOCAL_GOVERNMENT"       # 지방자치단체
    CENTRAL_GOVERNMENT = "CENTRAL_GOVERNMENT"   # 국가기관 / 중앙행정기관
    PUBLIC_INSTITUTION = "PUBLIC_INSTITUTION"   # 공공기관 / 공기업
    EDUCATIONAL = "EDUCATIONAL"                 # 교육청 / 국공립학교
    OTHER = "OTHER"                             # 기타

class GoverningLaw(str, Enum):
    LOCAL_CONTRACT_ACT = "LOCAL_CONTRACT_ACT"   # 지방계약법
    STATE_CONTRACT_ACT = "STATE_CONTRACT_ACT"   # 국가계약법
    PUBLIC_ENTERPRISE_RULE = "PUBLIC_ENTERPRISE_RULE" # 공기업·준정부기관 계약사무규칙
    OTHER = "OTHER"                             # 기타

class ProcurementMethod(str, Enum):
    NEGOTIATION = "NEGOTIATION"                 # 협상에 의한 계약
    RESTRICTED_COMPETITIVE = "RESTRICTED_COMPETITIVE" # 제한경쟁입찰
    OPEN_COMPETITIVE = "OPEN_COMPETITIVE"       # 일반경쟁입찰
    PRIVATE_CONTRACT = "PRIVATE_CONTRACT"       # 수의계약

class ExtractedMetadata(BaseModel):
    project_id: str = Field(..., description="연결된 프로젝트 ID")
    project_name: Optional[str] = Field(None, description="사업명")
    client_name: Optional[str] = Field(None, description="수요기관명")
    client_type: ClientType = Field(ClientType.LOCAL_GOVERNMENT, description="수요기관 유형")
    governing_law: GoverningLaw = Field(GoverningLaw.LOCAL_CONTRACT_ACT, description="적용 계약법")
    procurement_method: ProcurementMethod = Field(ProcurementMethod.NEGOTIATION, description="계약방법")
    budget_amount: Optional[int] = Field(None, description="사업예산 (원, 부가세 포함)")
    estimated_price: Optional[int] = Field(None, description="추정가격 (원, 부가세 제외)")
    project_period: Optional[str] = Field(None, description="사업기간")
    confidence_scores: Dict[str, float] = Field(default_factory=dict, description="필드별 AI 추출 신뢰도 (0.0~1.0)")
    source_references: Dict[str, str] = Field(default_factory=dict, description="필드별 추출 근거 block_id")
    extracted_at: datetime = Field(default_factory=datetime.utcnow, description="추출 일시")
    status: str = Field("COMPLETED", description="추출 상태 (COMPLETED, FAILED)")

class AuthoritativeMetadata(BaseModel):
    project_id: str = Field(..., description="연결된 프로젝트 ID")
    version: int = Field(1, ge=1, description="확정본 버전 (1부터 시작)")
    project_name: str = Field(..., description="사업명")
    client_name: str = Field(..., description="수요기관명")
    client_type: ClientType = Field(..., description="수요기관 유형")
    governing_law: GoverningLaw = Field(..., description="적용 계약법")
    procurement_method: ProcurementMethod = Field(..., description="계약방법")
    budget_amount: Optional[int] = Field(None, description="사업예산 (원, 부가세 포함)")
    estimated_price: Optional[int] = Field(None, description="추정가격 (원, 부가세 제외)")
    project_period: Optional[str] = Field(None, description="사업기간")
    confirmed_by: Optional[str] = Field("user_officer", description="확정자 식별자")
    note: Optional[str] = Field(None, description="확정 비고 및 메모")
    updated_at: datetime = Field(default_factory=datetime.utcnow, description="최종 확정 일시")

class AuthoritativeMetadataUpdateDto(BaseModel):
    project_name: str
    client_name: str
    client_type: ClientType
    governing_law: GoverningLaw
    procurement_method: ProcurementMethod
    budget_amount: Optional[int] = None
    estimated_price: Optional[int] = None
    project_period: Optional[str] = None
    confirmed_by: Optional[str] = "user_officer"
    note: Optional[str] = None

class MetadataSnapshot(BaseModel):
    snapshot_id: str
    project_id: str
    version: int
    data: AuthoritativeMetadata
    created_at: datetime = Field(default_factory=datetime.utcnow)
