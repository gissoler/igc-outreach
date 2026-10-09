# Prompt — v6 (entrega del benchmark del 2026-10-09)

Contexto. Repo `/Users/gcaicedo/Documents/PROJECTS/AGENT`, rama `main`, código en `research/bench/investors`. Estado heredado: v5 con el smoke fallado tras 3 iteraciones (`docs/handoff/V4-SMOKE.md`, secciones V5-DBG-1/2/3, commit `8339bef`): núcleo 40,7 % (meta 60 %), citas 100 %, D1/D2 con ganancia ≥ 2 en B2, D3 con `insufficient_evidence`, FETCH_EMPTY 0,6 %, rechazadas/fetches 0,644. Hoy (2026-10-09) hay que entregar el benchmark. Reunión con David Castro (11:18): ver ajustes abajo.

## 0. Autorizaciones de la usuaria (confirmadas al pegar este prompt; si alguna no aplica, bórrala antes de pegar)
1. Se corren las 90 corridas formales con la config v5 **aunque el smoke no pasó**. Los resultados del smoke se reportan tal cual como limitación conocida; no se cambian umbrales, juez, normalization ni prompts congelados.
2. Entrada 18 de `DECISIONS_PENDING.md` aprobada con `max_firms_per_run = 16`, `max_queries_per_firm = 2`, `max_fetches_per_firm = 4`. Registra la aprobación en el archivo con fecha y hora; no extiendas el alcance.
3. Los cambios nuevos de este prompt (sección 2) van **detrás de flags o como condiciones nuevas, apagados por defecto**: las corridas B1/B2 formales no los usan y su comportamiento queda idéntico al de v5.

## 1. Orden y plazo
Hora local Bogotá. Reporta cada fase en 5 líneas y no pares entre fases salvo que falle un criterio de aceptación de esa fase.
- Fase A — congelar y lanzar las 90 (sección 3). Es lo primero. Objetivo: lanzadas antes de las 15:30.
- Fase B — mientras corren, implementar y probar la sección 2 (con dependencias simuladas; sin tocar archivos que usan las corridas en curso: trabaja en archivos nuevos o en una copia).
- Fase C — pares de intenciones (sección 4) y ablación con embeddings (sección 5), solo cuando la Fase A haya terminado.
- Fase D — informe (sección 6). Si a las 20:00 no terminó algo, entrega lo que haya con el estado explícito de lo pendiente; no esperes a completarlo.

## 2. Ajustes de la reunión con David (qué construir)
**2.1 Sensibilidad a la formulación de la intención (benchmark).** Dos intenciones (no queries; la query es la traducción de la intención a lenguaje de máquina) **semánticamente equivalentes pero pragmáticamente distintas** deben dar resultados comparables. Ejemplo de David: «busco inversionistas para una app que reduzca emisiones de carbono» frente a «busco inversionistas para una app que reduzca contaminación y gane bonos de carbono». Se mide cuánto cambian los resultados entre las dos (cantidad y naturaleza). Si cambian mucho, hay espacio para mejorar la traducción de la intención.
- Construcción: perfil primero, sin ver inversionistas (`profile_builder_saw_investors: false`), igual que los casos actuales. Solo cambia el texto libre del brief (descripción, sector en lenguaje natural, propuesta de valor); los campos estructurados quedan iguales para que el juez y el oro sigan siendo comparables.
- Definición escrita en el informe de «semánticamente equivalente» (mismo significado literal) y «pragmáticamente distinto» (distinto énfasis, vocabulario o intención comunicativa: p. ej. problema frente a incentivo).

**2.2 Filtro de relevancia por embeddings (ablación, apagado por defecto).** Para cada consulta que devuelve N resultados (p. ej. 70): embedding de la intención del usuario y embedding de título + primer párrafo de cada resultado; similitud coseno; se conservan los k más altos (k = 10); un LLM lee solo esos y conserva los que hablan de **inversión**, no solo del mercado o tema (ejemplo de David: artículos sobre baterías de fosfato en Australia frente a inversiones en ellas). Si no queda ninguno, pasa al siguiente bloque de 10. Modelo local gratuito de Hugging Face (preferir una opción sin Python, p. ej. `@xenova/transformers` con `Xenova/multilingual-e5-small` o `all-MiniLM-L6-v2`; dilo si la red de la Mac no permite descargarlo y entonces para y repórtalo). Flag `relevance.embeddings.enabled`, condición nueva `B2E` (= B2 + este filtro). No cuenta como fetch, ni como rechazo; sus tokens/tiempo se reportan aparte. El contrato nuevo (schema, config v6 derivada de v5 con `status: draft`, nuevo `bench_id`) no modifica ningún archivo del fingerprint de v5.

**2.3 Parar antes cuando hay poco (solo diseño y registro, no se activa en las 90).** David: es mejor decirle al usuario «encontré poco» tras 2 rondas que hacerle esperar 4 rondas sin resultados. Añade solo el campo informativo `sparse_after_round_2` (verdadero si tras la ronda 2 hay < 3 firmas aceptadas) en el resultado de la condición B2E y la métrica correspondiente; no cambies las reglas de parada de B1/B2. Pregunta al usuario por la reformulación = fuera de alcance de hoy (no hay usuario en el benchmark); déjalo escrito como trabajo siguiente.

## 3. Fase A — congelar y lanzar
1. `git status` limpio. Confirma que `config/v5-2026-10-09.json` tiene `deepening.max_firms_per_run: 16`.
2. Congela v5 (`status: frozen`) y genera `out/<bench_id>/fingerprint.json` (sha256 de config v5, manifest, prompts, schemas, `normalization.v1.json`, `extractor/judge/engine/normalize/resolve/deepening.mjs`, casos y oro).
3. Corre `test:investors`, v4 y v5 (ACC-58 puede fallar solo por la ruta de git de macOS). Si falla otra cosa, para y reporta.
4. Preflight del lector (Docker/Crawl4AI) como en el smoke.
5. Lanza, una sola vez: `run-experiment.mjs --config ...v5-2026-10-09.json --cases ...cases --out ...out/<bench_id> --conditions B1,B2 --seeds 101,202,303 --concurrency 3` — 15 casos (p01–p12, n04, r13, r14) × B1 y B2 × 3 semillas = 90. Apollo/B3: 0. Fallos de infraestructura: se reportan y se repiten sin cambios.
6. Si una corrida o el proceso se cae, no relances todo: reanuda lo que falta.

## 4. Fase C.1 — pares de intenciones
- 6 pares sobre p01–p06: variante A = brief original; variante B = brief reescrito (sección 2.1). Condiciones B1 y B2, semillas 101/202/303 ⇒ 6 × 2 (variantes) × 2 × 3 = 72 corridas de las cuales las de la variante A ya existen (no se repiten) ⇒ 36 nuevas.
- Métricas **sin etiquetas**, por par y condición y semilla: número de firmas aceptadas, solapamiento (Jaccard) de firmas por `stable_id`, distribución de tipos de inversor, proporción de ganancia ≥ 2 según las etiquetas ya existentes (las firmas nuevas sin etiqueta se cuentan y se listan, no se etiquetan), y número de queries/fetches. Reporta la mediana y el rango por par. Pre-registra antes de correr: «el par es sensible» si Jaccard < 0,5 o el número de firmas aceptadas difiere > 30 %.
- No hay prueba de hipótesis confirmatoria: es descriptivo y exploratorio. Dilo.

## 5. Fase C.2 — ablación B2E
- Solo si 2.2 quedó implementado y probado. p01–p12 × B2E × semilla 101 (12 corridas), mismo oro. Compara contra B2 de la misma semilla: firmas aceptadas, ganancia ≥ 2 con etiquetas existentes, rechazadas/fetch, tokens y tiempo (con el costo de embeddings y del LLM de lectura aparte).
- Ablación exploratoria, no entra en la regla de decisión congelada.

## 6. Informe (Fase D)
- `REPORT.md` en la carpeta EVID-v4 + copia en `docs/handoff/V4-REPORT.md`. Solo cifras, sin adjetivos; sin afirmar éxito si algo falla.
- Obligatorio: tabla de resultados del smoke (los tres intentos), declarando que las 90 corridas se lanzaron con el smoke fallado por autorización de la usuaria.
- Métricas sin etiquetas: núcleo ≠ unknown, al menos 1 conocido, citas literales, positivos con ganancia ≥ 2 en ≥ 2 de 3 semillas (meta ≥ 10/12), nulos con 0 ganancia ≥ 2 y abstención válida ≥ 80 % e `insufficient_evidence` ≤ 20 %, rechazadas/fetch, FETCH_EMPTY, tokens y tiempo con la ronda de profundización aparte. Para D3 y nulos reales: reporta cuántas abstenciones son `insufficient_evidence` y por qué (criterios duros en unknown), sin reclasificarlas.
- Hojas ciegas con `analysis/make_sheets.mjs` para el pool v4/v5 menos oro/v3: **no etiquetes**; reporta cuántas firmas quedan sin etiqueta. `decide.mjs` solo si existen etiquetas nuevas; si no, escribe que la regla de decisión congelada no se pudo evaluar con las firmas nuevas y evalúala solo con las etiquetas ya existentes, indicando cuáles.
- Resultados de la sección 4 y 5 con su estado (hechos, parciales o no hechos).
- Sección «Qué no se pudo verificar» explícita y sección «Trabajo siguiente» con: el valor de los umbrales de núcleo y D3 frente a la política del juez para valores vagos (decisión de la usuaria), la reformulación con el usuario (2.3) y cualquier hallazgo de la sección 4 que sugiera mejorar la traducción de la intención.

## 7. Reglas que no cambian
Sin atribuciones de Claude en commits (`Co-Authored-By`, `Claude-Session`). Sin tocar umbrales ni archivos congelados. Una corrida formal se hace una vez. Todo en español, texto plano en el chat; los archivos van al repo.
