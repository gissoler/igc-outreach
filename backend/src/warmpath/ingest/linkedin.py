"""Parser propio del export oficial de LinkedIn ("Obtener una copia de tus datos").

Archivos soportados (formato estable del archivo de LinkedIn):
  Connections.csv  -> First Name, Last Name, URL, Email Address, Company, Position, Connected On
                      (precedido de unas líneas "Notes:" que hay que saltar)
  messages.csv     -> CONVERSATION ID, CONVERSATION TITLE, FROM, SENDER PROFILE URL, TO,
                      RECIPIENT PROFILE URLS, DATE, SUBJECT, CONTENT, FOLDER, ...

Minimización: de messages.csv solo se guardan metadatos (quién, a quién, cuándo).
El contenido (CONTENT/SUBJECT) NUNCA se lee a la base.

Solo da 1er grado. El 2º salto se infiere de fuentes públicas o de pooling con consentimiento.
"""
from __future__ import annotations

import csv
import io
from collections import Counter
from datetime import datetime
from pathlib import Path

from ..db import Store
from ..models import Person
from ..normalize import norm_linkedin, norm_org, norm_text, org_id, person_id

CONN_HEADER_KEY = "first name"


def _read_after_notes(path: Path) -> list[dict]:
    """LinkedIn antepone 'Notes:' + un párrafo; buscamos la fila de encabezado real."""
    raw = path.read_text(encoding="utf-8-sig", errors="replace")
    lines = raw.splitlines()
    start = next((i for i, l in enumerate(lines) if l.lower().startswith(CONN_HEADER_KEY)), 0)
    return list(csv.DictReader(io.StringIO("\n".join(lines[start:]))))


def _parse_date(s: str) -> datetime | None:
    s = (s or "").strip().replace(" UTC", "")
    for fmt in ("%d %b %Y", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%m/%d/%y, %I:%M %p", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def _norm_keys(row: dict) -> dict:
    return {(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}


def owner_entity(store: Store, founder: Person, prov_id: int | None = None) -> str:
    oid = person_id(linkedin=founder.linkedin_url, email=founder.email, name=founder.name, org=founder.org)
    store.upsert_entity(oid, "person", founder.name, prov_id=prov_id, email=founder.email,
                        linkedin=norm_linkedin(founder.linkedin_url), org_name=founder.org,
                        attrs={"is_founder": True})
    return oid


def require_consent(store: Store, owner_id: str, primary_owner: str | None) -> None:
    if primary_owner is None or owner_id == primary_owner:
        return
    ok = store.q("SELECT 1 FROM consents WHERE owner=? AND revoked_at IS NULL", [owner_id])
    if not ok:
        raise PermissionError(
            f"No hay consentimiento registrado para usar la red de {owner_id} en el pooling. "
            f"Regístralo con `warmpath consent add` antes de ingerir su export.")


def ingest_connections(store: Store, path: str | Path, owner: str) -> int:
    path = Path(path)
    rows = [_norm_keys(r) for r in _read_after_notes(path)]
    n = 0
    for r in rows:
        first, last = r.get("first name", ""), r.get("last name", "")
        name = f"{first} {last}".strip()
        if not name:
            continue
        url, email = r.get("url", ""), r.get("email address", "")
        company, position = r.get("company", ""), r.get("position", "")
        when = _parse_date(r.get("connected on", ""))
        pid = store.add_prov("linkedin", str(path.name),
                             f"Connection: {name} — {position} @ {company} (desde {r.get('connected on','')})", 1.0)
        cid = person_id(linkedin=url, email=email, name=name, org=company)
        store.upsert_entity(cid, "person", name, prov_id=pid, email=email, linkedin=norm_linkedin(url),
                            org_name=company, title=position)
        store.add_interaction(owner, cid, "li_connection", ts=when, prov_id=pid)
        if company:
            oid = org_id(company, kind="org")
            store.upsert_entity(oid, "institution", company, prov_id=pid)
            store.add_edge(cid, oid, "works_at", strength=0.8, prov_id=pid,
                           evidence=f"LinkedIn: {position} @ {company}", attrs={"title": position})
        n += 1
    return n


def ingest_messages(store: Store, path: str | Path, owner: str, owner_linkedin: str = "") -> int:
    """Solo metadatos. Cada mensaje -> una interacción entre owner y cada contraparte."""
    path = Path(path)
    with open(path, encoding="utf-8-sig", errors="replace", newline="") as f:
        rows = [_norm_keys(r) for r in csv.DictReader(f)]
    if not rows:
        return 0
    me = norm_linkedin(owner_linkedin)
    if not me:  # el remitente más frecuente es el dueño del export
        me = Counter(norm_linkedin(r.get("sender profile url", "")) for r in rows).most_common(1)[0][0]
    known = {r[0]: r[1] for r in store.q("SELECT linkedin, entity_id FROM entities WHERE linkedin IS NOT NULL")}
    by_name = {r[0]: r[1] for r in store.q("SELECT norm_name, entity_id FROM entities WHERE kind='person'")}
    pid = store.add_prov("linkedin", str(path.name), f"messages.csv: {len(rows)} mensajes (solo metadatos)", 1.0)
    n = 0
    for r in rows:
        if (r.get("folder", "") or "").upper() == "DRAFT":
            continue
        ts = _parse_date(r.get("date", ""))
        sender = norm_linkedin(r.get("sender profile url", ""))
        recips = [norm_linkedin(u) for u in r.get("recipient profile urls", "").replace(",", " ").split()]
        recip_names = [x.strip() for x in r.get("to", "").split(",") if x.strip()]
        n_part = 1 + max(len(recips), len(recip_names), 1)
        if sender == me:
            direction = "out"
            k = max(len(recips), len(recip_names))
            others = [(recips[i] if i < len(recips) else "", recip_names[i] if i < len(recip_names) else "")
                      for i in range(k)]
        else:
            direction = "in"
            others = [(sender, r.get("from", ""))]
        for url, nm in others:
            cid = known.get(url) if url else None
            cid = cid or by_name.get(norm_text(nm))
            if not cid:
                if not url and not nm:
                    continue
                cid = person_id(linkedin="https://www.linkedin.com/" + url if url else "", name=nm)
                store.upsert_entity(cid, "person", nm or url, prov_id=pid, linkedin=url)
                known[url] = cid
            store.add_interaction(owner, cid, "li_message", direction=direction, ts=ts,
                                  n_participants=n_part, prov_id=pid)
            n += 1
    return n


def ingest_export(store: Store, folder: str | Path, founder: Person, *, primary_owner: str | None = None) -> dict:
    folder = Path(folder)
    oid = owner_entity(store, founder)
    require_consent(store, oid, primary_owner)
    out = {"owner": oid, "connections": 0, "message_events": 0}
    conn = next((p for p in folder.rglob("*") if p.name.lower() == "connections.csv"), None)
    msgs = next((p for p in folder.rglob("*") if p.name.lower() == "messages.csv"), None)
    if conn:
        out["connections"] = ingest_connections(store, conn, oid)
    if msgs:
        out["message_events"] = ingest_messages(store, msgs, oid, founder.linkedin_url)
    if not conn and not msgs:
        raise FileNotFoundError(f"No encontré Connections.csv ni messages.csv en {folder}")
    return out


def fund_affiliations(store: Store) -> int:
    """Si la empresa actual de un contacto coincide con un fondo conocido -> partner_of (s=0.85)."""
    funds = {r[0]: r[1] for r in store.q("SELECT norm_name, entity_id FROM entities WHERE kind='fund'")}
    n = 0
    for eid, org, title in store.q("SELECT entity_id, org_name, title FROM entities WHERE kind='person' AND org_name IS NOT NULL"):
        fid = funds.get(norm_org(org))
        if fid and not store.q("SELECT 1 FROM edges WHERE src=? AND dst=? AND rel='partner_of'", [eid, fid]):
            pid = store.add_prov("linkedin", None, f"{title} @ {org}", 0.85)
            store.add_edge(eid, fid, "partner_of", strength=0.85, prov_id=pid,
                           evidence=f"LinkedIn: {title or 'trabaja'} @ {org}")
            n += 1
    return n
