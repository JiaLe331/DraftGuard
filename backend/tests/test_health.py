from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def test_health_without_cloud_configuration(monkeypatch):
    for name in (
        "SUPABASE_URL",
        "SUPABASE_SECRET_KEY",
        "SUPABASE_STORAGE_BUCKET",
        "GEMINI_API_KEY",
        "GEMINI_MODEL",
        "DEMO_SESSION_SECRET",
    ):
        monkeypatch.delenv(name, raising=False)
    settings = Settings(_env_file=None)
    assert settings.supabase_secret_key is None
    assert settings.gemini_api_key is None
    with TestClient(create_app(settings)) as client:
        response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "draftguard-api"}


def test_cors_allows_only_configured_origin():
    settings = Settings(_env_file=None, allowed_origins=["https://frontend.example.com"])
    with TestClient(create_app(settings)) as client:
        allowed = client.get("/api/health", headers={"Origin": "https://frontend.example.com"})
        denied = client.get("/api/health", headers={"Origin": "https://other.example.com"})
    assert allowed.headers["access-control-allow-origin"] == "https://frontend.example.com"
    assert "access-control-allow-origin" not in denied.headers
