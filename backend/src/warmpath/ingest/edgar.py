"""EDGAR en vivo para frescura (< 1 trimestre): full-text search + primary_doc.xml de Form D.

- Full-text search: https://efts.sec.gov/LATEST/search-index?q=...&forms=D
- Documento:        https://www.sec.gov/Archives/edgar/data/{cik}/{acc_sin_guiones}/primary_doc.xml
User-Agent con email obligatorio; ≤10 req/s (usamos 5).
Los resultados se escriben en las mismas tablas fd_filing / fd_person que el bulk.
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
from datetime import date, datetime

from ..db import Store
from .sec_formd import _fill_norms, ensure_schema

EFTS = "https://efts.sec.gov/LATEST/search-index"
DOC = "https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/primary_doc.xml"


def _t(el: ET.Element | None, path: str) -> str:
    if el is None:
        return ""
    x = el.find(path)
    return (x.text or "").strip() if x is not None and x.text else ""


def _strip_ns(root: ET.Element) -> ET.Element:
    for el in root.iter():
        if isinstance(el.tag, str) and "}" in el.tag:
            el.tag = el.tag.split("}", 1)[1]
    return root


def parse_formd_xml(xml_text: str, accession: str, filing_date: date | None = None) -> tuple[dict, list[dict]]:
    """Devuelve (fila fd_filing, filas fd_person) a partir del XML de Form D."""
    root = _strip_ns(ET.fromstring(xml_text))
    iss = root.find("primaryIssuer")
    off = root.find("offeringData")
    ind = off.find("industryGroup") if off is not None else None
    amounts = off.find("offeringSalesAmounts") if off is not None else None

    def num(v: str) -> float | None:
        try:
            return float(v.replace(",", ""))
        except (ValueError, AttributeError):
            return None

    sale = _t(off, "typeOfFiling/dateOfFirstSale/value")
    filing = {
        "accession": accession,
        "cik": _t(iss, "cik").lstrip("0"),
        "entity_name": _t(iss, "entityName"),
        "city": _t(iss, "issuerAddress/city"),
        "state": _t(iss, "issuerAddress/stateOrCountry"),
        "filing_date": filing_date,
        "industry_group": _t(ind, "industryGroupType"),
        "fund_type": _t(ind, "investmentFundInfo/investmentFundType"),
        "total_offering": num(_t(amounts, "totalOfferingAmount")),
        "total_sold": num(_t(amounts, "totalAmountSold")),
        "sale_date": datetime.strptime(sale, "%Y-%m-%d").date() if sale else None,
        "is_amendment": _t(off, "typeOfFiling/newOrAmendment/isAmendment").lower() == "true",
    }
    persons = []
    for rp in root.findall("relatedPersonsList/relatedPersonInfo"):
        rels = [r.text.strip() for r in rp.findall("relatedPersonRelationshipList/relationship") if r.text]
        persons.append({
            "accession": accession,
            "first_name": _t(rp, "relatedPersonName/firstName"),
            "last_name": _t(rp, "relatedPersonName/lastName"),
            "city": _t(rp, "relatedPersonAddress/city"),
            "state": _t(rp, "relatedPersonAddress/stateOrCountry"),
            "relationships": "|".join(rels),
            "clarification": _t(rp, "relationshipClarification"),
        })
    return filing, persons


def store_parsed(store: Store, filing: dict, persons: list[dict], origin: str = "edgar") -> bool:
    ensure_schema(store)
    if store.q("SELECT 1 FROM fd_filing WHERE accession=?", [filing["accession"]]):
        return False
    store.con.execute(
        "INSERT INTO fd_filing VALUES (?,?,?,NULL,?,?,?,?,?,?,?,?,?,?)",
        [filing["accession"], filing["cik"], filing["entity_name"], filing["city"], filing["state"],
         filing["filing_date"], filing["industry_group"], filing["fund_type"], filing["total_offering"],
         filing["total_sold"], filing["sale_date"], filing["is_amendment"], origin],
    )
    for p in persons:
        store.con.execute("INSERT INTO fd_person VALUES (?,?,?,NULL,?,?,?,?)",
                          [p["accession"], p["first_name"], p["last_name"], p["city"], p["state"],
                           p["relationships"], p["clarification"]])
    _fill_norms(store)
    return True


def search_formd(query: str, start: date, end: date | None = None, max_hits: int = 100) -> list[dict]:
    """Full-text search de Form D. Devuelve [{accession, cik, name, file_date}]."""
    from ..http import sec_client

    c = sec_client()
    params = {"q": f'"{query}"' if " " in query else query, "forms": "D", "dateRange": "custom",
              "startdt": start.isoformat(), "enddt": (end or date.today()).isoformat()}
    hits, frm = [], 0
    while len(hits) < max_hits:
        r = c.get(EFTS, params={**params, "from": frm})
        r.raise_for_status()
        data = r.json().get("hits", {}).get("hits", [])
        if not data:
            break
        for h in data:
            src = h.get("_source", {})
            acc = (h.get("_id", "").split(":")[0]) or src.get("adsh", "")
            hits.append({"accession": acc, "cik": (src.get("ciks") or [""])[0].lstrip("0"),
                         "name": (src.get("display_names") or [""])[0], "file_date": src.get("file_date")})
        frm += len(data)
    return hits[:max_hits]


def fetch_and_store(store: Store, hits: list[dict]) -> int:
    from ..http import sec_client

    c = sec_client()
    n = 0
    for h in hits:
        if not h["cik"] or not h["accession"]:
            continue
        url = DOC.format(cik=h["cik"], acc=h["accession"].replace("-", ""))
        r = c.get(url)
        if r.status_code != 200:
            continue
        fd = datetime.strptime(h["file_date"], "%Y-%m-%d").date() if h.get("file_date") else None
        filing, persons = parse_formd_xml(r.text, h["accession"], fd)
        n += store_parsed(store, filing, persons, origin=f"edgar:{url}")
    return n
