"""Webs de fondos -> tesis, etapa, ticket, portafolio, equipo (con cita por campo).

Respeta robots.txt, 1 req/s, máx. ~6 páginas por fondo (home + rutas típicas).
Si no hay ANTHROPIC_API_KEY, guarda solo el texto limpio para similitud de tesis
(sin afirmar tesis/ticket).
"""
from __future__ import annotations

from datetime import date
from urllib.parse import urljoin

from selectolax.parser import HTMLParser

from .. import llm
from ..db import Store
from ..http import PoliteClient
from ..normalize import norm_domain, org_id, person_id

PATHS = ["", "/about", "/thesis", "/approach", "/portfolio", "/team", "/companies", "/people"]


def html_to_text(html: str) -> str:
    tree = HTMLParser(html)
    for sel in ("script", "style", "noscript", "svg", "nav", "footer", "iframe"):
        for n in tree.css(sel):
            n.decompose()
    body = tree.body or tree.root
    return " ".join((body.text(separator=" ") if body else "").split())


def fetch_site(domain: str, client: PoliteClient | None = None, max_pages: int = 6) -> list[tuple[str, str]]:
    c = client or PoliteClient(rps=1.0)
    base = "https://" + norm_domain(domain)
    pages = []
    for p in PATHS:
        if len(pages) >= max_pages:
            break
        url = urljoin(base + "/", p.lstrip("/")) if p else base
        try:
            r = c.get(url)
        except (PermissionError, Exception):  # robots o red: se salta, nunca se fuerza
            continue
        if r.status_code == 200 and "html" in r.headers.get("content-type", ""):
            t = html_to_text(r.text)
            if len(t) > 200 and all(t[:500] != x[1][:500] for x in pages):
                pages.append((str(r.url), t))
    return pages


def enrich_fund(store: Store, fund_id: str, domain: str, client: PoliteClient | None = None) -> dict:
    pages = fetch_site(domain, client)
    if not pages:
        return {"fund": fund_id, "pages": 0}
    text = "\n\n".join(f"[{u}]\n{t}" for u, t in pages)
    pid = store.add_prov("fund_web", pages[0][0], text[:500], 0.8)
    store.upsert_entity(fund_id, "fund", fund_id, prov_id=pid, domain=norm_domain(domain),
                        attrs={"web_text": text[:20000]})
    data = llm.extract_fund(text, pages[0][0]) if llm.available() else None
    if data:
        url_of_quote = next((u for u, t in pages if data.get("thesis_quote") and
                             llm.quote_in_text(data["thesis_quote"], t)), pages[0][0])
        exists = store.q("SELECT 1 FROM fund_profile WHERE entity_id=?", [fund_id])
        if not exists:
            store.con.execute("INSERT INTO fund_profile(entity_id, prov_id) VALUES (?,?)", [fund_id, pid])
        store.con.execute("""UPDATE fund_profile SET thesis=?, thesis_quote=?, thesis_url=?, stages=?, sectors=?, geos=?,
                             ticket_min=?, ticket_max=?, ticket_kind=CASE WHEN ? IS NOT NULL THEN 'declared' ELSE ticket_kind END,
                             ticket_quote=? WHERE entity_id=?""",
                          [data.get("thesis"), data.get("thesis_quote"), url_of_quote, data.get("stages") or [],
                           data.get("sectors") or [], data.get("geos") or [], data.get("ticket_min_usd"),
                           data.get("ticket_max_usd"), data.get("ticket_quote"), data.get("ticket_quote"), fund_id])
        for t in data.get("team", []):
            pers = person_id(name=t["name"], org=fund_id)
            store.upsert_entity(pers, "person", t["name"], prov_id=pid, title=t.get("title"))
            store.add_edge(pers, fund_id, "partner_of", strength=0.9, prov_id=pid,
                           evidence=f"Equipo en la web del fondo: {t.get('title','')}")
        for comp in data.get("portfolio", []):
            sid = org_id(comp, kind="startup")
            store.upsert_entity(sid, "startup", comp, prov_id=pid)
            store.add_edge(fund_id, sid, "invested_in", prov_id=pid,
                           evidence=f"Listada en el portafolio de la web ({pages[0][0]})",
                           attrs={"source": "portfolio_page", "observed": date.today().isoformat()})
    return {"fund": fund_id, "pages": len(pages), "llm": bool(data)}
