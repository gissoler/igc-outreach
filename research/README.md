# Investigación pública en IGC Outreach

Este módulo está integrado en la aplicación original `frontend/` mediante la ruta `/buscar`. El registro y onboarding ahora protegen la entrada al espacio personal de investigación. Los componentes del dashboard, el motor Python, los datos DuckDB y el pipeline existentes se conservan sin migrar ni borrar datos.

## Ejecutar

Requisito: Node >= 22.13 (SQLite incluido); las pruebas usan Node >= 22.18 (ejecutan el modelo TypeScript del frontend). Única dependencia npm: Playwright, para el visor del Live Agent Run. Instalación: `npm --prefix research install` y `npm --prefix research run browser:install` (descarga Chromium una vez). Sin Chromium la investigación funciona igual, sin capturas.

Desde la raíz del repositorio, en una terminal adicional a las del backend y frontend existentes:

```bash
cd research
# Opcional: cp .env.example .env
npm start
```

Con los tres servicios activos, abre http://localhost:5173/buscar. Vite redirige `/api/research` a `127.0.0.1:8788`; el resto de `/api` sigue en FastAPI (8000). Si cambias el puerto de investigación, actualiza también `frontend/vite.config.ts`. Solo escucha en localhost y no es una aplicación desplegada.

La primera visita muestra registro e inicio de sesión reales. Cada cuenta tiene sesión HTTP-only, perfil, fuentes e historial separados. El onboarding guarda identidad, empresa, proyecto y necesidad de financiación antes de abrir la búsqueda. Las contraseñas se almacenan con `scrypt`; nunca se guardan en texto plano. En un despliegue público todavía harían falta HTTPS, verificación de correo, recuperación de contraseña, protección CSRF adicional, política de retención y una base de datos gestionada.

## Qué hace

Formulario para cualquier usuario → red propia opcional → estrategia visible → consultas → deduplicación → ranking determinista → decisión estructurada Jev opcional → cinco candidatos y más resultados → detalle, fuentes y borrador → feedback persistente. La pantalla abre con un perfil nuevo vacío; Ram/IGC-AD1 y Rohit/AHA son ejemplos opcionales. Nombres y cargos de esos ejemplos se comprueban contra la página oficial de IGC al investigar; no se tratan objetivos de financiación o geografía como anuncios públicos. La etapa de AHA es una hipótesis editable, no un hecho verificado.

- OpenAlex: coautorías con identidad estable y afiliaciones históricas. Cuando se activa equipo IGC, verifica al advisor en el sitio oficial antes de construir el camino. Una coautoría no prueba amistad ni capacidad de presentar.
- ClinicalTrials.gov: patrocinadores industriales y responsables publicados. No se usan correos de reclutamiento como contactos de negocio.
- Grants.gov: convocatorias, estados, fechas, techos y contactos publicados en la convocatoria.
- NIH RePORTER: proyectos financiados y responsables/program officers. Los montos adjudicados no se presentan como dinero disponible.
- Radar oficial: ADDF, a2 Collective y CDMRP. Ciclos cerrados o futuros quedan fuera del top.
- Serper opcional: pistas complementarias; sus snippets no se elevan a hechos ni al top sin evidencia adicional.
- LinkedIn durante onboarding: el usuario pega una URL `/in/`; el servidor consulta el perfil público mediante `harvestapi/linkedin-profile-scraper` y construye un mapa de actividad en ambos sentidos con `harvestapi/linkedin-profile-posts`, `harvestapi/linkedin-profile-comments` y `harvestapi/linkedin-profile-reactions`: quién comenta/reacciona a los posts del usuario y en los posts de quién comenta/reacciona el usuario. Los tres Actors se ejecutan en paralelo, con resultados parciales si uno falla. No se piden cookies, contraseña ni exports. Las personas se guardan como **relaciones por interacción pública**, nunca como conexiones oficiales, y conservan URL, dirección, tipo, frecuencia y fecha para construir warm paths con evidencia.
- Apify en investigación: después de descubrir organizaciones relevantes, ejecuta un Actor configurable de empleados públicos para localizar responsables de business development, licensing, alianzas e inversión. El token se envía mediante `Authorization: Bearer`, nunca en la URL o al navegador. El límite predeterminado es 20 perfiles y cinco organizaciones por investigación. Cada perfil conserva la URL pública y el Actor como procedencia, y su mandato se muestra como pendiente de confirmar.
- Jev opcional: después del ranking determinista evalúa candidatos no descartados con tres decisiones tipadas: siguiente acción (`prioritize`, `investigate_more`, `discard`), encaje documentado (Score 0–4) y suficiencia de evidencia (Noul). La aplicación conserva las exclusiones duras, nunca permite que Jev elimine automáticamente un candidato y envía a radar los casos inciertos o que requieren más evidencia. Solo se comparte el mínimo contexto profesional público; no se envían contactos, identidad del usuario, notas privadas ni datos de su red. Sin `JEV_API_KEY`, el flujo continúa de forma visible con ranking determinista y revisión humana.
- Fuentes de red por cuenta: LinkedIn `Connections.csv`, contactos exportados de Gmail/Outlook, participantes de calendario `.ics` y contactos CSV de HubSpot/Apollo. Los formatos se normalizan, se deduplican y alimentan el cálculo de caminos cálidos de la siguiente búsqueda. Solo se leen nombres, empresa, cargo, canal público y fechas disponibles; no se leen cuerpos de mensajes ni adjuntos.
- LinkedIn no ofrece a esta aplicación acceso OAuth a conexiones. Por eso el flujo automático usa solamente actividad visible sin autenticación: una coincidencia demuestra interacción pública, no amistad, primer grado ni disposición para presentar. Los exports autorizados siguen admitidos como fuente opcional por API. No se simulan conexiones ni se fabrican correos.
- Network graph autenticado: desde la pantalla de fuentes el usuario puede autorizar una ejecución puntual pegando `li_at` o un JSON de cookies. El servidor lo valida, lo mantiene solo en memoria durante la petición y lo envía como campo secreto a `crawlerbros/linkedin-people-search-scraper`; para un máximo de cinco perfiles de segundo grado consulta `data_link_miner/linkedin-shared-connections`. La sesión nunca se guarda en SQLite, el perfil ni los eventos. Los resultados sí se guardan como relaciones verificadas, con Actor, URLs y fuerza, y pueden eliminarse mediante `DELETE /api/research/account/network-graph`. La visualización separa conexiones autenticadas, contactos mutuos e interacciones públicas. Los Actors son comunitarios, pueden requerir suscripción y LinkedIn puede limitar la sesión.

Las APIs públicas se intentan sin credenciales; OpenAlex puede limitar acceso/cuota. Se configuran claves opcionales en `research/.env`. Apify usa un timeout separado de 120 segundos porque los Actors son trabajos síncronos, siempre dentro del límite total de tres minutos. Los errores, límites, falta de claves y resultados parciales se muestran en «Estrategia y estado de las fuentes». Las demás peticiones tienen timeout de 1–30 segundos (12 por defecto), límite de respuesta 5 MB y ritmo de aproximadamente una solicitud por segundo por dominio. Las lecturas HTML comprueban robots. No se mantiene un scraper propio.

## Live Agent Run (ejecución observable)

Durante una búsqueda la pantalla muestra solo el Live Agent Run: columna izquierda con pasos, fuente activa, mensajes, resultados, avisos y progreso; a la derecha un visor con la URL pública sanitizada y el estado (conectando, consultando, leyendo, procesando, terminado).

- **Eventos reales** (`server/research/liveRun.mjs`): los emite el código que ejecuta cada operación — cliente HTTP (`api_request`/`api_response`), navegador (`browser_opened`, `page_loaded`, `screenshot`), pipeline (`planning`, `source_started`/`source_completed`, `evaluating`, `drafting`, `completed`). Tienen `sequence` creciente, se guardan con el trabajo (`job.run.events`, máx. 400) y se redactan: sin cookies, cabeceras de autenticación, tokens, claves de `.env`, correos ni parámetros sensibles.
- **SSE**: `GET /api/research/jobs/:id/events` envía un snapshot (desde `Last-Event-ID`), eventos nuevos, keepalive cada 15 s y `end` al terminar; limpia listeners al desconectarse. El frontend usa `EventSource` nativo y vuelve al sondeo de `/jobs/:id` si SSE falla. Los eventos se unen por `sequence`, sin duplicados.
- **Páginas web** (Radar oficial, perfil público de IGC): un único Chromium headless compartido (`server/research/browser.mjs`), una página a la vez en cola, contexto nuevo por visita (sin cookies), `domcontentloaded` con timeout de 15 s, captura JPEG 1280×720 (calidad 60), vídeo/audio/sockets/trackers bloqueados. El texto se extrae del HTML servido por esa misma navegación. Si el navegador falla se muestra el error real y el documento se intenta por HTTP; si Playwright no está instalado se lee por HTTP y se indica que no hay captura.
- **Capturas**: en memoria, máx. 18 por ejecución y 40 MB en total; se sirven en `GET /api/research/jobs/:id/frames/:frameId` y caducan 45 min después de terminar el trabajo (o al reiniciar). El visor mantiene la captura anterior mientras carga la siguiente.
- **APIs** (Grants.gov, NIH RePORTER, OpenAlex, ClinicalTrials.gov, Exa, Serper, Apify): no se abren en navegador; el visor muestra método, endpoint, parámetros públicos, estado HTTP, tiempo, registros y una muestra JSON truncada y redactada.
- **Terminada**: «Ejecución finalizada», «Finalizada con avisos» o «Interrumpida», etiqueta REGISTRO; «Reproducir ejecución» revela los eventos guardados como REPRODUCCIÓN. Nunca se llama «EN VIVO» a una ejecución terminada. Investigaciones anteriores a este registro muestran su log de texto.
- Variables opcionales: `RESEARCH_BROWSER=off`, `RESEARCH_BROWSER_TIMEOUT_MS`, `RESEARCH_BROWSER_JPEG_QUALITY`, `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

## Prerregistro conversacional (perfilamiento)

El onboarding ya no es un formulario rígido: **conversación → confirmación → LinkedIn**.

1. **Agente de prerregistro** (`server/research/intake.mjs`, UI en `frontend/src/IntakeAgent.tsx`). El usuario escribe o adjunta pitch deck, one-pager, Word, presupuesto o artículos (PDF, DOCX, PPTX, XLSX, TXT/MD/CSV). El texto se extrae **en el navegador** (`docText.ts`, pdf.js); al servidor solo llega texto (máx. 60.000 caracteres por documento, 8 documentos). El agente extrae empresa, producto, qué hace, madurez, ronda, monto, objetivos (inversión, grants, partnering, deuda), geografía, sector, competidores, criterios, restricciones, uso de fondos y plazo. Cada campo guarda origen (documento, conversación, modelo o usuario), cita literal y confianza (`source`, `inferred`, `user`). Lo que el usuario edita a mano nunca se sobrescribe.
2. **Confirmación**: el perfil estructurado se muestra editable; nada se investiga hasta confirmarlo. Al confirmar se guarda en `account_profiles` (con `intake`: objetivos, madurez, evidencia, documentos y plan) y pasa a la investigación (`fundingTypes`, `stage`, `criteria`, competidores como exclusiones).
3. **Planificador** (`planResearch`, determinista): elige fuentes por objetivo y sector (Grants → Grants.gov, NIH, fundaciones; Inversión → SEC Form D, anuncios; Partnering → ClinicalTrials, OpenAlex; Contactos → red propia, Apify; Exa y Hunter quedan como «pendiente de integración») y muestra lo descartado y por qué.

**Modelo**: detrás de un endpoint compatible con OpenAI (Ollama, vLLM, LM Studio…), para comparar proveedores sin tocar el código. Cuando `INTAKE_LLM_BASE_URL` está configurado, **el modelo es quien interpreta la conversación y los documentos** — no corren reglas de patrones en paralelo. Las reglas de patrones (`heuristicExtract`) quedan solo como red de seguridad: se activan si no hay modelo configurado o si la llamada al modelo falla en ese turno (`runTurn` decide esto en cada mensaje). El modelo sigue sin poder inventar: el código valida rutas, enums y confirma con `quote_in_text`-style match si la cita aparece literal en la fuente (`confidence: source|inferred`). Sin LoRA: primero modelo + ontología + evaluaciones con casos reales.

Configuración actual (flota propia en `147.185.41.229`, un modelo por puerto): `8000` qwen-30b, `8001` qwen-4b (por defecto, más rápido), `8002` deepseek-8b, `8003` baai y `8004` mixbread — estos dos últimos son modelos de embeddings/reranking, **no sirven** como `INTAKE_LLM_BASE_URL` (no responden `/chat/completions`). Verifica el nombre exacto del modelo antes de arrancar con `curl http://147.185.41.229:<puerto>/v1/models`. Por defecto se desactiva el razonamiento de Qwen3 (`/no_think`); `INTAKE_LLM_THINK=true` lo activa (pendiente de evaluar). Alternativa local y privada: Ollama (`ollama pull qwen3:4b`, `INTAKE_LLM_BASE_URL=http://127.0.0.1:11434/v1`).

Rutas (con sesión): `GET /api/research/intake`, `POST /intake/message` `{text, documents:[{name,type,size,text}]}`, `PUT /intake/field` `{path, value}`, `DELETE /intake/documents/:id`, `POST /intake/reset`, `POST /intake/confirm`. Estado en la tabla `intake_sessions`.

Límites: PDF escaneado sin texto seleccionable no se lee (se pide el .pptx/.docx o pegar el texto); formatos antiguos .doc/.ppt/.xls no; la heurística puede confundir nombres (p. ej. «Neuro» en el nombre de la empresa sugiere sector neuro), por eso la confirmación es obligatoria.

## Evidencia, inferencia y ejemplos

«Confirmado en fuente» significa que un campo está en una fuente recuperada, no que sea vigente hoy ni que la persona acepte propuestas. Cada evidencia lleva URL, fecha y extracto. Los cargos o afiliaciones actuales no confirmados se señalan. Score, encaje y posible presentación son inferencias explicables. «No disponible» se conserva; no se generan correos.

El modo demo se elige explícitamente antes de investigar. Genera contactos **ficticios**, con evidencia no verificada, aviso persistente y borradores «NO ENVIAR». Una caída de proveedores nunca activa demo automáticamente.

El texto de outreach usa plantillas deterministas con hechos públicos recuperados. No se envían mensajes ni se incluyen automáticamente descripciones libres o datos financieros del formulario. El usuario puede editar/copiar el borrador. Las tres partes (motivo común, contexto, petición) muestran su procedencia.

## Ranking y límites

Pesos sobre 100: relaciones/colaboración = tema 35, tipo 20, vigencia 10, camino 30, canal 5; financiación/plazos = tema 25, tipo 25, vigencia 25, camino 5, canal 10, monto 10. Se restan 10 puntos a investigadores principales académicos en modo financiación, porque no son responsables de otorgar fondos. Desempate por ID estable. Evidencia ausente penaliza y excluye resultados reales del top. Se deduplica por ID de autor o nombre+organización; convocatorias mantienen su identidad aunque compartan contacto. Rechazos anteriores, organizaciones excluidas, tipo estricto y competidores opcionales se filtran.

Un cierre vencido, convocatoria prevista o plazo menor al mínimo solicitado pasa a radar. Geografía, etapa y criterios libres se muestran como pendientes cuando las fuentes no permiten verificar elegibilidad; no se simula una comprobación. Inversión y deuda tienen cobertura limitada: el motor SEC original sigue disponible en Inversionistas, pero no se ha construido una unión automática entre ambos rankings. La pertinencia de una entidad no prueba que tenga fondos disponibles. Revisión humana antes de contactar.

Datos locales: `research/data/research.sqlite` contiene cuentas, perfiles, sesiones, fuentes importadas, trabajos, snapshots públicos y feedback. No incluye claves de API. Los archivos importados quedan asociados a la cuenta y pueden eliminarse desde la interfaz. La memoria de feedback se separa por usuario, nombre, empresa, producto y modo demo/real. Al reiniciar, trabajos interrumpidos quedan marcados como error. Solo se ejecuta una investigación simultánea.

## Pruebas

```bash
npm --prefix research test
.venv/bin/python -m pytest backend/tests -q
npm --prefix frontend run build
npm --prefix frontend run lint:research
```

Las pruebas Node cubren validación, autenticación, aislamiento entre cuentas, perfiles, conexión y desconexión de fuentes, seguridad de enlaces, ranking, duplicados, fechas, timeouts/robots, privacidad del borrador, CSV/ICS, memoria, demo, respuestas parciales y flujo HTTP completo. Requieren permitir un puerto localhost temporal. El build ejecuta TypeScript estricto. El repositorio no tenía lint configurado; `lint:research` revisa el código nuevo sin imponer cambios al frontend existente.

## Decisiones frente al plan

Se conserva React/Vite + FastAPI/DuckDB y la interfaz original. El servicio de cuentas e investigación es un proceso Node local sin paquetes adicionales; permite reutilizar el motor de fuentes ya probado sin reescribir Python ni alterar los datos originales. Se priorizan APIs oficiales, exports autorizados por el usuario y evidencia antes que integraciones privadas pagadas. Apify se incorpora como proveedor opcional y acotado; sin `APIFY_TOKEN` se omite de forma visible y el resto del flujo continúa. Unipile, Happenstance, OAuth de terceros, envío de correos y un grafo visual adicional quedan fuera del MVP. No se usan nombres del informe como leads sin recuperarlos de una fuente durante la investigación.

## Verificación realizada (25 de septiembre de 2026)

- 20 pruebas existentes Python y 29 pruebas nuevas Node aprobadas.
- TypeScript, build y lint de archivos nuevos aprobados. El build conserva una advertencia de bundle grande; Python informa tres deprecaciones de dependencias/código previo.
- Navegador: registro, onboarding en cuatro pasos, importación de LinkedIn, persistencia tras recarga, cierre y reingreso de sesión; además, formularios Ram/Rohit, consultas reales para ambos, evidencias, borrador, radar, más resultados, demo explícita, feedback positivo y negativo guardados, recarga e historial. Revisión visual en escritorio y móvil.
- Ram produjo 85 candidatos priorizados y 3 de radar; Rohit 5 contactos de investigación y 15 convocatorias/programas en radar. Son capturas de consultas, no garantías de disponibilidad o elegibilidad. El horizonte de Rohit de 60 días mueve convocatorias con cierre anterior a ese plazo al radar.
- El servicio devuelve resultados parciales cuando faltan fuentes o claves opcionales. No utilizó ejemplos en las consultas reales.
- Este directorio no tiene historial Git. Se compararon los archivos originales contra una copia previa en `/tmp/igc-original-snapshot`: se modificaron únicamente el enrutamiento de App, proxy Vite, scripts/dependencia de lint y documentación; los demás componentes originales se conservaron. Los módulos de investigación son nuevos.
