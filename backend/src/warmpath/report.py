"""Salida: 20 inversores × {tesis citada, ticket, por qué encaja, mejor camino, confianza}.

Genera en out/<run_id>/:
  recomendaciones.md   — legible para el founder (con evidencia y citas)
  recomendaciones.csv  — una fila por inversor
  notion_import.csv    — columnas listas para importar a la base "Funding — Inversores"
y guarda la corrida en la tabla recommendations (para el registro de outcomes).
"""
from __future__ import annotations

import csv
import json
from datetime import datetime
from pathlib import Path

from .db import Store
from .models import Config


def _money(v) -> str:
    if v is None:
        return "?"
    return f"US${v/1e6:.1f}M" if v >= 1e6 else f"US${v/1e3:.0f}k"


def _ticket(t: dict) -> str:
    if t["kind"] == "desconocido":
        return "desconocido"
    tag = "[H] declarado" if t["kind"] == "declarado" else "[E] estimado"
    return f"{_money(t['min'])}–{_money(t['max'])} ({tag})"


def _path_line(p: dict | None) -> str:
    if not p:
        return "Sin camino — liderar con la tesis (outreach frío informado)"
    names = [p["hops"][0]["from_name"]] + [h["to_name"] for h in p["hops"]]
    flag = " [?] incluye hipótesis" if p["has_hypothesis"] else ""
    return f"{' → '.join(names)} (fuerza {p['strength']:.2f}, eslabón más débil {p['weakest']:.2f}){flag}"


def write(store: Store, cfg: Config, recs: list[dict], out_dir: str | Path = "out", sim_method: str = "") -> Path:
    run_id = datetime.now().strftime("%Y%m%d-%H%M%S")
    d = Path(out_dir) / run_id
    d.mkdir(parents=True, exist_ok=True)

    for r in recs:
        store.con.execute("INSERT INTO recommendations VALUES (?,?,?,?,?,?,?)",
                          [run_id, r["rank"], r["fund_id"], r["score"], json.dumps(r["factors"]),
                           json.dumps(r["paths"][0] if r.get("paths") else None, default=str), datetime.now()])

    # ---- Markdown
    L = [f"# Warm Path Engine — {cfg.project.name}", "",
         f"Corrida `{run_id}` · {len(recs)} inversores · similitud de tesis: {sim_method or 'n/d'}", "",
         "Leyenda: **[H]** observado con cita · **[E]** estimado por heurística · **[?]** hipótesis a confirmar.", "",
         "| # | Inversor | Score | Ticket | Mejor camino | Confianza |", "|---|---|---|---|---|---|"]
    for r in recs:
        best = r["paths"][0] if r.get("paths") else None
        L.append(f"| {r['rank']} | {r['name']} | {r['score']:.3f} | {_ticket(r['ticket'])} | "
                 f"{(best['connector'] or 'directo') if best else '—'} | {r['confidence']} |")
    L.append("")
    for r in recs:
        p = r["profile"]
        L += [f"## {r['rank']}. {r['name']}", ""]
        if p.get("thesis_quote"):
            L.append(f"**Tesis [H]:** {p.get('thesis') or ''} — «{p['thesis_quote']}» ([fuente]({p.get('thesis_url')}))")
        else:
            L.append("**Tesis:** no extraída con cita todavía (correr `warmpath enrich-funds`).")
        L.append(f"**Ticket:** {_ticket(r['ticket'])}" + (f" — {r['ticket']['quote']}" if r["ticket"].get("quote") else ""))
        L.append(f"**Por qué encaja:** {r['why']}")
        L.append("**Factores:** " + ", ".join(f"{k}={v:.2f}" for k, v in r["factors"].items()) + f" → score {r['score']:.3f}")
        L.append(f"**Mejor camino:** {_path_line(r['paths'][0] if r.get('paths') else None)}")
        for h in (r["paths"][0]["hops"] if r.get("paths") else []):
            L.append(f"  - {h['from_name']} ↔ {h['to_name']}: s={h['s']:.2f} ({h['rel']}) — {h['evidence']}")
        if r.get("widest") and r.get("paths") and r["widest"]["nodes"] not in [x["nodes"] for x in r["paths"]]:
            L.append(f"**Alternativa con eslabón más fuerte (widest):** {_path_line(r['widest'])}")
        for alt in (r.get("paths") or [])[1:]:
            L.append(f"**Alternativa:** {_path_line(alt)}")
        L.append(f"**Confianza:** {r['confidence']}")
        L.append("")
    L += ["---", "Validar a mano el top 20 en OpenVC / Signal NFX (uso manual del founder; no se ingieren).",
          "Registrar resultados: `warmpath outcome <fund_id> intro_pedida --connector <id>`."]
    (d / "recomendaciones.md").write_text("\n".join(L), encoding="utf-8")

    # ---- CSV
    cols = ["rank", "fund_id", "name", "score", "confidence", "seed", "coinvest", "thesis", "path", "activity",
            "thesis_text", "thesis_quote", "thesis_url", "ticket_min", "ticket_max", "ticket_kind",
            "best_path", "connector", "path_strength", "weakest_link", "has_hypothesis", "why"]
    with open(d / "recomendaciones.csv", "w", newline="", encoding="utf-8") as f:
        wr = csv.DictWriter(f, fieldnames=cols)
        wr.writeheader()
        for r in recs:
            best = r["paths"][0] if r.get("paths") else None
            wr.writerow({"rank": r["rank"], "fund_id": r["fund_id"], "name": r["name"], "score": r["score"],
                         "confidence": r["confidence"], **r["factors"],
                         "thesis_text": r["profile"].get("thesis"), "thesis_quote": r["profile"].get("thesis_quote"),
                         "thesis_url": r["profile"].get("thesis_url"), "ticket_min": r["ticket"]["min"],
                         "ticket_max": r["ticket"]["max"], "ticket_kind": r["ticket"]["kind"],
                         "best_path": _path_line(best), "connector": best["connector"] if best else "",
                         "path_strength": best["strength"] if best else "", "weakest_link": best["weakest"] if best else "",
                         "has_hypothesis": best["has_hypothesis"] if best else "", "why": r["why"]})

    # ---- Notion
    with open(d / "notion_import.csv", "w", newline="", encoding="utf-8") as f:
        wr = csv.writer(f)
        wr.writerow(["Name", "Empresa", "Score", "Confianza", "Tesis", "Fuente tesis", "Ticket", "Conector",
                     "Camino", "Por qué encaja", "Estado", "Run"])
        for r in recs:
            best = r["paths"][0] if r.get("paths") else None
            wr.writerow([r["name"], cfg.project.name, r["score"], r["confidence"], r["profile"].get("thesis") or "",
                         r["profile"].get("thesis_url") or "", _ticket(r["ticket"]),
                         best["connector"] if best else "", _path_line(best), r["why"], "Por contactar", run_id])
    return d
