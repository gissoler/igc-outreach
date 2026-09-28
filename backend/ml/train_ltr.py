"""Learning-to-rank (Módulo 6): LightGBM lambdarank sobre los juicios del usuario.

Entrada: backend/ml/data/judgments.jsonl (node research/scripts/ltr-export.mjs).
Se niega a entrenar con menos de 200 juicios: con menos, el tablero descriptivo con rangos es más honesto.

    pip install lightgbm scikit-learn
    python train_ltr.py --kind lead
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

MIN_JUDGMENTS = 200


def features(query: str, text: str) -> list[float]:
    """Rasgos simples y auditables. Con la flota se pueden añadir similitud de embeddings y el score del reranker."""
    q, t = set(query.lower().split()), set(text.lower().split())
    inter = len(q & t)
    return [inter, inter / (len(q) or 1), len(t), float("led" in t or "lideró" in t)]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=Path(__file__).parent / "data" / "judgments.jsonl")
    ap.add_argument("--kind", default=None, help="lead | chunk | message (por defecto, todos)")
    ap.add_argument("--out", type=Path, default=Path(__file__).parent / "out" / "ltr.txt")
    a = ap.parse_args()
    rows = [json.loads(l) for l in a.data.read_text().splitlines() if l.strip()] if a.data.exists() else []
    if a.kind:
        rows = [r for r in rows if r["kind"] == a.kind]
    if len(rows) < MIN_JUDGMENTS:
        raise SystemExit(f"{len(rows)} juicios: se necesitan al menos {MIN_JUDGMENTS}. Sigue usando el tablero descriptivo.")
    import lightgbm as lgb
    groups = defaultdict(list)
    for r in rows:
        groups[r["query"]].append(r)
    X, y, g = [], [], []
    for q, items in groups.items():
        for r in items:
            X.append(features(q, r["item_text"]))
            y.append(int(r["label"]))
        g.append(len(items))
    model = lgb.LGBMRanker(objective="lambdarank", n_estimators=200, learning_rate=0.05, min_child_samples=5)
    model.fit(X, y, group=g)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    model.booster_.save_model(str(a.out))
    print(f"Modelo guardado en {a.out} ({len(rows)} juicios, {len(g)} consultas)")


if __name__ == "__main__":
    main()
