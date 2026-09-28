"""Similitud tesis del fondo ↔ perfil del proyecto.

Preferido: embeddings all-MiniLM-L6-v2 (sentence-transformers, corre local).
Respaldo sin dependencias: TF-IDF + coseno (se indica en el reporte cuál se usó).
"""
from __future__ import annotations

import math
import re
from collections import Counter

_STOP = set("""a an and are as at be by for from has have in is it its of on or that the to we with our you your
we're their they this those these will can more most who what which into across over de la el en y los las del para
con por un una que se su sus al como""".split())
_TOK = re.compile(r"[a-záéíóúñü0-9]+")


def _tokens(s: str) -> list[str]:
    return [t for t in _TOK.findall((s or "").lower()) if t not in _STOP and len(t) > 2]


class Similarity:
    def __init__(self, prefer_embeddings: bool = True):
        self.method = "tfidf"
        self.model = None
        if prefer_embeddings:
            try:
                from sentence_transformers import SentenceTransformer

                self.model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
                self.method = "minilm"
            except Exception:  # sin paquete o sin red para bajar el modelo
                self.model = None

    def scores(self, query: str, docs: dict[str, str]) -> dict[str, float]:
        keys = [k for k, v in docs.items() if v and v.strip()]
        if not keys:
            return {k: 0.0 for k in docs}
        if self.model is not None:
            emb = self.model.encode([query] + [docs[k] for k in keys], normalize_embeddings=True)
            q = emb[0]
            sims = {k: float(max(0.0, (emb[i + 1] * q).sum())) for i, k in enumerate(keys)}
        else:
            sims = self._tfidf(query, {k: docs[k] for k in keys})
        return {k: round(sims.get(k, 0.0), 4) for k in docs}

    @staticmethod
    def _tfidf(query: str, docs: dict[str, str]) -> dict[str, float]:
        toks = {k: Counter(_tokens(v)) for k, v in docs.items()}
        qt = Counter(_tokens(query))
        N = len(toks) + 1
        df = Counter()
        for c in list(toks.values()) + [qt]:
            df.update(set(c))
        idf = {t: math.log((N + 1) / (df[t] + 0.5)) for t in df}

        def vec(c: Counter) -> dict[str, float]:
            v = {t: (1 + math.log(n)) * idf[t] for t, n in c.items()}
            norm = math.sqrt(sum(x * x for x in v.values())) or 1.0
            return {t: x / norm for t, x in v.items()}

        qv = vec(qt)
        return {k: sum(qv.get(t, 0) * x for t, x in vec(c).items()) for k, c in toks.items()}
