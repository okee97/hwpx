from typing import List, Optional
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks
from backend.app.schemas.common import ApiResponse, DocumentStatus
from backend.app.schemas.document import DocumentResponse, DocumentUploadResponse
from backend.app.schemas.hwp import HwpParseResult
from backend.app.services.storage import storage_service
from backend.app.services.rhwp_parser import parser_service

router = APIRouter()

@router.post("/upload", response_model=ApiResponse[HwpParseResult], summary="HWP 파일 업로드 및 rhwp 파싱 (Vertical Slice)")
async def upload_and_parse_hwp(
    file: UploadFile = File(..., description="한글 문서 (.hwp 또는 .hwpx 파일)"),
    auto_parse: bool = Form(True, description="업로드 즉시 rhwp CLI 파싱 실행 여부")
):
    """
    첫 번째 세로 슬라이스(Vertical Slice) 핵심 엔드포인트:
    1. HWP/HWPX 파일 수신 및 유효성 검사
    2. 로컬 스토리지에 임시 저장
    3. rhwp CLI 프로세스를 호출하여 Intermediate Representation(IR) JSON 및 메타데이터 추출
    4. Pydantic HwpParseResult 스키마로 검증 후 클라이언트에 반환
    """
    try:
        # 1. 파일 저장
        doc = await storage_service.save_upload_file(file)
        file_path = storage_service.get_file_path(doc.id)
        
        if not file_path:
            raise HTTPException(status_code=500, detail="파일 저장 경로를 찾을 수 없습니다.")

        # 2. 파싱 실행 (auto_parse=True)
        if auto_parse:
            storage_service.update_document_status(doc.id, DocumentStatus.PARSING)
            try:
                parse_result = parser_service.parse_document(doc.id, file_path)
                storage_service.update_document_status(doc.id, DocumentStatus.PARSED)
                return ApiResponse(
                    success=True,
                    message=f"'{doc.file_name}' 파일이 rhwp CLI를 통해 성공적으로 파싱되었습니다.",
                    data=parse_result
                )
            except Exception as pe:
                storage_service.update_document_status(doc.id, DocumentStatus.FAILED, str(pe))
                raise HTTPException(status_code=500, detail=f"rhwp 파싱 실패: {str(pe)}")

        return ApiResponse(
            success=True,
            message="파일이 업로드되었습니다. 파싱을 별도로 요청하세요.",
            data=None
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"업로드 처리 중 오류 발생: {str(e)}")

@router.post("/{doc_id}/parse", response_model=ApiResponse[HwpParseResult], summary="기 업로드 문서 재파싱")
def parse_document_by_id(doc_id: str):
    doc = storage_service.get_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="해당 문서를 찾을 수 없습니다.")
    
    file_path = storage_service.get_file_path(doc_id)
    if not file_path:
        raise HTTPException(status_code=404, detail="파일 실체를 찾을 수 없습니다.")

    storage_service.update_document_status(doc_id, DocumentStatus.PARSING)
    try:
        parse_result = parser_service.parse_document(doc_id, file_path)
        storage_service.update_document_status(doc_id, DocumentStatus.PARSED)
        return ApiResponse(
            success=True,
            message=f"문서 {doc_id} 파싱 성공",
            data=parse_result
        )
    except Exception as e:
        storage_service.update_document_status(doc_id, DocumentStatus.FAILED, str(e))
        raise HTTPException(status_code=500, detail=str(e))

@router.get("", response_model=ApiResponse[List[DocumentResponse]], summary="업로드된 문서 목록 조회")
def list_documents():
    docs = storage_service.list_documents()
    return ApiResponse(
        success=True,
        message=f"총 {len(docs)}건의 문서가 등록되어 있습니다.",
        data=docs
    )

@router.get("/{doc_id}", response_model=ApiResponse[DocumentResponse], summary="문서 단건 상세 조회")
def get_document(doc_id: str):
    doc = storage_service.get_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="해당 문서를 찾을 수 없습니다.")
    return ApiResponse(success=True, data=doc)
