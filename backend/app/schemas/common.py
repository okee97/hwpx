from enum import Enum
from typing import Generic, TypeVar, Optional, Any
from pydantic import BaseModel, Field

T = TypeVar("T")

class DocumentStatus(str, Enum):
    UPLOADED = "UPLOADED"
    PARSING = "PARSING"
    PARSED = "PARSED"
    REVIEWING = "REVIEWING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"

class DocumentFormat(str, Enum):
    HWP = "hwp"
    HWPX = "hwpx"

class SeverityLevel(str, Enum):
    CRITICAL = "CRITICAL"
    WARNING = "WARNING"
    INFO = "INFO"

class TextAlignment(str, Enum):
    LEFT = "LEFT"
    CENTER = "CENTER"
    RIGHT = "RIGHT"
    JUSTIFY = "JUSTIFY"

class ApiResponse(BaseModel, Generic[T]):
    success: bool = Field(True, description="API 요청 성공 여부")
    message: str = Field("요청이 성공적으로 처리되었습니다.", description="결과 안내 메시지")
    data: Optional[T] = Field(None, description="응답 페이로드")
    error: Optional[str] = Field(None, description="오류 상세 메시지")
