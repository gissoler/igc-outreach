"""Warm path por FUERZA, no por distancia (paso E).

costo(arista) = −log(s) + penalización_por_salto (+ penalización si la arista es hipótesis)
top-k caminos simples de menor costo (Yen, vía networkx.shortest_simple_paths),
solo con PERSONAS como nodos intermedios. Además se reporta:
  * eslabón más débil de cada camino (min s)
  * widest path: el camino cuyo eslabón más débil es el más fuerte posible
"""
from __future__ import annotations

import heapq
import math
from itertools import islice

import networkx as nx


def _view(G: nx.Graph, source: str, target: str) -> nx.Graph:
    """Solo personas como intermedios + source y target."""
    keep = [n for n, d in G.nodes(data=True) if d.get("kind") == "person" or n in (source, target)]
    return G.subgraph(keep)


HYPOTHESIS_PENALTY = 0.7  # un eslabón sin evidencia observable cuesta como ~2 saltos extra


def edge_cost(s: float, hop_penalty: float, hypothesis: bool = False) -> float:
    return -math.log(max(1e-6, min(1.0, s))) + hop_penalty + (HYPOTHESIS_PENALTY if hypothesis else 0.0)


def describe(G: nx.Graph, path: list[str]) -> dict:
    hops = []
    for a, b in zip(path, path[1:]):
        d = G.edges[a, b]
        best = max(d["rels"], key=lambda r: r["s"])
        hops.append({"from": a, "from_name": G.nodes[a].get("name", a), "to": b, "to_name": G.nodes[b].get("name", b),
                     "s": d["s"], "rel": best["rel"], "hypothesis": d["hypothesis"],
                     "evidence": " | ".join(sorted({r["evidence"] for r in d["rels"] if r["evidence"]}))[:400],
                     "sources": sorted({r["source"] for r in d["rels"] if r["source"]})})
    ss = [h["s"] for h in hops]
    return {"nodes": path, "hops": hops, "strength": round(math.prod(ss), 4) if ss else 0.0,
            "weakest": round(min(ss), 4) if ss else 0.0, "n_hops": len(hops),
            "has_hypothesis": any(h["hypothesis"] for h in hops),
            "connector": hops[0]["to_name"] if len(hops) >= 2 else None}


def top_paths(G: nx.Graph, source: str, target: str, k: int = 3, hop_penalty: float = 0.25,
              max_hops: int = 4, max_explore: int = 60) -> list[dict]:
    if source not in G or target not in G:
        return []
    H = _view(G, source, target)
    if not nx.has_path(H, source, target):
        return []
    weight = lambda u, v, d: edge_cost(d["s"], hop_penalty, d.get("hypothesis", False))  # noqa: E731
    out = []
    try:
        for p in islice(nx.shortest_simple_paths(H, source, target, weight=weight), max_explore):
            if len(p) - 1 <= max_hops:
                out.append(describe(G, p))
            if len(out) >= k:
                break
    except nx.NetworkXNoPath:
        return []
    return out


def widest_path(G: nx.Graph, source: str, target: str, max_hops: int = 4) -> dict | None:
    """Max-min (bottleneck) con límite de saltos. Dijkstra modificado sobre (nodo, saltos)."""
    if source not in G or target not in G:
        return None
    H = _view(G, source, target)
    best = {(source, 0): 1.0}
    heap = [(-1.0, 0, source, [source])]
    while heap:
        neg_b, hops, node, path = heapq.heappop(heap)
        if node == target:
            return describe(G, path)
        if hops >= max_hops:
            continue
        for nb in H.neighbors(node):
            if nb in path:
                continue
            b = min(-neg_b, H.edges[node, nb]["s"])
            if b > best.get((nb, hops + 1), 0):
                best[(nb, hops + 1)] = b
                heapq.heappush(heap, (-b, hops + 1, nb, path + [nb]))
    return None
