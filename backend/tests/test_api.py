from pathlib import Path

import yaml
from fastapi.testclient import TestClient

from warmpath.api import create_app


def test_dashboard_and_run_api(tmp_path: Path, cfg):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(yaml.safe_dump(cfg.model_dump(mode="json")), encoding="utf-8")
    app = create_app(tmp_path / "test.duckdb", config_path, tmp_path / "out")
    client = TestClient(app)

    health = client.get("/api/health")
    assert health.status_code == 200 and health.json()["status"] == "ok"

    dashboard = client.get("/api/dashboard")
    assert dashboard.status_code == 200
    assert dashboard.json()["project"]["name"] == "TestProj"
    assert len(dashboard.json()["readiness"]) == 6

    run = client.post("/api/run", json={"resolve_entities": False, "use_embeddings": False})
    assert run.status_code == 200
    assert run.json()["status"] == "completed"
    assert (tmp_path / "out" / run.json()["run_id"] / "recomendaciones.md").exists()


def test_config_update_is_validated(tmp_path: Path, cfg):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(yaml.safe_dump(cfg.model_dump(mode="json")), encoding="utf-8")
    client = TestClient(create_app(tmp_path / "test.duckdb", config_path, tmp_path / "out"))

    payload = client.get("/api/config").json()
    payload["project"]["name"] = "Nuevo nombre"
    saved = client.put("/api/config", json=payload)
    assert saved.status_code == 200
    assert client.get("/api/config").json()["project"]["name"] == "Nuevo nombre"
