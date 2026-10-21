# V15 · Brazo de inversionistas: diagnóstico y reconstrucción (20/10/2026)

Rama/worktree: `codex/simpler-grants-chat-ui` (base `bd6bffc` + cambios locales de grants V15, sin commitear). Este trabajo tampoco está commiteado: va junto a los expedientes de grants.

## 1. Estado real del código hoy frente a los 7 puntos

| # | Punto del vault | Estado al 20/10 (antes de este cambio) | Qué se hizo |
|---|---|---|---|
| 1 | El modelo elige el fondo entre listas (v9 NO-GO) | En producción ya no existía la etapa v9, pero el camino actual (agente V14, `ENGINE_AGENT=1`) seguía dependiendo del modelo: el agente elige qué abrir, el lector LLM marca `candidate` y el **juez LLM** decide `main/verify`. runs-v5: Sanofi Ventures quedó `apply` sin geografía ni hechos del solicitante; Recursion (empresa operativa), Chugai (nota de prensa 2023) y Gates/NACC (premio de investigación) quedaron como «inversores»; 8VC salió dos veces. | Nueva etapa `server/research/investors/`: ningún paso pide al modelo elegir ni juzgar. Candidatos por código (búsquedas escritas por el código, enlaces de listas, nombres de noticias de rondas resueltos por nombre–dominio, Apollo, páginas del agente), orden por evidencia de búsqueda, verificación por código. El juez LLM no corre en `investment`. |
| 2 | Extractor en vivo deja todo `unknown` → abstención siempre | Del harness `bench/investors` (v4–v9), no del pipeline. El agente actual tampoco llenaba criterios de inversión de forma fiable (bloqueos «not confirmed by the judge with a quote» en todos los hallazgos de runs-v5). | Ya no hay extractor LLM de criterios: cada criterio sale de una frase literal por regla (`evidence.mjs`). Un criterio sin frase queda como bloqueo explícito, no como `unknown` silencioso. |
| 3 | `decide.mjs`: `null <= umbral` es verdadero | Seguía igual (`bench/investors/decide.mjs`). | Arreglado: checks `true/false/null`; `null` nunca aprueba; si ninguna corrida recomienda nada la decisión es `not_evaluable` (`degenerate: true`). Test V15-INV-08. |
| 4 | Retrieval casi nulo (Hit@20 2/36) | Sin cambio en el harness; en producción las consultas las escribe el agente (frases largas) y no se abrían listas ni se resolvían nombres. | Cosecha determinista: 7 consultas cortas desde los *exact terms* (incluye una de listas «top … venture capital firms» y una de rondas «… raises seed round led by»); las listas aportan dominios directos (drughunter: 120 firmas con URL, sin resolver nombres); los nombres de noticias se resuelven con una búsqueda y un emparejador nombre–dominio sin sufijos y con siglas (el de v8 rechazaba «Kaszek VC Fund»→kaszek.com). Filtro en dos fases: home de 30 candidatas → profundizar 16. **No medido en vivo todavía.** |
| 5 | Sin lista de referencia humana | Sigue sin existir. | `eval/investors/rd-control-2026-10-19.json` (lista de control manual del 19/10, marcada `unreviewed_control`, `reviewed_by: null`) y `scripts/investor-control.mjs`, que reporta omisiones por caso y se niega a llamarlo recall sin revisión humana. Pendiente humano. |
| 6 | Apollo casi no se ejerce | El runner lo deja apagado por defecto; como herramienta del agente el modelo no la elige. | Las filas de Apollo (fuente inicial) entran como candidatas con procedencia `apollo`; el embudo cuenta candidatas / abiertas / retenidas de Apollo; `run-v15-investors.sh` lo enciende (tope 5 créditos) con contactos posteriores para lo retenido. Su aporte queda medible; no está medido. |
| 7 | `investor.mjs::verifyInvestor` | **Quedó atrás**: solo lo usa el motor anterior (`engine.mjs`, `ENGINE_AGENT` apagado). El camino actual no lo llamaba. | Sustituido en el camino actual por `investors/evidence.mjs` (mismas ideas, a nivel de organización, con citas literales más estrictas). `investor.mjs` se deja para el motor anterior. |

## 2. Diseño

`agentic/loop.mjs`, objetivo `investment` (`ENGINE_INVESTOR_DOSSIER=1` por defecto; `0` vuelve al juez LLM):

1. **Cosecha en paralelo al agente** (`prefetchInvestors`): consultas por código (`sector.mjs#investorQueries`); resultados clasificados por regla (`orgs.mjs#roleOf`): sitio propio → candidata; lista → se abre y sus enlaces externos son candidatas; prensa → se abre y se extraen nombres («led by», «participation from») que se resuelven por búsqueda solo si el dominio coincide con el nombre. Prensa, directorios, redes y plataformas nunca son candidatas.
2. **Unidad = organización** (dominio registrable). Orden por evidencia de búsqueda (fuentes distintas, señal de inversor en el nombre, términos del brief en el contexto). Fase A: home de las 30 primeras; fase B: hasta 3 páginas institucionales (enfoque/tesis, about, contacto) de las 16 que pasan el filtro rápido. Las páginas que abrió el agente se suman al expediente de su organización.
3. **Evidencia por código** (`evidence.mjs`), cada una con cita literal + URL, solo de frases de prosa sobre la propia organización (primera persona o su nombre): inversor; tesis (frase de inversión + sector del brief, `specific` o `broad`; el nombre del fondo no cuenta como sector); etapa (vs. la del brief); geografía (vs. el país **confirmado** del solicitante); contacto (frase con verbo de acción o enlace del propio sitio); actividad reciente (año de `today` o el anterior).
4. **Clasificación** (`pipeline.mjs#classifyOrg`): descarte si es la propia empresa, sin texto, directorio, no inversor (empresa operativa), ruta de partnering (se guarda aparte en `other_routes`) o sin tesis en el sector. Retenido = siempre con cita de inversor y de tesis. `main` solo si tesis específica + etapa + geografía + contacto + actividad + hechos del solicitante confirmados; si no, `verify` con bloqueos y condiciones a la vista. Antes de entregar, `auditQuotes` vuelve a comprobar cada cita contra su página.
5. **Orden** por evidencia (no por el modelo) y embudo completo en `audit.investor`, eventos `investor_harvest`, `investor_screen`, `investor_org` (cada decisión, `decided_by: 'code'`) e `investor_summary`; sección propia en `report.md`.

## 3. Verificación hecha (sin red ni gasto)

- `tests/v15.investors.test.mjs`: 10/10 (emparejador nombre–dominio, listas/noticias como fuentes, sector, citas literales, etapa completa sin modelo, `main` con hechos confirmados y bloqueo por geografía excluyente, prefetch sin reaperturas, regla de decisión, bucle del agente sin juez LLM, eventos nuevos válidos en el esquema de traza `eval/v14/events.schema.json`).
- Suite `npm test`: 617 pass / 10 fail; los 10 fallos son los mismos que antes del cambio (607/10 + 10 nuevas).
- Reproducción sobre páginas guardadas de runs-v4 y runs-v5 (`scripts/investor-replay.mjs`): Recursion, insitro, Formation Bio, Loyal, Fauna Bio, LabGenius, NACC/Gates, Alzheimer's Association, ADDF, Chugai (prensa) y redenlab → descartadas (`not_investor`); pharmanow.live y techbio.vc → `directory`; prnewswire.co.uk → fuente de terceros; Chemistry VC → `no_sector_thesis` (generalista). Retenidas como `verify`: Sanofi Ventures (tesis amplia, «investing globally in early-stage»), AbbVie Ventures (amplia, «discovery and pre-clinical», «US and Europe» → condición), 8VC y Air Street (amplias, AI), 501 Ventures (específica: metabolic), Reach Capital (específica: voice). Ninguna `main`: los briefs RD no confirman país ni tipo de entidad. Falso negativo conocido de la reproducción: ARCH Venture Partners → `not_investor`, porque runs-v5 solo guardó su home (1.047 caracteres de titulares y testimonios); en vivo la fase B abre sus páginas institucionales. La reproducción solo ve lo que las corridas viejas abrieron.

## 4. Límites y pendientes

- **No hay corrida en vivo.** Ni la cobertura (punto 4) ni el aporte de Apollo (punto 6) están medidos. Correr `scripts/run-v15-investors.sh` (gasta búsquedas con tope Exa USD 0,25 por caso y hasta 5 créditos de Apollo por caso) y luego leer `runs-v10-investors.control.txt`.
- El orden antes de abrir es por evidencia de búsqueda; entre muchas candidatas de una lista con el mismo puntaje decide el orden de la lista. Si el «oro» queda fuera de las 30 de la fase A, no se verifica.
- Las reglas de lenguaje (inversor, tesis, etapa, geografía) son heurísticas en inglés; páginas sin puntuación o solo con JS quedan `not_evaluable` o sin frase.
- La lista de control no es gold: necesita revisión humana (`reviewed_by`).
- El harness `bench/investors` (v4–v9) no se reescribió; solo se arregló `decide.mjs`.

## Primera corrida en vivo (RD-01, 2026-10-20) y ajustes

Resultado: 107 candidatas → 36 abiertas → 6 retenidas «a verificar», 0 listas para contactar. De la lista de control solo Sanofi Ventures apareció (SYNthesis y Novo Holdings ni fueron candidatas: falla de la búsqueda, sin resolver).

Hallazgos y qué se cambió (verificado con pruebas V15-INV-11..15 y reproducción sobre las páginas guardadas de esa corrida, sin red):
- **Medios y consultoras abrían cupo** (Yahoo, NYT, Fortune, Endpoints, Accenture, Qubit…): ampliada la lista de terceros (`MEDIA` en `orgs.mjs`).
- **Fondos reales descartados con una home de 587–1.047 caracteres** (AIX, ARCH, Amplitude): la home delgada de un dominio que suena a fondo (`INVESTORISH_LABEL`, sin límites de palabra) ahora se profundiza; la home se abre en el dominio registrable (antes en `careers.amplitudevc.com`). **No verificado en vivo**: la reproducción no puede abrir páginas internas.
- **Nombres** («Home», titulares): `orgDisplayName` toma un nombre que coincida con el dominio.
- **Tesis**: para un brief de IA + fármacos, «AI-life sciences», «AI-native life sciences», «TechBio» o «computationally-enabled therapeutic platforms» cuentan como específica; «biotech and AI companies» (lista) sigue amplia.
- **Geografía**: «global» exige un verbo de inversión en la misma frase («ayudamos a escalar empresas globalmente» ya no cuenta).
- **Apollo**: en esta cuenta responde 403 (`unsupported_by_plan`) a organizaciones y personas; las 5 llamadas no devolvieron nada. Ahora, tras el primer 403, no se vuelve a llamar (razón `plan_denied`), y `run-v15-investors.sh` lo deja apagado por defecto (`APOLLO_ENABLED=1` lo enciende).

Sigue abierto: cobertura de la búsqueda (SYNthesis y Novo Holdings no llegan a candidatas), lista de referencia revisada por una persona, contactos (4 de 6 sin vía de contacto con Apollo caído).

### Cobertura de la búsqueda (20/10, segunda parte) · SIN medir en vivo
Causa de SYNthesis y Novo Holdings ausentes: solo había 7 consultas por tema y 3 noticias abiertas; ninguna consulta apuntaba a los brazos de venture de farmacéuticas ni a fondos de creación de empresas.
- `investorQueries` pasa de 7 a 12 (`ENGINE_INVESTOR_SEARCHES`): añade arquetipos derivados del vocabulario de las familias del brief («pharma corporate venture capital arms», «<sector> company creation venture fund», «most active <sector> seed investors», «<tema> funding round investors include», «<sector> Series A led by participation from», …). Ningún nombre de fondo escrito a mano.
- Listas abiertas 3→5, noticias 3→6, nombres a resolver 6→12 (`ENGINE_INVESTOR_LISTS/NEWS/RESOLVE`). Resolver (`resolveNames`) acepta también un resultado cuyo título nombra al fondo y suena a inversor (antes solo dominio = nombre; la corrida real resolvió 0 de 2).
- **Segunda ronda** (`ENGINE_INVESTOR_SNOWBALL`, 8 por defecto; 0 la apaga): los fondos que pasan el filtro nombran co-inversores en sus noticias de cartera («led by», «participation from»); se resuelven, entran como candidatas (`portfolio:<dominio>`) y se abren en la misma etapa.
- Costo: más búsquedas por caso (≈12 + hasta 24 de resolución); el tope de Exa (USD 0,25) apaga Exa al llegar y siguen los otros buscadores.
- Pruebas V15-INV-16..18. El informe añade la línea «Segunda ronda».
Para saber si sirvió: repetir RD-01 y leer `investor-control.mjs` («no apareció como candidata» debería bajar).

### Segunda corrida en vivo (RD-01, `runs-v10-rd01b`, 20/10) y correcciones
Resultado: 108 candidatas → 36 abiertas → 7 retenidas, 4 con tesis específica (antes 0). SYNthesis y Novo Holdings siguen sin aparecer como candidatas; la segunda ronda no encontró nada (0 nombres).
Causas halladas leyendo la traza y las páginas guardadas:
- **Error propio (auditoría):** un contacto que es un enlace (sin cita) perdía su URL en `toFinding`, y `auditQuotes` descartaba al fondo como `quote_audit_failed` (AIX Ventures, Menlo Ventures). Corregido; prueba V15-INV-20.
- **Novo Holdings sí estaba en páginas leídas:** como título de una lista en prosa de BioSpace («## Novo Holdings», sin enlaces) y como enlace en una guía de Excedr («include firms like: * [Novo Holdings](…)»). Nuevo: `namesFromHeadings` (títulos de listas), `linkedInvestors` (enlaces precedidos de «firms like / include / led by…»), y los artículos explicativos (`/resources/`, `/guides/`) cuentan como fuente de nombres. Prueba V15-INV-19.
- **Nombres de noticias sucios** («Thrive Capital. The AI», «Premji. This», «CEO …»): cortados en el fin de oración, sin cargos ni conectores finales.
- **Segunda ronda vacía:** los fondos no tenían «led by» en su home/enfoque. Ahora se abren 1–2 páginas de cartera/noticias de cada fondo retenido (`ENGINE_INVESTOR_PORTFOLIO`, 2 por fondo, hasta 8 fondos).
- Sigue sin explicación: SYNthesis BioVentures no aparece en ninguna página recuperada (fondo australiano de terapéuticas); requiere otra consulta (por región/tipo), no más reglas.
- Resolución de nombres: hasta 14 por corrida (`ENGINE_INVESTOR_RESOLVE`).

### Tercera corrida en vivo (RD-01, `runs-v10-rd01c`, 20/10)
122 candidatas (search 48, agent 36, news 11, list 64) → 36 abiertas → 11 retenidas (3 con tesis específica). **Novo Holdings ya aparece** (resuelto desde el título «## Novo Holdings» de la lista de BioSpace). SYNthesis BioVentures sigue sin ser candidata (no está en ninguna página recuperada). La segunda ronda sigue en 0 nombres: las páginas de cartera listan empresas, no «led by».
Correcciones tras leer la traza:
- Novo Holdings salía **dos veces** (novoholdings.dk, abierto desde un PDF de informe anual, y novoholdings.com): el resolver ya no acepta PDF ni subdominios de activos (`assets.`, `cdn.`…), `preqin.com` es base de datos, y el mismo fondo con dos dominios se une (`org.also_domains`, descarte `duplicate_domain`).
- Encabezados de lista con numeral («1. ARCH…») o con año/«tracker/report» ya no se resuelven como nombres.
- Falsos negativos de «es inversor»: «RA Capital founds, funds, and scales companies…» y «Amplify Bio is the first investor for…» tienen el nombre del fondo como sujeto, no «we/our». Ahora cuentan (investor y tesis); un banco para startups (Rho) sigue sin contar. Pruebas V15-INV-21/22.
Siguen sin detectarse y no se arreglan con reglas: homes casi vacías o hechas con JavaScript (Lux Capital, Sequoia), sitios en francés (Amplitude Ventures: las expresiones son solo en inglés) y RA Capital, cuya página dice «healthcare» sin nombrar terapéutica ni IA (sin tesis de sector para este brief).

### Corrida de cuatro casos (RD-02, RD-03, RD-09, RD-10 · `runs-v10-inv`, 20/10)
Cada caso: 74–125 candidatas → 34–36 abiertas → 9–11 retenidas (1–4 con tesis específica); ninguna lista para contactar (el brief no confirma país ni tipo de entidad). Control (solo RD-03 y RD-10 tienen elementos): Novo Nordisk como ruta de partnering ✓ (RD-03); Sanofi ✓ en RD-10 y RD-01, «candidata no abierta» en RD-09; Novo Holdings, Lilly y SYNthesis no aparecen como candidatas en RD-03/RD-10 (en RD-10 se retuvo «Novo Holdings» con otro dominio, `novobroadgreenhouse.com`, y la lista de control exige novoholdings.com).
Causas y correcciones (todas verificadas solo con pruebas y reproducción de las páginas guardadas):
- **Tope de búsquedas del bucle**: el presupuesto era 7+6 de inversionistas; las consultas nuevas (12) + resolución (14) + segunda ronda (hasta 16) lo agotaban y las búsquedas de resolución fallaban en silencio (RD-10: 1 de 12 nombres resuelto). Ahora `loop.mjs` suma 12 + 14 + 2×8 = 42 y aperturas 200 (`ENGINE_INVESTOR_SEARCHES/RESOLVE/SNOWBALL/OPENS`). Pantalla de aperturas rápidas de 30 a 40 (`ENGINE_INVESTOR_SCREEN`): en RD-09 había 78 candidatas sin abrir con puntajes empatados (6) y Sanofi (5) quedó fuera.
- **Falsos positivos**: asesoras M&A (Flow Partners), agencia de marketing (VC Marketing Agency), bases de contactos (RevenueBase, SignalBase) → `service_firm` (señal en título/inicio de página o ≥2 señales distintas; una mención suelta en un fondo real, p. ej. «selective M&A advisory work» de 501 Ventures, no descarta). Perfiles de personas («As a principal at…», «he focuses on…») ya no cuentan como tesis. Listas con número («10 Biotech Venture Capital Firms», «The 22 largest…») cuentan como directorio.
- **Dominio equivocado**: «Novo Holdings» ↔ `novobroadgreenhouse.com` aceptado por prefijo; ahora el prefijo solo vale si lo que sobra es una palabra de fondo («holdings», «ventures»…).
Pruebas V15-INV-23/24. Suite completa: mismos 13 fallos previos.

### Segunda corrida de cuatro casos (`runs-v11-inv`, 20/10) · con el presupuesto corregido
Cobertura: 89–138 candidatas → 47–52 abiertas → 8–13 retenidas (3–6 con tesis específica). Resolución de nombres 9/10, 10/14, 12/13, 7/8 (antes 1/12 en RD-10); `budget-fails` 0. Segunda ronda: 5, 6, 2 y 9 candidatas nuevas abiertas.
Control: **Novo Holdings retenida #1 en RD-03 y #2 en RD-10** (antes ausente); Novo Nordisk como ruta de partnering ✓; Sanofi ✓ en RD-10 y RD-01, pero en RD-09 sigue «candidata no abierta (puntaje 5)»; Lilly en RD-03 «descartada: not_evaluable» (página demasiado corta); SYNthesis nunca es candidata.
Falsos positivos que seguían: The Motley Fool y Startup Intros (los nombres de aparición venían de títulos de búsqueda y contaban como «el sitio habla de sí mismo»), nsf.gov, directorios con perfiles de varios fondos (Neurofounders, Neurotech Partnering).
Correcciones: (1) solo cuentan como nombre propio los nombres que coinciden con el dominio, más la primera palabra (≥6 letras) para casos como «Amplify Bio» = Amplify Partners; (2) agencias públicas (`.gov`, `.gov.xx`) fuera: son grants; (3) detección de directorio por perfiles de ≥3 fondos ajenos (regla añadida, **no se activó con las páginas reales de Neurofounders y Neurotech Partnering: siguen retenidas**). Pruebas V15-INV-25/26.
