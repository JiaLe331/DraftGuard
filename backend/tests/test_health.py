from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def test_health_without_cloud_configuration(monkeypatch, tmp_path):
    for name in (
        "SUPABASE_URL",
        "SUPABASE_SECRET_KEY",
        "SUPABASE_STORAGE_BUCKET",
        "GEMINI_API_KEY",
        "GEMINI_MODEL",
        "DEMO_SESSION_SECRET",
    ):
        monkeypatch.delenv(name, raising=False)
    settings = Settings(
        _env_file=None, local_data_dir=tmp_path / "mailbox", dev_audit_db=tmp_path / "audit.sqlite3"
    )
    assert settings.supabase_secret_key is None
    assert settings.gemini_api_key is None
    with TestClient(create_app(settings)) as client:
        response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "draftguard-api",
        "capabilities": {
            "development_extraction": False,
            "upload_limit_bytes": 3 * 1024 * 1024,
        },
    }


def test_cors_allows_only_configured_origin(tmp_path):
    settings = Settings(
        _env_file=None,
        local_data_dir=tmp_path / "mailbox",
        dev_audit_db=tmp_path / "audit.sqlite3",
        allowed_origins=["https://frontend.example.com"],
    )
    with TestClient(create_app(settings)) as client:
        allowed = client.get("/api/health", headers={"Origin": "https://frontend.example.com"})
        denied = client.get("/api/health", headers={"Origin": "https://other.example.com"})
    assert allowed.headers["access-control-allow-origin"] == "https://frontend.example.com"
    assert "access-control-allow-origin" not in denied.headers
