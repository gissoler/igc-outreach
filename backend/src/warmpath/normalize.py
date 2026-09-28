"""Normalización de nombres, URLs, emails, dominios y organizaciones.

Todo el matching determinista (paso B.1) depende de estas funciones, así que
son puras y están cubiertas por tests.
"""
from __future__ import annotations

import re
import unicodedata
from urllib.parse import urlparse

_WS = re.compile(r"\s+")
_NON_ALNUM = re.compile(r"[^a-z0-9 ]+")

# Sufijos legales / de vehículo que no identifican al fondo
_ORG_STOP = {
    "lp", "l p", "llc", "l l c", "inc", "incorporated", "corp", "corporation", "ltd", "limited",
    "co", "company", "gp", "plc", "sa", "sas", "gmbh", "bv", "ag", "the", "fund", "funds",
    "partners fund", "opportunity", "opportunities", "annex", "side", "car", "spv", "series",
    "feeder", "parallel", "offshore", "onshore", "master", "holdings", "a", "b", "c",
}
_ROMAN = re.compile(r"\b(i{1,3}|iv|v|vi{0,3}|ix|x|xi{0,3})\b")
_NUMS = re.compile(r"\b\d+\b")
_FREE_MAIL = {
    "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com",
    "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "msn.com",
}


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def norm_text(s: str | None) -> str:
    if not s:
        return ""
    s = strip_accents(str(s)).lower()
    s = _NON_ALNUM.sub(" ", s)
    return _WS.sub(" ", s).strip()


def norm_person_name(first: str | None, last: str | None = None) -> str:
    """'Dr. José  Pérez-Gómez, PhD' -> 'jose perez gomez'."""
    full = f"{first or ''} {last or ''}"
    full = re.sub(r"\b(dr|mr|mrs|ms|prof|phd|md|mba|jr|sr)\b\.?", " ", full, flags=re.I)
    return norm_text(full)


def norm_org(name: str | None) -> str:
    """'Acme Ventures Fund III, L.P.' -> 'acme ventures'."""
    raw = strip_accents(str(name or "")).lower()
    raw = re.sub(r"\bl\.\s?l\.\s?c\.?|\bl\.\s?p\.?(?=\W|$)", " ", raw)  # L.P., L.L.C.
    s = norm_text(raw)
    s = _ROMAN.sub(" ", s)
    s = _NUMS.sub(" ", s)
    toks = [t for t in s.split() if t not in _ORG_STOP]
    return " ".join(toks)


def norm_email(email: str | None) -> str:
    if not email:
        return ""
    e = email.strip().lower()
    m = re.search(r"[\w.+'-]+@[\w-]+(\.[\w-]+)+", e)
    return m.group(0) if m else ""


def email_domain(email: str | None) -> str:
    e = norm_email(email)
    if not e:
        return ""
    d = e.split("@", 1)[1]
    return "" if d in _FREE_MAIL else d


def norm_domain(url_or_domain: str | None) -> str:
    if not url_or_domain:
        return ""
    s = url_or_domain.strip().lower()
    if "://" not in s:
        s = "http://" + s
    host = urlparse(s).netloc.split(":")[0]
    return host[4:] if host.startswith("www.") else host


def norm_linkedin(url: str | None) -> str:
    """Devuelve el slug canónico 'in/<slug>' o '' si no es un perfil de persona."""
    if not url:
        return ""
    s = url.strip()
    if "://" not in s:
        s = "https://" + s
    p = urlparse(s)
    if "linkedin.com" not in p.netloc.lower():
        return ""
    parts = [x for x in p.path.split("/") if x]
    if len(parts) >= 2 and parts[0].lower() == "in":
        return "in/" + parts[1].lower()
    return ""


def slug(s: str) -> str:
    return norm_text(s).replace(" ", "-")


def person_id(*, linkedin: str = "", email: str = "", name: str = "", org: str = "") -> str:
    """ID determinista por la señal más fuerte disponible."""
    li = norm_linkedin(linkedin)
    if li:
        return f"p:li:{li[3:]}"
    em = norm_email(email)
    if em:
        return f"p:em:{em}"
    n = norm_text(name)
    o = norm_org(org)
    return f"p:nm:{slug(n)}@{slug(o)}" if o else f"p:nm:{slug(n)}"


def org_id(name: str, *, cik: str | None = None, kind: str = "org") -> str:
    if cik:
        return f"{kind[0]}:cik:{str(cik).lstrip('0')}"
    return f"{kind[0]}:nm:{slug(norm_org(name) or norm_text(name))}"


def jaro_winkler(a: str, b: str) -> float:
    """Jaro-Winkler puro (para el motor de resolución sin Splink)."""
    if a == b:
        return 1.0 if a else 0.0
    la, lb = len(a), len(b)
    if not la or not lb:
        return 0.0
    rng = max(la, lb) // 2 - 1
    am, bm = [False] * la, [False] * lb
    m = 0
    for i, ca in enumerate(a):
        lo, hi = max(0, i - rng), min(i + rng + 1, lb)
        for j in range(lo, hi):
            if not bm[j] and b[j] == ca:
                am[i] = bm[j] = True
                m += 1
                break
    if not m:
        return 0.0
    t, k = 0, 0
    for i in range(la):
        if am[i]:
            while not bm[k]:
                k += 1
            if a[i] != b[k]:
                t += 1
            k += 1
    t /= 2
    jaro = (m / la + m / lb + (m - t) / m) / 3
    pref = 0
    for ca, cb in zip(a[:4], b[:4]):
        if ca != cb:
            break
        pref += 1
    return jaro + pref * 0.1 * (1 - jaro)
