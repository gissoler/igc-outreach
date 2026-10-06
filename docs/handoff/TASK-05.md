# TASK-05 · Señales, paciencia, gaps y logger

## Objetivo
Señales de progreso **independientes del judge**, la regla de paciencia, los vacíos documentales y un log validado.

## Archivos
- Crear `research/agent/signals.mjs`, `research/agent/gaps.mjs` y `research/agent/logger.mjs`.
- Crear `research/tests/agent/loop.test.mjs` (de momento solo ACC-11) y `research/tests/agent/logger.test.mjs`.

## Contratos que usa
`log_entry` (incluidos `$defs/signals` y `budgetUsed`) y `planner_input#/properties/gaps`.

## Especificación
- **`signals.mjs`:**
  - `createPatience(n)` → `{afterSearch(newOfficialCount)` (devuelve el contador)`, afterExtraFetches(newOfficialCount), value, exhausted}`. Regla de ARCHITECTURE §7.3.
  - `searchSignals({resultsNormUrls, seenBefore:Set, fetchResults, registryDelta, registry, catalog, patienceValue})` → objeto `signals`. Definiciones exactas en ARCHITECTURE §7.1.
  - `criteria_unknown` = número de gaps `criterion_missing` **sin** el tope de 40.
- **`gaps.mjs`:** `computeGaps(registry, catalog)` → `gaps[]`, con tipos, `gap_id`, orden y tope según ARCHITECTURE §7.2.
  - La mención está resuelta si su `identifier_text` normalizado está en las claves de alguna entidad, o si sus nombres se contienen como palabras en cualquier dirección (`(' '+a+' ').includes(' '+b+' ')` sobre `norm()`) y el más corto tiene ≥ 2 palabras.
  - Las entidades se exponen como `o${order+1}`.
- **`logger.mjs`:** `createRunLogger({dir, header:{run_id, case_id, condition, seed, versions}})` → `{log(kind, step, data, {tokens, latency, errors, budget_used})}`.
  - Completa `seq` y `ts` (con `clock`, inyectable).
  - Valida con `validate('log_entry', …)` **antes** de añadir la línea a `steps.jsonl`.
  - `tokens` y `latency` por defecto en cero.
  - `versions` se puede actualizar con `logger.setVersions(v)` (el `model_id` se conoce tras la primera llamada). Hasta entonces, `model_id = 'pending'`.

## Criterios de aceptación
ACC-11 y ACC-17. ACC-12 se activa en TASK-12, pero `computeGaps` ya debe existir aquí.

## No tocar
No se importa nada de `eligibility_judge.mjs`. Un test estático lo comprueba: `signals.mjs` y `gaps.mjs` no contienen las cadenas `judge`, `judgment` ni `eligibility_class`.
