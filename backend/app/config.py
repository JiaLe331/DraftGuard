import json
from pathlib import Path
from typing import Annotated

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


def _default_dataset_dir() -> Path:
    """Where the organiser bundle sits when this checkout lives beside it.

    Only the local import tooling reads it. Installed at a shallower path — in
    a container the package is at /srv/app — there is no such directory above
    us, and reaching for a parent that does not exist would raise while the
    settings class is still being defined, before the app can start.
    """
    here = Path(__file__).resolve()
    root = here.parents[3] if len(here.parents) > 3 else here.parents[1]
    return root / "sdoc-hackathon-bundle"


# Environments that serve the whole product rather than health alone. "demo" is
# the deployed judge-facing build: same surface as local development, without
# claiming to be a hardened production deployment.
FULL_APP_ENVS = frozenset({"development", "demo"})


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[1] / ".env",
        env_file_encoding="utf-8",
        env_ignore_empty=True,
        extra="ignore",
    )

    app_env: str = "development"
    local_data_dir: Path = Path(__file__).resolve().parents[1] / ".local"
    enable_dev_extraction: bool = False
    dataset_dir: Path = _default_dataset_dir()
    dev_audit_db: Path = Path(__file__).resolve().parents[1] / ".local/extraction-audit.sqlite3"
    dev_upload_limit: int = Field(default=3 * 1024 * 1024, gt=0)
    dev_request_limit: int = Field(default=4 * 1024 * 1024, gt=0)
    dev_document_timeout: float = Field(default=15, gt=0)
    dev_run_timeout: float = Field(default=60, gt=0)
    allowed_origins: Annotated[list[str], NoDecode] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    supabase_url: str | None = None
    supabase_secret_key: SecretStr | None = None
    supabase_storage_bucket: str | None = None
    gemini_api_key: SecretStr | None = None
    gemini_model: str | None = None
    gemini_timeout_seconds: float = Field(default=30, gt=0, le=55)
    gemini_text_max_chars: int = Field(default=100_000, gt=0, le=1_000_000)
    demo_session_secret: SecretStr | None = None

    @property
    def full_app_enabled(self) -> bool:
        return self.app_env in FULL_APP_ENVS

    @property
    def dev_extraction_enabled(self) -> bool:
        return self.full_app_enabled and self.enable_dev_extraction

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def split_origins(cls, value):
        """Accept a comma-separated list as well as JSON.

        Hosting dashboards take plain strings, so a deployment should not fail
        on `a.example,b.example` when only `["a.example"]` was understood.
        """
        if not isinstance(value, str):
            return value
        text = value.strip()
        if text.startswith("["):
            return json.loads(text)
        return [origin.strip() for origin in text.split(",") if origin.strip()]

    @field_validator("local_data_dir")
    @classmethod
    def resolve_local_directory(cls, value: Path) -> Path:
        return value if value.is_absolute() else Path(__file__).resolve().parents[1] / value
