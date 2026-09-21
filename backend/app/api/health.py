from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api", tags=["health"])


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: Literal["draftguard-api"] = "draftguard-api"
    capabilities: dict[str, bool | int] = Field(default_factory=dict)


@router.get("/health", response_model=HealthResponse)
def health(request: Request) -> HealthResponse:
    """Report process liveness only; external services are not checked."""
    settings = request.app.state.settings
    return HealthResponse(
        capabilities={
            "development_extraction": settings.dev_extraction_enabled,
            "development_tasks": settings.full_app_enabled,
            "upload_limit_bytes": settings.dev_upload_limit,
        }
    )
