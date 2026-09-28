"""Fuerza de vínculo explicable (Gilbert & Karahalios, CHI 2009).

Dimensiones del paper -> señales observables en exports (solo metadatos):
  intensidad   -> frecuencia de mensajes/correos en 24 meses
  recencia     -> días desde la última interacción (no cuenta la fecha de conexión)
  duración     -> antigüedad de la relación (primera interacción o fecha de conexión)
  reciprocidad -> min(in,out)/max(in,out)
  multiplexidad-> nº de canales distintos (LinkedIn msg, correo, reunión)
  intimidad    -> reuniones pequeñas (≤4) y correos 1:1
s = 0.05 + 0.90·σ(z), z = combinación lineal con pesos fijos y documentados.
v2: reemplazar pesos a mano por pesos aprendidos con outcomes (Supervised Random Walks).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime

from .db import Store

W = {"bias": -3.0, "recency": 2.0, "frequency": 1.8, "reciprocity": 1.2, "duration": 0.8,
     "multiplexity": 1.2, "intimacy": 1.0}
CHANNELS = ("li_message", "email", "meeting")


@dataclass
class TieFeatures:
    n_msgs: int = 0
    n_emails: int = 0
    n_meetings: int = 0
    n_small_meetings: int = 0
    n_one_to_one: int = 0
    n_in: int = 0
    n_out: int = 0
    first: datetime | None = None
    last: datetime | None = None
    connected: datetime | None = None
    channels: set = field(default_factory=set)

    def vector(self, now: datetime) -> dict[str, float]:
        recent_n = self.n_msgs + self.n_emails + 2 * self.n_meetings
        days = (now - self.last).days if self.last else None
        start = min([d for d in (self.first, self.connected) if d] or [now])
        return {
            "recency": math.exp(-days / 180) if days is not None else 0.0,
            "frequency": 1 - math.exp(-recent_n / 10),
            "reciprocity": (min(self.n_in, self.n_out) / max(self.n_in, self.n_out)) if self.n_in and self.n_out else 0.0,
            "duration": min(1.0, (now - start).days / (5 * 365)),
            "multiplexity": len(self.channels) / len(CHANNELS),
            "intimacy": min(1.0, (self.n_small_meetings + 0.3 * self.n_one_to_one) / 5),
        }


def strength_from_features(v: dict[str, float]) -> float:
    z = W["bias"] + sum(W[k] * v[k] for k in v)
    return round(0.05 + 0.90 / (1 + math.exp(-z)), 4)


def evidence_text(f: TieFeatures) -> str:
    parts = []
    if f.n_msgs:
        parts.append(f"{f.n_msgs} mensajes LinkedIn")
    if f.n_emails:
        parts.append(f"{f.n_emails} correos")
    if f.n_meetings:
        parts.append(f"{f.n_meetings} reuniones" + (f" ({f.n_small_meetings} de ≤4 personas)" if f.n_small_meetings else ""))
    s = ", ".join(parts) + " en 24 meses" if parts else "sin interacciones registradas"
    if f.last:
        s += f"; último contacto {f.last:%Y-%m}"
    if f.n_in and f.n_out:
        s += f"; recíproco ({f.n_out} enviados / {f.n_in} recibidos)"
    elif f.n_out and not f.n_in:
        s += "; solo mensajes salientes (sin respuesta)"
    if f.connected:
        s += f"; conectados en LinkedIn desde {f.connected:%Y-%m}"
    return s


def compute_ties(store: Store, now: datetime | None = None, window_days: int = 730) -> list[dict]:
    """Agrega interactions (por canónicos) -> lista de {owner, contact, s, features, evidence}."""
    now = now or datetime.utcnow()
    rows = store.q("""
        SELECT coalesce(mo.canonical_id, i.owner), coalesce(mc.canonical_id, i.contact_id),
               i.channel, i.direction, i.ts, i.n_participants
        FROM interactions i
        LEFT JOIN entity_map mo ON mo.entity_id=i.owner
        LEFT JOIN entity_map mc ON mc.entity_id=i.contact_id""")
    feats: dict[tuple[str, str], TieFeatures] = {}
    for owner, contact, ch, direction, ts, npart in rows:
        if owner == contact:
            continue
        f = feats.setdefault((owner, contact), TieFeatures())
        if ch == "li_connection":
            f.connected = ts if not f.connected or (ts and ts < f.connected) else f.connected
            continue
        if ts and (now - ts).days > window_days:
            f.first = ts if not f.first or ts < f.first else f.first
            continue
        f.channels.add(ch)
        if ch == "li_message":
            f.n_msgs += 1
        elif ch == "email":
            f.n_emails += 1
            if (npart or 2) <= 2:
                f.n_one_to_one += 1
        elif ch == "meeting":
            f.n_meetings += 1
            if (npart or 99) <= 4:
                f.n_small_meetings += 1
        if direction == "in":
            f.n_in += 1
        elif direction == "out":
            f.n_out += 1
        if ts:
            f.first = ts if not f.first or ts < f.first else f.first
            f.last = ts if not f.last or ts > f.last else f.last
    out = []
    for (o, c), f in feats.items():
        v = f.vector(now)
        out.append({"owner": o, "contact": c, "s": strength_from_features(v), "features": v,
                    "evidence": evidence_text(f)})
    return out


def noisy_or(values: list[float]) -> float:
    """Combina varias relaciones entre el mismo par (multiplexidad entre fuentes)."""
    p = 1.0
    for v in values:
        p *= 1 - max(0.0, min(0.99, v))
    return round(min(0.99, 1 - p), 4)
