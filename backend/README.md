# Warm Path Engine — backend v0.2

Recibe **el perfil de un proyecto + 5 comparables** y devuelve **20 inversores** con su tesis (citada), su ticket (declarado o estimado), por qué encajan y **el camino cálido más fuerte** para llegar a ellos, con la evidencia de cada eslabón.

Implementa la arquitectura del documento `propuesta_arquitectura_warm_path_engine_mvp_2026-09-23` (pasos 1–9).

> Leyenda en todos los outputs: **[H]** dato observado con cita · **[E]** estimado por heurística · **[?]** hipótesis que el founder debe confirmar. Nada se presenta como hecho sin fuente.

## Instalación (Mac)

```bash
cd REPOSITORIO
python3 -m venv .venv && source .venv/bin/activate
pip install -e "./backend[dev]"      # API + núcleo + pytest
pip install -e "./backend[all]"      # opcional: Splink + embeddings MiniLM
cd backend
pytest -q                            # 14 tests sobre datos 100% sintéticos
```

Variables de entorno:

| Variable | Para qué | Obligatoria |
|---|---|---|
| `SEC_USER_AGENT` | La SEC exige nombre + email, p. ej. `"Gisel Caicedo gisel@dominio.com"` | Sí, para Form D / EDGAR |
| `ANTHROPIC_API_KEY` | Extraer tesis/ticket de webs de fondos y rondas desde anuncios | No (sin ella se omite ese paso) |
| `WARMPATH_LLM_MODEL` | Modelo del LLM (Anthropic) a usar | No |
| `OPENALEX_MAILTO` | Pool "educado" de OpenAlex | No |

## Uso: de cero a 20 inversores

```bash
warmpath init                                   # crea data/warmpath.duckdb y config/*.yaml
# 1) edita config/project.yaml (perfil + founder + 5 comparables)
# 2) llena config/rounds.yaml con las rondas de los comparables (cada una con URL + cita literal)
warmpath extract-round "https://…/anuncio"      # opcional: el LLM propone la entrada y verifica la cita

# Universo público de fondos (SEC Form D, trimestres recientes)
warmpath formd-download 2026q2
warmpath formd-download 2026q1
warmpath formd-load data/raw/formd/2026q2_d.zip data/raw/formd/2026q1_d.zip
warmpath formd-columns data/raw/formd/2026q2_d.zip   # verificar encabezados la primera vez
warmpath edgar-search "Venture Capital Fund" --since 2026-07-01   # frescura < 1 trimestre

warmpath rounds config/rounds.yaml
warmpath formd-derive --since 2024-01-01        # fondos VC, partners, Form D de comparables

# Red del founder (exports locales; nada sale de la máquina)
warmpath linkedin exports/linkedin/             # carpeta del archivo de LinkedIn descomprimido
warmpath outlook  exports/outlook/              # .ics / .olm / .eml / mbox

# Opcional
warmpath adv-load ruta/ia_firms.csv --schedule-a ruta/schedule_a.csv
warmpath openalex                               # co-autorías (fuerte en health/biotech)
warmpath reporter "COMPARABLE 1" "COMPARABLE 2" # grants NIH de comparables

warmpath run                                    # resolve + 2º salto público + ranking + reporte
warmpath enrich-funds --limit 40                # tesis/ticket con cita para los rankeados
warmpath run                                    # re-rankea con tesis
```

Salida en `out/<run_id>/`: `recomendaciones.md`, `recomendaciones.csv`, `notion_import.csv` (columnas para la base "Funding — Inversores").

## API para el frontend

```bash
cd backend
warmpath-api                         # http://localhost:8000
```

La API expone el dashboard, configuración del proyecto, corridas del ranking, recomendaciones, revisión de entidades y registro de outcomes. La documentación interactiva queda disponible en `http://localhost:8000/docs`.

Después:

```bash
warmpath review list                            # matches dudosos de resolución de entidades
warmpath review accept <id_izq> <id_der>
warmpath confirm-edge <persona_a> <persona_b>   # confirmar un vínculo [?] con 1 comando
warmpath path <fund_id>                         # ver los 3 mejores caminos a un fondo
warmpath outcome <fund_id> intro_pedida --connector <persona>   # → intro_aceptada → reunion → dd → term_sheet
warmpath backtest --k 20                        # hit@20 / NDCG@20 con corte temporal
```

### Cómo conseguir los exports

- **LinkedIn**: Configuración → Privacidad de datos → *Obtener una copia de tus datos* → marcar **Conexiones** y **Mensajes**. Llega un zip; descomprimirlo en `exports/linkedin/`. Se leen `Connections.csv` y `messages.csv`; **de los mensajes solo se guardan metadatos** (quién, a quién, cuándo), nunca el contenido.
- **Outlook para Mac**: Archivo → Exportar → archivo `.olm` en `exports/outlook/`. *(El parser de .olm está hecho sobre el formato conocido; verificarlo con un export real).*
- **Outlook Windows (.pst)**: `brew install libpst` y `readpst -e -o exports/outlook_eml archivo.pst`; luego `warmpath outlook exports/outlook_eml`.
- **Calendario**: exportar/compartir el calendario como `.ics`.

### Pooling de redes con consentimiento (2º salto real)

```bash
warmpath consent add "Pascal …" --linkedin https://www.linkedin.com/in/…
warmpath linkedin exports/pascal_linkedin/ --owner-name "Pascal …" --owner-linkedin https://www.linkedin.com/in/…
warmpath consent revoke p:li:<slug>             # revoca y borra sus datos
```
Sin consentimiento registrado, la ingesta de la red de otro founder falla a propósito.

## Arquitectura (qué hace cada módulo)

| Paso | Módulo | Qué hace |
|---|---|---|
| A. Ingesta con procedencia | `db.py` | DuckDB; toda fila apunta a `provenance` (fuente, URL, fecha, fragmento, confianza) |
| | `ingest/sec_formd.py` | Form D Data Sets → `fd_filing`/`fd_person`; fondos VC (*Pooled Investment Fund + Venture Capital Fund*), GPs → `partner_of`; Form D de comparables → `director_of`, `co_director`; director de comparable que es GP de un fondo → `invested_in` **INFERIDO** (conf. 0,6) |
| | `ingest/edgar.py` | Full-text search + `primary_doc.xml` para Form D recientes |
| | `ingest/form_adv.py` | ADV (AUM, CRD, web) + Schedule A. Mapeo de columnas heurístico — **verificar formato** |
| | `ingest/rounds.py` | Rondas de comparables desde YAML; sin URL + cita literal no entra |
| | `ingest/fund_web.py` + `llm.py` | Webs de fondos (robots.txt, 1 req/s) → el LLM extrae tesis/etapa/ticket/equipo/portafolio; **se descarta cualquier campo cuya cita no aparezca literal en la página** |
| | `ingest/linkedin.py` | Parser propio de `Connections.csv` y `messages.csv` |
| | `ingest/outlook.py` | `.ics`, `.olm`, `.eml`, mbox — solo headers/asistentes; filtra newsletters/no-reply |
| | `ingest/academic.py` | OpenAlex (co-autorías solo entre personas ya en el grafo) y NIH RePORTER |
| B. Resolución | `resolve.py` | Reglas (LinkedIn, email, CIK, dominio, nombre+org) → probabilístico (scorer Fellegi-Sunter propio; Splink 4 desde 5.000 personas o con `--engine splink`) → cola de revisión 0,60–0,92 |
| C. Grafo | `graph.py` | DuckDB → NetworkX. Solo personas como intermediarios; "misma empresa" se vuelve arista débil (0,25) en vez de nodo; hipótesis de portafolio (0,30, marcada [?]) |
| D. Candidatos | `candidates.py`, `thesis.py` | semilla (invirtió en comparables) + ProbS por co-inversión + similitud de tesis (MiniLM o TF-IDF) + actividad; filtros duros de etapa/ticket/geo solo con dato conocido; etapa solo observada en rondas posteriores → ×0,6 |
| E. Warm path | `strength.py`, `paths.py` | Fuerza de vínculo (Gilbert & Karahalios): recencia, frecuencia, reciprocidad, duración, multiplexidad, intimidad → s ∈ (0,05, 0,95). Costo = −log s + penalización por salto (+0,7 si es hipótesis). Top-3 (Yen) + widest path + eslabón más débil |
| Output | `report.py` | Markdown, CSV y CSV para Notion; guarda la corrida para el registro de outcomes |
| Evaluación | `backtest.py` | Oculta la última ronda de cada comparable, usa los otros como semilla con corte temporal; hit@K y NDCG@K |

## Estado del prototipo: real vs. pendiente

- **Probado (tests sintéticos)**: esquema + procedencia, carga de Form D (zip con el formato de TSV documentado), parser de XML de Form D, LinkedIn, ICS/EML, resolución de entidades, fuerza de vínculo, pathfinder, ProbS, filtros, reporte, backtest, consentimiento y revocación, CLI completa.
- **Escrito pero no ejecutado contra la fuente real**: descarga de Form D/EDGAR, OpenAlex, RePORTER, webs de fondos y la API del LLM. Desde el entorno donde se construyó no había salida de red a sec.gov/openalex/nih. Primera corrida real: `warmpath formd-columns` para confirmar encabezados.
- **Por verificar con un archivo real**: `.olm` de Outlook para Mac y CSV de Form ADV.
- **Fuera de v1** (según la propuesta): OpenVC y Signal NFX (solo uso manual — sus términos prohíben extracción), Crunchbase, Microsoft Graph/OAuth, envío de correos, cobertura fuera de EE. UU. (Form D es solo EE. UU.), Supervised Random Walks / LightGCN (sin etiquetas aún), UI en Streamlit.

## Protección de datos

Todo corre local. `data/`, `exports/`, `out/` y `config/*.yaml` están en `.gitignore` — **no subir exports personales al repositorio**. Solo metadatos de mensajes/correos. Los contactos son terceros: aplica GDPR / Ley 1581 de 2012 (Colombia); `consent revoke` borra lo aportado por un founder. Esto no es asesoría legal.
