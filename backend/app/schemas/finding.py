from datetime import datetime
from enum import Enum
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field

class RuleCategoryType(str, Enum):
    RULE_FIX = "RULE_FIX"              # 🔴 즉시 수정
    RULE_WARN = "RULE_WARN"            # 🟡 확인 필요
    RULE_RECOMMEND = "RULE_RECOMMEND"  # 🟡 권고 수정
    RULE_INFO = "RULE_INFO"            # 🔵 단순 참고
    FAIRNESS = "FAIRNESS"              # 🟣 공정성 검토
    AI_REVIEW = "AI_REVIEW"            # 🟢 AI 추가검토


class SeverityLevel(str, Enum):
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"
    WARNING = "WARNING"
    INFO = "INFO"

class DecisionStatus(str, Enum):
    PENDING = "PENDING"
    ACCEPTED = "ACCEPTED"    # 수용
    REJECTED = "REJECTED"    # 불수용

class NativeLocator(BaseModel):
    section_index: int = Field(0, description="HWP 문서 구역 인덱스 (0-based)")
    paragraph_index: Optional[int] = Field(None, description="구역 내 문단 인덱스")
    table_index: Optional[int] = Field(None, description="구역 내 표 인덱스")
    row: Optional[int] = Field(None, description="표 내 행 번호")
    col: Optional[int] = Field(None, description="표 내 열 번호")

class SourceRef(BaseModel):
    block_id: str = Field(..., description="연결된 문서 블록 고유 ID (예: para_4, cell_0_0)")
    native_locator: NativeLocator = Field(..., description="HWP 원본 문서 내 세부 위치 좌표")
    text: Optional[str] = Field(None, description="해당 블록의 원문 텍스트 조각")

class DocumentBlock(BaseModel):
    block_id: str = Field(..., description="블록 고유 식별자")
    block_type: str = Field("PARAGRAPH", description="블록 유형 (PARAGRAPH, TABLE_CELL)")
    native_locator: NativeLocator = Field(..., description="원본 문서 좌표")
    text: str = Field(..., description="블록 평문 텍스트")
    style_name: Optional[str] = Field(None, description="스타일 이름 (제목, 개요, 본문 등)")

class Finding(BaseModel):
    finding_id: str = Field(..., description="탐지 지적사항 고유 ID")
    project_id: str = Field(..., description="소속 프로젝트 또는 문서 ID")
    rule_id: str = Field(..., description="적용된 규칙 식별자 (예: RULE-KEYWORD-001)")
    rule_name: str = Field(..., description="규칙 표시명")
    category: RuleCategoryType = Field(RuleCategoryType.RULE_FIX, description="카테고리 (RULE_FIX: 🔴 즉시 수정)")
    severity: SeverityLevel = Field(SeverityLevel.HIGH, description="심각도 수준 (HIGH)")
    title: str = Field(..., description="문제 발생 요약 제목")
    original_text: str = Field(..., description="문제 발생 원문 텍스트")
    matched_keyword: str = Field(..., description="탐지된 핵심 키워드")
    source_refs: List[SourceRef] = Field(default_factory=list, description="원문 블록 참조 좌표 목록")
    basis: str = Field(..., description="관련 법령 및 행정 가이드라인 근거")
    recommendation: str = Field(..., description="수정 권고 문안 및 대체 가이드")
    decision: DecisionStatus = Field(DecisionStatus.PENDING, description="사용자 결정 상태 (PENDING, ACCEPTED, REJECTED)")
    decision_reason: Optional[str] = Field(None, description="수용 또는 불수용 결정 사유")
    decided_at: Optional[str] = Field(None, description="결정 일시 (ISO8601)")
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat(), description="생성 일시")

class DecisionUpdateDto(BaseModel):
    decision: DecisionStatus = Field(..., description="사용자 검토 결정 (ACCEPTED 또는 REJECTED)")
    reason: Optional[str] = Field(None, description="선택적 결정 사유/비고")

class RuleExecuteRequest(BaseModel):
    document_id: Optional[str] = Field(None, description="검토 대상 문서 ID")
    blocks: Optional[List[DocumentBlock]] = Field(None, description="검토할 DocumentBlock 목록 (제공 시 우선 사용)")
    raw_text: Optional[str] = Field(None, description="문서 평문 전체 텍스트 (보조)")

class RuleExecuteResponse(BaseModel):
    project_id: str = Field(..., description="프로젝트 ID")
    total_findings: int = Field(..., description="총 탐지된 지적사항 건수")
    findings: List[Finding] = Field(default_factory=list, description="탐지된 Finding 목록")
    executed_rules_count: int = Field(2, description="실행된 규칙 수")
    executed_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
