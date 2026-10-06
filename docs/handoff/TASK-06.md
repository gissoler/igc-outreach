# TASK-06 · eligibility_judge y ranking

## Objetivo
Juicio por criterio con cinco estados y reglas en código, y orden final determinista.

## Archivos
- Crear `research/agent/eligibility_judge.mjs` y `research/agent/ranking.mjs`.
- Crear `research/tests/agent/judge.test.mjs`.

## Contratos que usa
`judge_output`, `judgment`, `criterion`, el catálogo y `profile`.

## Especificación
- `selectForJudging(entities, max)` sigue ARCHITECTURE §6.1.
- `judgeEntity({entity, evidence, docs, profile, catalog, llm, prompt, today, config})`:
  - Arma los placeholders de `prompts/README.md`. El tope de evidencia es `config.judge.max_evidence_per_opportunity`, en el orden de §6.2.
  - Llama al LLM con `{temperature:0, seed:0, schemaName:'judge_output', meta:{stable_id, profile_id}}`.
  - Aplica `applyRules` y luego `aggregate`, y devuelve un `Judgment` validado.
- `applyRules(raw, {entity, entityEvidenceIds:Set, hasOfficialCallDoc, profile, catalogById, reqCriteria, today, route})`: reglas R5, R6, R7, R1, R2, R3, R4a y R4b, en ese orden, con los nombres exactos de override del schema. Los criterios `code` se resuelven con `codeEval(criterionId, {validity, today, profile, route})`.
- `aggregate(criteria, route)`: ARCHITECTURE §6.4. `soft_score` se redondea a 4 decimales.
- `ranking.mjs`: `sortKey(entity, judgment)` y `rank(entities, judgments)`, según ARCHITECTURE §8. Los criterios no juzgados reciben los valores indicados allí.

## Criterios de aceptación
ACC-14, ACC-14p, ACC-15 y ACC-16.

## No tocar
`server/analysis/eligibility.mjs` y `server/research/applicant.mjs`: no se usan aquí.
