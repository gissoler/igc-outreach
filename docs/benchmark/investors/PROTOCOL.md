# Protocolo del benchmark de búsqueda y ranking de inversionistas v0

Estado: **propuesto**. Este documento no modifica ni reemplaza el benchmark de grants.

## Pregunta y alcance

El benchmark pregunta: dado el perfil congelado de una startup, ¿B2, con búsqueda adaptativa, encuentra y prioriza inversionistas institucionales activos y compatibles mejor que B0, con consultas estáticas, y B1, con una sola tanda de consultas generadas por el LLM?

La unidad evaluada es una firma o plataforma inversora institucional. Los vehículos se guardan como atributos de la firma. No se evalúan personas, emails, Apollo, warm paths, introducciones, reuniones ni probabilidad de inversión.

## Construcción del gold set

1. El perfil se construye exclusivamente a partir de documentos de la startup y se congela antes de buscar inversionistas.
2. El profile builder no puede ver fondos, anclas ni resultados del sistema y declara `builder_saw_investors=false`.
3. Un curator distinto inicia la búsqueda manual después del freeze.
4. B0, B1 y B2 usan el mismo buscador, modelo, fecha, caché, resultados por query, presupuesto, límites nominales, extractor, judge y ranking. Solo cambia la política de planificación.
5. El pool por caso une, por identidad de firma, el top-20 de todas las condiciones y seeds, hasta dos anclas y la búsqueda manual.
6. Un LLM de una familia distinta puede preanotar para priorizar revisión; nunca crea gold.
7. La adjudicación humana oculta condición, seed, rank y salidas del judge.
8. Un segundo revisor etiqueta una muestra estratificada de positivos, negativos, casos difíciles y desacuerdos.
9. Se reportan acuerdo bruto y Cohen's κ tanto para positivo (`gain >= 2`) como para hard eligibility.
10. Labels, thresholds, criterios y reglas de decisión quedan congelados antes de observar resultados. No se corrigen retrospectivamente para favorecer una condición.

## Diseño de casos

La corrida formal requiere entre 12 y 25 casos ancla, 2 o 3 casos nulos y máximo 2 anclas por perfil. La matriz de selección debe cubrir diversidad de sector, etapa, región y modelo de negocio; ningún estrato debe depender de una sola startup.

Un ancla es una firma con identidad verificada, activa o posiblemente activa, evidencia suficiente de compatibilidad, encontrada después de congelar el perfil y no escogida desde B0/B1/B2. No necesita haber invertido realmente en la startup. Una inversión histórica puede ser un control separado, pero no prueba fit ni actividad actuales.

Un caso nulo exige una búsqueda manual dentro de un alcance y tiempo predefinidos que no encuentre inversionistas activos con `gain >= 2`. “Difícil de financiar” no basta.

## Condiciones

- **B0:** plantillas estáticas versionadas: sector + venture capital; etapa + sector + investor; geografía + sector + fund; compañías comparables + investors; tesis específica; inversionistas activos recientes. No incluyen nombres de fondos.
- **B1:** una única llamada al planner en modo `initial_batch`; luego ejecuta la tanda completa sin adaptación.
- **B2:** la misma llamada inicial, seguida por reflexión sobre cobertura, duplicados y vacíos; termina por presupuesto, paciencia, dos pasos vacíos o `stop=true`.

El judge corre después de discovery. Sus resultados no pueden entrar al planner, las señales ni la parada.

## Pool, adjudicación y ganancia

La plantilla ciega está en `adjudication-template.csv`. Fuentes oficiales prevalecen cuando existen; directorios sirven para discovery, no para decidir. Cada label conserva URL, cita, fecha y notas.

La ganancia es ordinal y determinista:

- 0: identidad incorrecta; no es inversionista institucional; firma inactiva; sector off; hard eligibility ineligible; o relevancia irrelevant.
- 3: activa, strong, sector on, eligible, etapa y geografía met y sin incompatibilidad dura conocida.
- 2: plausible, active o possibly_active, sector on o partial, eligible o undetermined y sin criterio duro not_met.
- 1: pista débil que requiere investigación, evidencia insuficiente o varios unknown.

`gain >= 2` es positivo para pooled recall. `gain = 2` no implica que el fondo invertiría, respondería o aceptaría una reunión.

## Métricas y estadística

Por corrida: hit@20 del ancla, pooled_recall@20, nDCG@10, identidad correcta, exactitud de actividad, precisión/recall/F1 por estado y criterio, unknown_rate, hard_false_positive_rate, tasa de no inversionistas, tasa de empresas del portfolio confundidas, latencia y costo nominal.

Agregadas: curva pooled recall–costo, dispersión entre seeds, victorias/empates/derrotas, bootstrap pareado por caso, prueba de signos, abstenciones correctas en nulos como `x/y` y abstenciones falsas en anclas. No se reportan métricas de grants, respuesta, introducción o inversión.

## Regla de decisión (propuesta, no aprobada)

`status: proposed`. B2 avanzaría solo si supera a B0 y B1 en pooled_recall@20 con margen práctico y evidencia estadística, no degrada nDCG@10, mantiene hard false positives dentro del límite y conserva abstención en nulos. Los valores concretos figuran en `DECISIONS_PENDING.md` y deben ser aprobados antes de una corrida formal.

## Secuencia para el gold real

1. Aprobar criterios, thresholds, budgets, fuentes y muestra de doble revisión.
2. Seleccionar startups con consentimiento y documentos suficientes.
3. Construir y congelar perfiles; registrar hashes.
4. Curar anclas y nulos manualmente después del freeze.
5. Congelar configuración y ejecutar las tres condiciones.
6. Construir el pool, preanotar opcionalmente y generar hojas ciegas.
7. Adjudicar, doble revisar y congelar labels.
8. Calcular métricas una sola vez y aplicar la regla aprobada.
