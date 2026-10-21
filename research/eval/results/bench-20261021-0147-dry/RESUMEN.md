# Banco nocturno bench-20261021-0147-dry (SIMULACIÓN --dry: no mide calidad)

Casos: 3 · correctos: 2 · fallidos: 1 · tiempo total: 0 s

## Tiempo por etapa (segundos)

| Caso | Estado | Búsqueda GPTR | Juez | Motor total | Contact Finder | Evaluador | Corrida total |
|---|---|---|---|---|---|---|---|
| g1-mint-ad | ok | 0 | 0 | — | — | — | 0 |
| g3-ngo-latam | **failed** | — | — | — | — | — | 0 |
| i1-mint-ad | ok | 0 | 0 | — | — | — | 0 |

## Qué leyó y qué encontró

| Caso | URLs de GPTR | Del registro oficial | Abiertas | Leídas por el modelo | Verificados | A revisar | Act now | Watch | Ruled out | Créditos Apollo | Personas Apollo |
|---|---|---|---|---|---|---|---|---|---|---|---|
| g1-mint-ad | 150 | 2 | 152 | 42 | 0 | 2 | 0 | 2 | 0 | 0 | 0 |
| g3-ngo-latam | — | — | — | — | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| i1-mint-ad | 1 | 0 | — | — | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## MINT AD: cobertura contra la lista de Gemini

| Convocatoria | ¿Apareció? | Lista | Cierre hallado | Cierre esperado | Verificada |
|---|---|---|---|---|---|
| NIH SBIR parent PA-27-100 (cierres 5-ene-2027 y 5-abr-2027) | sí | radar | 2027-01-05 | 2027-01-05 | no |
| NSF SBIR (cierre 4-nov-2026) | sí | radar | 2026-11-04 | 2026-11-04 | no |
| TEDCO Maryland Innovation Initiative, RFA (cierre 15-oct-2026) | **no** | — | — | 2026-10-15 | no |
| MIPS (cierre 15-oct-2026) | **no** | — | — | 2026-10-15 | no |

Cobertura: 2/4.

## Lo mejor de cada caso

### g1-mint-ad — brief del jefe: cobertura contra la lista de Gemini
- · PA-27-100 · NIH SBIR omnibus parent solicitation (fixture record) (cierre 2027-01-05) — radar · 1 contactos — https://simpler.grants.gov/opportunity/00000000-0000-4000-8000-0000000a0100
- · NSF-SBIR-PHASE-I-FIXTURE · NSF SBIR Phase I (fixture record) (cierre 2026-11-04) — radar — https://simpler.grants.gov/opportunity/00000000-0000-4000-8000-0000000b0200

### g3-ngo-latam — ONG en Colombia: no debe usar el registro de EE. UU. ni traer convocatorias solo-EE. UU.
Sin candidatos.

### i1-mint-ad — brief del jefe, objetivo inversión (seed, salud digital, Maryland)
Sin candidatos.

## Errores y avisos

**g3-ngo-latam**
- ERROR: Error: fallo simulado en g3-ngo-latam (BENCH_DRY_FAIL): el banco debe seguir con los demás |     at runDry (file:///sessions/rcw-01fzhjqfnnsajxdsn96ruonj/mnt/AGENT/research/scripts/bench-overnight.mjs:102:50) |     at runCase (file:///sessions/rcw-01fzhjqfnnsajxdsn96ruonj/mnt/AGENT/research/scripts/bench-overnight.mjs:126:41)

Trazas por caso: `<caso>/gptr.log`, `<caso>/gptr-raw-*.log` (log crudo de GPT Researcher), `<caso>/gptr-seeds-*.json` (qué fue al juez y por qué), `<caso>/*-gptr-*/events.jsonl`, `<caso>/job.json`, `<caso>/result.json`.
