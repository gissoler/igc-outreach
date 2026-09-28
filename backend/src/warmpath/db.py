"""Esquema DuckDB con procedencia obligatoria (paso 1 del plan).

Regla: toda fila de `entities`, `edges`, `interactions` y `fund_profile` apunta a
una fila de `provenance` (fuente, URL, fecha, fragmento, confianza). Así cada
dato del reporte se puede rastrear hasta su origen.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import duckdb

SCHEMA = """
CREATE SEQUENCE IF NOT EXISTS prov_seq START 1;
CREATE TABLE IF NOT EXISTS provenance(
    prov_id      BIGINT PRIMARY KEY DEFAULT nextval('prov_seq'),
    source       VARCHAR NOT NULL,   -- sec_formd | edgar | form_adv | linkedin | outlook | rounds | fund_web | openalex | reporter | manual
    url          VARCHAR,            -- URL pública o ruta local del export
    retrieved_at TIMESTAMP NOT NULL,
    snippet      VARCHAR,            -- fragmento literal / fila de origen
    confidence   DOUBLE NOT NULL DEFAULT 1.0
);

CREATE TABLE IF NOT EXISTS entities(
    entity_id    VARCHAR PRIMARY KEY,  -- p:li:..., p:em:..., p:nm:..., f:cik:..., f:nm:..., s:nm:..., i:nm:...
    kind         VARCHAR NOT NULL,     -- person | fund | startup | institution | funder
    name         VARCHAR NOT NULL,
    norm_name    VARCHAR,
    email        VARCHAR,
    linkedin     VARCHAR,
    domain       VARCHAR,
    cik          VARCHAR,
    org_name     VARCHAR,              -- empresa actual (personas)
    title        VARCHAR,
    city         VARCHAR,
    country      VARCHAR,
    attrs        JSON,
    prov_id      BIGINT
);

-- Mapa de resolución de entidades: entity_id -> canónico (paso B)
CREATE TABLE IF NOT EXISTS entity_map(
    entity_id    VARCHAR PRIMARY KEY,
    canonical_id VARCHAR NOT NULL,
    method       VARCHAR,              -- self | rule:email | rule:linkedin | rule:cik | rule:domain | prob | human
    prob         DOUBLE
);

CREATE TABLE IF NOT EXISTS review_queue(
    left_id   VARCHAR, right_id VARCHAR, prob DOUBLE, reason VARCHAR,
    status    VARCHAR DEFAULT 'pending',   -- pending | accepted | rejected
    PRIMARY KEY(left_id, right_id)
);

-- Aristas del grafo. rel: invested_in | partner_of | director_of | co_director | coauthor
--                         | works_at | knows | granted | pi_of | hypothesis
CREATE TABLE IF NOT EXISTS edges(
    src           VARCHAR NOT NULL,
    dst           VARCHAR NOT NULL,
    rel           VARCHAR NOT NULL,
    start_date    DATE,
    end_date      DATE,
    strength      DOUBLE,           -- s ∈ (0,1] si ya se conoce (públicas); knows se calcula en strength.py
    evidence      VARCHAR,          -- texto legible: "co-directores en Form D 0001234-26-000001"
    is_hypothesis BOOLEAN DEFAULT FALSE,
    owner         VARCHAR,          -- founder dueño del export (pooling con consentimiento)
    attrs         JSON,
    prov_id       BIGINT
);

-- Eventos crudos de interacción (solo metadatos; nunca cuerpos de mensajes)
CREATE TABLE IF NOT EXISTS interactions(
    owner          VARCHAR NOT NULL,  -- entity_id del founder dueño del export
    contact_id     VARCHAR NOT NULL,
    channel        VARCHAR NOT NULL,  -- li_connection | li_message | email | meeting
    direction      VARCHAR,           -- out | in | none
    ts             TIMESTAMP,
    n_participants INTEGER,
    prov_id        BIGINT
);

CREATE TABLE IF NOT EXISTS fund_profile(
    entity_id      VARCHAR PRIMARY KEY,
    thesis         VARCHAR,
    thesis_quote   VARCHAR,           -- cita literal verificada contra el texto de la web
    thesis_url     VARCHAR,
    stages         VARCHAR[],
    sectors        VARCHAR[],
    geos           VARCHAR[],
    ticket_min     DOUBLE,
    ticket_max     DOUBLE,
    ticket_kind    VARCHAR,           -- declared | estimated
    ticket_quote   VARCHAR,
    fund_size      DOUBLE,
    fund_size_src  VARCHAR,
    last_activity  DATE,              -- último Form D / ronda observada
    prov_id        BIGINT
);

CREATE TABLE IF NOT EXISTS consents(
    owner       VARCHAR PRIMARY KEY,  -- founder que aporta su red al pooling
    granted_at  TIMESTAMP,
    scope       VARCHAR,              -- p.ej. 'linkedin+outlook headers, pooling piloto'
    revoked_at  TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recommendations(
    run_id      VARCHAR, rank INTEGER, investor_id VARCHAR, score DOUBLE,
    factors     JSON, best_path JSON, created_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS outcomes(
    investor_id VARCHAR, connector_id VARCHAR, stage VARCHAR, ts TIMESTAMP, note VARCHAR, run_id VARCHAR
);
"""

OUTCOME_STAGES = ["intro_pedida", "intro_aceptada", "reunion", "dd", "term_sheet", "rechazada", "sin_respuesta"]


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Store:
    def __init__(self, path: str | Path = "data/warmpath.duckdb"):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.con = duckdb.connect(self.path)
        self.con.execute(SCHEMA)

    # ------------------------------------------------------------------ helpers
    def q(self, sql: str, params: Iterable[Any] | None = None) -> list[tuple]:
        return self.con.execute(sql, params or []).fetchall()

    def qd(self, sql: str, params: Iterable[Any] | None = None) -> list[dict]:
        cur = self.con.execute(sql, params or [])
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]

    def add_prov(self, source: str, url: str | None = None, snippet: str | None = None,
                 confidence: float = 1.0, retrieved_at: datetime | None = None) -> int:
        row = self.con.execute(
            "INSERT INTO provenance(source,url,retrieved_at,snippet,confidence) VALUES (?,?,?,?,?) RETURNING prov_id",
            [source, url, retrieved_at or _now(), (snippet or "")[:2000], confidence],
        ).fetchone()
        return int(row[0])

    def upsert_entity(self, entity_id: str, kind: str, name: str, *, prov_id: int | None = None,
                      **fields: Any) -> str:
        """Inserta o completa (no pisa campos ya llenos con vacíos)."""
        from .normalize import norm_org, norm_text

        cols = ["email", "linkedin", "domain", "cik", "org_name", "title", "city", "country"]
        vals = {c: (fields.get(c) or None) for c in cols}
        attrs = fields.get("attrs")
        norm = norm_text(name) if kind == "person" else norm_org(name)
        exists = self.q("SELECT 1 FROM entities WHERE entity_id=?", [entity_id])
        if not exists:
            self.con.execute(
                f"INSERT INTO entities(entity_id,kind,name,norm_name,{','.join(cols)},attrs,prov_id) "
                f"VALUES (?,?,?,?,{','.join('?' * len(cols))},?,?)",
                [entity_id, kind, name, norm, *vals.values(), json.dumps(attrs or {}), prov_id],
            )
        else:
            sets = ", ".join(f"{c}=COALESCE({c}, ?)" for c in cols)
            self.con.execute(f"UPDATE entities SET {sets} WHERE entity_id=?", [*vals.values(), entity_id])
            if attrs:
                old = self.q("SELECT attrs FROM entities WHERE entity_id=?", [entity_id])[0][0]
                merged = {**json.loads(old or "{}"), **attrs}
                self.con.execute("UPDATE entities SET attrs=? WHERE entity_id=?", [json.dumps(merged), entity_id])
        return entity_id

    def add_edge(self, src: str, dst: str, rel: str, *, strength: float | None = None,
                 evidence: str = "", start_date: date | None = None, end_date: date | None = None,
                 is_hypothesis: bool = False, owner: str | None = None, attrs: dict | None = None,
                 prov_id: int | None = None) -> None:
        self.con.execute(
            "INSERT INTO edges VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            [src, dst, rel, start_date, end_date, strength, evidence, is_hypothesis, owner,
             json.dumps(attrs or {}), prov_id],
        )

    def add_interaction(self, owner: str, contact_id: str, channel: str, *, direction: str = "none",
                        ts: datetime | None = None, n_participants: int = 2, prov_id: int | None = None) -> None:
        self.con.execute(
            "INSERT INTO interactions VALUES (?,?,?,?,?,?,?)",
            [owner, contact_id, channel, direction, ts, n_participants, prov_id],
        )

    def canonical(self, entity_id: str) -> str:
        r = self.q("SELECT canonical_id FROM entity_map WHERE entity_id=?", [entity_id])
        return r[0][0] if r else entity_id

    def stats(self) -> dict[str, int]:
        out = {}
        for t in ["provenance", "entities", "edges", "interactions", "fund_profile", "review_queue", "outcomes"]:
            out[t] = self.q(f"SELECT count(*) FROM {t}")[0][0]
        for t in ["formd_issuers", "formd_offering", "formd_relatedpersons"]:
            try:
                out[t] = self.q(f"SELECT count(*) FROM {t}")[0][0]
            except duckdb.CatalogException:
                pass
        return out

    def close(self) -> None:
        self.con.close()
