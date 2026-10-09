# V4 — Smoke D1–D3 (semilla 101, B1 y B2)

## Iteración 0 (config v4 draft, commit 0ee2e3a) — 2026-10-09 00:2x, Mac de la usuaria

El lector fue Crawl4AI local (Jina respondió 402, sin saldo). 5 corridas válidas y 1 fallida (`D1/B2`).

| Criterio (§3.4) | Umbral | Resultado | ¿Cumple? |
|---|---|---|---|
| Firmas con SECTOR/STAGE/GEO/TYPE ≠ unknown | ≥ 60 % | 9,5 % (2/21) | no |
| Citas literales verificadas | 100 % | 100 % (58/58) | sí |
| D1 y D2 con ≥ 1 gain ≥ 2 en B2 | ≥ 1 | 0 (D1/B2 falló; D2/B2 = 0) | no |
| D3: 0 gain ≥ 2 y abstención `no_candidates` o `all_hard_not_met` | — | 0 gain ≥ 2, pero `insufficient_evidence` | no |
| FETCH_EMPTY | ≤ 10 % | 0,7 % | sí |
| rechazados / fetches | ≤ 0,75 | 0,841 | no |

### Causas medidas (eventos y caché de esta carpeta)

1. **Actividad `unknown` en casi todas las firmas**, lo que impide el gain 2. En 13 de 21 portadas propias el modelo puso `source_kind=other`, y FIX-09 solo cuenta fuentes `official`. Ejemplos: Taram Capital, Chalmers Ventures, Investible, Impact Ventures.
2. **Entidades creadas desde páginas de terceros con hechos de la ronda.** Aqua-Spark se creó desde enifer.com con "Series A" y "Netherlands", que son datos de la startup.
3. **Citas unidas con "…".** De la evidencia que el modelo dio pero el anclaje no encontró literal, la mayoría une varios pasajes literales con "...": geografía 29, sector 18, tipo 12 y etapa 11 no literales.
4. **Candidatos: 246 propuestos → 38 verificados.** 90 citas no aparecen tal cual (elisiones) y 87 no se atribuyen. Las listas de participación ("with participation from X", "investors include X", "backing came from X") no estaban reconocidas.
5. **Páginas en español (D1) fuera de las regex.** Faltaba "invierte", "fondo de venture capital", "Serie A", "Perú", "México".
6. **`D1/B2` falló por JSON truncado.** La página-lista de shizune.co tenía 56k caracteres y la salida pasó de 3000 tokens. Un fallo del modelo tumbaba la corrida entera.

## Iteración 1 (V4-DBG-1)

Cambios, uno por causa:

1. El host decide la primera parte: la portada propia pasa a `official`.
2. Una página de terceros nunca crea la entidad; la firma pasa a candidato y se verifica en su sitio (FIX-05).
3. La evidencia con "…" vale solo si cada tramo es literal.
4. Atribución por listas de participación, también en español.
5. Patrones de inversión en español/portugués; "serie"/"semilla" en etapas; alias y acentos de países.
6. `extractor_max_tokens` = 6000, y una salida inválida del modelo rechaza la página en vez de tumbar la corrida.

Ningún umbral cambió.
