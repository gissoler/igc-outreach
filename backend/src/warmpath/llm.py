"""Extracción con un LLM (API de Anthropic) + verificación de citas.

Principio: el LLM propone, el código verifica. Un campo solo se guarda si viene
con una cita que aparece LITERALMENTE (normalizando espacios) en el texto fuente.
Si no hay ANTHROPIC_API_KEY, las funciones devuelven None y el pipeline sigue.
"""
from __future__ import annotations

import json
import os
import re

import httpx

API = "https://api.anthropic.com/v1/messages"
MODEL = os.environ.get("WARMPATH_LLM_MODEL")


def available() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY")) and bool(MODEL)


def _squash(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip().lower()


def quote_in_text(quote: str, text: str) -> bool:
    q = _squash(quote).strip(" .\"'“”")
    return len(q) >= 8 and q in _squash(text)


def ask_json(system: str, user: str, max_tokens: int = 1500) -> dict | None:
    if not available():
        return None
    r = httpx.post(API, timeout=90, headers={
        "x-api-key": os.environ["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01",
        "content-type": "application/json"},
        json={"model": MODEL, "max_tokens": max_tokens, "system": system,
              "messages": [{"role": "user", "content": user}]})
    r.raise_for_status()
    text = "".join(b.get("text", "") for b in r.json().get("content", []))
    m = re.search(r"\{.*\}", text, re.S)
    return json.loads(m.group(0)) if m else None


FUND_SYSTEM = """Extraes datos de la web de un fondo de inversión. Responde SOLO un JSON:
{"thesis": str|null, "thesis_quote": str|null, "stages": [..], "sectors": [..], "geos": [..],
 "ticket_min_usd": number|null, "ticket_max_usd": number|null, "ticket_quote": str|null,
 "portfolio": [str], "team": [{"name": str, "title": str}]}
Reglas: *_quote debe ser una frase copiada LITERALMENTE del texto. Si el texto no lo dice, null.
stages ∈ {pre-seed, seed, series-a, series-b, growth}. geos como códigos ISO-2 o 'EU','LATAM','GLOBAL'.
No inventes: sin evidencia en el texto => null o lista vacía."""

ROUND_SYSTEM = """Extraes una ronda de financiación de un anuncio. Responde SOLO un JSON:
{"company": str, "date": "YYYY-MM-DD"|null, "stage": "pre-seed|seed|series-a|series-b|growth|unknown",
 "amount_usd": number|null, "investors": [{"name": str, "lead": bool, "person": str}],
 "snippet": str}
snippet = frase copiada LITERALMENTE del texto que nombra a los inversores. No inventes inversores."""


def extract_fund(text: str, url: str) -> dict | None:
    data = ask_json(FUND_SYSTEM, f"URL: {url}\n\nTEXTO:\n{text[:60000]}")
    if not data:
        return None
    # verificación de citas: se descarta lo que no esté respaldado
    if not quote_in_text(data.get("thesis_quote") or "", text):
        data["thesis"], data["thesis_quote"] = None, None
    if not quote_in_text(data.get("ticket_quote") or "", text):
        data["ticket_min_usd"], data["ticket_max_usd"], data["ticket_quote"] = None, None, None
    data["team"] = [t for t in data.get("team", []) if t.get("name") and _squash(t["name"]) in _squash(text)]
    data["portfolio"] = [p for p in data.get("portfolio", []) if p and _squash(p) in _squash(text)]
    return data


def extract_round(text: str, url: str) -> dict | None:
    data = ask_json(ROUND_SYSTEM, f"URL: {url}\n\nTEXTO:\n{text[:60000]}")
    if not data or not quote_in_text(data.get("snippet") or "", text):
        return None
    data["investors"] = [i for i in data.get("investors", []) if _squash(i.get("name", "")) in _squash(text)]
    data["source_url"] = url
    return data
