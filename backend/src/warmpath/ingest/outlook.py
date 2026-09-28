"""Export local de Outlook / Microsoft 365 -> interacciones (solo headers y asistentes).

Rutas soportadas, todas locales, sin OAuth ni permisos de tenant:
  * .ics  — calendario exportado (Outlook web/Windows/Mac: "Exportar calendario" o publicar ICS)
  * .olm  — archivo de Outlook para Mac (Archivo → Exportar). Es un zip de XML.  [verificar con export real]
  * .pst  — Outlook Windows. Se convierte primero con `readpst` (libpst, open source):
              readpst -e -o exports/outlook_eml  archivo.pst
            y luego se ingiere la carpeta de .eml resultante.
  * .eml / mbox — cualquier carpeta de correos exportados.

Minimización: se leen From/To/Cc/Date y asistentes/hora de reuniones. Nunca cuerpos.
Microsoft Graph (Calendars.Read, Mail.Read) queda para el piloto: ver README.
"""
from __future__ import annotations

import mailbox
import re
import zipfile
from datetime import date, datetime, timezone
from email import policy
from email.parser import BytesHeaderParser
from email.utils import getaddresses, parsedate_to_datetime
from pathlib import Path
from xml.etree import ElementTree as ET

from ..db import Store
from ..normalize import norm_email, person_id


def _naive(dt: datetime | date | None) -> datetime | None:
    if dt is None:
        return None
    if isinstance(dt, datetime):
        return dt.astimezone(timezone.utc).replace(tzinfo=None) if dt.tzinfo else dt
    return datetime(dt.year, dt.month, dt.day)


class _Ctx:
    def __init__(self, store: Store, owner: str, owner_emails: set[str], source_name: str):
        self.store, self.owner, self.me = store, owner, {norm_email(e) for e in owner_emails if e}
        self.pid = store.add_prov("outlook", source_name, f"Export Outlook {source_name} (solo headers)", 1.0)
        self.cache: dict[str, str] = {}
        self.n = 0

    def contact(self, name: str, email: str) -> str | None:
        em = norm_email(email)
        if not em or em in self.me or _is_robot(em):
            return None
        if em not in self.cache:
            existing = self.store.q("SELECT entity_id FROM entities WHERE lower(email)=?", [em])
            cid = existing[0][0] if existing else person_id(email=em)
            if not existing:
                self.store.upsert_entity(cid, "person", name or em, prov_id=self.pid, email=em)
            self.cache[em] = cid
        return self.cache[em]

    def record(self, frm: list[tuple[str, str]], to: list[tuple[str, str]], ts: datetime | None, channel: str):
        senders = {norm_email(e) for _, e in frm}
        everyone = frm + to
        n_part = len({norm_email(e) for _, e in everyone if e})
        if senders & self.me:
            direction, others = "out", to
        elif any(norm_email(e) in self.me for _, e in to):
            direction, others = "in", frm
        elif channel == "meeting":
            direction, others = "none", everyone
        else:
            return  # correo donde el founder no participa
        for nm, em in others:
            cid = self.contact(nm, em)
            if cid:
                self.store.add_interaction(self.owner, cid, channel, direction=direction, ts=ts,
                                           n_participants=n_part, prov_id=self.pid)
                self.n += 1


_ROBOT = re.compile(r"(no-?reply|noreply|notifications?|mailer-daemon|calendar-server|bounce|news(letter)?)@", re.I)


def _is_robot(email: str) -> bool:
    return bool(_ROBOT.search(email))


# ------------------------------------------------------------------ ICS
def ingest_ics(ctx: _Ctx, path: Path) -> None:
    from icalendar import Calendar

    cal = Calendar.from_ical(path.read_bytes())
    for ev in cal.walk("VEVENT"):
        org = ev.get("ORGANIZER")
        att = ev.get("ATTENDEE") or []
        att = att if isinstance(att, list) else [att]
        def addr(v):  # noqa: E306
            s = str(v)
            return (str(v.params.get("CN", "")) if hasattr(v, "params") else "", s.split(":", 1)[-1])
        frm = [addr(org)] if org else []
        to = [addr(a) for a in att]
        dt = ev.get("DTSTART")
        ctx.record(frm, to, _naive(dt.dt) if dt else None, "meeting")


# ------------------------------------------------------------------ EML / MBOX
def _from_headers(ctx: _Ctx, h) -> None:
    frm = getaddresses(h.get_all("From", []))
    to = getaddresses(h.get_all("To", []) + h.get_all("Cc", []))
    try:
        ts = _naive(parsedate_to_datetime(h.get("Date"))) if h.get("Date") else None
    except (TypeError, ValueError):
        ts = None
    ctx.record(frm, to, ts, "email")


def ingest_eml_dir(ctx: _Ctx, folder: Path) -> None:
    parser = BytesHeaderParser(policy=policy.compat32)
    for p in folder.rglob("*"):
        if p.is_file() and (p.suffix.lower() == ".eml" or p.suffix == "" and p.stat().st_size < 50_000_000):
            with open(p, "rb") as f:
                head = f.read(65536)
            if b"\nFrom:" not in b"\n" + head and not head.startswith(b"From:"):
                if head.startswith(b"From "):  # mbox
                    for msg in mailbox.mbox(str(p)):
                        _from_headers(ctx, msg)
                continue
            _from_headers(ctx, parser.parsebytes(head))


# ------------------------------------------------------------------ OLM (Outlook for Mac)
def ingest_olm(ctx: _Ctx, path: Path) -> None:
    """OLM = zip de XML. Mensajes: <email> con OPFMessageCopy*Addresses y OPFMessageCopySentTime.
    Eventos: <appointment> con OPFCalendarEventCopyStartTime y lista de asistentes.
    Se leen solo atributos de dirección y fechas. [VERIFICAR con un export real]"""
    def addrs(el, tag):
        node = el.find(tag)
        if node is None:
            return []
        return [(a.get("OPFContactEmailAddressName", ""), a.get("OPFContactEmailAddressAddress", ""))
                for a in node.iter() if a.get("OPFContactEmailAddressAddress")]

    def ts(el, *tags):
        for t in tags:
            x = el.find(t)
            if x is not None and x.text:
                try:
                    return _naive(datetime.fromisoformat(x.text.replace("Z", "+00:00")))
                except ValueError:
                    pass
        return None

    with zipfile.ZipFile(path) as z:
        for name in z.namelist():
            if not name.endswith(".xml"):
                continue
            try:
                root = ET.fromstring(z.read(name))
            except ET.ParseError:
                continue
            for em in root.iter("email"):
                ctx.record(addrs(em, "OPFMessageCopyFromAddresses") or addrs(em, "OPFMessageCopySenderAddress"),
                           addrs(em, "OPFMessageCopyToAddresses") + addrs(em, "OPFMessageCopyCCAddresses"),
                           ts(em, "OPFMessageCopySentTime", "OPFMessageCopyReceivedTime"), "email")
            for ap in root.iter("appointment"):
                ctx.record(addrs(ap, "OPFCalendarEventCopyOrganizer"),
                           addrs(ap, "OPFCalendarEventCopyAttendeeList"),
                           ts(ap, "OPFCalendarEventCopyStartTime"), "meeting")


def ingest_path(store: Store, path: str | Path, owner: str, owner_emails: list[str]) -> int:
    path = Path(path)
    if path.suffix.lower() == ".pst":
        raise ValueError("Convierte el .pst primero:  readpst -e -o exports/outlook_eml " + str(path)
                         + "  (brew install libpst)  y luego ingiere la carpeta exports/outlook_eml")
    ctx = _Ctx(store, owner, set(owner_emails), path.name)
    if path.is_dir():
        for ics in path.rglob("*.ics"):
            ingest_ics(ctx, ics)
        for olm in path.rglob("*.olm"):
            ingest_olm(ctx, olm)
        ingest_eml_dir(ctx, path)
    elif path.suffix.lower() == ".ics":
        ingest_ics(ctx, path)
    elif path.suffix.lower() == ".olm":
        ingest_olm(ctx, path)
    elif path.suffix.lower() == ".eml":
        with open(path, "rb") as f:
            _from_headers(ctx, BytesHeaderParser(policy=policy.compat32).parsebytes(f.read(65536)))
    elif path.suffix.lower() in (".mbox", ""):
        for m in mailbox.mbox(str(path)):
            _from_headers(ctx, m)
    else:
        raise ValueError(f"Formato no soportado: {path}")
    return ctx.n
