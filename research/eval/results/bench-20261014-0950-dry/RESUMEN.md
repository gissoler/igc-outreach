# Banco nocturno bench-20261014-0950-dry (SIMULACIÓN --dry: no mide calidad)

Casos: 6 · correctos: 6 · fallidos: 0 · tiempo total: 0 s

## Tiempo por etapa (segundos)

| Caso | Estado | Búsqueda GPTR | Juez | Motor total | Contact Finder | Evaluador | Corrida total |
|---|---|---|---|---|---|---|---|
| g1-mint-ad | ok | 0 | 0 | — | — | — | 0 |
| g2-aha-nonprofit | ok | 0 | 0 | — | — | — | 0 |
| g3-ngo-latam | ok | 0 | 0 | — | — | — | 0 |
| i1-mint-ad | ok | 0 | 0 | — | — | — | 0 |
| i2-aha-commercial | ok | 0 | 0 | — | — | — | 0 |
| i3-medtech-eu | ok | 0 | 0 | — | — | — | 0 |

## Qué leyó y qué encontró

| Caso | URLs de GPTR | Del registro oficial | Abiertas | Leídas por el modelo | Verificados | A revisar | Act now | Watch | Ruled out | Créditos Apollo | Personas Apollo |
|---|---|---|---|---|---|---|---|---|---|---|---|
| g1-mint-ad | 150 | 2 | 152 | 42 | 4 | 0 | 1 | 3 | 0 | 0 | 0 |
| g2-aha-nonprofit | 0 | 0 | — | — | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| g3-ngo-latam | 0 | 0 | — | — | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| i1-mint-ad | 1 | 0 | — | — | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| i2-aha-commercial | 1 | 0 | — | — | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| i3-medtech-eu | 1 | 0 | — | — | 1 | 0 | 1 | 0 | 0 | 0 | 0 |

## MINT AD: cobertura contra la lista de Gemini

| Convocatoria | ¿Apareció? | Lista | Cierre hallado | Cierre esperado | Verificada |
|---|---|---|---|---|---|
| NIH SBIR parent PA-27-100 (cierres 5-ene-2027 y 5-abr-2027) | sí | top | 2027-01-05 | 2027-01-05 | sí |
| NSF SBIR (cierre 4-nov-2026) | sí | radar | 2026-11-04 | 2026-11-04 | sí |
| TEDCO Maryland Innovation Initiative, RFA (cierre 15-oct-2026) | sí | radar | 2026-10-15 | 2026-10-15 | sí |
| MIPS (cierre 15-oct-2026) | sí | radar | 2026-10-15 | 2026-10-15 | sí |

Cobertura: 4/4.

## Lo mejor de cada caso

### g1-mint-ad — brief del jefe: cobertura contra la lista de Gemini
- ✔ PA-27-100 · NIH SBIR omnibus parent solicitation (fixture record) (cierre 2027-01-05) — top · 1 contactos — https://simpler.grants.gov/opportunity/00000000-0000-4000-8000-0000000a0100
- ✔ Maryland Industrial Partnerships (MIPS): request for proposals. (cierre 2026-10-15) — radar — https://example.test/fixture-mips-rfp
- ✔ TEDCO Maryland Innovation (cierre 2026-10-15) — radar — https://www.tedcomd.com/sites/default/files/2026-01/MII%20Company%20Formation-RFA_FY2026_v4.pdf
- ✔ NSF-SBIR-PHASE-I-FIXTURE · NSF SBIR Phase I (fixture record) (cierre 2026-11-04) — radar — https://simpler.grants.gov/opportunity/00000000-0000-4000-8000-0000000b0200

### g2-aha-nonprofit — ONG de EE. UU.: elegibilidad por tipo de entidad y registro federal
Sin candidatos.

### g3-ngo-latam — ONG en Colombia: no debe usar el registro de EE. UU. ni traer convocatorias solo-EE. UU.
Sin candidatos.

### i1-mint-ad — brief del jefe, objetivo inversión (seed, salud digital, Maryland)
- ✔ Fixture Ventures invests in seed-stage digital health and medical technology companies in the United States and Europe. — top — https://example.test/fixture-fund

### i2-aha-commercial — empresa de EE. UU., datos de salud / IA
- ✔ Fixture Ventures invests in seed-stage digital health and medical technology companies in the United States and Europe. — top — https://example.test/fixture-fund

### i3-medtech-eu — startup en España: inversores europeos
- ✔ Fixture Ventures invests in seed-stage digital health and medical technology companies in the United States and Europe. — top — https://example.test/fixture-fund

## Errores y avisos

**g2-aha-nonprofit**
- GPTR_NO_URLS

**g3-ngo-latam**
- GPTR_NO_URLS

Trazas por caso: `<caso>/gptr.log`, `<caso>/gptr-raw-*.log` (log crudo de GPT Researcher), `<caso>/gptr-seeds-*.json` (qué fue al juez y por qué), `<caso>/*-gptr-*/events.jsonl`, `<caso>/job.json`, `<caso>/result.json`.
