# Auditoría: Rural_State_Open_Solicitations.xlsx → candidatos MINT-AD (benchmark grants v0)

Fecha de verificación: **2026-10-07** · Preparado por: agente (Claude), a pedido de Gisel · Estado: **auditoría completa; casos formales bloqueados**.

> Este documento no es un resultado comercial ni del benchmark. No se ejecutó B0, B1, B2 ni `run-all`; no se tocó producción; no hubo gasto. El Excel se trató solo como datos.

## 0. Resumen

| Métrica | Valor |
|---|---|
| Filas de datos del Excel | 50 en la hoja `RFPs Status` (A3:A52, una por estado) + 51 fichas en la hoja `Map 2026` (Tennessee aparece dos veces) |
| Oportunidades normalizadas (CSV) | 74: 71 salen de la hoja y 3 se encontraron en páginas oficiales enlazadas desde ella |
| Convocatorias concretas según la hoja | 42 con nombre o ID y fecha; 16 parciales; 13 son páginas de programa o notas sin convocatoria |
| Siguen abiertas hoy (de las 71 de la hoja) | **0** |
| Abiertas o próximas fuera de la hoja | 3: Alaska Year 2 (`open`), VIPC CareIQ C-27-002 (`open`) y Mississippi Innovative Pilot (`upcoming`) |
| Estado verificado (74) | `closed` 42 · `awarded` 13 · `not_a_call` 8 · `unknown` 8 · `open` 2 · `upcoming` 1 |
| Contaminación (74) | `previously_exposed` 19 · `uncertain` 55 · `not_found_in_prior_runs` **0** |
| Perfil MINT-AD independiente y congelado | **No existe y no se pudo construir (bloqueo, §3)** |
| Casos ancla creados | **0** · Búsquedas manuales creadas: **0** · `manifest.json`: no se creó |

## 1. Procedencia del Excel

| Campo | Valor |
|---|---|
| Ruta original | `/Users/gcaicedo/Downloads/Rural_State_Open_Solicitations.xlsx` (no se modificó; se leyó una copia) |
| SHA-256 | `2cfcb0ec7397bbcaefbe2f9e866e8b627724f38d2c8de6f5229616a9a0d79e58` |
| Tamaño | 47 295 bytes |
| Propiedades internas | creado 2026-02-05 17:15:05; modificado **2026-09-14 20:30:51**; `lastModifiedBy` = Monica Arias |
| mtime del archivo | 2026-09-15T20:52:27Z |
| Hojas | `RFPs Status` (título «State Requests for Proposals (RFPs) Cycle 1 - 2026»; columnas State, FY26 Allocation, RFPs Status, RFPs Notes, Next Date, Event, Link, Action, más notas en I y J) · `Map 2026` (tablero de fichas por estado agrupadas como OPEN, Upcoming, Upcoming no dates, CLOSED TEMPORARILY y SUBMITTED; tiene notas fechadas hasta el 23-ago) |

Qué contiene el Excel: es un tracker de outreach del Rural Health Transformation Program (RHTP), una sola familia federal (CMS) que reparten los 50 estados. Mezcla páginas de programa, RFP/RFA concretas, ciclos cerrados o futuros, notas de partners y contactos, y opiniones de encaje («We are strongly eligible…», «Not a fit»). En el CSV, esas opiniones van en `partner_outreach_notes` o `route_basis`, separadas de `eligibility_evidence_in_sheet`. Esta última solo recoge texto de la hoja que cita reglas de la convocatoria.

- **Asignación estatal FY26:** se conserva en la columna `state_fy26_rhtp_allocation_usd_NOT_available_to_applicant`. Es el monto que CMS asigna al estado; **no** es lo disponible para MINT-AD.
- **Status:** `RFPs Status` no se usó para decidir nada. Cada estado se volvió a comprobar en la fuente oficial el 2026-10-07.
- **Hallazgo sobre la propia organización:** la hoja registra que IGC ya presentó una LOI en Alaska (Year 1, «LOI not accepted») y una propuesta en Maryland (presentada el 26-may).

## 2. Contaminación (Fase 1)

### 2.1 Qué se buscó y dónde
- **Términos buscados:** las 62 URL del Excel (57 hosts), los nombres de programa (RHTP, Rural Health Transformation, THRIVE, Memory Care Assessment Network, Live Well Together, Healthier Ohio, DOH 59808, Provider Technology Fund, GREAT Health, Healthy Horizons, Telepods, Chronic Disease Collaborative Care, Regional Partnership Grant) y los identificadores.
- **Lugares revisados:**
  - todo el árbol de trabajo, incluidos archivos ignorados (`research/bench/out/**`, `research/eval/runs/**` con `search-cache.json`);
  - una copia de `research/data/research.sqlite` y de su WAL, y `firecrawl-cache.sqlite`;
  - `prompts/**`, `research/agent/config/**` y `docs/contracts/**`;
  - el historial de git (`git log -S`).
- **Lo que no fue posible revisar:** las salidas de las corridas IGC/MINT-AD del **2026-10-05**. No están en el repo ni en la base local (las últimas `jobs` locales son del 30-sep); viven en el servidor AWS, que no se tocó.

### 2.2 Tipos de exposición encontrados

| Tipo | Evidencia | Alcance |
|---|---|---|
| **Prueba unitaria con fixture** | `research/tests/federalSources.test.mjs` y `screenIndividualState.test.mjs` (commit `750ae04`, 05-oct). Usan un brief IGC/MINT-AD y Maryland como fixture, y fijan que el brief activa «CMS Rural Health Transformation» y el término «Rural Health Transformation Program». | Familia RHTP y Maryland. No nombran ninguna convocatoria estatal. |
| **Cambio del motor de producción por la corrida IGC del 05-oct** | `750ae04`: `expand.mjs` antepone «Rural Health Transformation Program» a los términos del modelo en briefs rurales; `grantPortals.json` añade la página del CMS RHT. El comentario del test dice que la corrida del 05-oct **no** encontró convocatorias estatales del RHTP. | Toda la familia. Las corridas posteriores de IGC habrían buscado RHTP primero; sus salidas no están disponibles. |
| **Corrida real anterior del producto (Mentiva)** | `research/eval/runs/search-cache.json` (corridas del motor v2 del 30-sep) contiene URL RHTP de TX (URL exacta de la hoja), WI (URL exacta del Map), AK, ID, GA, ND, NC, NM y SD. La corrida `2026-09-30-23-10-qwen3-30b` **leyó y juzgó** una página con el RFA RHTP de Colorado y Healthy Horizons de Nuevo México. | Programa por estado. |
| **Piloto técnico B0/B1/B2 (Mentiva)** | `pilot-v2`: B0 descargó `ncdhhs.gov/about/grant-opportunities`; B1 recuperó la página del RHT Program en `medicaid.gov`. AHA no tocó RHTP. | NC y la familia. |
| **Caso formal de benchmark** | Ninguno: `research/bench/cases/` solo tiene README. | — |
| **Historia de la organización (fuera del sistema)** | IGC presentó en AK (Year 1) y en MD (hoja). | AK y MD. |

### 2.3 Clasificación
- **`previously_exposed` (19 filas de 11 estados):** AK, ND, TX, MD, NM, NC, SD, GA, CO, ID y WI. Cada fila del CSV dice qué artefacto la expuso.
- **`uncertain` (55):** no aparece ni la URL ni el nombre, pero la familia RHTP entró en el motor por la corrida IGC del 05-oct y esas salidas no se pueden revisar, así que no se puede descartar la exposición a nivel de convocatoria. KS y LA tienen además URL del mismo host en la caché, de tema no confirmado.
- **`not_found_in_prior_runs` (0):** ninguna fila cumple, porque todas pertenecen a la familia que se añadió al motor para este mismo perfil.

Una prueba unitaria o una corrida del producto **no** es un caso formal de benchmark. Aun así, las dos contaminan la selección de anclas: el ancla vendría de la familia que se ajustó a mano después de ver el fallo del motor con este perfil.

## 3. Control profile-first (Fase 2): **bloqueado**

1. **No existe un perfil MINT-AD congelado.** No hay `prof-*.json` de IGC/MINT-AD en `research/bench/**`; los únicos perfiles son los del piloto (AHA y Mentiva).
2. **No hay documentos propios de MINT-AD en el repo ni en la base local.**
   - `intake_sessions` y `account_profiles` mencionan IGC Pharma, pero ninguno menciona MINT-AD.
   - La única mención es un fragmento de `igcpharma.com/team` dentro de una corrida del 28-sep: «MINT-AD, an AI tool for risk stratification and prediction of cognitive decline».
   - Los briefs del 05-oct están en AWS y son inconsistentes entre sí. Uno describe MINT-AD como plataforma de cribado con el programa PRISM en Maryland; otro, como «pharma Alzheimer agitation, clinical_phase_2», que corresponde a IGC-AD1.
3. **No existe el «prompt de transformación de perfil».**
   - `prompts/manifest.json` solo versiona planner, extractor, eligibility_judge, preannotator y b0_templates.
   - El protocolo (§2.2.3) exige `profile_builder = "llm:<prompt>@vN"` con un prompt fijo.
   - AGENTS.md prohíbe editar `prompts/**`, y un prompt escrito ahora por quien ya leyó el Excel sería en sí mismo una vía de fuga.
   - La transformación por código que sí existe (`research/agent/profile.mjs`: `briefToProfile` / `intakeToProfile`, `code:briefToProfile@v1` en el piloto) necesita un brief o intake de MINT-AD, y no hay ninguno.
4. **El protocolo §2.3 choca con este perfil.** Dice: «Antes de congelar, el curator no ejecuta ningún sistema (… ni el producto) sobre los perfiles del benchmark». El producto ya se corrió sobre IGC/MINT-AD el 05-oct (y sobre IGC entre el 25 y el 30-sep). Si IGC/MINT-AD puede ser un perfil del benchmark es una decisión humana.
5. **El curator tiene que ser una persona** (H2, AGENTS.md regla 10). Este agente no puede firmar `construction.curator`.

**Consecuencia:** no se encargó el perfil a un subagente, porque no había ni documentos fuente ni prompt versionado que entregarle. No se creó ningún perfil, caso ni búsqueda manual. `builder_saw_anchor` no se escribió en ningún archivo.

## 4. Verificación oficial (Fase 4)

- **Cómo se hizo:** se abrió la página oficial de cada uno de los 50 estados el 2026-10-07 (o la página de financiación enlazada desde ella) y se aplicaron los estados de `LABELING_GUIDE.md` §1.
- **Fuentes que no se pudieron leer:**
  - TX, GA y NH devolvieron 403;
  - NV bloquea por robots.txt;
  - NY entra en un bucle de redirección;
  - SD usa un posting board que se arma con JavaScript;
  - MI y WA no muestran la lista en el HTML.

  En esos estados el status sale de la fecha de la hoja ya vencida, y queda con `verification_confidence = low` o con status `unknown`.
- **Fechas:** cada fila guarda la URL verificada, el identificador oficial cuando existe y la fecha del primer paso.
- **SearXNG local:** no estaba levantado (puerto 8888 rechazado), y la red del Mac no salía a los sitios estatales.

### 4.1 Abiertas o próximas (las tres están fuera de la hoja)

| Fila | Oportunidad | Status | Primer paso | Ruta | Por qué no es ancla |
|---|---|---|---|---|---|
| RS-002 | Alaska RHTP **Year 2 Fall 2026 Funding Cycle** (GrantInterface, sin LOI, ~US$75M) | `open` | **2026-10-28** 23:59 AKT | `direct_apply` posible: entre los tipos elegibles están «Technology and innovation partners»; a los de fuera del estado se les recomienda mucho tener partner, sin exigirlo | Sin perfil congelado; el programa estuvo expuesto (`previously_exposed`); IGC ya aplicó en Year 1 y no la aceptaron; elegibilidad dura `undetermined` |
| RS-055 | Virginia **CareIQ Tech Innovation Fund**, VIPC, **C-27-002** (US$250K–999,999; tecnología para enfermedades crónicas, TRL 4–7) | `open` | **2026-10-29** 17:00 | `direct_apply` si se cumplen: empresa con sede y propiedad en EE. UU., **menos de 10 años desde su fundación y menos de US$50M recaudados**; preferencia por Virginia | Sin perfil; las reglas de antigüedad y capital pueden excluir al solicitante (no se usó conocimiento externo para decidirlo); familia RHTP `uncertain` |
| RS-061 | Mississippi RHTP **Innovative Pilot Program Grant** | `upcoming` (abre el 2026-10-14) | 2026-11-16 | sin determinar (la elegibilidad no aparece en la página) | No está abierta hoy; sin perfil |

Las tres siguen abiertas el **2026-10-20**, el `run_config.today` de `config/v0.json`. Un caso exige `as_of` como mucho 2 días antes de esa fecha, así que cualquier ancla habría que reverificarla entre el 18 y el 20-oct.

### 4.2 Afinidad temática frente a elegibilidad
- La convocatoria con más afinidad temática es **Tennessee Memory Care Assessment Network** (cribado y diagnóstico de ADRD, navegadores de demencia, telesalud). Su ventana fue del 18-jun al 20-jul de 2026, así que está `closed` y no puede ser ancla abierta.
- En casi todas las demás, quien solicita es un hospital, un proveedor, una coalición regional, una ONG con sede en el estado o una entidad invitada. Por eso la ruta dominante es `partner_subaward` (35 filas), seguida de `not_actionable` (14) y `future_cycle` (13); `procurement_vendor` tiene 7 y `direct_apply` solo 5.

## 5. Filas excluidas y motivo

Motivos: `excluded_closed` significa que el primer paso ya venció o que la página oficial dice que está cerrada; `excluded_awarded` significa que hay ganadores publicados; `excluded_not_a_call` cubre páginas de programa, la NOFO federal, asignaciones directas o páginas de asociación; `excluded_unknown_status` es para estados en los que la fuente oficial no permite saber el status. La URL, la nota y la confianza de cada fila están en el CSV.

**excluded_closed** (42)

| Fila | Estado | Oportunidad (hoja) | Verificado | Primer paso | Exposición |
|---|---|---|---|---|---|
| RS-003 | North Dakota | RHTP RFP: Ensuring Safety Net Service Delivery (equipment/remodeling, TA, traini | closed (low) | 2026-05-29 | previously_exposed |
| RS-004 | North Dakota | RFA: strengthen care coordination and information exchange across North Dakota ( | closed (low) | 2026-08-31 | previously_exposed |
| RS-011 | Texas | $56M competitive chronic disease grant for rural hospitals | closed (low) | 2026-06-04 | previously_exposed |
| RS-013 | Maryland | Maryland RHTP First Combined RFA | closed (medium) | — | previously_exposed |
| RS-014 | Maryland | Maryland RHTP Data RFA | closed (medium) | — | previously_exposed |
| RS-015 | Minnesota | RHTP Notice of Grant Opportunity for rural hospitals (70% of award) | closed (high) | 2026-05-26 | uncertain |
| RS-017 | Oklahoma | Promoting School Health Services Through Medicaid Billing | closed (medium) | 2026-09-11 | uncertain |
| RS-018 | West Virginia | RHTP first-cycle full proposals (workforce, system operability) | closed (high) | — | uncertain |
| RS-019 | West Virginia | Expansion of adult medical daycare services | closed (high) | — | uncertain |
| RS-021 | Nevada | RHTP NOFO: accelerator / chronic disease prevention (full proposal) | closed (low) | 2026-07-06 | uncertain |
| RS-022 | South Carolina | SCDHHS RHTP RFAs (Year 1: Health IT modernization, EHR, RPM, assistive technolog | closed (high) | 2026-06-01 | uncertain |
| RS-023 | Alabama | Rural Health Initiative NOFO (Year 1) / Chronic Disease Management | closed (high) | — | uncertain |
| RS-024 | Montana | Montana RHTP RFPs (vendor registry; emergency equipment) | closed (medium) | — | uncertain |
| RS-027 | Michigan | Chronic Disease Collaborative Care Fund | closed (low) | 2026-08-06 | uncertain |
| RS-028 | New Mexico | Administrative Services Organization (ASO) RFP | closed (high) | — | previously_exposed |
| RS-030 | Utah | RFP: Behavioral Health—Primary Care Integration | closed (high) | 2026-06-29 | uncertain |
| RS-031 | Utah | $15M Value-Based Care Models RFP | closed (high) | 2026-07-22 | uncertain |
| RS-032 | Utah | Recruit and retain | closed (high) | 2026-08-04 | uncertain |
| RS-033 | Utah | Semantic data cloud | closed (high) | 2026-07-10 | uncertain |
| RS-034 | Utah | Food infrastructure | closed (high) | 2026-08-31 | uncertain |
| RS-036 | Idaho | Chronic disease prevention and treatment | closed (low) | 2026-09-08 | previously_exposed |
| RS-037 | Arizona | Arizona RHTP RFPs/RGAs | closed (medium) | — | uncertain |
| RS-039 | Washington | Provider Technology Fund (awards up to $500K) | closed (low) | 2026-08-13 | uncertain |
| RS-040 | North Carolina | NC ROOTS Hub Lead Candidacy Application | closed (high) | 2026-04-02 | previously_exposed |
| RS-041 | North Carolina | Mobile Integrated Health (MIH) and Community Paramedicine (CP) Expansion | closed (high) | 2026-05-20 | previously_exposed |
| RS-042 | Florida | RFA Health and Lifestyle | closed (low) | — | uncertain |
| RS-043 | Kentucky | RFA: dental hygiene program expansion (non-profit academic institutions, $10M) | closed (high) | — | uncertain |
| RS-044 | Kentucky | 'From Crisis to Care' EMS RFAs (Community Paramedicine; EMS Training Equipment;  | closed (high) | — | uncertain |
| RS-045 | South Dakota | Second round of RHT RFPs (invitation only) | closed (medium) | — | previously_exposed |
| RS-046 | South Dakota | RFA Digital Health Modernization | closed (low) | 2026-06-30 | previously_exposed |
| RS-047 | New Jersey | NJ RHTP first-cycle RFP | closed (medium) | — | uncertain |
| RS-048 | Kansas | 2026 Regional Partnership Grant Program RFA | closed (high) | 2026-04-03 | uncertain |
| RS-050 | Georgia | RFA Care to Consumer: Telepods | closed (low) | — | previously_exposed |
| RS-051 | Nebraska | Food as Medicine | closed (high) | 2026-04-08 | uncertain |
| RS-052 | Nebraska | Workforce Incentive and Sustainability | closed (high) | 2026-06-01 | uncertain |
| RS-053 | Nebraska | Chronic Disease Management | closed (high) | 2026-03-17 | uncertain |
| RS-056 | New York | First RFA: partnership coordination ($500K per county) | closed (low) | 2026-07-10 | uncertain |
| RS-058 | Louisiana | Telehealth Infrastructure for Rural Access Program (award only $500K) | closed (medium) | — | uncertain |
| RS-059 | Tennessee | RFA Memory Care Assessment Network (dementia care model: telehealth diagnostics, | closed (low) | 2026-07-20 | uncertain |
| RS-060 | Mississippi | RFA on Health Technology Advancement (HTAM) | closed (medium) | — | uncertain |
| RS-072 | Wisconsin | RFA Rural Technology and Innovation (Rural Technology Transformation) | closed (high) | — | previously_exposed |
| RS-074 | Ohio | Healthier Ohio Initiatives — Preventing & Addressing Chronic Disease (Track One) | closed (medium) | 2026-06-16 | uncertain |

**excluded_awarded** (13)

| Fila | Estado | Oportunidad (hoja) | Verificado | Primer paso | Exposición |
|---|---|---|---|---|---|
| RS-001 | Alaska | Alaska RHTP Year 1 Letter of Interest cycle | awarded (high) | 2026-03-11 | previously_exposed |
| RS-005 | Arkansas | THRIVE RFP: Telehealth, Health-monitoring & Response Innovation for Vital Expans | awarded (high) | — | uncertain |
| RS-006 | Arkansas | HEART full proposal | awarded (high) | — | uncertain |
| RS-007 | Vermont | AI Transcription/Scribe Technology RFP | awarded (high) | — | uncertain |
| RS-008 | Vermont | Remote Patient Monitoring subrecipient grant | awarded (high) | — | uncertain |
| RS-009 | Vermont | E-consult technology grant | awarded (high) | — | uncertain |
| RS-010 | Vermont | Telehealth grant | awarded (high) | — | uncertain |
| RS-016 | Oklahoma | Chronic Disease Management Program | awarded (medium) | 2026-06-08 | uncertain |
| RS-020 | Indiana | GROW Regional Grants (regional coalitions only) | awarded (high) | — | uncertain |
| RS-025 | Colorado | Colorado RHTP RFA (vendor interest form; webinars) | awarded (medium) | — | previously_exposed |
| RS-029 | New Mexico | Healthy Horizons — Hub Lead application (RFA) | awarded (high) | — | previously_exposed |
| RS-035 | Oregon | RHTP RFPs for rural hospitals (Catalyst Awards) | awarded (medium) | 2026-05-26 | uncertain |
| RS-049 | Georgia | GREAT Health LOI invitations to rural hospitals (primary care priority) | awarded (medium) | — | previously_exposed |

**excluded_not_a_call** (8)

| Fila | Estado | Oportunidad (hoja) | Verificado | Primer paso | Exposición |
|---|---|---|---|---|---|
| RS-012 | Texas | $60M RHTP direct awards | not_a_call (medium) | — | previously_exposed |
| RS-026 | Missouri | Missouri RHTP RFPs (expected Q3) / Missouri Rural Health Conference exhibitor | not_a_call (high) | — | uncertain |
| RS-065 | Illinois | Illinois RHTP (program page; no concrete call named in sheet) | not_a_call (medium) | — | uncertain |
| RS-066 | Pennsylvania | Pennsylvania RHTP (program page; no concrete call named in sheet) | not_a_call (medium) | — | uncertain |
| RS-068 | Hawaii | Hawaii RHTP (program page; no concrete call named in sheet) | not_a_call (medium) | — | uncertain |
| RS-069 | Massachusetts | Massachusetts RHTP (program page; no concrete call named in sheet) | not_a_call (medium) | — | uncertain |
| RS-070 | Rhode Island | Rhode Island RHTP (program page; no concrete call named in sheet) | not_a_call (medium) | — | uncertain |
| RS-071 | Connecticut | Connecticut RHTP (program page; no concrete call named in sheet) | not_a_call (medium) | — | uncertain |

**excluded_unknown_status** (8)

| Fila | Estado | Oportunidad (hoja) | Verificado | Primer paso | Exposición |
|---|---|---|---|---|---|
| RS-038 | California | California RHTP RFAs (EHR modernization) | unknown (low) | — | uncertain |
| RS-054 | Virginia | Live Well Together - Virginia Department for Aging and Rehabilitative Services | unknown (low) | — | uncertain |
| RS-057 | Iowa | Iowa RHTP RFAs (colorectal cancer, rural residencies, public health leads) | unknown (low) | — | uncertain |
| RS-062 | Wyoming | RFPs: chronic disease prevention — subaward release | unknown (low) | — | uncertain |
| RS-063 | New Hampshire | New Hampshire RHTP (program page; no concrete call named in sheet) | unknown (low) | — | uncertain |
| RS-064 | Ohio | Ohio RHTP (program page; no concrete call named in sheet) | unknown (low) | — | uncertain |
| RS-067 | Maine | Maine RHTP (program page; no concrete call named in sheet) | unknown (low) | — | uncertain |
| RS-073 | Delaware | RFA FQHC and Value-Based Care | unknown (low) | — | uncertain |

## 6. Límites de diversidad
- **Un solo perfil, un solo país y una sola familia de financiador:** IGC/MINT-AD, EE. UU., programa federal CMS que administran los estados. Aunque se resolviera el bloqueo, esta lista aporta **como máximo 2 casos ancla** (protocolo §2.3). No sirve para llegar a los 12–25 casos.
- **Lo que esta lista no cubre:** ni nonprofit ni academic como tipo de entidad, ni una región fuera de EE. UU., ni las familias fundación y prize/challenge.
- **Correlación entre anclas:** dos anclas RHTP de estados distintos no son casos independientes. Comparten el planner, el mismo tipo de página (`.gov` estatal) y el mismo sesgo del curator (protocolo §10.1).
- **Qué hacer con el resto:** las demás oportunidades válidas quedan como **candidatas de búsqueda manual o material de piloto**, no como casos.

## 7. Casos preparados (Fase 5)
**Ninguno.** No se cumple la primera condición: no hay un perfil independiente y congelado. Tampoco se creó un caso nulo. Las filas cerradas no lo justifican, y un caso nulo exige una búsqueda manual de 20 a 30 minutos para un perfil completo, que no existe.

## 8. Controles pendientes y decisiones humanas
1. **H1 · perfil.** Decidir si IGC/MINT-AD puede ser un perfil del benchmark a pesar de §2.3 (producto corrido el 05-oct). Si puede:
   - aportar los documentos fuente de MINT-AD (intake o documentos propios);
   - nombrar al constructor: persona B, o un prompt de transformación versionado con una nueva entrada en `prompts/manifest.json` que apruebe una persona.

   Sin eso, IGC/MINT-AD queda como **material de piloto**.
2. **H2 · anclas.** Si el perfil se congela, el curator humano elige como máximo 2 entre RS-002, RS-055 y RS-061, o fuera de esta lista. Después:
   - reverificar entre el 18 y el 20-oct, ya que `as_of` admite como mucho 2 días antes de `run_config.today` = 2026-10-20;
   - hacer la búsqueda manual de 20 a 30 minutos y guardarla según `manual_search.schema.json`;
   - documentar la exposición `previously_exposed` / `uncertain` en el caso o excluirlo.
3. **Exposición del 05-oct.** Revisar en AWS (lectura) las salidas de las corridas IGC/MINT-AD del 05-oct para convertir los 55 `uncertain` en `previously_exposed` o `not_found_in_prior_runs`.
4. **Estados con fuente oficial ilegible** (TX, GA, NH, NV, NY, SD, MI, WA). Una persona debe confirmar el status abriendo la página.
5. **Diversidad.** Buscar perfiles y anclas nonprofit, academic, de fuera de EE. UU., de fundación y de prize para llegar a 12–25 casos.
6. **Sin tocar:** `manifest.json` no se creó, `run_config.status` sigue en `draft` y no se ejecutó nada del benchmark.

## 9. Archivos
- `research/bench/case-prep/rural-state-candidates.csv`: 74 filas con las columnas normalizadas, la verificación, la exposición y la disposición de cada una.
- Este documento.
