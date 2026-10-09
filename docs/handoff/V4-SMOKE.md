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

## Iteración 1 — resultados (2026-10-09 00:3x)

6/6 corridas válidas.

| Criterio | Umbral | Resultado | ¿Cumple? |
|---|---|---|---|
| Firmas con los 4 criterios núcleo ≠ unknown | ≥ 60 % | 11,4 % (4/35) | no |
| Citas literales | 100 % | 99,1 % (106/107) con verificación por tramos | no |
| D1 con gain ≥ 2 en B2 | ≥ 1 | 2 | sí |
| D2 con gain ≥ 2 en B2 | ≥ 1 | 2 | sí |
| D3 nulo | 0 gain ≥ 2 | **4 en B2** (falso positivo) | no |
| FETCH_EMPTY | ≤ 10 % | 0,5 % | sí |
| Rechazados / fetches | ≤ 0,75 | 0,81 | no |

### Causas medidas

1. **D3 da gain 2 a firmas sin mandato geográfico.** La causa es la regla `plausible` del spec ("etapa o geografía"): Stephen Industries, Archipelago Ventures, Impact Ventures e Investible tenían "early-stage" genérico, geografía `unknown` y sector `partial` (greentech/climate frente a fosfatos).
2. **La única cita no literal** venía del LLM de sector, que citó un tramo que cruzaba la unión entre dos citas distintas de la firma (Grey Silo Ventures).
3. **Geografía conocida solo en el 40 % de las firmas.** Muchas portadas no la publican, y los países fuera de la tabla (p. ej. "Australia") quedaban `unknown` en vez de `not_met`.

## Iteración 2 (V4-DBG-2)

1. `plausible` exige geografía `met`, o sector `on` + etapa explícita cuando la geografía es `unknown` (DECISIONS_PENDING #13).
2. La cita del LLM de sector debe caber en una sola cita de la firma.
3. Enriquecimiento: hasta 4 firmas por corrida a las que les falta etapa, geografía o tipo reciben una búsqueda `"<firma>" investment focus stage` y se abre una página propia más, dentro del mismo presupuesto.
4. Lista de países del mundo y alias en `normalization.v1`.
5. `v4_check` verifica por tramos ("…") contra el texto del lector y el del buscador.

**Re-juicio sin red de las corridas de la iteración 1 con las reglas 1, 2 y 4:**

| Caso | gain ≥ 2 en B2 | Resultado |
|---|---|---|
| D1 | 2 | — |
| D2 | 1 | — |
| D3 | 0 | se abstiene, pero con `insufficient_evidence` (firmas sin geografía publicada) |

## Iteración 2 — resultados (2026-10-09 00:4x)

6/6 corridas válidas.

| Criterio | Umbral | Resultado | ¿Cumple? |
|---|---|---|---|
| Firmas con los 4 criterios núcleo ≠ unknown | ≥ 60 % | 18,8 % (6/32) | no |
| Citas literales | 100 % | 100 % (109/109) | sí |
| D1 con gain ≥ 2 en B2 | ≥ 1 | 1 (Taram Capital) | sí |
| D2 con gain ≥ 2 en B2 | ≥ 1 | 0 | no |
| D3 nulo | 0 gain ≥ 2; abstención `no_candidates` o `all_hard_not_met` | 0 gain ≥ 2, pero `insufficient_evidence` | parcial |
| FETCH_EMPTY | ≤ 10 % | 0,5 % | sí |
| Rechazados / fetches | ≤ 0,75 | 0,793 | no |

### Causas medidas

1. **El LLM de sector pierde respuestas válidas.**
   * De 31 llamadas, 3 terminaron en `quote_not_literal`: el modelo quita los "…" de una evidencia con tramos (Industrifonden en D2/B2, Corfo y Impact Ventures).
   * 10 respuestas fueron `unknown`.
   * En D2/B2, Industrifonden pasó de `partial` (B1) a `unknown` por esta razón.
2. **EIT Food (D2/B2) es `plausible`, pero tiene gain 1** porque su actividad quedó `unknown`. Su única fuente es una nota de prensa en su propio dominio, y FIX-09 solo cuenta como tesis las fuentes `official`.
3. **D3 se abstiene por `insufficient_evidence`.** Las 5 firmas restantes no publican geografía (Stephen Industries, Archipelago, Investible "globally", Impact Ventures, One Planet): sin evidencia no pueden ser `not_met`. No hay corrección legítima: inventar `not_met` sería falso.
4. **Los 4 criterios a la vez solo se conocen en el 18,8 %.** La geografía se conoce en el 56 % y el sector en el 59 %. El enriquecimiento encontró una página propia útil en 4 de 10 intentos.

## Iteración 3 (V4-DBG-3, la última permitida)

1. La cita del LLM de sector se acepta si se descompone en ≤ 4 tramos literales consecutivos de una **misma** cita. Se guarda con " … " para que la verificación por tramos la compruebe. Cruzar dos citas distintas sigue prohibido.
2. Una nota de prensa en el dominio propio con lenguaje de inversión cuenta como tesis de primera parte (`possibly_active`).

**Re-juicio sin red de la iteración 2 con estos cambios:**

| Caso | B1 | B2 |
|---|---|---|
| D1 | 1 | 2 |
| D2 | 1 | 1 (EIT Food) |
| D3 | 0 | 0 (`insufficient_evidence`) |

## Iteración 3 — resultados (2026-10-09 00:5x)

6/6 corridas válidas.

| Criterio | Umbral | Resultado | ¿Cumple? |
|---|---|---|---|
| Firmas con los 4 criterios núcleo ≠ unknown | ≥ 60 % | 18,8 % | no |
| Citas literales | 100 % | 100 % (109/109) | sí |
| D1 con gain ≥ 2 en B2 | ≥ 1 | 2 | sí |
| D2 con gain ≥ 2 en B2 | ≥ 1 | 1 | sí |
| D3 nulo | 0 gain ≥ 2 | B2: 0 (`insufficient_evidence`); **B1: 1** (Elemental Impact) | no |
| FETCH_EMPTY | ≤ 10 % | 0,5 % | sí |
| Rechazados / fetches | ≤ 0,75 | 0,793 | no |

## Revisión manual 3.5 (D1/B2, D2/B2 y el falso positivo de D3/B1)

Las citas se compararon contra el texto guardado de cada página: todas existen literalmente (verificación automática 109/109). No pude abrir las URLs en vivo desde la sesión porque no tiene red.

**D1/B2**

| # | Firma | Estado | Veredicto |
|---|---|---|---|
| 1 | Taram Capital | gain 2 | **Correcta.** Fondo VC chileno; "Late Seed y Serie A", Chile/Latinoamérica. El sector `partial` (SaaS B2B frente a edtech) es razonable. |
| 2 | Early Stage Tech Fund (Corfo) | gain 2 | **Fallo.** La cita de identidad ("Early Stage Tech Fund - Corfo ### Early Stage Tech Fund") no muestra a nadie invirtiendo; la regex tomó el sustantivo "Fund" como verbo. Es un programa público de cofinanciamiento, no un inversor institucional que invierta directamente. |
| 3 | Nazca | gain 1 | Correcta (VC de Latinoamérica hispana). Sector desconocido, así que `weak`. |
| 4 | Prosus Ventures | gain 0 | Exclusión correcta (Series A ≠ seed). |
| 5 | Futura Fund | gain 0 | Exclusión correcta: la página dice "It is not traditional venture capital". |

**D2/B2**

| # | Firma | Estado | Veredicto |
|---|---|---|---|
| 1 | EIT Food | gain 2 | **Fallo.** La cita habla de otros inversores (Newtree Impact, Beyond Impact) en una noticia del dominio de EIT Food. Ni la identidad ni la etapa son de EIT Food. |
| 2 | Industrifonden | gain 1 | Hechos correctos (VC sueco, Series A, Estocolmo). Sector `unknown`, así que `weak`. |
| 3 | Purple Orange Ventures | gain 1 | Hechos correctos (alt-protein, early-stage, global). |
| 4 | Beiersdorf VC | gain 0 | Exclusión correcta (CVC fuera de los tipos aceptados). |

**D3/B1**

| Firma | Estado | Veredicto |
|---|---|---|
| Elemental Impact | gain 2 | **Fallo.** Geografía "California, US, Nevada": "California" no está en la tabla y volvía vaga toda la lista, aunque "US" ≠ Nauru. |

## V4-DBG-4 (fuera del límite de 3 iteraciones; requiere aprobación de la usuaria para correrlo)

1. "Fund" sustantivo no es evidencia de inversión; sí lo son "we/that/to fund", "funds" y "funded". Se añadió "led/co-led" activo. Las pasivas ("backed by X", "led by X") ya no se atribuyen a la startup.
2. Si la cita literal del modelo no muestra a la firma invirtiendo, se busca otra en la página.
3. En una noticia, aunque esté en el dominio propio, la cita debe nombrar a la firma.
4. Un país reconocido decide la geografía aunque haya subdivisiones no reconocidas ("California, US" → US).

## Iteración 4 — resultados del smoke con el código DBG-4 (`e81d1ad`), 2026-10-09 ~09:5x, Mac de la usuaria

Corrida aprobada por la usuaria el 2026-10-09 como verificación previa al congelamiento (`ITER=dbg4`, caché copiada de `smoke-dbg3`). Preflight del lector: `passed` (Crawl4AI ok, Jina no). 6/6 corridas válidas. Salida: `research/bench/investors/out/debug-v4-2026-10-09/smoke-dbg4/`.

| Criterio (§3.4) | Umbral | DBG-3 | DBG-4 | ¿Cumple? |
|---|---|---|---|---|
| Firmas con SECTOR/STAGE/GEO/TYPE ≠ unknown | ≥ 60 % | 18,8 % (6/32) | 20,0 % (7/35) | no |
| Al menos uno ≠ unknown | (≥ 85 % en §5.3) | 100 % | 100 % | sí |
| Citas literales verificadas | 100 % | 100 % (109/109) | 100 % (117/117) | sí |
| D1 con ≥ 1 gain ≥ 2 en B2 | ≥ 1 | 2 | 1 (Taram Capital) | sí |
| D2 con ≥ 1 gain ≥ 2 en B2 | ≥ 1 | 1 (EIT Food, falso) | **0** (`insufficient_evidence`) | **no** |
| D3: 0 gain ≥ 2 | 0 | B1: 1 (Elemental Impact) | B1: 0 · B2: 0 | sí |
| D3: abstención `no_candidates`/`all_hard_not_met` | ambas | B2 `insufficient_evidence` | B1 `all_hard_not_met` · B2 `insufficient_evidence` | no (1/2) |
| FETCH_EMPTY | ≤ 10 % | 0,5 % | 1,0 % | sí |
| Rechazados / fetches | ≤ 0,75 | 0,793 | 0,789 | no |

Por corrida (entidades · gain ≥ 2 · parada · búsquedas/fetches · tokens):

* D1/B1: 4 · 1 (Taram Capital) · `queries_exhausted` · 13/28 · 93.598
* D1/B2: 7 · 1 (Taram Capital) · `no_more_actions` · 13/28 · 101.556. Corfo "Early Stage Tech Fund" baja a gain 1 (sector `unknown`).
* D2/B1: 5 · 1 (Be8 Ventures: sector `partial`, geografía "Europe, Israel, North America" `met`, etapa `unknown`) · `queries_exhausted` · 15/30 · 119.461
* D2/B2: 3 · 0 · `no_more_actions` · 14/30 · 120.343. EIT Food ya no es entidad; Industrifonden (sector `unknown`) y Purple Orange (geografía `unknown`) quedan `weak`. Be8 no aparece en B2.
* D3/B1: 3 · 0 · `all_hard_not_met` (geografía `not_met` en las 3) · 12/26 · 94.114
* D3/B2: 13 · 0 · `insufficient_evidence` · `budget_searches` · 18/52 · 170.635. Cinco firmas `weak` con geografía `unknown`.

Lectura: DBG-4 eliminó los 3 fallos de la revisión manual (Corfo, EIT Food, Elemental Impact), pero con ello D2/B2 se queda sin gain ≥ 2. El gate §3.4 sigue sin cumplirse en 4 criterios (núcleo 20 %, D2/B2, abstención D3/B2, rechazados 0,789). No se cambió código ni umbral. Revisión manual: las citas se verificaron contra el texto en caché (117/117); no se abrieron las URLs en vivo. La cita de identidad de Be8 ("Lisa is an Investment Analyst at Be8 Ventures…") no muestra inversión por sí sola; la de tipo ("Venture capital fund investing in and building food companies…") sí.
