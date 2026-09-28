# Agente asesor de IGC Outreach (28-sep-2026)

**Qué es.** Una capa que hace lo que haría un consultor de fundraising con la evaluación: reencuadra a los candidatos, arma la lista corta, explota el warm path a través de conectores y mantiene la relación con updates periódicos hasta el roadshow. Implementa el playbook de Alan.

Está en **Análisis → Asesor** (pestaña por defecto) y en el botón **"Qué haría un asesor"** de la evaluación.

## 1. El playbook de Alan, con fuente

Jean-Charles Samuelian (Alan) cuenta cómo levantaron la Serie A en 10 días ([Our toolkit to raise $28 million in 10 days](https://medium.com/alan/our-toolkit-to-raise-28-million-in-10-days-b40dc936084d)). El warm path de Alan no fue una intro puntual: fue una **relación construida con updates antes de pedir**.

| Regla | Qué dice la fuente | Cómo lo aplica el agente |
|---|---|---|
| P1 | "Update every 4 to 6 months your preferred investors on your market." | Cadencia por defecto de 4 meses (se puede elegir 2 o 6); el update incluye una sección de mercado |
| P2 | "12 is a maximum…" (y una lista de "10-ish VCs") | La lista corta tiene un máximo de 12; el checklist pide 8–12 |
| P3 | "Don't waste time when they don't invest often in your geography, business or at other ticket sizes." | Solo entran decisores del tipo de financiación pedido |
| P4 | "Always be transparent, share information to everyone at the same time." | El update es igual para todos (más una línea personal). Encaja con Reg FD para IGC |
| P5 | Mark Suster: "Meet your potential investors early. Tell them you're not raising money yet…" ([Invest in lines, not dots](https://medium.com/both-sides-of-the-table/invest-in-lines-not-dots-611f36491d73)) | El primer contacto pide consejo y permiso para mandar updates, no dinero |

Las citas se tomaron con una herramienta de lectura web. Conviene verificarlas literal.

## 2. Qué hace (el código decide; el modelo solo redacta)

1. **Reencuadre.** Clasifica a cada persona como decisor, decisor por confirmar, conector interno, conector externo, plataforma o convocatoria.
2. **Lista corta** (máximo 12), priorizada por score + warm path. Muestra los excluidos con su motivo.
3. **Warm path al revés.** Para cada conector, a cuántos decisores de la lista abre la puerta y con qué eslabón más débil.
4. **Etapa de la relación**, calculada con los acercamientos registrados: sin contacto → en la lista → calentando (2 o más updates o una respuesta) → reunión, o descartado. Muestra la siguiente jugada y la fecha del próximo update.
5. **Diagnóstico** con hallazgos F1…Fn, cada uno marcado [V] (verificado) o [I] (inferencia).
6. **Checklist de roadshow y plan con fechas.**
7. **Updates.** Formulario por periodo (TL;DR, métricas actual/anterior, avances, lo que no salió, mercado, pedidos, hitos, meses para abrir la ronda). Una línea con `[privado]` o una métrica sin marcar como pública **nunca sale**.
   - A un **decisor**: "no estamos levantando todavía" + update + "¿te sigo escribiendo cada pocos meses?". Cuando está caliente y la ronda abre en ≤ 1 mes, pide 20 minutos.
   - A un **conector**: update + un pedido de intro concreto a los decisores que puede abrir.
   - **Intro de doble opt-in**: pedido al conector + texto reenviable. Nunca escribe en nombre del conector.
8. **"Ya lo envié: registrar"** crea el acercamiento (canal `update`, `intro_advisor`…), y el asesor recalcula la etapa. La app no envía nada.

**Verificación de lo que redacta la flota:**

- Memo: se descarta cualquier párrafo que cite un hallazgo inexistente o que tenga una cifra que no está en el paquete.
- Update: si aparece una cifra nueva, se vuelve a la plantilla.

### Lo que dijo sobre la evaluación real (Mentiva, 27-sep)

- **F1:** la recomendación #1 (Andres Sanchez, Investor Relations de IGC) no es un inversionista: es el puente.
- **F7 [I]:** "red prestada". Los inversionistas y analistas que ya siguen a IGC son el warm path más grande.
- **F2:** Lucas Roquilly y Stephane Nasser son de OpenVC, una plataforma, no un fondo.
- **F3:** Ben Robbins (GV) y Trip Hofer (.406) no tienen cargo confirmado.
- **Red:** 69 contactos (41 de Connections.csv); ninguno fuera de IGC en un fondo o con cargo de inversión.
- **F8:** 12 de los 20 resultados son grants, aunque se pidió inversión.
- **Lista corta: 5 decisores.** Camillo Schobesberger (hipótesis vía Andres, 20 %), Erin Sietstra y Nathaan Demers (Hopelab), Ben Robbins y Trip Hofer.

## 3. Prompts de la flota (vLLM)

Están en `server/analysis/advisor.mjs` (`MEMO_SYSTEM`, `UPDATE_SYSTEM`) y usan `response_format: json_schema` (`MEMO_SCHEMA`, `UPDATE_SCHEMA`).

Variables en `research/.env`:

- `ADVISOR_ROLE`: rol de la flota. Por defecto `chat` (qwen-30b); también sirven `reasoning` o `small`.
- `ADVISOR_MODEL`: id de un adaptador LoRA servido en ese puerto (opcional).

**No hace falta entrenar para usarlo.** Sin flota corre por reglas; con flota, el prompt y la verificación ya funcionan.

## 4. Entrenar el modelo propio (cuando haya datos)

Cada borrador redactado por la flota se guarda en `advisor_generations`. En la app, **Aprobar / Guardar mi edición / Rechazar** lo convierte en dato de entrenamiento: SFT con lo aprobado y editado, y DPO con el par (tu edición vs. la salida del modelo).

| # | Dónde | Comando | Umbral |
|---|---|---|---|
| 1 | Mac | `node scripts/advisor-trainset.mjs --stats` | — |
| 2 | Mac | `node scripts/advisor-trainset.mjs` → `backend/ml/data/advisor_{sft,dpo,test}.jsonl` (15 % test, división estable) | — |
| 3 | GPU | `python train_advisor.py sft --base <id> --out out/advisor-lora` | ≥ 200 SFT |
| 4 | GPU | `python train_advisor.py dpo --base <id> --adapter out/advisor-lora --out out/advisor-lora-dpo` | ≥ 100 pares |
| 5 | GPU | `vllm serve <id> --port 8001 --enable-lora --max-lora-rank 16 --lora-modules advisor-lora=/ruta` | — |
| 6 | Mac | `node --env-file-if-exists=.env scripts/advisor-eval.mjs --a chat --b advisor-lora` → cifras inventadas, refs inválidas y un CSV ciego A/B en `backend/eval/results/` | Adoptar solo si no inventa más y gana o empata en la revisión ciega |
| 7 | Mac | `ADVISOR_ROLE=small`, `ADVISOR_MODEL=advisor-lora` | — |

## 5. Verificación

- Tests: **113, 112 pasan, 0 fallan** (7 nuevos en `tests/analysis.advisor.test.mjs`).
- `tsc` y `vite build` sin errores.
- Capturas revisadas: pestaña Asesor, borrador a un decisor, pedido de intro y botón en la evaluación.

## 6. Límites y pendientes

- **No probado contra la flota real:** la red de la sesión la bloquea. El pulido y el memo con qwen se probaron con respuestas simuladas.
- **El ranking principal de la evaluación sigue recomendando a Andres Sanchez como "contactar directamente".** Falta llevar el reencuadre a `core.mjs` para que la tarjeta principal no lo trate como objetivo.
- **Clasificación por reglas:** cargos raros pueden caer en "sin papel claro". Revisar los excluidos.
- **Pendiente:** la sección de mercado del update la escribe Gisel. Una versión futura puede proponer 1–2 líneas con fuentes de la investigación (con cita).
- **Temporal:** `workspace_notes/_verificacion_asesor.tgz` se puede borrar. Hay un respaldo previo en `workspace_notes/respaldo_2026-09-28_asesor/`.

**Archivos nuevos:**

- `research/server/analysis/advisor.mjs`
- `research/server/analysis/advisorRoutes.mjs`
- `research/scripts/advisor-trainset.mjs`
- `research/scripts/advisor-eval.mjs`
- `backend/ml/train_advisor.py`
- `research/tests/analysis.advisor.test.mjs`
- `frontend/src/app/Advisor.tsx`

**Archivos modificados:** `analysisStore.mjs` (tablas `advisor_updates` y `advisor_generations`), `outreach.mjs` (canales `update` y `pedido_consejo`), `index.mjs`, `analysisApi.ts`, `Analysis.tsx`, `App.tsx`, `Evaluation.tsx` y `app.css`.
