"""Grafo (DuckDB -> NetworkX) — paso C.

Dos vistas:
  * path_graph: grafo no dirigido de PERSONAS + FONDOS para buscar caminos cálidos.
      aristas: knows (fuerza calculada), coauthor, co_director, colleague, partner_of, hypothesis
      Instituciones y startups NO son nodos intermedios (evita caminos espurios tipo
      "ambos trabajan en Google"); se convierten en aristas colleague débiles.
  * investment bipartite: fondo—startup (invested_in) para candidatos/co-inversión.
Todas las ids pasan por entity_map (canónicos). `cutoff` excluye datos posteriores (backtest).
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import date, datetime

import networkx as nx

from .db import Store
from .normalize import norm_org
from .strength import compute_ties, noisy_or

PATH_RELS = {"coauthor", "co_director", "partner_of", "knows", "hypothesis"}
COLLEAGUE_S = 0.25
PORTFOLIO_HYPOTHESIS_S = 0.30


def _canon_edges(store: Store, rels: set[str], cutoff: date | None = None) -> list[dict]:
    q = f"""
        SELECT coalesce(ms.canonical_id, e.src) AS src, coalesce(md.canonical_id, e.dst) AS dst, e.rel,
               e.strength, e.evidence, e.is_hypothesis, e.start_date, e.attrs, e.prov_id, p.source, p.url
        FROM edges e
        LEFT JOIN entity_map ms ON ms.entity_id=e.src
        LEFT JOIN entity_map md ON md.entity_id=e.dst
        LEFT JOIN provenance p ON p.prov_id=e.prov_id
        WHERE e.rel IN ({",".join("?" * len(rels))})
        {"AND (e.start_date IS NULL OR e.start_date < ?)" if cutoff else ""}
    """
    return store.qd(q, [*rels, *([cutoff] if cutoff else [])])


def node_info(store: Store) -> dict[str, dict]:
    rows = store.qd("""
        SELECT e.entity_id, coalesce(m.canonical_id, e.entity_id) AS cid, e.kind, e.name, e.org_name, e.title, e.attrs
        FROM entities e LEFT JOIN entity_map m ON m.entity_id=e.entity_id""")
    info: dict[str, dict] = {}
    for r in rows:
        cur = info.setdefault(r["cid"], {"kind": r["kind"], "name": r["name"], "org": r["org_name"], "title": r["title"],
                                         "is_founder": False})
        if r["entity_id"] == r["cid"] and r["name"]:
            cur["name"] = r["name"]
        cur["org"] = cur["org"] or r["org_name"]
        cur["title"] = cur["title"] or r["title"]
        if r["attrs"] and json.loads(r["attrs"]).get("is_founder"):
            cur["is_founder"] = True
    return info


def build_path_graph(store: Store, *, cutoff: date | None = None, now: datetime | None = None,
                     owners: list[str] | None = None) -> nx.Graph:
    info = node_info(store)
    rel_by_pair: dict[tuple[str, str], list[dict]] = defaultdict(list)

    def add(a: str, b: str, rel: str, s: float, ev: str, hyp: bool = False, src: str = "", url: str | None = None):
        if a == b or s is None:
            return
        rel_by_pair[tuple(sorted((a, b)))].append({"rel": rel, "s": float(s), "evidence": ev, "hypothesis": hyp,
                                                   "source": src, "url": url})

    # 1) knows desde interacciones (1er grado de cada owner; pooling incluido si hay consentimiento)
    for t in compute_ties(store, now=now):
        if owners and t["owner"] not in owners and not _consented(store, t["owner"]):
            continue
        add(t["owner"], t["contact"], "knows", t["s"], t["evidence"], src="export")
    # 2) aristas públicas / declaradas
    for e in _canon_edges(store, PATH_RELS, cutoff):
        s = e["strength"] if e["strength"] is not None else 0.3
        add(e["src"], e["dst"], e["rel"], s, e["evidence"] or "", bool(e["is_hypothesis"]), e["source"] or "", e["url"])
    # 3) colegas actuales (misma empresa en LinkedIn/Form D) -> arista débil persona–persona
    by_org: dict[str, list[str]] = defaultdict(list)
    for e in _canon_edges(store, {"works_at"}, cutoff):
        by_org[e["dst"]].append(e["src"])
    for org, people in by_org.items():
        people = sorted(set(people))
        if 2 <= len(people) <= 30:  # empresas grandes no dicen nada
            for i, a in enumerate(people):
                for b in people[i + 1:]:
                    add(a, b, "colleague", COLLEAGUE_S, f"Misma empresa actual: {info.get(org, {}).get('name', org)}")
    # 4) hipótesis de portafolio: persona que trabaja en una startup del portafolio del fondo
    inv = defaultdict(set)
    for e in _canon_edges(store, {"invested_in"}, cutoff):
        inv[e["dst"]].add(e["src"])
    startup_by_name = {norm_org(v["name"]): k for k, v in info.items() if v["kind"] == "startup" and v["name"]}
    for e in _canon_edges(store, {"works_at"}, cutoff):
        sid = e["dst"] if e["dst"] in inv else startup_by_name.get(norm_org(info.get(e["dst"], {}).get("name")))
        for fund in inv.get(sid, ()):
            add(e["src"], fund, "hypothesis", PORTFOLIO_HYPOTHESIS_S,
                f"HIPÓTESIS: trabaja en {info.get(sid, {}).get('name', sid)}, empresa del portafolio de "
                f"{info.get(fund, {}).get('name', fund)} — confirmar que conoce al partner", hyp=True)

    G = nx.Graph()
    for (a, b), rels in rel_by_pair.items():
        s = noisy_or([r["s"] for r in rels])
        G.add_edge(a, b, s=s, rels=rels, hypothesis=all(r["hypothesis"] for r in rels))
    for n in G.nodes:
        G.nodes[n].update(info.get(n, {"kind": "person" if n.startswith("p:") else "fund", "name": n}))
    return G


def _consented(store: Store, owner: str) -> bool:
    return bool(store.q("SELECT 1 FROM consents WHERE owner=? AND revoked_at IS NULL", [owner]))


def investment_bipartite(store: Store, cutoff: date | None = None) -> dict[str, set[str]]:
    """fund -> {startups}. Incluye invested_in (citado o inferido)."""
    out: dict[str, set[str]] = defaultdict(set)
    for e in _canon_edges(store, {"invested_in"}, cutoff):
        out[e["src"]].add(e["dst"])
    return out


# ───────────────────────── Red declarada en la configuración ─────────────────────────
TEAM_REL = "team"
AFFILIATION_S = 0.22
DECLARED_AT_FUND_S = 0.7


def _find_person(G: nx.Graph, store: Store, pid: str, name: str) -> str:
    """Reusa el nodo existente (canónico o mismo nombre normalizado) antes de crear uno nuevo."""
    from .normalize import norm_text

    cid = store.canonical(pid)
    if cid in G:
        return cid
    key = norm_text(name)
    if key:
        for n, d in G.nodes(data=True):
            if d.get("kind") == "person" and norm_text(d.get("name")) == key:
                return n
    return cid


def _link(G: nx.Graph, a: str, b: str, rel: str, s: float, evidence: str, hyp: bool = False) -> None:
    if a == b:
        return
    r = {"rel": rel, "s": float(s), "evidence": evidence, "hypothesis": hyp, "source": "config", "url": None}
    if G.has_edge(a, b):
        d = G.edges[a, b]
        d["rels"].append(r)
        d["s"] = noisy_or([x["s"] for x in d["rels"]])
        d["hypothesis"] = all(x["hypothesis"] for x in d["rels"])
    else:
        G.add_edge(a, b, s=round(s, 4), rels=[r], hypothesis=hyp)


def add_declared(G: nx.Graph, store: Store, cfg, root: str) -> dict[str, int]:
    """Suma al grafo lo que el founder declaró en Configuración:

    * equipo / grupo  -> arista `team` founder—miembro (cercanía por rol)
    * contactos       -> arista `knows` (fuente manual) desde quien lo conoce; si trabaja en un
                         fondo conocido, arista contacto—fondo
    * afiliaciones    -> HIPÓTESIS débil con personas del grafo que declaran esa organización
    Devuelve conteos para el reporte.
    """
    from .models import TIE_STRENGTH
    from .normalize import norm_org, norm_text, person_id

    info = {n: d for n, d in G.nodes(data=True)}
    if root not in G:
        G.add_node(root, kind="person", name=cfg.founder.name, org=cfg.founder.org, is_founder=True)
    who: dict[str, str] = {"": root, norm_text(cfg.founder.name): root}
    stats = {"team": 0, "contacts": 0, "contacts_at_fund": 0, "affiliation_links": 0}

    for m in cfg.team:
        if not m.name.strip():
            continue
        mid = _find_person(G, store, person_id(linkedin=m.linkedin_url, email=m.email, name=m.name, org=m.org), m.name)
        if mid not in G:
            G.add_node(mid, kind="person", name=m.name, org=m.org, title=m.role)
        G.nodes[mid]["team_role"] = m.role
        _link(G, root, mid, TEAM_REL, m.tie(), f"Equipo ({m.role}) declarado en Configuración")
        who[norm_text(m.name)] = mid
        stats["team"] += 1

    funds_by_name = {norm_org(d.get("name")): n for n, d in info.items() if d.get("kind") == "fund" and d.get("name")}
    if any(c.org for c in cfg.contacts):  # fondos que no están en el grafo de caminos aún
        for r in store.q("SELECT coalesce(m.canonical_id, e.entity_id), e.name FROM entities e "
                         "LEFT JOIN entity_map m ON m.entity_id=e.entity_id WHERE e.kind='fund'"):
            funds_by_name.setdefault(norm_org(r[1]), r[0])
    for c in cfg.contacts:
        if not c.name.strip():
            continue
        src = who.get(norm_text(c.known_by), root)
        cid = _find_person(G, store, person_id(linkedin=c.linkedin_url, name=c.name, org=c.org), c.name)
        if cid not in G:
            G.add_node(cid, kind="person", name=c.name, org=c.org)
        knower = G.nodes[src].get("name", "founder")
        _link(G, src, cid, "knows", TIE_STRENGTH[c.strength],
              f"Declarado: {knower} conoce a {c.name} ({c.strength})" + (f" — {c.note}" if c.note else ""))
        stats["contacts"] += 1
        fund = funds_by_name.get(norm_org(c.org)) if c.org else None
        if fund:
            if fund not in G:
                G.add_node(fund, kind="fund", name=c.org)
            _link(G, cid, fund, "partner_of", DECLARED_AT_FUND_S, f"Declarado: {c.name} trabaja en {c.org}")
            stats["contacts_at_fund"] += 1

    for a in cfg.affiliations:
        key = norm_org(a.name)
        if not key:
            continue
        holders = [who.get(norm_text(n), None) for n in (a.members or [""])]
        holders = [h for h in holders if h]
        peers = [n for n, d in G.nodes(data=True)
                 if d.get("kind") == "person" and n not in holders and norm_org(d.get("org")) == key]
        for h in holders:
            for p in peers[:40]:
                _link(G, h, p, "hypothesis", AFFILIATION_S,
                      f"HIPÓTESIS: comparten {a.kind} {a.name} — confirmar que se conocen", hyp=True)
                stats["affiliation_links"] += 1
    return stats
