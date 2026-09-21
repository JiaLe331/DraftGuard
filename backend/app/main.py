import sqlite3
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.exception_handlers import http_exception_handler, request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException

from app.ai.amendment import GeminiAmendmentProvider
from app.ai.risk import GeminiRiskProvider
from app.api.health import router as health_router
from app.api.samples import build_router
from app.api.tasks import build_task_router
from app.config import Settings
from app.dev_extraction.api import router as dev_router
from app.dev_extraction.dataset import DatasetError
from app.dev_extraction.middleware import InboundGuard, error_response
from app.dev_extraction.service import RunService
from app.dev_extraction.store import AuditStore
from app.store import Store


def create_app(
    settings: Settings | None = None,
    vision_provider=None,
    semantic_provider=None,
    amendment_provider=None,
    risk_provider=None,
) -> FastAPI:
    settings = settings if settings is not None else Settings()

    @asynccontextmanager
    async def lifespan(application):
        if settings.dev_extraction_enabled:
            application.state.audit_store.initialize()
        if settings.app_env == "development":
            application.state.mailbox_store.recover_audit_runs()
        try:
            yield
        finally:
            if settings.app_env == "development":
                await run_in_threadpool(application.state.run_service.shutdown)

    application = FastAPI(title="DraftGuard API", version="0.1.0", lifespan=lifespan)
    application.state.settings = settings
    application.add_middleware(InboundGuard, max_bytes=settings.dev_request_limit)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_methods=["GET", "POST", "PUT"] if settings.app_env == "development" else ["GET"],
        allow_headers=["Content-Type"],
        expose_headers=["X-Request-ID"],
    )
    application.include_router(health_router)
    if settings.app_env == "development":
        store = AuditStore(settings.dev_audit_db)
        application.state.audit_store = store
        application.state.run_service = RunService(
            store, settings, vision_provider, semantic_provider
        )
        application.state.mailbox_store = Store(
            settings.local_data_dir,
            application.state.run_service,
            amendment_provider or GeminiAmendmentProvider(settings),
        )
        application.include_router(build_router(settings, application.state.mailbox_store))
        application.include_router(
            build_task_router(
                settings,
                application.state.mailbox_store,
                risk_provider or GeminiRiskProvider(settings),
            )
        )
        if settings.dev_extraction_enabled:
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
        if request.url.path.startswith(
            (
                "/api/v1/samples",
                "/api/v1/records",
                "/api/v1/dev/samples",
                "/api/v1/dev/tasks",
            )
        ):
            return await request_validation_exception_handler(request, exc)
        return error_response(
            "INVALID_REQUEST",
            "Check the request fields and identifiers.",
            request.state.request_id,
            422,
        )

    @application.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException):
        if request.url.path.startswith(
            (
                "/api/v1/samples",
                "/api/v1/records",
                "/api/v1/dev/samples",
                "/api/v1/dev/tasks",
            )
        ):
            return await http_exception_handler(request, exc)
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
