"""Candidatos de inversores + ranking explicable (paso D).

semilla        = fondos que invirtieron en los comparables (ronda citada o board seat inferido)
co-inversión   = difusión ProbS en el bipartito fondo–startup (Zhou et al. 2007; aplicado a VC en Xu 2020)
tesis          = similitud tesis del fondo ↔ perfil (MiniLM o TF-IDF)
camino         = fuerza del mejor warm path desde el founder
actividad      = actividad reciente observada (Form D del fondo / rondas)
filtros duros  = etapa, ticket, geografía (solo si el dato del fondo es conocido)
score = m_etapa · Σ w_k · factor_k  (factores ∈ [0,1]; m_etapa=0.6 si solo se le ha visto en etapas
        posteriores a las permitidas y no publica su etapa; se muestra todo en el reporte)
"""
from __future__ import annotations

import json
import math
from collections import defaultdict
from datetime import date, datetime

import networkx as nx

from .db import Store
from .graph import add_declared, build_path_graph, investment_bipartite, node_info
from .models import FUNDING_LABELS, STAGE_ORDER, VC_COMPATIBLE, Config
from .normalize import norm_org, org_id, person_id
from .paths import top_paths, widest_path
from .thesis import Similarity

EST_TICKET_LO, EST_TICKET_HI = 0.005, 0.02  # % del tamaño del fondo -> ticket inicial estimado [E]


def probs(bip: dict[str, set[str]], seed: dict[str, float]) -> dict[str, float]:
    """ProbS (mass diffusion) fondo→startup→fondo partiendo de la masa de los fondos semilla."""
    inv_of = defaultdict(set)
    for f, ss in bip.items():
        for s in ss:
            inv_of[s].add(f)
    at_startup = defaultdict(float)
    for f, r in seed.items():
        if r > 0 and bip.get(f):
            for s in bip[f]:
                at_startup[s] += r / len(bip[f])
    out = defaultdict(float)
    for s, r in at_startup.items():
        for f in inv_of[s]:
            out[f] += r / len(inv_of[s])
    m = max(out.values(), default=0) or 1.0
    return {f: v / m for f, v in out.items()}


def _canon(store: Store, eid: str) -> str:
    return store.canonical(eid)


def comparable_ids(store: Store, cfg: Config) -> list[str]:
    return [_canon(store, org_id(c.name, kind="startup")) for c in cfg.comparables]


def founder_id(store: Store, cfg: Config) -> str:
    f = cfg.founder
    return _canon(store, person_id(linkedin=f.linkedin_url, email=f.email, name=f.name, org=f.org))


def _fund_texts(store: Store) -> dict[str, dict]:
    rows = store.qd("""
        SELECT coalesce(m.canonical_id, e.entity_id) AS cid, e.name, e.attrs, fp.*
        FROM entities e LEFT JOIN entity_map m ON m.entity_id=e.entity_id
        LEFT JOIN fund_profile fp ON fp.entity_id=e.entity_id
        WHERE e.kind='fund'""")
    out: dict[str, dict] = {}
    for r in rows:
        cur = out.setdefault(r["cid"], {"name": r["name"], "text": "", "profile": {}})
        attrs = json.loads(r["attrs"] or "{}")
        cur["text"] += " " + " ".join(filter(None, [r["name"], r.get("thesis"), " ".join(r.get("sectors") or []),
                                                     (attrs.get("web_text") or "")[:4000]]))
        prof = cur["profile"]
        for k in ("thesis", "thesis_quote", "thesis_url", "stages", "sectors", "geos", "ticket_min", "ticket_max",
                  "ticket_kind", "ticket_quote", "fund_size", "fund_size_src", "last_activity"):
            if r.get(k) not in (None, [], "") and prof.get(k) in (None, [], ""):
                prof[k] = r[k]
            elif k in ("fund_size", "last_activity") and r.get(k) and prof.get(k) and r[k] > prof[k]:
                prof[k] = r[k]
    return out


def _passes_filters(prof: dict, cfg: Config, observed: set[str] | None = None) -> tuple[bool, list[str], float]:
    """Devuelve (pasa, notas, multiplicador de etapa). Etapa declarada = filtro duro;
    etapa solo observada en rondas = penalización suave (×0.6), nunca exclusión."""
    f, notes, mult = cfg.filters, [], 1.0
    stages = [s for s in (prof.get("stages") or []) if s in STAGE_ORDER]
    obs = sorted((observed or set()) & set(STAGE_ORDER), key=STAGE_ORDER.index)
    if stages:
        if not set(stages) & set(f.stages_allowed):
            return False, [f"etapa {stages} fuera de {f.stages_allowed}"], 0.0
    elif obs:
        if set(obs) & set(f.stages_allowed):
            notes.append(f"etapas observadas en rondas: {', '.join(obs)}")
        else:
            notes.append(f"solo observado en {', '.join(obs)} (etapa no publicada)")
            mult = 0.6
    elif f.require_known_stage:
        return False, ["etapa desconocida"], 0.0
    else:
        notes.append("etapa no publicada")
    lo, hi = prof.get("ticket_min"), prof.get("ticket_max")
    if (lo or hi) and (f.ticket_min_usd or f.ticket_max_usd):
        if f.ticket_max_usd and lo and lo > f.ticket_max_usd:
            return False, [f"ticket mínimo {lo:,.0f} > {f.ticket_max_usd:,.0f}"], 0.0
        if f.ticket_min_usd and hi and hi < f.ticket_min_usd:
            return False, [f"ticket máximo {hi:,.0f} < {f.ticket_min_usd:,.0f}"], 0.0
    geos = [g.upper() for g in (prof.get("geos") or [])]
    if geos and f.geos and "GLOBAL" not in geos and not set(geos) & {g.upper() for g in f.geos}:
        return False, [f"geografía {geos} fuera de {f.geos}"], 0.0
    return True, notes, mult


def ticket_view(prof: dict) -> dict:
    if prof.get("ticket_min") or prof.get("ticket_max"):
        return {"min": prof.get("ticket_min"), "max": prof.get("ticket_max"), "kind": "declarado",
                "quote": prof.get("ticket_quote")}
    if prof.get("fund_size"):
        fs = prof["fund_size"]
        return {"min": round(fs * EST_TICKET_LO, -3), "max": round(fs * EST_TICKET_HI, -3), "kind": "estimado",
                "quote": f"[E] {EST_TICKET_LO:.1%}–{EST_TICKET_HI:.0%} de un fondo de US${fs:,.0f} ({prof.get('fund_size_src')})"}
    return {"min": None, "max": None, "kind": "desconocido", "quote": None}


def rank(store: Store, cfg: Config, *, cutoff: date | None = None, now: datetime | None = None,
         G: nx.Graph | None = None, sim: Similarity | None = None, with_paths: bool = True) -> list[dict]:
    now = now or datetime.utcnow()
    today = (cutoff or now.date())
    w = cfg.weights.normalized()
    comps = comparable_ids(store, cfg)
    bip = investment_bipartite(store, cutoff)
    info = node_info(store)
    funds = _fund_texts(store)
    for f in bip:  # fondos que solo aparecen como inversores
        funds.setdefault(f, {"name": info.get(f, {}).get("name", f), "text": info.get(f, {}).get("name", f), "profile": {}})

    # seed: nº de comparables en los que invirtió (normalizado), leads pesan más
    seed_raw: dict[str, float] = defaultdict(float)
    seed_ev: dict[str, list[str]] = defaultdict(list)
    comp_names = {c: info.get(c, {}).get("name", c) for c in comps}
    inv_edges = store.qd("""
        SELECT coalesce(ms.canonical_id,e.src) src, coalesce(md.canonical_id,e.dst) dst, e.attrs, e.evidence, e.start_date
        FROM edges e LEFT JOIN entity_map ms ON ms.entity_id=e.src LEFT JOIN entity_map md ON md.entity_id=e.dst
        WHERE e.rel='invested_in'""" + (" AND (e.start_date IS NULL OR e.start_date < ?)" if cutoff else ""),
        [cutoff] if cutoff else [])
    seen = set()
    observed_stages: dict[str, set[str]] = defaultdict(set)
    for e in inv_edges:
        st = json.loads(e["attrs"] or "{}").get("stage")
        if st:
            observed_stages[e["src"]].add(st)
        if e["dst"] in comps and (e["src"], e["dst"]) not in seen:
            seen.add((e["src"], e["dst"]))
            a = json.loads(e["attrs"] or "{}")
            seed_raw[e["src"]] += (1.5 if a.get("lead") else 1.0) * a.get("confidence", 1.0)
            seed_ev[e["src"]].append(e["evidence"])
    seed = {f: min(1.0, v / max(1.0, len(comps) * 0.4)) for f, v in seed_raw.items()}
    co = probs(bip, seed_raw)

    sim = sim or Similarity()
    th = sim.scores(cfg.project.thesis_text(), {f: d["text"] for f, d in funds.items()})

    G = G if G is not None else (build_path_graph(store, cutoff=cutoff, now=now) if with_paths else nx.Graph())
    me = founder_id(store, cfg)
    if with_paths and (cfg.team or cfg.contacts or cfg.affiliations):
        add_declared(G, store, cfg, me)
    excluded = {norm_org(x) for x in cfg.exclude_funds if x.strip()}

    rows = []
    for f, d in funds.items():
        if f in comps or (excluded and norm_org(d["name"]) in excluded):
            continue
        prof = d["profile"]
        ok, notes, stage_mult = _passes_filters(prof, cfg, observed_stages.get(f))
        if not ok:
            continue
        wanted = set(cfg.project.funding_types or [])
        if wanted and not wanted & VC_COMPATIBLE:
            # Busca grants/deuda/bootstrapping: los fondos VC no se esconden, pero bajan y se avisa por qué.
            notes = [*notes, "es venture capital; buscas " + ", ".join(FUNDING_LABELS[t] for t in sorted(wanted))]
            stage_mult *= 0.75
        last = prof.get("last_activity")
        act = math.exp(-max(0, (today - last).days) / 540) if isinstance(last, date) else 0.0
        factors = {"seed": round(seed.get(f, 0.0), 4), "coinvest": round(co.get(f, 0.0), 4),
                   "thesis": th.get(f, 0.0), "path": 0.0, "activity": round(act, 4)}
        # no se calcula camino para fondos sin ninguna señal de encaje (ahorra tiempo)
        pre = sum(w[k] * factors[k] for k in ("seed", "coinvest", "thesis", "activity"))
        rows.append({"fund_id": f, "name": d["name"], "factors": factors, "pre": pre * stage_mult,
                     "stage_mult": stage_mult, "profile": prof,
                     "notes": notes, "seed_evidence": seed_ev.get(f, [])})
    rows.sort(key=lambda r: -r["pre"])
    shortlist = rows[: max(cfg.top_n * 5, 100)]
    for r in shortlist:
        paths = top_paths(G, me, r["fund_id"], k=3, hop_penalty=cfg.hop_penalty, max_hops=cfg.max_hops) if with_paths else []
        r["paths"] = paths
        r["widest"] = widest_path(G, me, r["fund_id"], cfg.max_hops) if paths else None
        if paths:
            best = paths[0]
            r["factors"]["path"] = round(best["strength"] * (0.5 if best["has_hypothesis"] else 1.0), 4)
        r["score"] = round(r["stage_mult"] * sum(w[k] * r["factors"][k] for k in w), 4)
        r["ticket"] = ticket_view(r["profile"])
        r["why"] = explain(r, cfg, comp_names)
        r["confidence"] = confidence(r)
    shortlist.sort(key=lambda r: -r["score"])
    out = shortlist[: cfg.top_n]
    for i, r in enumerate(out, 1):
        r["rank"] = i
    return out


def explain(r: dict, cfg: Config, comp_names: dict[str, str]) -> str:
    f, bits = r["factors"], []
    if r["seed_evidence"]:
        bits.append("Invirtió en comparables: " + "; ".join(r["seed_evidence"][:3]))
    if f["coinvest"] >= 0.2:
        bits.append(f"Co-invierte con los inversores de los comparables (ProbS {f['coinvest']:.2f})")
    if f["thesis"] >= 0.2:
        bits.append(f"Tesis similar al perfil (sim {f['thesis']:.2f})")
    if f["activity"] >= 0.5:
        bits.append(f"Actividad reciente ({r['profile'].get('last_activity')})")
    if r["notes"]:
        bits.append("Notas: " + ", ".join(r["notes"]))
    return " · ".join(bits) or "Solo señal débil — revisar a mano."


def confidence(r: dict) -> str:
    cited_seed = any("INFERIDO" not in e for e in r["seed_evidence"])
    good_path = bool(r.get("paths")) and not r["paths"][0]["has_hypothesis"] and r["paths"][0]["weakest"] >= 0.3
    if cited_seed and good_path:
        return "alta"
    if cited_seed or good_path or r["factors"]["thesis"] >= 0.35:
        return "media"
    return "baja"
