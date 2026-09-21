"""Shared server-side Gemini request helpers and stable provider failures."""

import json
from time import perf_counter

from google import genai
from google.genai import types

from app.config import Settings
from app.extraction.models import ProviderMetadata


class AIProviderError(Exception):
    def __init__(self, code: str, message: str, *, retryable: bool, status: int = 502):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.status = status


class GeminiProvider:
    """Common structured-output transport; construction never calls Gemini."""

    operation_label = "AI analysis"

    def __init__(self, settings: Settings, client_factory=None):
        key = settings.gemini_api_key.get_secret_value() if settings.gemini_api_key else ""
        self.api_key = key.strip() or None
        self.model = settings.gemini_model.strip() if settings.gemini_model else None
        self.timeout_seconds = settings.gemini_timeout_seconds
        self.client_factory = client_factory or genai.Client

    def _generate(self, contents, schema, prompt_version, *, timeout_seconds=None):
        if not self.api_key or not self.model:
            raise AIProviderError(
                "AI_NOT_CONFIGURED",
                f"Gemini {self.operation_label} is not configured. Set GEMINI_API_KEY and "
                "GEMINI_MODEL on the backend, restart it, and retry.",
                retryable=False,
                status=503,
            )
        timeout = min(timeout_seconds or self.timeout_seconds, self.timeout_seconds)
        started = perf_counter()
        client = None
        try:
            client = self.client_factory(api_key=self.api_key)
            response = client.models.generate_content(
                model=self.model,
                contents=contents,
                config=types.GenerateContentConfig(
                    temperature=0,
                    candidate_count=1,
                    response_mime_type="application/json",
                    response_schema=self.provider_schema(schema),
                    http_options=types.HttpOptions(
                        timeout=max(1, round(timeout * 1000)),
                        retry_options=types.HttpRetryOptions(attempts=1),
                    ),
                ),
            )
            payload = schema.model_validate_json(response.text)
            metadata = ProviderMetadata(
                configured_model=self.model,
                model_version=getattr(response, "model_version", None),
                response_id=getattr(response, "response_id", None),
                prompt_version=prompt_version,
                duration_ms=round((perf_counter() - started) * 1000, 3),
                usage=self.usage(getattr(response, "usage_metadata", None)),
            )
            return payload, metadata
        except AIProviderError:
            raise
        except Exception as exc:
            raise self.provider_error(exc) from exc
        finally:
            close = getattr(client, "close", None) if client is not None else None
            if callable(close):
                try:
                    close()
                except Exception:
                    pass

    @staticmethod
    def provider_schema(model) -> dict:
        def compatible(value):
            if isinstance(value, dict):
                return {
                    key: compatible(item)
                    for key, item in value.items()
                    if key != "additionalProperties"
                }
            if isinstance(value, list):
                return [compatible(item) for item in value]
            return value

        return compatible(model.model_json_schema())

    @staticmethod
    def usage(usage) -> dict[str, int | None] | None:
        if usage is None:
            return None
        if hasattr(usage, "model_dump"):
            values = usage.model_dump(exclude_none=True)
        elif isinstance(usage, dict):
            values = usage
        else:
            return None
        allowed = {
            "prompt_token_count",
            "candidates_token_count",
            "total_token_count",
            "cached_content_token_count",
            "thoughts_token_count",
        }
        return {key: values.get(key) for key in allowed if key in values} or None

    def provider_error(self, exc: Exception) -> AIProviderError:
        code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
        try:
            code = int(code)
        except (TypeError, ValueError):
            pass
        name = type(exc).__name__.lower()
        if code == 429:
            return AIProviderError(
                "AI_RATE_LIMITED",
                "Gemini is rate limited or out of quota. Check quota and retry later.",
                retryable=True,
                status=429,
            )
        if code in {401, 403}:
            return AIProviderError(
                "AI_ACCESS_DENIED",
                "Gemini rejected the configured credentials or model access.",
                retryable=False,
                status=502,
            )
        if "timeout" in name or isinstance(exc, TimeoutError):
            return AIProviderError(
                "AI_TIMEOUT",
                f"Gemini {self.operation_label} timed out. Retry the analysis.",
                retryable=True,
                status=504,
            )
        if isinstance(exc, (ValueError, TypeError, json.JSONDecodeError)):
            return AIProviderError(
                "AI_INVALID_RESPONSE",
                "Gemini returned an invalid structured response. Retry the analysis.",
                retryable=True,
                status=502,
            )
        return AIProviderError(
            "AI_PROVIDER_ERROR",
            f"Gemini {self.operation_label} failed. Check provider availability and retry.",
            retryable=True,
            status=502,
        )
