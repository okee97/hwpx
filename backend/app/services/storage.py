import os
import uuid
from typing import Dict, Optional, List
from datetime import datetime
from fastapi import UploadFile, HTTPException

from backend.app.config import settings
from backend.app.schemas.common import DocumentStatus, DocumentFormat
from backend.app.schemas.document import DocumentResponse

class StorageService:
    def __init__(self, upload_dir: str = settings.UPLOAD_DIR):
        self.upload_dir = upload_dir
        os.makedirs(self.upload_dir, exist_ok=True)
        # In-memory registry for vertical slice document state
        self._registry: Dict[str, DocumentResponse] = {}
        self._file_paths: Dict[str, str] = {}

    def validate_file(self, file: UploadFile):
        file_name = file.filename or "unknown"
        ext = os.path.splitext(file_name)[1].lower()
        if ext not in settings.ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail=f"지원하지 않는 파일 형식입니다. (.hwp, .hwpx 만 지원, 업로드된 확장자: {ext})"
            )

    async def save_upload_file(self, file: UploadFile) -> DocumentResponse:
        self.validate_file(file)
        
        doc_id = str(uuid.uuid4())
        safe_filename = f"{doc_id}_{file.filename}"
        dest_path = os.path.join(self.upload_dir, safe_filename)
        
        content = await file.read()
        file_size = len(content)
        
        max_bytes = settings.MAX_FILE_SIZE_MB * 1024 * 1024
        if file_size > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"파일 크기 초과 (최대 {settings.MAX_FILE_SIZE_MB}MB까지 업로드 가능합니다)"
            )

        with open(dest_path, "wb") as f:
            f.write(content)

        ext = os.path.splitext(file.filename or "")[1].lower().replace(".", "")
        doc_format = DocumentFormat.HWPX if ext == "hwpx" else DocumentFormat.HWP

        doc_response = DocumentResponse(
            id=doc_id,
            title=os.path.splitext(file.filename or "무제")[0],
            file_name=file.filename or "unknown.hwp",
            file_size=file_size,
            file_format=doc_format,
            status=DocumentStatus.UPLOADED,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )

        self._registry[doc_id] = doc_response
        self._file_paths[doc_id] = dest_path
        return doc_response

    def get_document(self, doc_id: str) -> Optional[DocumentResponse]:
        return self._registry.get(doc_id)

    def get_file_path(self, doc_id: str) -> Optional[str]:
        return self._file_paths.get(doc_id)

    def update_document_status(self, doc_id: str, status: DocumentStatus, error_message: Optional[str] = None):
        if doc_id in self._registry:
            doc = self._registry[doc_id]
            doc.status = status
            doc.error_message = error_message
            doc.updated_at = datetime.utcnow()

    def list_documents(self) -> List[DocumentResponse]:
        return list(self._registry.values())

storage_service = StorageService()
