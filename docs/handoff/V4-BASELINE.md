# V4 — Línea base de pruebas (Fase 0)

Fecha: 2026-10-08/09. Entorno: VM Linux de la sesión (no el macOS de la usuaria), Node 22.23.2, `HTTPS_PROXY=http://127.0.0.1:9`.

| Momento | `npm test` | `npm run test:agent` | `npm run test:investors` |
|---|---|---|---|
| 0.1 `main@ad5ac6f` + trabajo sin commit | 427 pass · 0 fail · 1 skip (428) | 84 pass · 1 fail (85) | 19/19 |
| 0.5 tras C0–C2 + ajuste de apollo.test | 427 pass · 0 fail · 1 skip (428) | 86 pass · 1 fail (87) | 21/21 |

Diferencias con la referencia documentada (415 pass, 1 fail `UW-Madison I-Corps…`, 1 skip):

* `npm test`: el fallo `UW-Madison I-Corps…` no aparece en este entorno; hay 12 pruebas más (capital/Apollo).
* `test:agent` — `ACC-58 CLI fixture timing is deterministic` falla por entorno: la prueba fija `GIT_BINARY=/Library/Developer/CommandLineTools/usr/bin/git` (ruta de macOS) y la VM Linux no la tiene (`spawnSync … ENOENT`). Falla igual antes y después; no es regresión. No verificable aquí si pasa en el Mac.
* `test:investors`: el spec esperaba 20/20; el archivo del snapshot tiene 21 pruebas y pasan las 21.
* Tras C2, `apollo.test.mjs › B0/B1/B2 code cannot import Apollo…` fallaba: la prueba (escrita antes del arnés B3) buscaba el texto "apollo"/"capital/" en todo `bench/`, y el arnés B3 del snapshot (`run-experiment.mjs`, `preflight-chain.mjs`) importa Apollo a propósito; los scripts de análisis solo mencionan el campo `capital_strategy_context`. Se acotó a sentencias `import` y se añadió la aserción de que el arnés solo instancia Apollo cuando `condition === 'B3'`. El fallo existía igual en el snapshot.

FIX-00.T2 (`research/bench/investors/replay-v3.mjs`, 10 primeras corridas v3 por `sort()`): igualdad exacta de `judgments` y `ranked` en 10/10.
