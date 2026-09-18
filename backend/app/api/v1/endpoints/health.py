import os
import subprocess
from fastapi import APIRouter
from backend.app.config import settings

router = APIRouter()

@router.get("/health")
def health_check():
    cli_exists = os.path.exists(settings.RHWP_CLI_PATH) and os.access(settings.RHWP_CLI_PATH, os.X_OK)
    cli_version = "not_found"
    if cli_exists:
        try:
            res = subprocess.run([settings.RHWP_CLI_PATH, "--version"], capture_output=True, text=True, timeout=5)
            cli_version = res.stdout.strip()
        except Exception:
            cli_version = "error_running_cli"

    return {
        "status": "healthy",
        "version": settings.VERSION,
        "rhwp_cli": {
            "path": settings.RHWP_CLI_PATH,
            "installed": cli_exists,
            "version": cli_version
        }
    }
