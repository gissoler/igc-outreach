# QUESTIONS v4 — decisiones que el spec no fijaba

1. **Planner v2 `user.md`.** El spec solo fija `system.md`. Usé una copia literal de `planner/v1/user.md`; el estado nuevo viaja en `{{state}}`.
2. **FIX-11.** `preflight-chain.mjs` es el preflight de Apollo/B3. El preflight del lector va en un archivo nuevo, `preflight-reader.mjs`. Las URLs de prueba son agregadores que en v3 dieron 100 % `FETCH_EMPTY` y no son firmas del gold. El spec pedía sitios elegidos por quien crea D1–D3.
3. **D3 (nulo Nauru).** La búsqueda manual duró unos 5 minutos, no 20. El schema de caso v2 baja el mínimo y el caso lo declara en `notes`.
4. **`first_seen.origin`.** Se añadió al schema de entidad v2 (`search | resolution | planner_candidate`).
5. **`run_result.v2.v2_stats`.** Agrega contadores del motor (fetch vacíos, respaldo de búsqueda, resoluciones, llamadas de sector) que el schema v1 de `totals` no admite.
6. **Candidatos de páginas no-inversor.** El prompt v3 manda las listas y noticias a `entity_kind=other`. Por eso el gate v2 entrega candidatos verificados en cualquier rechazo, no solo en `missing_identity` y `collection_page`.
7. **Commits.** FIX-03 y FIX-04 comparten un commit, igual que FIX-06/07/08 y FIX-05/09/10/12: tocan las mismas funciones y el spec exige que extractor y juez entren juntos.
8. **`fetch.mjs`.** `via` ahora nombra el lector que produjo el texto. Antes quedaba "jina" o "crawl4ai" aunque esos lectores hubieran fallado. El texto devuelto es el mismo.
