from pathlib import Path

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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
    dataset_dir: Path = Path(__file__).resolve().parents[3] / "sdoc-hackathon-bundle"
    dev_audit_db: Path = Path(__file__).resolve().parents[1] / ".local/extraction-audit.sqlite3"
    dev_upload_limit: int = Field(default=3 * 1024 * 1024, gt=0)
    dev_request_limit: int = Field(default=4 * 1024 * 1024, gt=0)
    dev_document_timeout: float = Field(default=15, gt=0)
    dev_run_timeout: float = Field(default=60, gt=0)
    allowed_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    supabase_url: str | None = None
    supabase_secret_key: SecretStr | None = None
    supabase_storage_bucket: str | None = None
    gemini_api_key: SecretStr | None = None
    gemini_model: str | None = None
    demo_session_secret: SecretStr | None = None

    @property
    def dev_extraction_enabled(self) -> bool:
        return self.app_env == "development" and self.enable_dev_extraction

    @field_validator("local_data_dir")
    @classmethod
    def resolve_local_directory(cls, value: Path) -> Path:
        return value if value.is_absolute() else Path(__file__).resolve().parents[1] / value
