from fastapi import APIRouter
from backend.app.api.v1.endpoints import documents, health, findings, metadata

api_v1_router = APIRouter()
api_v1_router.include_router(health.router, tags=["Health"])
api_v1_router.include_router(documents.router, prefix="/documents", tags=["Documents"])
api_v1_router.include_router(findings.router, prefix="/projects", tags=["RuleEngine & Findings"])
api_v1_router.include_router(metadata.router, prefix="/projects", tags=["Metadata"])

