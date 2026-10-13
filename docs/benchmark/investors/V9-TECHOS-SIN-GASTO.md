# V9 — Techos sin gasto (pasos 0 a 2 de PROMPT-v11)

Generado: 2026-10-13T02:08:20.820Z. Solo relectura de cachés y events.jsonl de v5–v8 (sin Exa, sin LLM, sin red). Script: research/bench/investors/analysis/v9/sin_gasto_report.mjs.

## Paso 0: separar la causa (parte sin gasto)

Resoluciones por nombre de firma en events.jsonl de v8 (18 corridas más el intento descartado de p05 s202, que aporta 7): no_domain 109, accepted 92, rejected:missing_literal_quote 16, rejected:other 19, already_seen 1, rejected:fetch_empty 2, rejected:collection_page 1, rejected:unresolved_firm_identity 2.

no_domain: 109 resoluciones de 53 nombres. 36 llevaban el tipo de la tabla del agregador pegado al nombre ("… VC Fund"); sus búsquedas devolvieron sobre todo páginas del agregador. En los resultados guardados, el emparejador v9 encuentra el sitio propio (o un subdominio del propio) en 23 resoluciones (14 nombres). Revisión de los hosts: en unas 47 de las 109 el sitio propio o el de la matriz estaba en los resultados (dominios cortos, siglas, acentos, subdominios); el resto no lo traía.

Intentos de resolver el oro en v8: 0. Las no_domain no explican la pérdida del oro.

Búsquedas por el nombre del oro que ya están en las cachés (consultas de profundización, no la de resolución):

| Carpeta | Caso | Consulta | Proveedor | Puesto del dominio del oro |
|---|---|---|---|---|
| investors-internal-2026-10-12-v7 | p05 | World Fund investment criteria: sectors and stages they invest in | exa | 1 |
| investors-internal-2026-10-09-v5-pairs | p01 | Magma Partners investment criteria: sectors and geographies (countries | exa | 1 |
| investors-internal-2026-10-09-v6 | p01 | Magma Partners investment criteria: sectors, stages and geographies (c | exa | 1 |

Oro aceptado en un intento de v8 que falló por infraestructura y se descartó por la regla: inv-case-syn-p05 B2 s202 (https://www.worldfund.vc/).

Sin la medición con Exa por nombre (12 llamadas, go-v9-diagnostico.sh) queda abierto si (i) aplica a 10 de los 12 oros. Lo que sí está medido: la redacción de la consulta no cambia el alcance (6 formas, ≤ 1 de 6), las listas nombran al oro y el motor lo pierde en la extracción y la selección (iii).

## Paso 1: páginas de listas y puesto del oro

diag = texto Exa (≤ 10.000 caracteres) de las 2 consultas de listas del diagnóstico v8; full = páginas completas que abrió la fase de listas de v8 (unión de 3 réplicas); union = diag + full. Puesto = puesto del oro / nombres distintos. Órdenes: pages (páginas que citan el nombre), firm_pages (solo nombres con forma de firma, por páginas), position (mejor puesto dentro de una página).

| Caso | Oro | Páginas diag | Con el oro | Páginas full | Con el oro | diag pages | diag firm_pages | diag position | full pages | full firm_pages | full position | union firm_pages |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| p01 | magmapartners.com | 20 | 6 | 10 | 2 | 21/470 | 15/319 | 5/319 | 343/1105 | 19/153 | 27/153 | 14/352 |
| p02 | lightrock.com | 20 | 0 | 14 | 1 | —/507 | —/248 | —/248 | 630/1379 | 113/292 | 134/292 | 361/377 |
| p03 | celesta.vc | 20 | 0 | 14 | 1 | —/569 | —/242 | —/242 | 462/994 | 86/308 | 126/308 | 256/429 |
| p04 | golden.ventures | 19 | 2 | 12 | 1 | 108/554 | 71/289 | 3/289 | 864/1275 | 79/321 | 71/321 | 32/428 |
| p05 | worldfund.vc | 20 | 0 | 14 | 1 | —/498 | —/258 | —/258 | 1075/1470 | 561/604 | 599/604 | 591/690 |
| p06 | ecapital.vc | 20 | 2 | 13 | 2 | 126/777 | 42/345 | 120/345 | 124/907 | 29/310 | 95/310 | 50/397 |
| p07 | novastarventures.com | 20 | 2 | — | — | 82/534 | 35/280 | 149/280 | — | — | — | — |
| p08 | venturesplatform.com | 19 | 6 | — | — | 17/656 | 5/302 | 19/302 | — | — | — | — |
| p09 | a91partners.com | 20 | 1 | — | — | 257/463 | 99/196 | 129/196 | — | — | — | — |
| p10 | endiya.com | 20 | 5 | — | — | 31/570 | 20/316 | 36/316 | — | — | — | — |
| p11 | seacef.org | 20 | 6 | — | — | 16/313 | 3/180 | 12/180 | — | — | — | — |
| p12 | sginnovate.com | 19 | 0 | — | — | —/665 | —/275 | —/275 | — | — | — | — |

Por réplica v8 (O2 se cuenta por réplica; la regla pide ≥ 2 de 3):

| Caso | Réplica | Páginas de lista | Con el oro | Nombres | Puesto del oro (firm_pages) |
|---|---|---|---|---|---|
| p01 | s101 | 10 | 2 | 153 | 20 |
| p01 | s202 | 10 | 2 | 153 | 20 |
| p01 | s303 | 10 | 2 | 153 | 19 |
| p02 | s101 | 12 | 1 | 276 | 96 |
| p02 | s202 | 12 | 1 | 276 | 96 |
| p02 | s303 | 12 | 1 | 281 | 101 |
| p03 | s101 | 12 | 1 | 294 | 79 |
| p03 | s202 | 12 | 1 | 291 | 76 |
| p03 | s303 | 12 | 1 | 292 | 77 |
| p04 | s101 | 10 | 0 | 304 | — |
| p04 | s202 | 10 | 1 | 314 | 70 |
| p04 | s303 | 10 | 0 | 304 | — |
| p05 | s101 | 12 | 0 | 167 | — |
| p05 | s202 | 12 | 0 | 167 | — |
| p05 | s303 | 12 | 1 | 563 | 558 |
| p06 | s101 | 12 | 2 | 280 | 27 |
| p06 | s202 | 12 | 2 | 280 | 27 |
| p06 | s303 | 12 | 2 | 303 | 29 |

| Cupo K de resoluciones por caso | 8 | 16 | 32 | 64 | 128 | 256 |
|---|---|---|---|---|---|---|
| p01–p06: casos con el oro ≤ K en ≥ 2 de 3 réplicas | 0 | 0 | 2 | 2 | 4 | 4 |
| p07–p12 (diag, firm_pages, una lista por caso) | 2 | 2 | 3 | 4 | 5 | — |

Presupuesto de Exa: tope US$ 5 − diagnóstico US$ 0.107 − parte del planner como v7 (152 llamadas) US$ 1.353 = US$ 3.54 → 397 resoluciones en total, 66 por caso (las réplicas repiten nombres y salen de la caché). Con K ≤ 66 el techo de selección es 2 de 6.

## (g) Firmas con gain ≥ 2 en las etiquetas

| Caso | Firmas gain ≥ 2 | v7: unión de réplicas | v7: mediana | v8: unión | v8: mediana |
|---|---|---|---|---|---|
| p01 | 8 | 2 | 2 | 2 | 2 |
| p02 | 3 | 0 | 0 | 0 | 0 |
| p03 | 9 | 3 | 3 | 3 | 3 |
| p04 | 11 | 2 | 1 | 0 | 0 |
| p05 | 2 | 2 | 1 | 1 | 1 |
| p06 | 4 | 0 | 0 | 0 | 0 |
| Total | 37 | 9 | | 6 | |

p07–p12: p07 4, p08 5, p09 2, p10 4, p11 3, p12 9. Las etiquetas salen del pool de resultados de los sistemas, así que el conjunto está sesgado hacia lo que ya se encontró.
