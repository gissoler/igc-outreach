# Alcanzabilidad del oro (C4, H6)

Ejecutada una vez el 2026-10-12T23:10:00.152Z. 18 consultas cortas sin nombre de firma (3 por caso; la 1.ª es la de la tabla P1 del diagnóstico), solo Exa (auto, 10 resultados, texto 4000, highlights). Llamadas pagadas: 18; errores: 0; costo a 0.0089 USD por llamada: 0.16 USD.

Regla (fijada en docs/handoff/V7-PREREGISTRO.md antes de ejecutar): un caso es P si el dominio del oro aparece en al menos 1 de sus 3 consultas; D si no aparece en ninguna. Global: P con 4 o más casos P; D con 2 o menos; mixto con 3.

| Caso | Oro | Consulta | Palabras | Resultados | Puesto del oro |
|---|---|---|---|---|---|
| p01 | magmapartners.com | Latin America seed venture capital fintech marketplaces | 7 | 10 | — |
| p01 | magmapartners.com | seed stage venture capital firm investing in Latin American fintech startups | 11 | 10 | — |
| p01 | magmapartners.com | early stage VC fund fintech insurtech marketplaces Latin America | 9 | 10 | — |
| p02 | lightrock.com | growth equity impact investor Brazil Latin America mobility Series B | 10 | 10 | — |
| p02 | lightrock.com | impact growth fund investing in efficient mobility and renewable energy companies in emerging markets | 14 | 10 | — |
| p02 | lightrock.com | growth stage impact investor Brazil climate mobility logistics | 8 | 10 | — |
| p03 | celesta.vc | deep tech venture capital hardware building blocks compute memory power delivery | 11 | 10 | — |
| p03 | celesta.vc | venture capital firm investing in semiconductor and hardware startups Series A | 11 | 10 | — |
| p03 | celesta.vc | deep tech venture fund semiconductors systems infrastructure early stage | 9 | 10 | — |
| p04 | golden.ventures | Toronto pre-seed seed venture capital Canadian founders | 7 | 10 | — |
| p04 | golden.ventures | Canadian seed stage venture capital firm enterprise software | 8 | 10 | — |
| p04 | golden.ventures | pre-seed venture fund backing Canadian founders building software companies | 9 | 10 | — |
| p05 | worldfund.vc | European climate tech venture capital Series B buildings energy | 9 | 10 | 3 |
| p05 | worldfund.vc | climate venture capital fund investing in decarbonisation of buildings energy manufacturing transport | 12 | 10 | — |
| p05 | worldfund.vc | European climate tech VC fund Series A Series B Netherlands Germany | 11 | 10 | 1 |
| p06 | ecapital.vc | German venture capital cybersecurity defense tech seed | 7 | 10 | — |
| p06 | ecapital.vc | venture capital firm investing in cybersecurity and defense tech startups Germany | 11 | 10 | — |
| p06 | ecapital.vc | early stage VC Germany Austria Switzerland cybersecurity industrial security | 9 | 10 | — |

| Caso | Consultas con el oro | Clasificación |
|---|---|---|
| p01 | 0 de 3 | D |
| p02 | 0 de 3 | D |
| p03 | 0 de 3 | D |
| p04 | 0 de 3 | D |
| p05 | 2 de 3 | P |
| p06 | 0 de 3 | D |

Global: D.

Conclusión: El dominio del oro aparece en 1 de 6 casos (2 de 18 consultas: p05 puesto 3, p05 puesto 1) y no aparece en 5 (p01, p02, p03, p04, p06): con consultas cortas sin nombre Exa tampoco devuelve el oro, así que el problema es sobre todo del oro (D: poco recuperable con búsqueda abierta), no de las consultas.
