# Protocolo del benchmark v0 (pre-registro)

Versión: `protocol@v1` · 06/10/2026 · Estado: **propuesta**. Las decisiones del 05/10 ya aprobadas en el vault están integradas aquí como restricciones. Los umbrales, N y el tratamiento de empates esperan la aprobación de Gisel (paso humano H4) **antes** de la primera corrida.

**Alcance honesto.** Esto es un harness exploratorio para comparar búsqueda estática y adaptativa sobre oportunidades ancla conocidas. Su resultado es una **regla de negocio interna** (`business_rule_exploratory`). No es una estimación general de recall ni de calidad del producto.

---

## 1. Pregunta única

> Con límites comparables, ¿B2 (planner adaptativo) recupera mejores candidatos que B0 (queries estáticas) y que B1 (una tanda de queries del LLM sin adaptación)?

**Métrica primaria:** `pooled_recall@20` en casos ancla, comparando B2 con B1.
**Secundarias:** `hit@20` del ancla, `nDCG@10`, elegibilidad por criterio, tasa de falsos positivos duros, exactitud de status, deadline e identidad, abstención, curva recall–costo, latencia y dispersión entre corridas.

## 2. Casos

### 2.1 Tipos
- **Caso ancla (12 a 25):** un perfil real y una «oportunidad ancla preadjudicada», es decir, una convocatoria abierta en la fecha de corrida y sin ganadores publicados.
- **Caso nulo (2 o 3):** un perfil real para el que la búsqueda manual no encontró ninguna oportunidad abierta y elegible dentro del alcance. Se reporta solo como «abstenciones correctas: x/y».

### 2.2 Orden de construcción (control de fuga)
Se usan perfiles de founders reales si existen. Hoy el vault solo tiene un perfil operativo parcial de IGC Pharma, el brief parcial de Mentiva y la documentación de producto de AHA, así que la construcción por defecto es esta:

1. **H1 · Perfiles primero.** El *profile builder* (persona B) arma el perfil (`profile.schema.json`) a partir de documentos de una organización real: intake, documentación propia o páginas públicas propias de la organización. No sabe qué anclas se elegirán y no busca convocatorias. Todo campo sin fuente queda en `null`. Al terminar, congela el perfil con fecha y sha256.
2. **H2 · Anclas después.** El *curator* (persona A, distinta de B) busca para cada perfil congelado una convocatoria abierta hoy, sin ganadores publicados y verificada en su página oficial. La registra en `case.anchor` con todos sus identificadores, la ruta esperada y por qué encaja. Además hace la búsqueda manual breve, de 20 a 30 minutos, y la guarda en `manual_search.schema.json`.
3. **Si B no está disponible**, el perfil se construye con transformación ciega: un LLM con un prompt fijo que solo recibe los documentos de la organización. En ese caso `profile_builder = "llm:<prompt>@vN"` y el curator no edita el perfil después.

`case.construction.profile_builder_saw_anchor` tiene que ser `false` y `selection_order` tiene que ser `profile_first`. El validador lo exige.

### 2.3 Diversidad y dependencia
- Como mínimo 3 tipos de entidad (for-profit, nonprofit y academic), al menos 2 regiones (EE. UU. y fuera de EE. UU.) y al menos 3 familias de financiador (federal o gobierno, fundación, y prize o challenge).
- Como máximo **2 casos ancla por perfil**. El bootstrap remuestrea casos; si dos casos comparten perfil, se avisa en el reporte.
- Antes de congelar, el curator no ejecuta ningún sistema (ni B0, ni B1, ni B2, ni el producto) sobre los perfiles del benchmark.

### 2.4 Congelación
`research/bench/cases/manifest.json` lista los casos con sus sha256 y los de sus perfiles. Su sha256 se anota en el Registro de decisiones antes de H5. Si un ancla cierra o publica ganadores antes de la corrida, el caso se **excluye y se reporta**; nunca se reemplaza después de ver resultados.

### 2.5 Piloto
Antes del benchmark se hace un piloto con 2 casos **distintos** a los del benchmark (por ejemplo, Mentiva y AHA con sus briefs actuales), solo para depurar el harness. Los prompts se pueden corregir después del piloto. **No se tocan después de congelar `run_config`.**

## 3. Condiciones y límites

Las tres condiciones usan el mismo `run_config` (ver `research/bench/config/v0.json`):

| Parámetro | Valor propuesto | Igual en B0, B1 y B2 |
|---|---|---|
| Modelo (planner, extractor y judge) | un único `agent_model` | sí |
| Buscador | un único `search.provider`, 10 resultados por query | sí |
| Búsquedas | 24 | sí |
| Descargas | 72 | sí |
| Tokens nominales de discovery | 600 000 | sí |
| Tiempo nominal de discovery | 1 200 s | sí |
| Paciencia N | 6 búsquedas seguidas sin oportunidad oficial nueva con ID estable | sí |
| Descarga por defecto | top-3 por búsqueda | sí |
| Judge | máx. 40 oportunidades, temperatura 0 | sí |
| Seeds | 101, 202, 303 (3 corridas por caso) | sí |
| Temperatura del planner | 0,7 (B1 y B2); B0 no llama al planner | — |
| Oracle | **fuera de la v0** | — |

- **B0:** queries renderizadas desde `prompts/b0/v1/templates.json`.
- **B1:** el planner, una sola vez, en `initial_batch` (hasta 24 queries).
- **B2:** el planner en `initial_batch` (6 queries) y después pasos adaptativos (hasta 3 búsquedas y 4 descargas extra por paso).

Algoritmos exactos en `ARCHITECTURE.md` §4 y §7.

Todas las condiciones corren **el mismo día** (`run_config.today`) y comparten la caché del día. Los presupuestos y los costos se cuentan en valores nominales.

## 4. Pool y etiquetado

### 4.1 Pool por caso
Es la unión de:
- (a) el top-20 de las 9 corridas (3 condiciones × 3 seeds);
- (b) el ancla;
- (c) los ítems de la búsqueda manual.

Los ítems se fusionan por identificadores normalizados (`identifierKeys`). Cada ítem del pool es un `stable_id` canónico.

### 4.2 Preanotación
Un LLM de **otra familia** que el agente (`preannotator_model.family ≠ agent_model.family`, verificado por código) preanota todos los ítems del pool con `prompts/preannotator/v1`. Ve el perfil y el texto de las fuentes del ítem, pero no ve qué sistema lo trajo ni el juicio de ningún sistema. La preanotación **nunca es gold**: solo sirve para estratificar y priorizar.

### 4.3 Adjudicación humana: muestra estratificada, ciega
Para cada caso, el harness genera la hoja de adjudicación con:

| Estrato | Qué entra | Cantidad |
|---|---|---|
| S1 | el ancla | siempre |
| S2 | ítems que alguna corrida marcó `recommendable` | todos (hacen falta para la tasa de falsos positivos duros) |
| S3 | ítems preanotados como positivos (gain ≥ 2) | todos (los jueces LLM sobre-etiquetan positivos: Alaofi et al.) |
| S4 | ítems preanotados con `hard_eligibility=undetermined` o `confidence=low` | hasta 10 por caso, al azar (seed 7) |
| S5 | negativos preanotados que no están en S1–S4 | 15 % al azar, mínimo 3 por caso si hay |
| S6 | casos difíciles: el `eligibility_class` de alguna corrida contradice la `hard_eligibility` preanotada, o las condiciones discrepan entre sí | hasta 5 por caso |

- **Ciega:** la hoja no muestra condición, seed, rank, juicio del sistema ni preanotación. Solo muestra el perfil, el nombre y las URLs del ítem, y enlaces a las páginas. El orden se baraja con seed.
- **Criterios:** por caso se etiquetan hasta 6 pares (ítem, criterio) tomados de S1 ∪ S2 ∪ S3 ∪ S6. Se estratifican por el estado que dio el judge (met, not_met, unknown y uno entre not_applicable y conflict), elegido por el código sin mostrárselo al humano. Objetivo total: ≥ 72 pares.
- **Segundo revisor:** unos 30 ítems (10 de S3, 10 de S5 y 10 de S4 ∪ S6), ciego también a la primera adjudicación. Se reporta el acuerdo bruto y la κ de Cohen sobre `gain≥2` y sobre `hard_eligibility`. **Si κ(gain≥2) < 0,6**, se ajusta la guía, ambos revisores re-adjudican juntos los desacuerdos y se reportan las dos κ. Esto queda fijado ahora, antes de ver datos.
- **Calibración del preanotador** (Thomas et al.): se reporta su precisión y recall sobre `gain≥2` contra la adjudicación humana. Ese número se usa solo para describirlo, nunca para corregir métricas.
- **Esfuerzo estimado:** entre 15 y 25 ítems por caso; con 12 casos son unos 250 ítems, a unos 3 minutos cada uno, ≈ 12 h de adjudicación más 1,5 h del segundo revisor.

### 4.4 Ganancia (fijada antes de correr)
La calcula el código a partir de la etiqueta humana:
1. `gain = 0` si `status ∈ {closed, not_a_call, awarded}`, o `scope = off`, o `hard_eligibility = ineligible`, o `route = not_actionable`.
2. Si no, `gain = 3` si `route = direct_apply` y `hard_eligibility = eligible` y `scope = on` y `status ∈ {open, rolling}`.
3. Si no, `gain = 2` si `route ∈ {direct_apply, partner_subaward}` y `status ∈ {open, rolling, upcoming}`.
4. Si no, `gain = 1`.

**Positivo** = `gain ≥ 2`. Los ítems del pool **no adjudicados** cuentan como `gain = 0` y se reporta cuántos negativos de S5 resultaron positivos (`negatives_found_positive`) como indicador de recall subestimado.

`direct_apply`, `partner_subaward`, `procurement_vendor`, `future_cycle` y `not_actionable` se etiquetan por separado. Un award ya concedido nunca cuenta como convocatoria abierta (decisión del 05/10).

### 4.5 Guía de etiquetado
Ver `docs/benchmark/LABELING_GUIDE.md`. La guía se escribe **antes** de H6 y no cambia durante la adjudicación, salvo por la regla de κ.

## 5. Métricas (definiciones exactas)

Para cada corrida `r` de un caso `c`, `top_k(r)` son los primeros `k` stable_ids de `result.ranked`. La coincidencia con un ítem del pool se hace por intersección de `identifierKeys`.

1. **hit@20** (solo casos ancla): 1 si algún ítem de `top_20(r)` coincide con el ancla; si no, 0.
2. **pooled_recall@20:** `|top_20(r) ∩ P_c| / |P_c|`, donde `P_c` son los positivos adjudicados del caso. Vale `null` si `|P_c| = 0`. **Siempre se llama `pooled_recall@20`** y se describe como relativo al pool, nunca como «recall».
3. **nDCG@10:** `DCG = Σ_{i=1..10} (2^{g_i} − 1) / log2(i+1)`, con `g_i` la ganancia del ítem en la posición `i` (0 si no está adjudicado o no está en el pool). `IDCG` usa las 10 mayores ganancias del pool. Vale `null` si `IDCG = 0`.
4. **Elegibilidad por criterio:** se comparan los pares (ítem, criterio) adjudicados con el estado del judge de esa corrida para ese ítem (si lo juzgó). Por condición se reportan:
   - la matriz de confusión 5×5;
   - precisión, recall y F1 para `met` y para `not_met` (uno contra el resto);
   - macro-F1 sobre los estados con soporte > 0;
   - `unknown_rate` del judge.
5. **hard_false_positive_rate:** entre los ítems `recommendable` de la corrida, la fracción que el humano etiquetó con `hard_eligibility=ineligible`, o `scope=off`, o `status ∈ {closed, awarded, not_a_call}`. Vale `null` si la corrida no recomienda nada.
6. **Exactitud de status, deadline e identidad**, sobre los ítems adjudicados del top-20 de la corrida:
   - `identity_accuracy` = fracción con `identity_correct=true`;
   - `status_accuracy` = fracción con `validity.status` igual al status humano, entre los que tienen identidad correcta (`unknown` del sistema nunca cuenta como acierto);
   - `deadline_accuracy` = fracción con `closes_on` igual al deadline humano (mismo día), entre los que tienen deadline humano no nulo.
7. **Abstención:**
   - En casos nulos, un caso cuenta como abstención correcta si ≥ 2 de sus 3 seeds se abstienen. Se reporta «abstenciones correctas: x/y» por condición.
   - En casos ancla, con la misma regla de mayoría, se reportan las «abstenciones falsas: x/y».
   - Nunca se presenta como una tasa estimada.
8. **Curva recall vs costo:**
   - Para cada corrida, con `prefix_curve`, en cada punto `k` se toman las entidades registradas hasta ese momento, se ordenan con sus juicios finales (`ARCHITECTURE` §8) y se calcula `pooled_recall@20`.
   - Malla de tokens nominales: 0, 50 000, …, 600 000. En cada punto de la malla se usa el último punto `k` cuyo costo no lo supera.
   - Se promedia por caso (sobre seeds) y luego entre casos. Salida en CSV y en tabla markdown.
   - Limitación: usa los juicios finales restringidos a lo descubierto hasta `k`.
   - **No se calcula «costo por elegible nuevo».**
9. **Latencia:** mediana por condición de los segundos nominales de discovery y judge.
10. **Dispersión:** por caso y condición, desviación estándar, mínimo y máximo de cada métrica sobre los 3 seeds. Se reporta además la mediana de esas desviaciones por condición.

Las corridas que terminan en `fatal_error` o `planner_error` **se cuentan** con las métricas que produzcan (normalmente 0). No se descartan.

## 6. Análisis

- **Valor por caso:** para cada métrica, la media de los 3 seeds de cada condición.
- **Diferencias pareadas:** `d_c = m_B2(c) − m_X(c)` para `X ∈ {B0, B1}`, solo en casos ancla.
- **Victoria, empate o derrota**, con margen de empate `τ` fijado ahora:
  - `pooled_recall@20`: τ = 0,05
  - `nDCG@10`: τ = 0,03
  - `hit@20`: τ = 0 (empate solo si es exactamente igual)
  - Si `|d_c| ≤ τ` es empate; si `d_c > τ`, B2 gana; si `d_c < −τ`, B2 pierde.
  - Los casos con valor `null` en alguna de las dos condiciones se excluyen de esa comparación y se cuentan aparte.
- **Prueba de signos** (unilateral): `p = P(X ≥ wins | n = wins + losses, 0,5)`. **Los empates se excluyen de `n`** y se reportan.
- **Bootstrap por caso:** 10 000 remuestreos de casos con reemplazo, seed `20261006`, sobre la media de `d_c`. IC95 por percentiles 2,5 y 97,5.

**Umbrales de la prueba de signos (p ≤ 0,05, unilateral):** victorias mínimas para cada `n` sin empates.

| n | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| victorias mín. | 6 | 7 | 7 | 8 | 9 | 9 | 10 | 10 | 11 | 12 | 12 | 13 | 13 | 14 | 15 | 15 | 16 | 16 | 17 | 18 |

Ejemplo del vault: con 12 casos, 10 victorias sobre 12 sin empates da p ≈ 0,019.

## 7. Regla de decisión `decision_rule@v1` (fijada antes de ver datos)

**ADOPT_B2** si se cumplen todas:
- **D1:** contra B1 en `pooled_recall@20`, hay `n` (casos sin empate) ≥ 8 y la prueba de signos da p ≤ 0,05.
- **D2:** contra B1 en `pooled_recall@20`, el límite inferior del IC95 bootstrap de la diferencia media es > 0.
- **D3:** contra B0 en `pooled_recall@20`, hay más victorias que derrotas.
- **D4 (guardarraíl de falsos positivos):** la media de `hard_false_positive_rate` de B2 es ≤ min(B0, B1) + 0,05, calculada sobre las corridas con valor no nulo.
- **D5 (guardarraíl de abstención):** las abstenciones correctas de B2 son ≥ max(B0, B1) − 1.
- **D6 (guardarraíl de hit):** la media de `hit@20` de B2 es ≥ la de B1 − 0,05.
- **D7 (integridad):**
  - ≤ 5 % de corridas con `fatal_error`;
  - todos los `steps.jsonl` válidos;
  - 0 casos en que un `unknown` se convirtió en `met` (lo verifica el código: un estado `met` final cuyo `llm_state` no era `met`);
  - κ(gain≥2) final ≥ 0,6.

**DO_NOT_ADOPT** si se cumple alguna:
- contra B1, las victorias son ≤ las derrotas;
- falla D4, D5 o D6.

**INCONCLUSIVE** en cualquier otro caso: por ejemplo, más victorias que derrotas pero p > 0,05, menos de 8 casos sin empate, IC que incluye 0, más del 50 % de casos empatados contra B1, o falla D7 (problema del harness, no del método).

**Precedencia (exacta):**
1. Si falla D7 → `INCONCLUSIVE`.
2. Si no, si se cumple alguna condición de `DO_NOT_ADOPT` → `DO_NOT_ADOPT`.
3. Si no, si se cumplen D1–D6 → `ADOPT_B2`.
4. Si no → `INCONCLUSIVE`.

`decision.label = "business_rule_exploratory"` en todos los casos. Con pocos casos, D1 se acerca a una prueba de signos, pero el resultado se presenta como regla de negocio sobre un harness exploratorio y no como evidencia estadística general.

## 8. Ejecución (comandos; los implementa TASK-09…11)

```
node research/bench/cli.mjs validate --config research/bench/config/v0.json --cases research/bench/cases
node research/bench/cli.mjs run-all  --config ...            # exige status=frozen; 3 seeds × 3 condiciones × casos
node research/bench/cli.mjs pool     --bench bench-v0
node research/bench/cli.mjs preannotate --bench bench-v0
node research/bench/cli.mjs sample   --bench bench-v0        # → out/<bench>/labeling/sheet-<case>.csv + .json (ciego)
node research/bench/cli.mjs import-labels --bench bench-v0 --file labels.csv --role adjudicator|second_reviewer
node research/bench/cli.mjs metrics  --bench bench-v0        # → metrics_report.json + report.md + curve.csv
node research/bench/cli.mjs decide   --bench bench-v0        # aplica decision_rule@v1 y la escribe en metrics_report.json
```

## 9. Pasos humanos

| Id | Paso | Quién | Antes de |
|---|---|---|---|
| H1 | Elegir organizaciones reales y construir o congelar perfiles a ciegas | persona B | H2 |
| H2 | Elegir anclas y casos nulos, verificar que siguen abiertos, búsqueda manual de 20–30 min, congelar el manifiesto | Gisel (curator) | H5 |
| H3 | Revisar y aprobar el catálogo de criterios (`status: approved`) y la lista de dominios oficiales | Gisel + Rohit/Mónica | H5 |
| H4 | Aprobar la regla de decisión, N, los presupuestos y τ (registrar como decisión) | Gisel | H5 |
| H5 | Congelar `run_config` (familias de modelo, fecha y proveedor; `status: frozen`) | Gisel | run-all |
| H9 | Autorizar el envío de perfiles al buscador, al modelo y al preanotador externo, y el gasto correspondiente | Gisel | run-all |
| H6 | Adjudicar las hojas ciegas | Gisel | metrics |
| H7 | Segundo revisor, unos 30 ítems | otra persona | metrics |
| H8 | Leer fallos: al menos 1 caso perdido por condición, clasificado con la taxonomía de `LABELING_GUIDE.md` §9 | Gisel | decisión final |

## 10. Amenazas a la validez (se declaran en el reporte)

1. **Sesgo del curator:** las anclas que encuentra una persona con búsqueda web son, por construcción, encontrables con búsqueda web. Eso favorece a cualquier sistema basado en un buscador frente a otros (por ejemplo, registros oficiales).
2. **Sesgo del pool:** los positivos solo pueden venir de lo que trajo algún sistema o la búsqueda manual. `pooled_recall` sobrestima el recall real.
3. **Prompts escritos por el mismo arquitecto** para B1 y B2. El prompt compartido reduce la asimetría, pero no la elimina.
4. **Familia del modelo:** planner, extractor y judge son el mismo modelo. Los resultados no se generalizan a otros modelos.
5. **n pequeño:** con 12 a 25 casos, la v0 solo detecta efectos grandes.
6. **Web cambiante:** se mitiga con la ejecución el mismo día y la caché compartida, pero no se elimina.
7. **Perfiles parciales:** muchos campos `null` empujan al judge hacia `unknown`. Es lo correcto, pero reduce `recommendable` en todas las condiciones por igual.

## 11. Qué no se afirma
- No se afirma que B2 encuentre «todos» los grants elegibles.
- No se afirma que el judge esté validado para producción; solo se mide su acuerdo con la adjudicación.
- No se afirma que los papers citados validen el diseño. Respaldan principios concretos (`ARCHITECTURE` §14) y no demuestran transferencia a grants.
