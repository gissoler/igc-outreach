# V14 · C0 · Respuestas de Gisel (13/10/2026)

Preguntas cerradas hechas antes de escribir el plan. Respuestas tal como se dieron.

| # | Pregunta | Respuesta | Efecto en el plan |
|---|---|---|---|
| 1 | ¿Se pueden mover archivos congelados a `research/_archivo/` con `git mv`, archivo por archivo? | «Sí, pero listarlos antes» | `V14-PLAN-CODEX.md` trae la lista (tarea F3.0). Codex no mueve nada hasta que Gisel firme la lista por escrito en ese archivo. Sin firma, F3 queda apagada. |
| 2 | Tope de créditos de Apollo para el benchmark | 50 créditos | Tope total para las dos corridas F2 (grant + inversionistas). F1 no llama a Apollo. `ApolloBudget({ perRun: 50, perDay: 50 })`. |
| 3 | ¿Quién etiqueta a mano 50–100 páginas y cuándo? | Gisel, esta semana | Plantilla `research/eval/gold-etiquetado-igc.csv` (100 filas). La medición de aciertos se activa cuando el archivo tenga ≥ 50 filas etiquetadas. |
| 4 | ¿Las pistas se muestran al usuario? | Ambas: alimentan la búsqueda y se listan aparte | El resultado tiene dos listas: `findings` (verificadas) y `leads` (pistas), y cada pista registra qué búsqueda o apertura produjo. |
| 5 | ¿Qué debe pedir el intake para que `product` quede claro? | «Eso no lo decido yo. Siento que cada brief debe cambiar dependiendo de cómo se va avanzando en la conversación, tal cual como pasa en un modelo como Gemini: yo le doy un oneliner o doc de lo que necesito, él lo interpreta, busca, y si ve que le falta algo se detiene y me pregunta, o hace el análisis antes para no gastar tokens. Hay que buscar literatura o qué se hace hoy en día con eso.» | No se fija una lista de campos. `V14-ARQUITECTURA.md` §3 diseña un paso 0 «entender el brief» en el bucle (interpretación, supuestos, hasta 3 preguntas antes de gastar búsqueda) con la literatura encontrada. En el benchmark no hay usuario: las preguntas se registran y el agente sigue con el supuesto escrito. |

Pendiente (sin respuesta): brief de inversionistas distinto del de IGC. Se usa el mismo brief (`eval/briefs/jefe-igc-mint-ad-2026-10-12.json`, `--objectives investment`).
