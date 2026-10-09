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

## (d) Decodificación guiada estricta del servidor — NO EJECUTADO

El servidor de la flota (`147.185.41.229:8016`) no es alcanzable desde la VM de la sesión ni desde la nube (allowlist de red). El script lo soporta con `--guided`: hace 4 sondas (enum inválido, clave extra, falta un campo obligatorio, `maxLength`) con `strict:true`.

## Lectura provisional

El modelo no omite al azar: siempre devuelve el mínimo que el schema exige, aunque la página tenga los datos. Eso es compatible con dos causas que (b) solo no separa:

1. Prompt y schema: los hechos son opcionales y el prompt dice "use null or unknown".
2. El modelo.

(c) separa estas dos. (d) dice si poner los campos como obligatorios en el schema (FIX-01) basta para forzarlos o si depende solo del prompt.
