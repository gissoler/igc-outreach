# AGENTS.md — instrucciones para agentes de código (Codex)

Este repositorio (`igc-outreach`) contiene el prototipo de Outreach y, desde el 06/10/2026, el **agente de búsqueda iterativo v0**: un harness exploratorio para comparar búsqueda estática y adaptativa sobre oportunidades ancla conocidas. Tu trabajo es implementar las tareas de `docs/handoff/`, una por PR, sin interpretar: lo que no esté especificado se pregunta en el PR y no se decide.

## Lectura obligatoria antes de tocar código
1. `docs/ARCHITECTURE.md`: módulos, flujo, reglas y algoritmos exactos.
2. `docs/contracts/README.md` y los schemas de `docs/contracts/`. **Son la fuente de verdad.**
3. `docs/handoff/ACCEPTANCE.md`: la condición de terminado.
4. La `docs/handoff/TASK-0X.md` que vas a implementar.
5. `docs/handoff/REVIEW.md`: con esto se revisa tu PR.

## Stack
- **Node ≥ 22.13**, ESM (`.mjs`), sin TypeScript ni bundler. `node:sqlite` para la caché y `node:test` + `node:assert/strict` para los tests.
- **Dependencias nuevas permitidas:** solo `ajv@^8` y `ajv-formats@^3`, en `research/package.json`.
- Frontend (`frontend/`, React + Vite) y backend Python (`backend/`, FastAPI): **fuera de alcance**.

## Comandos
```bash
npm --prefix research install
npm --prefix research run test:agent      # tests del agente (node --test tests/agent/*.test.mjs)
npm --prefix research test                # suite existente: línea base 415 pass, 1 fail preexistente, 1 skip
node research/bench/cli.mjs validate --config research/bench/config/v0.json --cases research/bench/cases
node research/bench/cli.mjs run --config <cfg> --case <case.json> --condition B0|B1|B2 --seed 101
```
Para construir el frontend, que no forma parte de estas tareas: `npm --prefix frontend run build`.

## Estructura
```
AGENTS.md                      ← este archivo
docs/ARCHITECTURE.md           ← diseño (no editar)
docs/BENCHMARK_PROTOCOL.md     ← pre-registro del benchmark (no editar)
docs/benchmark/LABELING_GUIDE.md
docs/contracts/                ← JSON Schemas, catálogo y ejemplos (no editar)
docs/handoff/                  ← README, ACCEPTANCE, TASK-01…13, REVIEW
prompts/                       ← prompts versionados + manifest con sha256 (no editar)
research/
  agent/                       ← código nuevo del agente (lo creas tú)
    config/official_domains.v1.json   (no editar; lo cambia una persona en H3)
  bench/                       ← harness (lo creas tú); config/v0.json (no editar; H5)
    cases/                     ← casos del benchmark (los crean personas)
    out/                       ← salidas; está en .gitignore
  tests/agent/                 ← tests nuevos
    fixtures/world-v1/         ← mundo offline (no editar)
  server/                      ← pipeline de producción: NO TOCAR salvo lo indicado en TASK-02 sobre fleet.mjs
  tests/*.test.mjs             ← suite existente: NO TOCAR
frontend/ backend/ deploy/     ← fuera de alcance
```

## Convenciones
- Funciones puras siempre que se pueda; red, disco y reloj se inyectan por `deps`.
- Una función por responsabilidad y nombres del documento de arquitectura **exactos**.
- Todo objeto que cruza un límite se valida con `validate(name, obj)` de `research/agent/contracts.mjs`.
- Errores con `code` del enum `common.errorCode`.
- Fechas de lógica **solo** desde `run_config.today`. Nunca `new Date()` ni `Date.now()` en lógica.
- Los tests nombran el ACC que cubren al inicio del título: `test('ACC-11 …')`.
- Commits: `TASK-0X: <qué>`. Un PR por tarea.

## Reglas (no negociables)
1. **No modifiques** `docs/contracts/**`, `prompts/**`, `research/tests/agent/fixtures/**`, `docs/ARCHITECTURE.md` ni `docs/BENCHMARK_PROTOCOL.md`. Si crees que están mal, explícalo en el PR y detente.
2. **No decidas nada ambiguo.** Si algo no está en un contrato ni en la TASK, pregúntalo en el PR.
3. **Prompts:** se cargan con `loadPrompt` y no se copian al código. Su sha256 se verifica en cada carga.
4. **Circularidad prohibida:** ni el planner, ni las señales, ni la parada pueden leer nada producido por `eligibility_judge`. El judge corre después del discovery.
5. **`unknown` nunca se convierte en `met`.** Los estados de criterio solo cambian dentro de `applyRules`.
6. **Mismas condiciones:** B0, B1 y B2 comparten modelo, buscador, topes, N, temperatura del extractor y del judge y política de descarga por defecto. Ninguna rama por condición cambia esto.
7. **Sin red en tests.** Todo test usa el mundo fixture.
8. **Sin defaults inventados** en perfiles, por ejemplo «for-profit» o «US».
9. **No toques el pipeline de producción** ni la suite existente. La línea base de `npm --prefix research test` no puede empeorar.
10. **Pasos humanos:** elegir casos, adjudicar, validar el catálogo, congelar la config, autorizar gasto y leer fallos los hacen personas (H1–H9 en `docs/BENCHMARK_PROTOCOL.md` §9). No los simules ni los automatices.
