# Briefs de prueba

Cada `.json` es el brief completo (campo `_about` = qué prueba y qué debe pasar). Para probar desde la app, pega el texto de abajo en el chat del prerregistro; para el motor web solo: `node --env-file-if-exists=.env scripts/engine-run.mjs --brief eval/briefs/<archivo>.json`.

| Archivo | Qué prueba | Texto para el chat |
|---|---|---|
| `aha-nonprofit.json` | Entidad sin fines de lucro, infraestructura de datos. CogNeuro NO debe salir; NSF 26-512 y NIA sí | «We are AHA, a non-profit open-science initiative building AI harmonization of Alzheimer's datasets (MMSE vs MoCA crosswalks) and researcher matching in the AD Workbench. We need about $350k over 24 months in grants, no equity.» |
| `aha-commercial.json` | Misma tecnología pero empresa con fines de lucro: debe cambiar la elegibilidad (SBIR sí, solo-ONG no) | «AHA Labs Inc. is a US for-profit company selling an AI harmonization layer for multi-cohort Alzheimer's datasets to pharma and CROs. Seed stage, looking for ~$500k in grants and investment.» |
| `ngo-latam-health.json` | ONG en Colombia, sin entidad en EE. UU.: restricción por país | «Fundación Salud Rural is a Colombian nonprofit with no US or EU entity. We train community health workers and run telehealth for rural maternal care. We want a $150k grant to scale from 3 to 12 municipalities.» |
| `medtech-eu-forprofit.json` | Startup UE con dos objetivos (grant + inversión) | «CardioLoop is a Spanish medtech startup building a wearable ECG patch with AI arrhythmia detection. Seed round of about €1.2M; interested in EU grants and investors.» |
| `university-climate.json` | Entidad académica, investigación | «We are a university research group in the Netherlands doing ML downscaling of climate projections for coastal flood risk. We want a research grant of about €600k over 36 months.» |
| `energy-hardware-debt.json` | Objetivos que no son grant (deuda, patrocinio) | «VoltCell is a US startup repurposing used EV batteries into storage for small businesses. We want asset-backed debt and sponsorship, about $900k.» |
| `es-pocos-datos.json` | Brief en español con pocos datos: lo desconocido debe salir «?», no exclusión | «Somos Aula Abierta, una plataforma de tutoría con IA para secundaria rural en América Latina. Buscamos grants.» |

Qué revisar en cada run (Run audit): la tabla «Which search source was worth it», el panel «Expansion from verified pages», los descartes uno por uno (razón y cita) y si el supuesto de tipo de entidad se mostró en vez de asumirse en silencio.
