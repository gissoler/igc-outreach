# V9 — Diagnóstico: búsqueda por nombre del oro y techo del diseño L128

Ejecutado: 2026-10-13T02:16:50.003Z. Pre-registro: docs/handoff/V9-PREREGISTRO.md. Config: research/bench/investors/config/v9-diagnostico-2026-10-12.json.

Costo Exa: 12 unidades × 0.0089 = US$ 0.107; costDollars de Exa (suma) US$ 0.084. Panel de Exa: antes US$ 8, después US$ 8, diferencia US$ 0 para 12 unidades. LLM: 16 llamadas no cacheadas. Descargas no cacheadas: 78.

## Paso 0: búsqueda por el nombre del oro (consulta de resolución del motor)

| Caso | Oro | Consulta | Puesto Exa | Exa: host elegido (v8) | Exa: host elegido (v9) | Puesto Serper | Serper: host elegido (v9) |
|---|---|---|---|---|---|---|---|
| p01 | magmapartners.com | "Magma Partners" venture capital | 1 | magmapartners.com | magmapartners.com | 1 | magmapartners.com |
| p02 | lightrock.com | "Lightrock" venture capital | 1 | lightrock.com | lightrock.com | 1 | lightrock.com |
| p03 | celesta.vc | "Celesta Capital" venture capital | 1 | celesta.vc | celesta.vc | 1 | celesta.vc |
| p04 | golden.ventures | "Golden Ventures" venture capital | 1 | golden.ventures | golden.ventures | 1 | golden.ventures |
| p05 | worldfund.vc | "World Fund" venture capital | 1 | worldfund.vc | worldfund.vc | 1 | worldfund.vc |
| p06 | ecapital.vc | "eCAPITAL ENTREPRENEURIAL PARTNERS" venture capital | 1 | ecapital.vc | ecapital.vc | 1 | ecapital.vc |
| p07 | novastarventures.com | "Novastar Ventures" venture capital | 1 | novastarventures.com | novastarventures.com | 2 | novastarventures.com |
| p08 | venturesplatform.com | "Ventures Platform" venture capital | 1 | venturesplatform.com | venturesplatform.com | 1 | venturesplatform.com |
| p09 | a91partners.com | "A91 Partners" venture capital | 1 | a91partners.com | a91partners.com | 1 | a91partners.com |
| p10 | endiya.com | "Endiya Partners" venture capital | 1 | endiya.com | endiya.com | 2 | endiya.com |
| p11 | seacef.org | "SEACEF" venture capital | 1 | seacef.org | seacef.org | 1 | seacef.org |
| p12 | sginnovate.com | "SGInnovate" venture capital | 1 | sginnovate.com | sginnovate.com | 1 | sginnovate.com |

Sitio del oro ausente de los 10 primeros de Exa: 0 de 12. Regla del paso 0 (≥ 4 de 12 → el límite es Exa): no.

## Resolución completa y aceptación en el sitio del oro (extractor v7, prompt v3, regla de cita sin cambios)

| Caso | Exa: resultado | Exa: oro aceptado | Serper: resultado | Serper: oro aceptado | URL del ancla: resultado | Ancla aceptada |
|---|---|---|---|---|---|---|
| p01 | accepted | sí | accepted | sí | accepted | sí |
| p02 | accepted | sí | accepted | sí | accepted | sí |
| p03 | accepted | sí | rejected:missing_literal_quote | no | rejected:missing_literal_quote | no |
| p04 | rejected:missing_literal_quote | no | rejected:missing_literal_quote | no | rejected:missing_literal_quote | no |
| p05 | accepted | sí | accepted | sí | accepted | sí |
| p06 | rejected:other | no | accepted | sí | accepted | sí |
| p07 | accepted | sí | accepted | sí | accepted | sí |
| p08 | rejected:missing_literal_quote | no | accepted | sí | rejected:missing_literal_quote | no |
| p09 | rejected:other | no | rejected:missing_literal_quote | no | rejected:missing_literal_quote | no |
| p10 | accepted | sí | accepted | sí | accepted | sí |
| p11 | accepted | sí | accepted | sí | accepted | sí |
| p12 | rejected:missing_literal_quote | no | accepted | sí | accepted | sí |

## Selección dentro del cupo K = 128 (diseño L128)

| Caso | Fuente de las páginas | Puesto del oro (por réplica o único) | Seleccionado |
|---|---|---|---|
| p01 | v8_replicas | 20/20/19 | sí |
| p02 | v8_replicas | 96/96/101 | sí |
| p03 | v8_replicas | 79/76/77 | sí |
| p04 | v8_replicas | —/70/— | no |
| p05 | v8_replicas | —/—/558 | no |
| p06 | v8_replicas | 27/27/29 | sí |
| p07 | diag_urls | — | no |
| p08 | diag_urls | 2 | sí |
| p09 | diag_urls | 100 | sí |
| p10 | diag_urls | 22 | sí |
| p11 | diag_urls | 67 | sí |
| p12 | diag_urls | — | no |

## Regla pre-registrada

| | p01–p06 | p07–p12 |
|---|---|---|
| Oro seleccionado (≤ K) | 4 | 4 |
| Seleccionado y aceptado, resolución por Exa | 3 | 2 |
| Seleccionado y aceptado, resolución por Serper | 3 | 3 |

Resultado: **NO-GO**. (GO condicional exige ≥ 4 de 6 en p01–p06 y ≥ 4 de 6 en p07–p12 con resolución por Serper; los diseños solo con Exa quedan en NO-GO por el cupo, ver V9-PREREGISTRO.md §2.)
