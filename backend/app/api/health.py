from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/api", tags=["health"])


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: Literal["draftguard-api"] = "draftguard-api"


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Report process liveness only; external services are not checked."""
    return HealthResponse()
