"""Rondas de los comparables (anuncios de prensa, blogs, notas) -> invested_in con cita.

Entrada: config/rounds.yaml (ver config/rounds.example.yaml). Cada ronda exige
source_url + snippet literal. `warmpath extract-round URL` genera la entrada con
un LLM y verifica que el fragmento exista literalmente en la página.
"""
from __future__ import annotations

from pathlib import Path

from ..db import Store
from ..models import Config, RoundsFile
from ..normalize import norm_domain, norm_org, org_id, person_id


def ingest_rounds(store: Store, cfg: Config, path: str | Path) -> dict[str, int]:
    rf = RoundsFile.load(path)
    comp_names = {norm_org(c.name): c for c in cfg.comparables}
    for c in cfg.comparables:
        for a in c.aliases:
            comp_names[norm_org(a)] = c
    stats = {"rounds": 0, "investments": 0, "non_comparable_rounds": 0}
    for r in rf.rounds:
        comp = comp_names.get(norm_org(r.company))
        sid = org_id(comp.name if comp else r.company, kind="startup")
        pid = store.add_prov("rounds", r.source_url, r.snippet, r.confidence)
        store.upsert_entity(sid, "startup", comp.name if comp else r.company, prov_id=pid,
                            domain=comp.domain if comp else "", attrs={"comparable": bool(comp)})
        stats["rounds"] += 1
        stats["non_comparable_rounds"] += 0 if comp else 1
        for inv in r.investors:
            fid = org_id(inv.name, kind="fund")
            store.upsert_entity(fid, "fund", inv.name, prov_id=pid, domain=norm_domain(inv.domain))
            store.add_edge(fid, sid, "invested_in", prov_id=pid, start_date=r.date,
                           evidence=f"{inv.name}{' (lead)' if inv.lead else ''} en {r.stage} de {r.company} "
                                    f"({r.date:%Y-%m}) — {r.source_url}",
                           attrs={"stage": r.stage, "lead": inv.lead, "amount_usd": r.amount_usd,
                                  "confidence": r.confidence})
            _bump_activity(store, fid, r.date, pid)
            if inv.person:
                pers = person_id(name=inv.person, org=inv.name)
                store.upsert_entity(pers, "person", inv.person, prov_id=pid, org_name=inv.name)
                store.add_edge(pers, fid, "partner_of", strength=0.9, prov_id=pid,
                               evidence=f"Citado como partner de {inv.name} en anuncio de ronda")
            stats["investments"] += 1
    return stats


def _bump_activity(store: Store, fid: str, d, pid: int) -> None:
    if store.q("SELECT 1 FROM fund_profile WHERE entity_id=?", [fid]):
        store.con.execute("UPDATE fund_profile SET last_activity = greatest(coalesce(last_activity, DATE '1900-01-01'), ?) "
                          "WHERE entity_id=?", [d, fid])
    else:
        store.con.execute("INSERT INTO fund_profile(entity_id, last_activity, prov_id) VALUES (?,?,?)", [fid, d, pid])
