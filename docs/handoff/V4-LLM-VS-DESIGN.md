# Fase 1.5 — prueba LLM vs diseño

Script: `research/bench/investors/analysis/llm_vs_design.mjs`. Datos: `V4-LLM-VS-DESIGN.json`.

**Muestra.** 20 páginas distintas, descargadas en v3, de firmas con etiqueta positiva (`investorGain(label) ≥ 2` en `gold/v3/labels/adjudicator.jsonl`). Tomé la URL más corta de cada firma cuyo host es el dominio de la firma y que tenga ≥ 200 caracteres en caché, en round-robin por caso (11 casos). La selección es determinista y no depende de mi juicio.

## (b) gpt-oss-120b, extractor actual (prompt `extractor v1`, schema `investor_extraction`)

Usé la salida cruda guardada en `cache.sqlite` de v3 (temperatura 0, misma clave de caché que `external.mjs`): 20/20 aciertos. No hubo llamadas nuevas.

| Medida | Valor |
|---|---|
| INV-SECTOR/STAGE/GEO/TYPE ≠ `unknown` (80 criterios) | **0 %** |
| Los 12 criterios ≠ `unknown` | 8,8 % (solo PORTFOLIO-CONFLICT, por regla del juez) |
| Campos de hecho llenos (12 campos × 20 páginas) | 0,4 % (1 `active_status`) |
| Páginas donde el texto sí nombra una etapa / un tipo de inversor (regex conservadora) | 17/20 · 18/20 |
| Aceptadas por el gate v1 | 18/20 |
| gain ≥ 2 | 0/20 |

En las 20 páginas el modelo devolvió exactamente `{entity_kind, canonical_name, aliases, source_kind, canonical_url, contradictions}` (más `active_status` en 1). Son las 3 claves obligatorias y 3 opcionales; ninguna clave de hechos.

## (c) Modelo más fuerte, mismo prompt y schema — NO EJECUTADO

No hay en esta sesión ninguna clave ni endpoint de un modelo más fuerte (`.env` no contiene claves de OpenAI, Anthropic ni OpenRouter). El script lo soporta con `--strong` y un tope de gasto `--cap-usd 5`.

## (d) Decodificación guiada estricta del servidor — EJECUTADO en el Mac de la usuaria (2026-10-08 23:26)

Servidor `openai/gpt-oss-120b`, `response_format: json_schema` con `strict:true`. Resultado: 4/4 sondas salen conformes aunque el prompt pedía violar el schema.

* `enum_violation` → `"institutional_investor"`.
* `extra_key` → la clave extra quedó cortada (`"X,"`).
* `missing_required` → se emitieron las dos claves obligatorias.
* `maxlength` → 20 caracteres.

**El servidor impone el schema durante la generación.**

## Lectura (actualizada con d)

El modelo no omite al azar: siempre devuelve el mínimo que el schema exige, aunque la página tenga los datos. Eso es compatible con dos causas que (b) solo no separa:

1. Prompt y schema: los hechos son opcionales y el prompt dice "use null or unknown".
2. El modelo.

(c) separa estas dos. (d) dice si poner los campos como obligatorios en el schema (FIX-01) basta para forzarlos o si depende solo del prompt.

**Con (d):** la gramática del servidor permite omitir toda clave no obligatoria, y el schema v1 solo exige 3. El objeto mínimo es una salida válida que el prompt v1 ("use null or unknown when absent") empuja a elegir. Es decir, la omisión la permite y la favorece el diseño (schema + prompt). No queda probado que el modelo sea incapaz.

Lo que sigue sin medirse es si gpt-oss-120b llena los valores, y no solo las claves, cuando el schema las exige (FIX-01) y el prompt las pide con cita (FIX-02). Esa es la prueba que separa modelo de diseño sin gastar en otro modelo.

## (c') Mismo gpt-oss-120b con el diseño v4 — EJECUTADO en el Mac (2026-10-08 23:5x)

Schema `investor_extraction.v2` y prompt `extractor v3`, literales del spec y sin ajustes, sobre las mismas 20 páginas. Medición única.

| | v1 (b) | v4 (c') |
|---|---|---|
| Páginas con el campo lleno por el modelo: tipo / sector / etapa / geo / cita / dominio | 0 / 0 / 0 / 0 / 0 / 0 | 18 / 20 / 18 / 19 / 20 / 20 |
| Campo conservado tras el anclaje literal: tipo / sector / etapa / geo | — | 10 / 11 / 6 / 5 |
| Aceptadas por el gate | 18 (v1) | 13 (v2) |
| SECTOR/STAGE/GEO/TYPE ≠ unknown (80 criterios) | 0 % | 33,8 % |
| gain ≥ 2 | 0/20 | 1/20 |
| Errores de decodificación | — | 0 |
| Tokens medios por extracción | ≈ 2,15k | 4,09k |

**Conclusión: la causa era el diseño (schema y prompt), no el modelo.** Con el mismo modelo, los campos pasan de 0/20 a 18–20/20. No se propone cambiar de modelo.

**Pérdida nueva, aún no explicada: el anclaje literal.** Se pierden etapa (18 → 6) y geografía (19 → 5), y el gate v2 rechaza 7/20. No inspecciono el contenido de estas 20 páginas del gold para no depurar con él. La causa se mide en D1–D3 con `fields_dropped_by_grounding` (evento `extract_end`) y `rejected_kind`.

**Los tokens por extracción casi se duplican.** Se espera ≈ 4,1k frente a los 2,8k que estimaba el spec. Hay que revisar el presupuesto de tokens antes de la corrida formal.
