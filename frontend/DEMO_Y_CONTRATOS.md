# Frontend v2 · demo ejecutiva y contratos

## Ejecutar

```bash
# 1. Servicio de research (cuentas, evaluaciones, red)
npm --prefix research start          # http://127.0.0.1:8788
# 2. Frontend
cd frontend && npm install && npm run dev   # http://localhost:5173
```

- **Demo ejecutiva (sin cuenta, sin servidor externo, sin crédito):** `http://localhost:5173/#/demo`
  - `#/demo/ejecucion` → Live Agent Run de la demo · `#/demo/red` → red completa · `#/demo/evaluacion?lead=demo-lead-2` → candidato con warm path verificado.
- **Workspace real:** `http://localhost:5173/` → iniciar sesión → `#/evaluacion`, `#/red`, `#/ejecucion`, `#/configuracion/{empresa|producto|objetivo|evidencia|red|revision}`.
- Abrir la aplicación **no** lanza una investigación (antes se autoarrancaba en cada inicio de sesión y podía consumir crédito de Apify). Se ejecuta solo desde *Configuración → Revisión → Confirmar y ejecutar* o *Repetir con el mismo perfil*.

## Configuración para usuarios no técnicos

- La configuración arranca en **Asistente IA** (`#/configuracion/asistente`): el founder cuenta su empresa o adjunta su pitch deck y la IA llena el perfil (con la cita de cada dato). A la derecha ve lo que ya entendió y qué falta; el formulario por secciones queda como alternativa y todas las secciones tienen el botón «Completar con IA».
- **Red** en lenguaje de negocio: «Analizar mi LinkedIn» (sin contraseña) y «Subir mis contactos» con instrucciones paso a paso para LinkedIn, Google, Outlook, calendario, HubSpot y Apollo. Se retiró de la interfaz la opción de sesión de LinkedIn por cookie.
- Los mensajes de configuración (claves, variables de entorno) se muestran como «No activada · pide a tu administrador que la active»; el detalle técnico queda plegado en «Detalle técnico».

## Arquitectura (`frontend/src/app/`)

| Archivo | Componentes |
|---|---|
| `App.tsx` | Rutas hash, sesión, `Workspace`, `DemoApp`, `NetworkView` |
| `Shell.tsx` | `AppShell`, `AccountMenu`, `WorkspaceSwitcher`, `IntegrationsDrawer`, `AuthScreen` |
| `Onboarding.tsx` | `OnboardingWorkspace`, navegación por secciones, `AutosaveStatus`, secciones Evidencia / Red / Revisión |
| `Evaluation.tsx` | `EvaluationDashboard`, `ExecutiveSummary`, `SourceHealth`, `EvidenceCoverage`, `ApifyCard`, `JevCard` |
| `Candidates.tsx` | `CandidateExplorer`, `CandidateCard`, comparación, export CSV filtrado |
| `NetworkGraph.tsx` | `NetworkGraph` (radial / jerárquico, d3-zoom), controles, `GraphLegend` |
| `Detail.tsx` | `CandidatePanel`, `WarmPathPanel`, `DecisionTrace`, `ExecutiveExplain` (3 niveles), `RelationshipDrawer`, `EvidenceDrawer` |
| `ui.tsx` | `Info` (tooltip por clic/teclado), `Drawer`, `EmptyState`, `ErrorState`, `SkeletonState`, badges |
| `model.ts` | Derivaciones puras: resumen, salud de fuentes, estado Apify/Jev, caminos normalizados, grafo, traza |
| `demoData.ts` | Dataset **ficticio** etiquetado; scores calculados con la misma fórmula que `core.mjs` |
| `useResearch.ts` | Historial, carga, SSE + sondeo, detener, feedback |

Sin librerías nuevas: se reutilizan `d3-zoom`, `d3-selection`, `lucide-react`. El Live Agent Run y el agente de prerregistro existentes se reutilizan tal cual.

## Cómo se calcula lo que se muestra

- **Score de prioridad (0–100):** `Σ(valor_factor × peso) × cobertura`, cobertura = 0,5 si no hay evidencia verificada. Pesos estratégico: afinidad 35 · tipo 20 · vigencia 10 · relación 30 · canal 5; financiero: 25 · 25 · 25 · 5 · 10 · monto 10. Ordena; no es probabilidad.
- **Confianza en datos:** alta / media / baja según `core.mjs` (evidencia verificada, cargo, correo público, oportunidad abierta).
- **Estimación Jev:** probabilidad de la *acción* recomendada por el modelo; nunca de inversión.
- **Decisión final:** lista (prioritario / radar / descartado) tras reglas deterministas y, si existe, el ruteo de Jev (solo baja a radar).
- **Recomendación operativa:** regla explícita del frontend (`nextAction`): intro por intermediario, contacto directo, frío con canal público, completar investigación, monitorear o no contactar.
- **Warm path:** fuerza total = producto de la fuerza de cada salto; confianza del camino = la del salto menos confiable; caminos duplicados (mismos nodos) se fusionan uniendo su evidencia.
- **Certeza de una relación:** *Verificada* (sesión autorizada / fuente primaria del vínculo), *Documentada · cercanía inferida* (la evidencia prueba un hecho, no la confianza para presentar), *Hipótesis* (sin evidencia verificable o solo canal público).

## Cambios en el backend (aditivos)

- `GET /api/research/jobs` añade `company`, `venture`, `finishedAt`, `leads`, `top` a cada elemento (los campos anteriores no cambian; 65/65 pruebas pasan).
- El perfil admite `research_prefs: { mode, minDays, useApify }` (se guarda con el `PUT /account/profile` existente, que acepta el cuerpo completo).

## Contrato ideal pendiente (no se inventa en el frontend)

1. **Workspaces por usuario:** `GET/POST /account/workspaces` + cabecera `X-Workspace-Id`. Hoy cada empresa = una cuenta; cambiar de empresa implica iniciar sesión (el aislamiento lo garantiza el servidor por `userId`).
2. **Coste por fuente:** `run.events[].detail.cost = { units, usd, provider }` para Apify/Exa/Jev. Hoy solo se muestra «consumido (monto no reportado)» y el número de ejecuciones.
3. **Fecha del vínculo:** `hops[].observedAt` (fecha del hecho, no de la consulta). Hoy la antigüedad es la de `evidence.retrievedAt`.
4. **Confianza numérica por salto:** `hops[].confidence` (0–1) independiente de `strength`.
5. **Tipo de nodo en caminos:** `paths[].nodes` como objetos `{ name, kind, url }` para no inferir equipo/intermediario por nombre.
6. **Notas por candidato en servidor:** hoy la nota vive en el navegador y viaja con el feedback.
7. **Jev usage:** exponer `usage` del evento en el Job para mostrar tokens/coste.

## Guion de 5–7 minutos para Ram y Rohit

1. **(0:00) Problema.** «Un founder pierde semanas buscando a quién escribir y escribe en frío. Esto responde tres preguntas: a quién, cómo llegar y por qué, con evidencia auditable.» Abrir `#/demo`.
2. **(0:40) Qué entró.** Menú de cuenta → *Estado de integraciones*: qué fuentes están activas y cuáles cuestan crédito. Mencionar que la configuración (6 secciones, autosave) define los términos y el objetivo.
3. **(1:20) Qué encontró, en 10 segundos.** Resumen ejecutivo: 15 candidatos, 6 accionables, 7/12 con warm path (3 verificados), 94 % de evidencia verificada, NIH falló, Serper sin clave, Apify 3 ejecuciones, Jev 9 decisiones. Clic en *Fuentes* → tabla con motivo, duración y cómo resolver.
4. **(2:20) La recomendación.** Tarjeta oscura: «Pedir intro a Diego Ferrer para llegar a Priya Nair · 88/100 · confianza alta · fuerza 82 %». Clic en *Ver camino y evidencia*.
5. **(3:00) El grafo.** Camino dorado Tú → Diego → Priya. Cambiar a vista *Jerárquica*. Activar *Ocultar hipotéticas*: desaparecen las líneas punteadas (canales sin relación). Clic en un salto → drawer con fuente, fecha, fuerza y por qué sirve para una intro.
6. **(4:00) Auditar el número.** Pestaña *Factores y pesos*: `Σ = 88 × 1`; puntos no capturados por factor (sensibilidad). *¿Por qué esta recomendación?* → árbol: evidencia → reglas → Jev → resultado. Subrayar: score ≠ confianza ≠ probabilidad Jev ≠ decisión ≠ acción.
7. **(5:00) Contraste con un caso débil.** Seleccionar Hannah Weiss: camino *documentado* por coautoría de 2022, eslabón débil 65 %, riesgo de vigencia. Luego Sofía Lang: camino verificado pero Jev la baja a radar por evidencia insuficiente (48 % < 65 %).
8. **(5:45) Datos reales.** Salir de la demo al workspace real: misma pantalla con datos reales; cuando no hay red, el sistema dice «0 warm paths» y explica por qué en vez de inventarlos.
9. **(6:30) Valor.** Frente a una búsqueda o un CRM de contactos: prioriza por evidencia, mide la calidad del camino y deja trazabilidad para defender cada decisión.
