"""Vínculos académicos (OpenAlex) y grants (NIH RePORTER). Fuerte en health/biotech.

OpenAlex: https://docs.openalex.org  (gratis; se recomienda mailto= en la query)
RePORTER: https://api.reporter.nih.gov  (POST /v2/projects/search)
"""
from __future__ import annotations

import os
from collections import defaultdict
from datetime import date

from ..db import Store
from ..http import PoliteClient
from ..normalize import norm_text, org_id, person_id

OA = "https://api.openalex.org"
REPORTER = "https://api.reporter.nih.gov/v2/projects/search"


def _mailto() -> dict:
    m = os.environ.get("OPENALEX_MAILTO")
    return {"mailto": m} if m else {}


def openalex_author(c: PoliteClient, name: str, institution_hint: str = "") -> dict | None:
    r = c.get(f"{OA}/authors", params={"search": name, "per-page": 10, **_mailto()})
    if r.status_code != 200:
        return None
    res = r.json().get("results", [])
    res = [a for a in res if norm_text(a.get("display_name")) == norm_text(name)] or res[:1]
    if institution_hint and len(res) > 1:
        hint = norm_text(institution_hint)
        res.sort(key=lambda a: -any(hint in norm_text(i.get("display_name")) for i in
                                   (a.get("last_known_institutions") or [])))
    return res[0] if res else None


def coauthor_edges(store: Store, person_ids: list[str], min_year: int = 2010) -> int:
    """Para cada persona de interés busca su autor OpenAlex, baja sus trabajos y crea aristas
    coauthor SOLO entre personas que ya están en el grafo (no se ingiere el mundo)."""
    c = PoliteClient(rps=5.0, respect_robots=False)
    people = store.qd("SELECT entity_id, name, org_name FROM entities WHERE entity_id IN ("
                      + ",".join("?" * len(person_ids)) + ")", person_ids)
    in_graph = {r[0]: r[1] for r in store.q("SELECT norm_name, entity_id FROM entities WHERE kind='person'")}
    pairs: dict[tuple[str, str], list[tuple[int, str]]] = defaultdict(list)
    for p in people:
        a = openalex_author(c, p["name"], p["org_name"] or "")
        if not a:
            continue
        aid = a["id"].rsplit("/", 1)[-1]
        r = c.get(f"{OA}/works", params={"filter": f"author.id:{aid},from_publication_date:{min_year}-01-01",
                                         "per-page": 200, "select": "id,title,publication_year,authorships",
                                         **_mailto()})
        if r.status_code != 200:
            continue
        for w in r.json().get("results", []):
            for au in w.get("authorships", []):
                other = in_graph.get(norm_text(au.get("author", {}).get("display_name")))
                if other and other != p["entity_id"]:
                    key = tuple(sorted((p["entity_id"], other)))
                    pairs[key].append((w.get("publication_year") or 0, w.get("title") or w["id"]))
    n = 0
    for (x, y), works in pairs.items():
        works = sorted(set(works), reverse=True)
        pid = store.add_prov("openalex", f"{OA}/works?filter=author.id", f"{len(works)} co-autorías: {works[0][1]}", 0.8)
        s = min(0.9, 0.3 + 0.1 * len(works)) * (0.9 if date.today().year - works[0][0] > 5 else 1.0)
        store.add_edge(x, y, "coauthor", strength=round(s, 3), prov_id=pid, start_date=date(works[-1][0] or 2000, 1, 1),
                       end_date=date(works[0][0] or 2000, 12, 31),
                       evidence=f"Co-autores en {len(works)} trabajo(s), último {works[0][0]}: «{works[0][1][:80]}»")
        n += 1
    return n


def reporter_grants(store: Store, org_names: list[str], fiscal_years: list[int] | None = None) -> int:
    """Grants NIH de organizaciones (p.ej. comparables) -> funder NIH granted startup + PIs."""
    c = PoliteClient(rps=1.0, respect_robots=False)
    crit = {"org_names": org_names}
    if fiscal_years:
        crit["fiscal_years"] = fiscal_years
    r = c.post(REPORTER, json={"criteria": crit, "limit": 500, "offset": 0})
    r.raise_for_status()
    nih = org_id("NIH", kind="funder")
    store.upsert_entity(nih, "funder", "NIH")
    n = 0
    for p in r.json().get("results", []):
        org = (p.get("organization") or {}).get("org_name") or ""
        sid = org_id(org, kind="startup")
        url = f"https://reporter.nih.gov/project-details/{p.get('appl_id')}"
        pid = store.add_prov("reporter", url, f"{p.get('project_num')} {p.get('project_title')} "
                                              f"FY{p.get('fiscal_year')} ${p.get('award_amount')}", 1.0)
        store.upsert_entity(sid, "startup", org, prov_id=pid)
        store.add_edge(nih, sid, "granted", prov_id=pid, start_date=date(p.get("fiscal_year") or 2000, 1, 1),
                       evidence=f"NIH {p.get('project_num')} (${p.get('award_amount')})",
                       attrs={"amount_usd": p.get("award_amount"), "activity": p.get("activity_code")})
        for pi in p.get("principal_investigators") or []:
            nm = pi.get("full_name") or ""
            if nm:
                pers = person_id(name=nm, org=org)
                store.upsert_entity(pers, "person", nm.title(), prov_id=pid, org_name=org)
                store.add_edge(pers, sid, "pi_of", strength=0.7, prov_id=pid, evidence=f"PI de {p.get('project_num')}")
        n += 1
    return n
