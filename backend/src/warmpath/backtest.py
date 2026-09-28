"""Evaluación offline (paso 9): corte temporal por comparable.

Para cada comparable con rondas fechadas: se oculta su última ronda (todo lo
desde su fecha queda fuera vía `cutoff`) y ese comparable pasa a ser "el proyecto":
solo los OTROS comparables (con datos anteriores al corte) son la semilla. Se mide si
los inversores reales de la ronda oculta aparecen en el top-K.
"""
from __future__ import annotations

import math
from datetime import datetime

from .candidates import rank
from .db import Store
from .models import Config
from .normalize import org_id
from .thesis import Similarity


def ndcg_at_k(ranked: list[str], relevant: set[str], k: int) -> float:
    dcg = sum(1 / math.log2(i + 2) for i, f in enumerate(ranked[:k]) if f in relevant)
    idcg = sum(1 / math.log2(i + 2) for i in range(min(k, len(relevant))))
    return dcg / idcg if idcg else 0.0


def run(store: Store, cfg: Config, k: int = 20) -> dict:
    sim = Similarity()
    results = []
    for comp in cfg.comparables:
        sid = store.canonical(org_id(comp.name, kind="startup"))
        rounds = store.qd("""
            SELECT e.start_date d, list(DISTINCT coalesce(m.canonical_id, e.src)) investors
            FROM edges e LEFT JOIN entity_map m ON m.entity_id=e.src
            LEFT JOIN entity_map md ON md.entity_id=e.dst
            WHERE e.rel='invested_in' AND coalesce(md.canonical_id, e.dst)=? AND e.start_date IS NOT NULL
            GROUP BY e.start_date ORDER BY e.start_date""", [sid])
        if not rounds:
            continue
        hidden = rounds[-1]
        others = [c for c in cfg.comparables if c.name != comp.name]
        if not others:
            continue
        # el comparable oculto NO es semilla (evita fuga: sus inversores previos harían trampa)
        sub = cfg.model_copy(update={"comparables": others, "top_n": k})
        recs = rank(store, sub, cutoff=hidden["d"], now=datetime.combine(hidden["d"], datetime.min.time()),
                    sim=sim, with_paths=False)
        ranked = [r["fund_id"] for r in recs]
        rel = set(hidden["investors"])
        hits = len(rel & set(ranked[:k]))
        results.append({"comparable": comp.name, "hidden_round": str(hidden["d"]), "n_true": len(rel),
                        f"hit@{k}": hits / len(rel) if rel else 0.0, f"ndcg@{k}": ndcg_at_k(ranked, rel, k)})
    agg = {}
    if results:
        for key in (f"hit@{k}", f"ndcg@{k}"):
            agg[key] = sum(r[key] for r in results) / len(results)
    return {"per_comparable": results, "mean": agg, "similarity": sim.method,
            "note": "Sin rondas fechadas de comparables no hay backtest posible." if not results else ""}
