"""SEC Form ADV (RIA + Exempt Reporting Advisers) — enriquecimiento de fondos.

Fuente: https://www.sec.gov/data-research/sec-markets-data/information-about-registered-investment-advisers-exempt-reporting-advisers
Publicación mensual (CSV/Excel dentro de un zip). [VERIFICAR FORMATO AL CONSTRUIR]
Como los encabezados cambian entre meses, el mapeo es heurístico y configurable:
se busca la columna por fragmentos de nombre. `warmpath adv-columns` imprime los encabezados.

Uso: se cruza por nombre normalizado con los fondos que ya salieron de Form D y se
agrega AUM + CRD + web. Schedule A (dueños/ejecutivos) se carga si se pasa ese archivo.
"""
from __future__ import annotations

import csv
from pathlib import Path

from ..db import Store
from ..normalize import norm_domain, norm_org, org_id, person_id

FIRM_COLS = {
    "name": ["primary business name", "business name", "legal name"],
    "crd": ["organization crd", "crd"],
    "sec_no": ["sec#", "sec number", "sec file"],
    "website": ["website", "web address"],
    "aum": ["5f(2)(c)", "regulatory assets", "total regulatory assets", "aum"],
    "city": ["main office city"],
    "country": ["main office country"],
}
SCHED_A_COLS = {
    "firm": ["primary business name", "business name", "firm"],
    "crd": ["organization crd", "crd"],
    "person": ["full legal name", "name"],
    "title": ["title or status", "title"],
}


def _find(header: list[str], frags: list[str]) -> int | None:
    low = [h.lower().strip() for h in header]
    for f in frags:
        for i, h in enumerate(low):
            if f in h:
                return i
    return None


def _read(path: Path) -> tuple[list[str], list[list[str]]]:
    with open(path, encoding="latin-1", newline="") as f:
        rows = list(csv.reader(f))
    return rows[0], rows[1:]


def load_firms(store: Store, path: str | Path, only_matching_funds: bool = True) -> int:
    header, rows = _read(Path(path))
    idx = {k: _find(header, v) for k, v in FIRM_COLS.items()}
    if idx["name"] is None:
        raise KeyError(f"No encuentro la columna de nombre en {path}. Encabezados: {header[:30]}")
    known = {r[0]: r[1] for r in store.q("SELECT norm_name, entity_id FROM entities WHERE kind='fund'")}
    n = 0
    for r in rows:
        get = lambda k: r[idx[k]].strip() if idx[k] is not None and idx[k] < len(r) else ""  # noqa: E731
        nn = norm_org(get("name"))
        fid = known.get(nn)
        if not fid:
            if only_matching_funds:
                continue
            fid = org_id(get("name"), kind="fund")
        pid = store.add_prov("form_adv", str(path), f"ADV: {get('name')} CRD {get('crd')} AUM {get('aum')}", 1.0)
        store.upsert_entity(fid, "fund", get("name"), prov_id=pid, domain=norm_domain(get("website")),
                            city=get("city"), country=get("country"),
                            attrs={"adv_crd": get("crd"), "adv_aum": get("aum"), "adv_sec_no": get("sec_no")})
        n += 1
    return n


def load_schedule_a(store: Store, path: str | Path) -> int:
    header, rows = _read(Path(path))
    idx = {k: _find(header, v) for k, v in SCHED_A_COLS.items()}
    known = {r[0]: r[1] for r in store.q("SELECT norm_name, entity_id FROM entities WHERE kind='fund'")}
    n = 0
    for r in rows:
        get = lambda k: r[idx[k]].strip() if idx[k] is not None and idx[k] < len(r) else ""  # noqa: E731
        fid = known.get(norm_org(get("firm")))
        if not fid or not get("person") or "," not in get("person") and len(get("person").split()) < 2:
            continue
        name = get("person")
        if "," in name:  # "DOE, JANE" -> "Jane Doe"
            last, first = [x.strip() for x in name.split(",", 1)]
            name = f"{first} {last}".title()
        pid = store.add_prov("form_adv", str(path), f"Schedule A: {name} — {get('title')} en {get('firm')}", 1.0)
        pers = person_id(name=name, org=get("firm"))
        store.upsert_entity(pers, "person", name, prov_id=pid, org_name=get("firm"), title=get("title"))
        store.add_edge(pers, fid, "partner_of", strength=0.9, prov_id=pid,
                       evidence=f"Form ADV Schedule A: {get('title')}")
        n += 1
    return n
