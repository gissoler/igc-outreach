# WarmPath

Aplicación local para priorizar inversionistas y encontrar el camino cálido más fuerte hacia cada fondo. El producto combina evidencia pública, comparables, la red del founder y un ranking explicable.

## Investigación de financiación

La sección **Encontrar oportunidades** añade registro e inicio de sesión, onboarding por cuenta, importación de red desde LinkedIn, Gmail, Outlook, Calendar, HubSpot y Apollo, enriquecimiento opcional de personas mediante Apify y el flujo para Ram Mukunda y Rohit Goel, fuentes públicas, evidencia, ranking, borradores y feedback. Abre [la investigación local](http://localhost:5173/buscar). Inicia también `npm --prefix research start` junto al frontend y backend habituales. Configuración, formatos, limitaciones y pruebas en [research/README.md](research/README.md).

## Frontend v2 (workspace ejecutivo)

Onboarding navegable con autosave, dashboard ejecutivo, network graph, warm paths salto a salto y trazabilidad de cada decisión. Demo ejecutiva con datos ficticios en [http://localhost:5173/#/demo](http://localhost:5173/#/demo). Arquitectura, fórmulas, contratos pendientes y guion de presentación en [frontend/DEMO_Y_CONTRATOS.md](frontend/DEMO_Y_CONTRATOS.md).

## Estructura

```text
frontend/   React + Vite — dashboard, ranking, warm paths y pipeline
research/   Servicio local de investigación pública, evidencia y feedback
backend/    FastAPI + motor Python — ingesta, resolución, grafo, scoring y reportes
```

Los datos privados permanecen en `backend/data/` y `backend/exports/`; ambas rutas están excluidas del repositorio.

## Desarrollo local

Backend:

```bash
source .venv/bin/activate
pip install -e "./backend[dev]"
cd backend
warmpath-api
```

Frontend, en otra terminal:

```bash
cd frontend
npm install
npm run dev
```

Cuentas e investigación, en una tercera terminal:

```bash
npm --prefix research start
```

Abre [http://localhost:5173](http://localhost:5173). El servidor de desarrollo redirige `/api` a `http://localhost:8000`.

## Flujo recomendado

1. Completa el proyecto, founder y comparables desde **Proyecto y criterios**.
2. Usa la CLI del backend para cargar rondas con evidencia y exports de LinkedIn/Outlook.
3. Pulsa **Ejecutar ranking** en la interfaz.
4. Revisa el porqué, el ticket, la fuerza de la ruta y la evidencia de cada eslabón.
5. Registra avances en el pipeline para evaluar el ranking con resultados reales.

La guía completa de ingesta y fuentes está en [backend/README.md](backend/README.md).
# igc-outreach
