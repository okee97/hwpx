from typing import List, Optional
from fastapi import APIRouter, HTTPException, Path, Body, status
from backend.app.schemas.common import ApiResponse
from backend.app.schemas.finding import (
    Finding,
    DecisionUpdateDto,
    RuleExecuteRequest,
    RuleExecuteResponse,
    DocumentBlock,
    DecisionStatus,
)
from backend.app.services.rule_engine import rule_engine_service
from backend.app.services.finding_storage import finding_storage_service

router = APIRouter()

@router.post("/{project_id}/rules/execute", response_model=ApiResponse[RuleExecuteResponse])
async def execute_rules_on_project(
    project_id: str = Path(..., description="프로젝트 또는 문서 고유 ID"),
    payload: Optional[RuleExecuteRequest] = Body(None),
):
    """
    대표 룰 2개(주민등록번호 탐지, 자동연장 문구 탐지)를 실행하여 Finding을 생성하고 저장합니다.
    """
    blocks: List[DocumentBlock] = []
    if payload and payload.blocks:
        blocks = payload.blocks
    elif payload and payload.raw_text:
        # Fallback to lines
        lines = payload.raw_text.split("\n")
        for i, line in enumerate(lines):
            if line.strip():
                blocks.append(
                    DocumentBlock(
                        block_id=f"para_{i}",
                        block_type="PARAGRAPH",
                        native_locator={"section_index": 0, "paragraph_index": i},
                        text=line.strip(),
                    )
                )
    else:
        # 기본 점검용 테스트 블록 (요구사항 룰 1 및 룰 2 포함)
        blocks = [
            DocumentBlock(
                block_id="para_1",
                block_type="PARAGRAPH",
                native_locator={"section_index": 0, "paragraph_index": 0},
                text="2026년도 공공 정보화 사업 계약서 및 개인정보 처리방침",
                style_name="제목",
            ),
            DocumentBlock(
                block_id="para_4",
                block_type="PARAGRAPH",
                native_locator={"section_index": 0, "paragraph_index": 3},
                text="나. 비공개 민감 정보(주민등록번호, 계좌번호 등)의 외부 유출 사전 차단 필터링 구축",
                style_name="개요 2",
            ),
            DocumentBlock(
                block_id="para_7",
                block_type="PARAGRAPH",
                native_locator={"section_index": 0, "paragraph_index": 6},
                text="다. 본 계약은 기간 만료 30일 전까지 별도의 서면 이의 제기가 없는 한 동일한 조건으로 1년간 자동연장되는 것으로 본다.",
                style_name="개요 2",
            ),
        ]

    findings = rule_engine_service.execute_rules(project_id, blocks)
    saved_findings = finding_storage_service.save_findings(project_id, findings)

    response_data = RuleExecuteResponse(
        project_id=project_id,
        total_findings=len(saved_findings),
        findings=saved_findings,
        executed_rules_count=len(rule_engine_service.rules),
    )

    return ApiResponse(
        success=True,
        message=f"프로젝트 '{project_id}'에 대해 {len(rule_engine_service.rules)}개 대표 규칙 실행 완료. 총 {len(saved_findings)}건의 Finding이 탐지되었습니다.",
        data=response_data,
    )


@router.get("/{project_id}/findings", response_model=ApiResponse[List[Finding]])
async def get_project_findings(
    project_id: str = Path(..., description="프로젝트 또는 문서 고유 ID"),
):
    """
    해당 프로젝트에서 탐지된 모든 Finding 목록을 조회합니다.
    """
    findings = finding_storage_service.get_findings(project_id)
    return ApiResponse(
        success=True,
        message=f"총 {len(findings)}건의 Finding이 조회되었습니다.",
        data=findings,
    )


@router.get("/{project_id}/findings/{finding_id}", response_model=ApiResponse[Finding])
async def get_single_finding(
    project_id: str = Path(..., description="프로젝트 고유 ID"),
    finding_id: str = Path(..., description="지적사항 고유 ID"),
):
    """
    특정 Finding 상세 정보를 조회합니다.
    """
    finding = finding_storage_service.get_finding(project_id, finding_id)
    if not finding:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Finding '{finding_id}'을 찾을 수 없습니다.",
        )
    return ApiResponse(
        success=True,
        message="Finding 상세 조회 성공",
        data=finding,
    )


@router.put("/{project_id}/findings/{finding_id}/decision", response_model=ApiResponse[Finding])
async def update_finding_decision(
    project_id: str = Path(..., description="프로젝트 고유 ID"),
    finding_id: str = Path(..., description="지적사항 고유 ID"),
    payload: DecisionUpdateDto = Body(...),
):
    """
    사용자가 검토 카드에서 [수용] 또는 [불수용]을 선택할 때 이를 저장합니다.
    """
    updated_finding = finding_storage_service.update_decision(
        project_id=project_id,
        finding_id=finding_id,
        decision=payload.decision,
        reason=payload.reason,
    )

    if not updated_finding:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Finding '{finding_id}'을 찾을 수 없어 결정을 반영하지 못했습니다.",
        )

    decision_label = "수용" if payload.decision == DecisionStatus.ACCEPTED else "불수용"
    return ApiResponse(
        success=True,
        message=f"Finding '{finding_id}'에 대해 '{decision_label}' 결정이 성공적으로 저장되었습니다.",
        data=updated_finding,
    )
