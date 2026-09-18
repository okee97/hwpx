import uuid
from datetime import datetime
from typing import List, Dict, Any, Optional
from backend.app.schemas.finding import (
    Finding,
    DocumentBlock,
    SourceRef,
    NativeLocator,
    RuleCategoryType,
    SeverityLevel,
    DecisionStatus,
)
from backend.app.schemas.metadata import AuthoritativeMetadata, ClientType, GoverningLaw

class KeywordRule:
    def __init__(
        self,
        rule_id: str,
        rule_name: str,
        keyword: str,
        category: RuleCategoryType,
        severity: SeverityLevel,
        title: str,
        basis: str,
        recommendation: str,
    ):
        self.rule_id = rule_id
        self.rule_name = rule_name
        self.keyword = keyword
        self.category = category
        self.severity = severity
        self.title = title
        self.basis = basis
        self.recommendation = recommendation

    def evaluate_block(self, project_id: str, block: DocumentBlock) -> Optional[Finding]:
        if self.keyword in block.text:
            finding_id = f"finding-{self.rule_id.lower()}-{uuid.uuid4().hex[:8]}"
            source_ref = SourceRef(
                block_id=block.block_id,
                native_locator=block.native_locator,
                text=block.text.strip(),
            )
            return Finding(
                finding_id=finding_id,
                project_id=project_id,
                rule_id=self.rule_id,
                rule_name=self.rule_name,
                category=self.category,
                severity=self.severity,
                title=self.title,
                original_text=block.text.strip(),
                matched_keyword=self.keyword,
                source_refs=[source_ref],
                basis=self.basis,
                recommendation=self.recommendation,
                decision=DecisionStatus.PENDING,
                decision_reason=None,
                decided_at=None,
                created_at=datetime.utcnow().isoformat(),
            )
        return None


class MetadataLawMismatchRule:
    """
    메타데이터 기반 룰 (RULE-META-001):
    수요기관이 지방자치단체(지방계약법 적용 대상)로 확정되었음에도 본문에 국가계약법 조항이 혼용된 경우 탐지
    """
    def __init__(self):
        self.rule_id = "RULE-META-001"
        self.rule_name = "수요기관 유형과 적용 법령 불일치 탐지"
        self.category = RuleCategoryType.RULE_FIX
        self.severity = SeverityLevel.HIGH
        self.title = "지방자치단체 발주 사업에 국가계약법 조항 혼용 탐지"
        self.target_keywords = [
            "국가를 당사자로 하는 계약에 관한 법률",
            "국가를 당사자로 하는 계약",
            "국가계약법",
        ]
        self.basis = (
            "지방자치단체를 당사자로 하는 계약에 관한 법률 제4조(다른 법률과의 관계)에 의거, "
            "지방자치단체가 발주하는 계약은 지방계약법이 배타적으로 적용되며 국가계약법 규정을 직접 원용할 수 없습니다."
        )
        self.recommendation = (
            "본 사업은 지방자치단체 발주(확정: 지방계약법 적용 대상)이므로, "
            "'국가를 당사자로 하는 계약에 관한 법률' 조항을 '지방자치단체를 당사자로 하는 계약에 관한 법률(지방계약법)' 및 동법 시행령 조항으로 수정하십시오."
        )

    def evaluate_block(
        self, project_id: str, block: DocumentBlock, metadata: Optional[AuthoritativeMetadata]
    ) -> Optional[Finding]:
        if not metadata:
            return None

        is_local_gov = (
            metadata.client_type == ClientType.LOCAL_GOVERNMENT
            or metadata.governing_law == GoverningLaw.LOCAL_CONTRACT_ACT
        )
        if not is_local_gov:
            return None

        for kw in self.target_keywords:
            if kw in block.text:
                finding_id = f"finding-{self.rule_id.lower()}-{uuid.uuid4().hex[:8]}"
                source_ref = SourceRef(
                    block_id=block.block_id,
                    native_locator=block.native_locator,
                    text=block.text.strip(),
                )
                return Finding(
                    finding_id=finding_id,
                    project_id=project_id,
                    rule_id=self.rule_id,
                    rule_name=self.rule_name,
                    category=self.category,
                    severity=self.severity,
                    title=self.title,
                    original_text=block.text.strip(),
                    matched_keyword=kw,
                    source_refs=[source_ref],
                    basis=self.basis,
                    recommendation=self.recommendation,
                    decision=DecisionStatus.PENDING,
                    decision_reason=None,
                    decided_at=None,
                    created_at=datetime.utcnow().isoformat(),
                )
        return None


class RuleEngineService:
    """
    1단계 세로 슬라이스 완성: 대표 KEYWORD 룰 2개 엔진
    - 룰 1: "주민등록번호" 요구 탐지 (RULE_FIX, HIGH, 생년월일 대체 권고)
    - 룰 2: "자동연장" 문구 탐지 (RULE_FIX, HIGH, 상호협의/삭제 권고)
    """

    def __init__(self):
        self.rules: List[KeywordRule] = [
            KeywordRule(
                rule_id="RULE-KEYWORD-001",
                rule_name="주민등록번호 요구 탐지",
                keyword="주민등록번호",
                category=RuleCategoryType.RULE_FIX,
                severity=SeverityLevel.HIGH,
                title="주민등록번호 수집/요구 조항 탐지",
                basis="개인정보보호법 제24조의2(주민등록번호 처리의 제한)에 따라 법령에서 구체적으로 주민등록번호 처리를 요구하거나 허용한 경우를 제외하고는 공문서, 서식 및 계약서상 주민등록번호의 수집 및 기재가 원칙적으로 금지됩니다.",
                recommendation="주민등록번호 요구 문구를 삭제하고, '생년월일(YYYY.MM.DD)' 또는 마이핀/아이핀 등 안전한 비식별 대체 수단으로 변경하십시오.",
            ),
            KeywordRule(
                rule_id="RULE-KEYWORD-002",
                rule_name="자동연장 문구 탐지",
                keyword="자동연장",
                category=RuleCategoryType.RULE_FIX,
                severity=SeverityLevel.HIGH,
                title="계약 자동연장 독소조항 탐지",
                basis="약관의 규제에 관한 법률 제9조(계약의 해제·해지) 및 공정거래위원회 표준계약서 규정에 따라, 별도 통지 없이 묵시적으로 계약이 갱신되는 일방적 자동연장 조항은 상대방의 해제권을 부당하게 제한하는 불공정 독소조항에 해당합니다.",
                recommendation="자동연장 문구를 삭제하거나, '계약 만료 30일 전까지 서면으로 상호 협의하여 갱신 여부를 결정한다'와 같이 당사자 간 상호 합의 절차로 변경하십시오.",
            ),
        ]
        self.meta_rule = MetadataLawMismatchRule()

    def extract_blocks_from_hwp_result(self, hwp_data: Dict[str, Any]) -> List[DocumentBlock]:
        """
        HwpParseResult 데이터 구조(sections -> paragraphs, tables -> cells)를
        검토 가능한 평탄화된 DocumentBlock 리스트로 변환합니다.
        """
        blocks: List[DocumentBlock] = []
        sections = hwp_data.get("sections", [])
        for s_idx, section in enumerate(sections):
            # 문단 블록 추출
            paragraphs = section.get("paragraphs", [])
            for p_idx, para in enumerate(paragraphs):
                text = para.get("text", "")
                if text and text.strip():
                    block_id = para.get("id") or f"para_{s_idx}_{p_idx}"
                    blocks.append(
                        DocumentBlock(
                            block_id=block_id,
                            block_type="PARAGRAPH",
                            native_locator=NativeLocator(
                                section_index=s_idx,
                                paragraph_index=p_idx,
                            ),
                            text=text,
                            style_name=para.get("style_name"),
                        )
                    )

            # 표 셀 블록 추출
            tables = section.get("tables", [])
            for t_idx, table in enumerate(tables):
                t_id = table.get("id") or f"table_{s_idx}_{t_idx}"
                cells = table.get("cells", [])
                for cell in cells:
                    cell_text = cell.get("text", "")
                    if cell_text and cell_text.strip():
                        r = cell.get("row", 0)
                        c = cell.get("col", 0)
                        blocks.append(
                            DocumentBlock(
                                block_id=f"{t_id}_c_{r}_{c}",
                                block_type="TABLE_CELL",
                                native_locator=NativeLocator(
                                    section_index=s_idx,
                                    table_index=t_idx,
                                    row=r,
                                    col=c,
                                ),
                                text=cell_text,
                                style_name="표내용",
                            )
                        )

        # 문단이 없는 경우 raw_text를 줄 단위로 분할하여 기본 블록 생성
        if not blocks and hwp_data.get("raw_text"):
            raw_lines = hwp_data["raw_text"].split("\n")
            for idx, line in enumerate(raw_lines):
                if line.strip():
                    blocks.append(
                        DocumentBlock(
                            block_id=f"line_{idx}",
                            block_type="PARAGRAPH",
                            native_locator=NativeLocator(section_index=0, paragraph_index=idx),
                            text=line,
                        )
                    )

        return blocks

    def execute_rules(
        self,
        project_id: str,
        blocks: List[DocumentBlock],
        metadata: Optional[AuthoritativeMetadata] = None,
    ) -> List[Finding]:
        """
        DocumentBlock 리스트를 순회하며 2개 대표 규칙 + 1개 Metadata 규칙을 평가하고 Finding 리스트를 반환합니다.
        """
        if metadata is None:
            from backend.app.services.metadata_service import metadata_service
            metadata = metadata_service.get_authoritative(project_id)

        findings: List[Finding] = []
        for block in blocks:
            for rule in self.rules:
                finding = rule.evaluate_block(project_id, block)
                if finding:
                    findings.append(finding)
            
            # 메타데이터 기반 규칙 평가
            if metadata:
                meta_finding = self.meta_rule.evaluate_block(project_id, block, metadata)
                if meta_finding:
                    findings.append(meta_finding)

        return findings


rule_engine_service = RuleEngineService()
