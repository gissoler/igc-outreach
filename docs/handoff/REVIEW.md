# Checklist de revisión de cada entrega

Cada PR de Codex se revisa con esta lista. Un solo ítem bloqueante sin cumplir significa **rechazo**, y se devuelve con el número del ítem.

## A. Alcance (bloqueante)
- [ ] A1. El PR implementa una sola TASK y lo dice en su título (`TASK-0X: …`).
- [ ] A2. Solo toca los archivos que la TASK lista. Hay que ver `git diff --stat`.
- [ ] A3. No modifica `docs/contracts/**`, `prompts/**`, `research/tests/agent/fixtures/**`, `docs/BENCHMARK_PROTOCOL.md` ni `docs/ARCHITECTURE.md`.
- [ ] A4. No modifica el pipeline de producción (`research/server/research/**`). La única excepción es el cambio permitido en `fleet.mjs` (TASK-02). Tampoco toca la UI ni el backend Python.
- [ ] A5. No añade dependencias distintas de `ajv` y `ajv-formats`.

## B. Tests (bloqueante)
- [ ] B1. `npm --prefix research run test:agent` pasa en verde.
- [ ] B2. Cada ACC de la TASK tiene al menos un test cuyo nombre empieza por su id, y el test comprueba **los valores exactos** que indica `ACCEPTANCE.md`. No vale comprobar solo que «no lanza».
- [ ] B3. `npm --prefix research test` no empeora respecto a la línea base: 415 pass, 1 fail preexistente (`searchQuality.test.mjs:37`), 1 skip.
- [ ] B4. Ningún test usa red: se ejecutan con la red cortada (`HTTPS_PROXY=http://127.0.0.1:9`).
- [ ] B5. No se han debilitado tests: no hay `skip`/`todo` nuevos ni tolerancias más amplias que las del ACC.

## C. Contratos (bloqueante)
- [ ] C1. Todo objeto que cruza un límite (log, resultado, entrada o salida del LLM, etiqueta o métrica) se valida con `validate(name, …)` en el punto en que se produce.
- [ ] C2. No hay campos fuera del schema (`additionalProperties:false` se respeta; nada de `// TODO extra fields`).
- [ ] C3. Los prompts se cargan con `loadPrompt` y su sha queda en `versions.prompts`. No hay texto de prompt escrito dentro del código.

## D. Invariantes del diseño (bloqueante)
- [ ] D1. **Circularidad:** `signals.mjs`, `gaps.mjs`, `planner.mjs` y `search_agent.mjs` no importan `eligibility_judge.mjs` ni leen campos de `Judgment`. Se comprueba con `grep -nE "eligibility_judge|judgment|eligibility_class|recommendable"` sobre esos archivos, que debe salir vacío salvo en comentarios que prohíban su uso.
- [ ] D2. **Unknown nunca pasa a met:** ACC-14p existe y pasa. Las reglas se aplican solo en `applyRules`.
- [ ] D3. **Parada idéntica:** la paciencia y los presupuestos están en un único lugar (`search_agent.mjs` + `signals.mjs`) y no se ramifican por condición, salvo `planner_calls`, que solo existe en B2.
- [ ] D4. **Mismo modelo, buscador y topes:** ningún parámetro de la condición cambia el modelo, el proveedor, los topes, la temperatura del extractor o del judge, ni la descarga por defecto.
- [ ] D5. **Fechas:** la lógica nunca usa `new Date()` ni `Date.now()`. Solo `config.today` y el `clock` inyectado (este únicamente para `ts` y latencias).
- [ ] D6. **El planner no escribe URLs:** solo se descargan `result_id`/`link_id` validados. `isPublicUrl` se comprueba antes de cada descarga.
- [ ] D7. **Texto no confiable:** todo texto de página que entra en un prompt pasa por `sanitizePageText` y va dentro de `<page_data>`.
- [ ] D8. **Sin defaults inventados en el perfil:** ningún `?? 'for_profit'`, `?? 'US'` ni similares. Hay que buscarlos con grep.
- [ ] D9. **Ciego:** las hojas de etiquetado no contienen condición, seed, rank, juicio ni preanotación (ACC-33).

## E. Calidad (no bloqueante, pero se anota)
- [ ] E1. Funciones puras y pequeñas; los efectos (red, disco, reloj) se inyectan por `deps`.
- [ ] E2. Los errores tienen `code` del enum y un mensaje de 300 caracteres como máximo.
- [ ] E3. Los nombres de las métricas son los del schema. En código y reportes no aparece «recall» suelto en lugar de `pooled_recall`.
- [ ] E4. El PR explica qué decidió Codex que no estaba especificado. Debería ser nada; si hay algo, se revisa la decisión.
- [ ] E5. Los comentarios del código están en español o en inglés, de forma coherente con el módulo.

## F. Revisión manual del arquitecto
- [ ] F1. Leer `steps.jsonl` de las corridas fixture B0, B1 y B2 y comprobar que la historia se entiende sin abrir el código.
- [ ] F2. Desde la TASK-07, ejecutar una corrida B1 con proveedores reales sobre un caso **piloto** (no del benchmark) y revisar a mano 5 evidencias.
- [ ] F3. Comparar el diff con `ARCHITECTURE.md`. Cualquier divergencia se resuelve corrigiendo el código o abriendo una propuesta de cambio de diseño; nunca se acepta en silencio.
