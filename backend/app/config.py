import os
from typing import List

class Settings:
    PROJECT_NAME: str = "HWP AI Document Reviewer API"
    VERSION: str = "1.1.0"
    API_V1_STR: str = "/api/v1"
    
    # Storage settings
    UPLOAD_DIR: str = os.getenv("UPLOAD_DIR", "/tmp/hwp_uploads")
    MAX_FILE_SIZE_MB: int = int(os.getenv("MAX_FILE_SIZE_MB", "50"))
    ALLOWED_EXTENSIONS: List[str] = [".hwp", ".hwpx"]
    
    # Parser settings
    RHWP_CLI_PATH: str = os.getenv("RHWP_CLI_PATH", "/usr/local/bin/rhwp")
    CLI_TIMEOUT_SECONDS: int = int(os.getenv("CLI_TIMEOUT_SECONDS", "30"))

settings = Settings()
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
