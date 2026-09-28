"""Resolución de entidades (paso B).

1) Reglas deterministas: LinkedIn, email, CIK, dominio, nombre+organización normalizados.
2) Probabilístico entre personas: Splink 4 (DuckDB) si está instalado; si no, un scorer
   Fellegi-Sunter simplificado (Jaro-Winkler de nombre + organización + dominio + ciudad).
3) Cola de revisión humana para probabilidades medias (REVIEW_LOW ≤ p < AUTO_MERGE).
El resultado es entity_map(entity_id -> canonical_id); el grafo usa siempre el canónico.
"""
from __future__ import annotations

import math
from collections import defaultdict
from itertools import combinations

from .db import Store
from .normalize import email_domain, jaro_winkler, norm_org

AUTO_MERGE = 0.92
SPLINK_MIN = 5000
REVIEW_LOW = 0.60
_PRIORITY = {"p:li": 0, "p:em": 1, "f:cik": 0, "p:nm": 2, "f:nm": 1}


class UF:
    def __init__(self):
        self.p: dict[str, str] = {}
        self.how: dict[str, tuple[str, float]] = {}

    def find(self, x: str) -> str:
        self.p.setdefault(x, x)
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a: str, b: str, method: str, prob: float = 1.0) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        # el canónico es el id "más fuerte" (LinkedIn > email > nombre)
        if _rank(rb) < _rank(ra):
            ra, rb = rb, ra
        self.p[rb] = ra
        self.how[rb] = (method, prob)


def _rank(eid: str) -> tuple[int, str]:
    return (_PRIORITY.get(eid[:4].rstrip(":"), 5), eid)


def _person_score(a: dict, b: dict) -> tuple[float, str]:
    """Log-odds tipo Fellegi-Sunter con pesos fijos razonables (m/u a ojo, documentados)."""
    name = jaro_winkler(a["norm_name"] or "", b["norm_name"] or "")
    w = -4.0  # prior: la mayoría de pares no son la misma persona
    w += 6.0 if name >= 0.97 else 3.0 if name >= 0.92 else -3.0
    oa, ob = norm_org(a["org_name"]), norm_org(b["org_name"])
    if oa and ob:
        jo = jaro_winkler(oa, ob)
        w += 3.0 if jo >= 0.93 else 1.0 if jo >= 0.85 else -2.0
    da, db = email_domain(a["email"]), email_domain(b["email"])
    if da and db:
        w += 2.5 if da == db else -1.0
    if a["city"] and b["city"]:
        w += 0.8 if a["city"].lower() == b["city"].lower() else -0.5
    p = 1 / (1 + math.exp(-w))
    return p, f"name_jw={name:.2f} org={oa or '-'}|{ob or '-'}"


def _splink_scores(people: list[dict]) -> list[tuple[str, str, float]] | None:
    try:
        import pandas as pd
        import splink.comparison_library as cl
        from splink import DuckDBAPI, Linker, SettingsCreator, block_on
    except ImportError:
        return None
    df = pd.DataFrame([{
        "unique_id": p["entity_id"],
        "first": (p["norm_name"] or "").split(" ")[0] if p["norm_name"] else None,
        "last": (p["norm_name"] or "").split(" ")[-1] if p["norm_name"] else None,
        "full": p["norm_name"], "org": norm_org(p["org_name"]) or None,
        "domain": email_domain(p["email"]) or None, "city": (p["city"] or "").lower() or None,
    } for p in people])
    settings = SettingsCreator(
        link_type="dedupe_only",
        comparisons=[cl.JaroWinklerAtThresholds("full", [0.97, 0.92]),
                     cl.JaroWinklerAtThresholds("org", [0.93, 0.85]),
                     cl.ExactMatch("domain"), cl.ExactMatch("city")],
        blocking_rules_to_generate_predictions=[block_on("last"), block_on("first", "org")],
    )
    import logging

    logging.getLogger("splink").setLevel(logging.ERROR)
    try:
        linker = Linker(df, settings, db_api=DuckDBAPI())
        linker.training.estimate_probability_two_random_records_match([block_on("full", "org")], recall=0.8)
        linker.training.estimate_u_using_random_sampling(max_pairs=2e5)
        linker.training.estimate_parameters_using_expectation_maximisation(block_on("last"))
        pred = linker.inference.predict(threshold_match_probability=REVIEW_LOW).as_pandas_dataframe()
    except Exception:  # pocos datos -> EM no converge; se usa el scorer propio
        return None
    return [(r.unique_id_l, r.unique_id_r, float(r.match_probability)) for r in pred.itertuples()]


def resolve(store: Store, engine: str = "auto") -> dict[str, int]:
    uf = UF()
    ents = store.qd("SELECT * FROM entities")
    for e in ents:
        uf.find(e["entity_id"])

    # 1) reglas deterministas
    def group_by(key, kinds, method):
        g = defaultdict(list)
        for e in ents:
            k = key(e)
            if e["kind"] in kinds and k:
                g[k].append(e["entity_id"])
        for ids in g.values():
            for other in ids[1:]:
                uf.union(ids[0], other, method)

    group_by(lambda e: (e["email"] or "").lower(), {"person"}, "rule:email")
    group_by(lambda e: e["linkedin"], {"person"}, "rule:linkedin")
    group_by(lambda e: (e["norm_name"], norm_org(e["org_name"])) if e["org_name"] else None, {"person"}, "rule:name+org")
    group_by(lambda e: e["domain"], {"fund"}, "rule:domain")
    group_by(lambda e: e["norm_name"], {"fund"}, "rule:fund_name")
    for e in ents:  # funds que comparten algún CIK
        for c in (e["cik"] or "").split(","):
            if c and e["kind"] == "fund":
                uf.union(f"cik:{c}", e["entity_id"], "rule:cik")
    # startups/institutions con mismo nombre normalizado
    group_by(lambda e: e["norm_name"], {"startup"}, "rule:org_name")

    # 2) probabilístico (personas que no quedaron unidas)
    people = [e for e in ents if e["kind"] == "person"]
    scores: list[tuple[str, str, float, str]] = []
    # Splink necesita volumen para estimar m/u con EM; con pocos miles de personas el scorer
    # propio (pesos fijos documentados) es más estable. auto => Splink desde SPLINK_MIN personas.
    use_splink = engine == "splink" or (engine == "auto" and len(people) >= SPLINK_MIN)
    sp = _splink_scores(people) if use_splink else None
    if sp is not None:
        scores = [(a, b, p, "splink") for a, b, p in sp]
    else:
        blocks = defaultdict(list)
        for p in people:
            if p["norm_name"]:
                toks = p["norm_name"].split(" ")
                blocks["L:" + toks[-1]].append(p)                              # mismo apellido
                if p["org_name"]:
                    org0 = (norm_org(p["org_name"]).split() or [""])[0]
                    blocks["FO:" + toks[0] + "|" + org0].append(p)  # mismo nombre + 1ª palabra de la org
        done = set()
        for blk in blocks.values():
            if len(blk) > 200:
                continue
            for a, b in combinations(blk, 2):
                key = tuple(sorted((a["entity_id"], b["entity_id"])))
                if key in done or uf.find(a["entity_id"]) == uf.find(b["entity_id"]):
                    continue
                done.add(key)
                p, why = _person_score(a, b)
                if p >= REVIEW_LOW:
                    scores.append((a["entity_id"], b["entity_id"], p, why))

    rejected = {(r[0], r[1]) for r in store.q("SELECT left_id, right_id FROM review_queue WHERE status='rejected'")}
    accepted = store.q("SELECT left_id, right_id, prob FROM review_queue WHERE status='accepted'")
    n_auto = n_review = 0
    for a, b, p, why in scores:
        if (a, b) in rejected or (b, a) in rejected:
            continue
        if p >= AUTO_MERGE:
            uf.union(a, b, "prob", p)
            n_auto += 1
        else:
            store.con.execute("INSERT OR IGNORE INTO review_queue(left_id,right_id,prob,reason) VALUES (?,?,?,?)",
                              [a, b, p, why])
            n_review += 1
    for a, b, p in accepted:
        uf.union(a, b, "human", p)

    # 3) persistir mapa
    store.con.execute("DELETE FROM entity_map")
    rows = []
    for e in ents:
        eid = e["entity_id"]
        root = uf.find(eid)
        if root.startswith("cik:"):  # nodo virtual de CIK: elegir un fondo real como canónico
            root = min((x for x in uf.p if uf.find(x) == root and not x.startswith("cik:")), key=_rank)
        method, prob = uf.how.get(eid, ("self", 1.0))
        rows.append((eid, root, method, prob))
    store.con.executemany("INSERT INTO entity_map VALUES (?,?,?,?)", rows)
    merged = sum(1 for eid, root, _, _ in rows if eid != root)
    return {"entities": len(ents), "merged": merged, "auto_prob": n_auto, "to_review": n_review}


def review_list(store: Store, limit: int = 50) -> list[dict]:
    return store.qd("""
        SELECT q.left_id, l.name AS left_name, l.org_name AS left_org, q.right_id, r.name AS right_name,
               r.org_name AS right_org, round(q.prob, 3) AS prob, q.reason
        FROM review_queue q JOIN entities l ON l.entity_id=q.left_id JOIN entities r ON r.entity_id=q.right_id
        WHERE q.status='pending' ORDER BY q.prob DESC LIMIT ?""", [limit])


def review_decide(store: Store, left: str, right: str, accept: bool) -> None:
    store.con.execute("UPDATE review_queue SET status=? WHERE left_id=? AND right_id=?",
                      ["accepted" if accept else "rejected", left, right])
