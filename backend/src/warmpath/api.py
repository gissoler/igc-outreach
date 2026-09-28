"""HTTP API for the Warm Path Engine dashboard.

The CLI remains the most complete ingestion interface. This module exposes the
day-to-day product surface: project configuration, readiness, ranking, paths,
evidence and outcome tracking.
"""
from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

import uvicorn
import yaml
from fastapi import FastAPI, HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import report
from .candidates import rank
from .db import OUTCOME_STAGES, Store
from .models import Config
from .thesis import Similarity


BACKEND_ROOT = Path(__file__).resolve().parents[2]


class RunRequest(BaseModel):
    resolve_entities: bool = True
    use_embeddings: bool = False


class OutcomeRequest(BaseModel):
    investor_id: str
    stage: Literal[
        "intro_pedida", "intro_aceptada", "reunion", "dd", "term_sheet", "rechazada", "sin_respuesta"
    ]
    connector_id: str = ""
    note: str = Field(default="", max_length=1000)


class ReviewDecision(BaseModel):
    decision: Literal["accepted", "rejected"]


def _decode(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (json.JSONDecodeError, TypeError):
            return value
    return value


def _latest_recommendations(store: Store, run_id: str | None = None) -> list[dict[str, Any]]:
    if run_id is None:
        row = store.q("SELECT max(run_id) FROM recommendations")
        run_id = row[0][0] if row else None
    if not run_id:
        return []
    rows = store.qd(
        """
        SELECT r.run_id, r.rank, r.investor_id AS fund_id, r.score, r.factors,
               r.best_path, r.created_at,
               coalesce(e.name, r.investor_id) AS name,
               fp.thesis, fp.thesis_quote, fp.thesis_url, fp.stages, fp.sectors,
               fp.geos, fp.ticket_min, fp.ticket_max, fp.ticket_kind,
               fp.ticket_quote, fp.fund_size, fp.last_activity,
               e.domain, e.linkedin,
               json_extract_string(e.attrs, '$.photo_url') AS photo_url,
               e.city, e.country,
               (SELECT f.state FROM fd_filing f
                 WHERE f.accession = json_extract_string(e.attrs, '$.formd_accessions[0]') LIMIT 1) AS state,
               json_extract_string(e.attrs, '$.vehicle_names[0]') AS vehicle,
               json_extract_string(e.attrs, '$.formd_accessions[0]') AS source_ref,
               (SELECT f.filing_date FROM fd_filing f
                 WHERE f.accession = json_extract_string(e.attrs, '$.formd_accessions[0]') LIMIT 1) AS source_date,
               (SELECT f.total_sold FROM fd_filing f
                 WHERE f.accession = json_extract_string(e.attrs, '$.formd_accessions[0]') LIMIT 1) AS total_sold,
               (SELECT stage FROM outcomes o WHERE o.investor_id=r.investor_id
                ORDER BY o.ts DESC LIMIT 1) AS outcome_stage
        FROM recommendations r
        LEFT JOIN entities e ON e.entity_id=r.investor_id
        LEFT JOIN fund_profile fp ON fp.entity_id=r.investor_id
        WHERE r.run_id=?
        ORDER BY r.rank
        """,
        [run_id],
    )
    for row in rows:
        row["factors"] = _decode(row.get("factors")) or {}
        row["best_path"] = _decode(row.get("best_path"))
        row["profile"] = {
            key: row.pop(key)
            for key in (
                "thesis", "thesis_quote", "thesis_url", "stages", "sectors", "geos",
                "ticket_min", "ticket_max", "ticket_kind", "ticket_quote", "fund_size", "last_activity",
                "domain", "linkedin", "photo_url", "city", "country", "state", "vehicle",
                "source_ref", "source_date", "total_sold",
            )
        }
    _attach_people(store, rows)
    return rows


def _attach_people(store: Store, rows: list[dict[str, Any]]) -> None:
    """Contactos públicos (partner_of) de cada fondo, para sugerir a quién escribir."""
    ids = [row["fund_id"] for row in rows]
    if not ids:
        return
    marks = ",".join("?" * len(ids))
    people = store.qd(
        f"""
        SELECT e.dst AS fund_id, p.name, coalesce(p.norm_name, lower(p.name)) AS key
        FROM edges e JOIN entities p ON p.entity_id = e.src
        WHERE e.rel = 'partner_of' AND e.dst IN ({marks})
        ORDER BY p.name
        """,
        ids,
    )
    by_fund: dict[str, list[dict[str, str]]] = {}
    for item in people:
        by_fund.setdefault(item["fund_id"], []).append({"name": item["name"], "key": item["key"]})
    for row in rows:
        row["people"] = by_fund.get(row["fund_id"], [])


def _fund_links(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Fondos del top que comparten socios/directores (misma persona en ambos Form D)."""
    links = []
    for i, a in enumerate(rows):
        keys_a = {p["key"]: p["name"] for p in a.get("people", [])}
        for b in rows[i + 1:]:
            shared = [keys_a[p["key"]] for p in b.get("people", []) if p["key"] in keys_a]
            if shared:
                links.append({"source": a["fund_id"], "target": b["fund_id"], "shared": sorted(set(shared))})
    return links


def _readiness(store: Store, cfg: Config) -> list[dict[str, Any]]:
    stats = store.stats()
    checks = [
        ("profile", "Perfil de la empresa", bool(cfg.project.name and cfg.project.one_liner), "config/project.yaml"),
        ("comparables", "Comparables", len(cfg.comparables) >= 3, f"{len(cfg.comparables)} configurados"),
        ("rounds", "Rondas con evidencia", store.q("SELECT count(*) FROM edges WHERE rel='invested_in'")[0][0] > 0,
         "Conecta comparables con fondos"),
        ("funds", "Universo de fondos", stats.get("fund_profile", 0) > 0, f"{stats.get('fund_profile', 0):,} perfiles"),
        ("network", "Red del founder", stats.get("interactions", 0) > 0, f"{stats.get('interactions', 0):,} interacciones"),
        ("team", "Equipo y red declarada", bool(cfg.team or cfg.contacts),
         f"{len(cfg.team)} personas · {len(cfg.contacts)} contactos · {len(cfg.affiliations)} afiliaciones"),
    ]
    return [{"id": key, "label": label, "ready": ready, "detail": detail} for key, label, ready, detail in checks]


def create_app(
    db_path: str | Path | None = None,
    config_path: str | Path | None = None,
    out_dir: str | Path | None = None,
) -> FastAPI:
    db_path = Path(db_path or os.getenv("WARMPATH_DB", BACKEND_ROOT / "data/warmpath.duckdb"))
    config_path = Path(config_path or os.getenv("WARMPATH_CONFIG", BACKEND_ROOT / "config/project.yaml"))
    out_dir = Path(out_dir or os.getenv("WARMPATH_OUT", BACKEND_ROOT / "out"))

    app = FastAPI(title="Warm Path Engine API", version="0.2.0")
    origins = [item.strip() for item in os.getenv("WARMPATH_CORS", "http://localhost:5173").split(",") if item.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def store() -> Store:
        return Store(db_path)

    def config() -> Config:
        if not config_path.exists():
            raise HTTPException(404, "No existe la configuración de la empresa")
        return Config.load(config_path)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "warmpath"}

    @app.get("/api/dashboard")
    def dashboard() -> dict[str, Any]:
        s = store()
        try:
            cfg = config()
            recs = _latest_recommendations(s)
            run_id = recs[0]["run_id"] if recs else None
            outcomes = s.qd("SELECT stage, count(*) AS count FROM outcomes GROUP BY stage ORDER BY count DESC")
            return jsonable_encoder({
                "project": cfg.project.model_dump(),
                "founder": cfg.founder.model_dump(),
                "team": [m.model_dump() for m in cfg.team],
                "filters": cfg.filters.model_dump(),
                "weights": cfg.weights.normalized(),
                "stats": s.stats(),
                "readiness": _readiness(s, cfg),
                "latest_run_id": run_id,
                "recommendations": recs,
                "links": _fund_links(recs),
                "outcomes": outcomes,
            })
        finally:
            s.close()

    @app.get("/api/config")
    def get_config() -> dict[str, Any]:
        return jsonable_encoder(config().model_dump())

    @app.put("/api/config")
    def update_config(payload: dict[str, Any]) -> dict[str, Any]:
        cfg = Config.model_validate(payload)
        config_path.parent.mkdir(parents=True, exist_ok=True)
        config_path.write_text(yaml.safe_dump(cfg.model_dump(mode="json"), allow_unicode=True, sort_keys=False), encoding="utf-8")
        return {"status": "saved", "config": jsonable_encoder(cfg.model_dump())}

    @app.get("/api/runs")
    def runs() -> list[dict[str, Any]]:
        s = store()
        try:
            return jsonable_encoder(s.qd(
                "SELECT run_id, count(*) AS recommendations, max(created_at) AS created_at, max(score) AS top_score "
                "FROM recommendations GROUP BY run_id ORDER BY run_id DESC"
            ))
        finally:
            s.close()

    @app.get("/api/recommendations")
    def recommendations(run_id: str | None = None) -> list[dict[str, Any]]:
        s = store()
        try:
            return jsonable_encoder(_latest_recommendations(s, run_id))
        finally:
            s.close()

    @app.post("/api/run")
    def run_engine(body: RunRequest) -> dict[str, Any]:
        s = store()
        try:
            cfg = config()
            resolution = None
            if body.resolve_entities:
                from .resolve import resolve

                resolution = resolve(s)
            similarity = Similarity(prefer_embeddings=body.use_embeddings)
            recs = rank(s, cfg, sim=similarity)
            run_path = report.write(s, cfg, recs, out_dir, sim_method=similarity.method)
            return jsonable_encoder({
                "status": "completed",
                "run_id": run_path.name,
                "recommendations": recs,
                "resolution": resolution,
                "similarity_method": similarity.method,
            })
        finally:
            s.close()

    @app.post("/api/outcomes", status_code=201)
    def create_outcome(body: OutcomeRequest) -> dict[str, Any]:
        if body.stage not in OUTCOME_STAGES:
            raise HTTPException(422, "Etapa inválida")
        s = store()
        try:
            run = s.q("SELECT max(run_id) FROM recommendations")[0][0] or ""
            s.con.execute(
                "INSERT INTO outcomes VALUES (?,?,?,?,?,?)",
                [body.investor_id, body.connector_id, body.stage, datetime.utcnow(), body.note, run],
            )
            return {"status": "saved", "run_id": run}
        finally:
            s.close()

    @app.get("/api/outcomes/{investor_id:path}")
    def outcome_history(investor_id: str) -> list[dict[str, Any]]:
        """Historial de avances registrados con un fondo (más reciente primero)."""
        s = store()
        try:
            return jsonable_encoder(s.qd(
                "SELECT stage, connector_id, note, ts FROM outcomes WHERE investor_id=? ORDER BY ts DESC",
                [investor_id],
            ))
        finally:
            s.close()

    @app.get("/api/reviews")
    def reviews(limit: int = 50) -> list[dict[str, Any]]:
        s = store()
        try:
            from .resolve import review_list

            return jsonable_encoder(review_list(s, min(max(limit, 1), 200)))
        finally:
            s.close()

    @app.post("/api/reviews/{left_id}/{right_id}")
    def decide_review(left_id: str, right_id: str, body: ReviewDecision) -> dict[str, str]:
        s = store()
        try:
            from .resolve import review_decide

            review_decide(s, left_id, right_id, body.decision == "accepted")
            return {"status": body.decision}
        finally:
            s.close()

    return app


app = create_app()


def main() -> None:
    # Local-only by default because the dashboard can expose relationship metadata.
    uvicorn.run(
        "warmpath.api:app",
        host=os.getenv("WARMPATH_HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "8000")),
        reload=False,
    )


if __name__ == "__main__":
    main()
