import sqlite3
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException

from app.api.health import router as health_router
from app.config import Settings
from app.dev_extraction.api import router as dev_router
from app.dev_extraction.dataset import DatasetError
from app.dev_extraction.middleware import InboundGuard, error_response
from app.dev_extraction.service import RunService
from app.dev_extraction.store import AuditStore


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings if settings is not None else Settings()

    @asynccontextmanager
    async def lifespan(application):
        if settings.dev_extraction_enabled:
            application.state.audit_store.initialize()
        yield

    application = FastAPI(title="DraftGuard API", version="0.1.0", lifespan=lifespan)
    application.state.settings = settings
    application.add_middleware(InboundGuard, max_bytes=settings.dev_request_limit)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_methods=["GET", "POST"] if settings.dev_extraction_enabled else ["GET"],
        allow_headers=["Content-Type"],
        expose_headers=["X-Request-ID"],
    )
    application.include_router(health_router)
    if settings.dev_extraction_enabled:
        store = AuditStore(settings.dev_audit_db)
        application.state.audit_store = store
        application.state.run_service = RunService(store, settings)
        application.include_router(dev_router)

    @application.exception_handler(DatasetError)
    async def dataset_error(request: Request, exc: DatasetError):
        return error_response(
            exc.code, exc.message, request.state.request_id, exc.status, exc.status >= 500
        )

    @application.exception_handler(sqlite3.Error)
    async def storage_error(request: Request, exc: sqlite3.Error):
        return error_response(
            "AUDIT_SAVE_FAILED",
            "Local history could not be read or saved. Check local storage and retry.",
            request.state.request_id,
            503,
            True,
        )

    @application.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        return error_response(
            "INVALID_REQUEST",
            "Check the request fields and identifiers.",
            request.state.request_id,
            422,
        )

    @application.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException):
        return error_response(
            "NOT_FOUND" if exc.status_code == 404 else "REQUEST_REJECTED",
            "The requested resource is unavailable."
            if exc.status_code == 404
            else "The request was rejected. Check its method and format.",
            request.state.request_id,
            exc.status_code,
        )

    return application


app = create_app()
