"""Vehículos de fondos VC desde los datasets trimestrales de Form D de la SEC (señal "fondo nuevo").

Solo stdlib: lee las carpetas TSV ya descomprimidas (FORMDSUBMISSION, ISSUERS, OFFERING, RELATEDPERSONS)
y escribe un JSON que consume el servidor Node (research/server/analysis/momentum.mjs).

    python -m warmpath.ingest.formd_vehicles data/raw/formd/2026q2_d_x --out ../research/data/fund_vehicles.json

Cada vehículo lleva: nombre del emisor, CIK, fecha de presentación, fecha de primera venta, monto ofrecido y
vendido, si es enmienda, personas relacionadas (Executive Officer / Director / Promoter, públicas en el Form D)
y el enlace a la carpeta del filing en EDGAR.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

csv.field_size_limit(sys.maxsize)
FUND_TYPES = {"Venture Capital Fund"}


def _rows(folder: Path, name: str):
    with open(folder / name, newline="", encoding="utf-8", errors="replace") as fh:
        yield from csv.DictReader(fh, delimiter="\t")


def _num(v: str | None):
    try:
        return float(v) if v not in (None, "", "Indefinite") else None
    except ValueError:
        return None


def _date(v: str | None) -> str | None:
    """'30-JUN-2026' o '2026-06-30' -> '2026-06-30'."""
    if not v:
        return None
    months = {m: i for i, m in enumerate(["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"], 1)}
    v = v.strip()
    if len(v) >= 10 and v[4] == "-":
        return v[:10]
    parts = v.split("-")
    if len(parts) == 3 and parts[1].upper() in months:
        return f"{parts[2]}-{months[parts[1].upper()]:02d}-{int(parts[0]):02d}"
    return None


def vehicles(folder: Path, fund_types: set[str] = FUND_TYPES) -> list[dict]:
    offer = {r["ACCESSIONNUMBER"]: r for r in _rows(folder, "OFFERING.tsv") if r.get("INVESTMENTFUNDTYPE") in fund_types}
    subs = {r["ACCESSIONNUMBER"]: r for r in _rows(folder, "FORMDSUBMISSION.tsv") if r["ACCESSIONNUMBER"] in offer}
    issuers: dict[str, dict] = {}
    for r in _rows(folder, "ISSUERS.tsv"):
        if r["ACCESSIONNUMBER"] in offer and (r.get("IS_PRIMARYISSUER_FLAG") in ("YES", "Y", "true", "1") or r["ACCESSIONNUMBER"] not in issuers):
            issuers[r["ACCESSIONNUMBER"]] = r
    people: dict[str, list[dict]] = {}
    for r in _rows(folder, "RELATEDPERSONS.tsv"):
        if r["ACCESSIONNUMBER"] in offer:
            name = " ".join(x for x in (r.get("FIRSTNAME"), r.get("MIDDLENAME"), r.get("LASTNAME")) if x and x.strip())
            rel = [x for x in (r.get("RELATIONSHIP_1"), r.get("RELATIONSHIP_2"), r.get("RELATIONSHIP_3")) if x]
            people.setdefault(r["ACCESSIONNUMBER"], []).append({"name": name.strip(), "relationships": rel, "clarification": (r.get("RELATIONSHIPCLARIFICATION") or "").strip()})
    out = []
    for acc, o in offer.items():
        s, i = subs.get(acc, {}), issuers.get(acc, {})
        cik = (i.get("CIK") or "").lstrip("0")
        out.append({
            "accession": acc,
            "cik": cik,
            "entityName": (i.get("ENTITYNAME") or "").strip(),
            "state": i.get("STATEORCOUNTRYDESCRIPTION") or i.get("STATEORCOUNTRY"),
            "fundType": o.get("INVESTMENTFUNDTYPE"),
            "submissionType": s.get("SUBMISSIONTYPE"),
            "isAmendment": (o.get("ISAMENDMENT") or "").lower() in ("true", "yes", "y", "1"),
            "filingDate": _date(s.get("FILING_DATE")),
            "firstSaleDate": _date(o.get("SALE_DATE")),
            "yetToOccur": (o.get("YETTOOCCUR") or "").lower() in ("true", "yes", "y", "1"),
            "totalOffering": _num(o.get("TOTALOFFERINGAMOUNT")),
            "totalSold": _num(o.get("TOTALAMOUNTSOLD")),
            "investors": _num(o.get("TOTALNUMBERALREADYINVESTED")),
            "relatedPersons": people.get(acc, [])[:12],
            "url": f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc.replace('-', '')}/" if cik else None,
        })
    return sorted(out, key=lambda v: v["filingDate"] or "", reverse=True)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("folders", nargs="+", type=Path, help="carpetas TSV descomprimidas (p. ej. data/raw/formd/2026q2_d_x)")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--include-pe", action="store_true", help="incluye Private Equity Fund")
    a = ap.parse_args(argv)
    types = FUND_TYPES | ({"Private Equity Fund"} if a.include_pe else set())
    rows = [v for f in a.folders for v in vehicles(f, types)]
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps({"generatedFrom": [str(f) for f in a.folders], "count": len(rows), "vehicles": rows}, ensure_ascii=False))
    print(f"{len(rows)} vehículos → {a.out}")


if __name__ == "__main__":
    main()
