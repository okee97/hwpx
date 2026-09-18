from datetime import datetime
from typing import List, Optional, Dict
from pydantic import BaseModel, Field
from backend.app.schemas.common import SeverityLevel

class ReviewCategory(BaseModel):
    id: str = Field(..., description="카테고리 코드 (COMPLIANCE, PRIVACY, GRAMMAR, TERMINOLOGY)")
    name: str = Field(..., description="카테고리 표시명 (공문서 규정, 개인정보 보호, 맞춤법/순화어)")
    description: str = Field(..., description="카테고리 설명")

class ReviewRule(BaseModel):
    id: str = Field(..., description="규칙 고유 식별자")
    category_id: str = Field(..., description="소속 카테고리")
    name: str = Field(..., description="규칙명")
    description: str = Field(..., description="규칙 세부 내용")
    severity: SeverityLevel = Field(..., description="위반 심각도 (CRITICAL, WARNING, INFO)")
    enabled: bool = Field(True, description="규칙 활성화 여부")

class Violation(BaseModel):
    id: str = Field(..., description="위반 사항 식별자")
    rule_id: str = Field(..., description="위반된 규칙 ID")
    rule_name: str = Field(..., description="규칙명")
    category: str = Field(..., description="위반 분류")
    severity: SeverityLevel = Field(..., description="위반 수준")
    paragraph_id: Optional[str] = Field(None, description="위반 위치 문단 ID")
    target_text: str = Field(..., description="문제 발생 원문 텍스트")
    message: str = Field(..., description="위반 원인 및 지적 사항")
    suggestion: Optional[str] = Field(None, description="수정 권고안 또는 대체 표현")
    start_offset: Optional[int] = Field(None, description="문단 내 시작 위치")
    end_offset: Optional[int] = Field(None, description="문단 내 종료 위치")

class CategorySummary(BaseModel):
    category: str = Field(..., description="검토 항목명")
    total_issues: int = Field(0, ge=0, description="발견된 문제 건수")
    critical_count: int = Field(0, ge=0, description="중대 위반 수")
    warning_count: int = Field(0, ge=0, description="주의 권고 수")
    info_count: int = Field(0, ge=0, description="단순 참고 수")

class ReviewResult(BaseModel):
    id: str = Field(..., description="검토 세션 고유 식별자")
    document_id: str = Field(..., description="대상 문서 ID")
    total_violations: int = Field(0, ge=0, description="총 위반 건수")
    score: int = Field(100, ge=0, le=100, description="문서 품질 점수 (100점 만점)")
    summary: str = Field(..., description="전체 종합 검토 소견")
    categories_summary: List[CategorySummary] = Field(default_factory=list, description="항목별 집계")
    violations: List[Violation] = Field(default_factory=list, description="세부 위반 항목 목록")
    reviewed_at: datetime = Field(default_factory=datetime.utcnow, description="검토 일시")
