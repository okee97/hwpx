from typing import List, Optional
from fastapi import APIRouter, HTTPException, Path, Body, status
from pydantic import BaseModel
from backend.app.schemas.common import ApiResponse
from backend.app.schemas.finding import DocumentBlock
from backend.app.schemas.metadata import (
    ExtractedMetadata,
    AuthoritativeMetadata,
    AuthoritativeMetadataUpdateDto,
)
from backend.app.services.metadata_service import metadata_service

router = APIRouter()

class MetadataExtractRequest(BaseModel):
    blocks: Optional[List[DocumentBlock]] = None
    raw_text: Optional[str] = None
    async_mode: Optional[bool] = False

@router.post("/{project_id}/metadata/extract", response_model=ApiResponse[ExtractedMetadata])
async def extract_project_metadata(
    project_id: str = Path(..., description="프로젝트 또는 문서 고유 ID"),
    payload: Optional[MetadataExtractRequest] = Body(None),
):
    """
    HWP DocumentBlock 및 텍스트를 기반으로 사업정보를 AI 추출(Metadata Extractor)합니다.
    """
    blocks = payload.blocks if payload else None
    raw_text = payload.raw_text if payload else ""

    extracted = metadata_service.extract_from_blocks(
        project_id=project_id,
        blocks=blocks,
        raw_text=raw_text,
    )

    return ApiResponse(
        success=True,
        message=f"프로젝트 '{project_id}' 사업정보 AI 추출 완료 (신뢰도: 수요기관 {extracted.confidence_scores.get('client_name', 0.9):.2f})",
        data=extracted,
    )


@router.get("/{project_id}/metadata/extracted", response_model=ApiResponse[ExtractedMetadata])
async def get_extracted_metadata(
    project_id: str = Path(..., description="프로젝트 고유 ID"),
):
    """
    AI가 추출한 원본 사업정보(Extracted Metadata)를 조회합니다.
    """
    extracted = metadata_service.get_extracted(project_id)
    if not extracted:
        # 아직 추출된 적이 없다면 기본 자동 추출 1회 실행
        extracted = metadata_service.extract_from_blocks(project_id=project_id)

    return ApiResponse(
        success=True,
        message="AI 추출 메타데이터 조회 성공",
        data=extracted,
    )


@router.put("/{project_id}/metadata/authoritative", response_model=ApiResponse[AuthoritativeMetadata])
async def update_authoritative_metadata(
    project_id: str = Path(..., description="프로젝트 고유 ID"),
    payload: AuthoritativeMetadataUpdateDto = Body(...),
):
    """
    사용자가 화면 2에서 확인 및 수정한 최종 사업정보를 저장하고 신규 버전 스냅샷을 생성합니다.
    """
    authoritative = metadata_service.save_authoritative(project_id, payload)
    return ApiResponse(
        success=True,
        message=f"Authoritative Metadata (버전 {authoritative.version}) 확정 완료 및 스냅샷 생성 성공",
        data=authoritative,
    )


@router.get("/{project_id}/metadata/authoritative", response_model=ApiResponse[AuthoritativeMetadata])
async def get_authoritative_metadata(
    project_id: str = Path(..., description="프로젝트 고유 ID"),
):
    """
    사용자가 최종 확정한 Authoritative Metadata 최신 버전을 조회합니다.
    """
    authoritative = metadata_service.get_authoritative(project_id)
    if not authoritative:
        # 없으면 AI 추출 기반으로 생성
        metadata_service.extract_from_blocks(project_id=project_id)
        authoritative = metadata_service.get_authoritative(project_id)

    if not authoritative:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"프로젝트 '{project_id}'의 Authoritative Metadata를 찾을 수 없습니다.",
        )

    return ApiResponse(
        success=True,
        message=f"최신 Authoritative Metadata (버전 {authoritative.version}) 조회 성공",
        data=authoritative,
    )
