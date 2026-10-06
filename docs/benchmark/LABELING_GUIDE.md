# Guía de etiquetado — benchmark v0 (`labeling_guide@v1`)

Esta guía es para quien adjudica (H6) y para el segundo revisor (H7). Se congela antes de empezar a adjudicar; solo se cambia si se activa la regla de κ (protocolo §4.3).

## 0. Cómo trabajar
1. Abre la hoja de tu caso. Cada fila es un ítem e incluye el perfil (con los campos desconocidos marcados), el nombre del ítem y sus URL.
2. **Decide solo con la fuente oficial.** Ábrela tú. Una noticia, un blog o un agregador sirven para llegar a la fuente oficial, nunca para decidir.
3. Etiqueta tal como están las cosas en la **fecha del benchmark** (`run_config.today`). No uses lo que sepas por otros medios del perfil: solo vale lo que dice el perfil.
4. Si en 5 minutos no puedes decidir un campo, márcalo como no determinable (`undetermined` o `unknown`, según el campo), pon `confidence: low` y explica en `notes` qué falta.
5. No busques ni consultes qué sistema trajo el ítem.

## 1. `status`
- `open`: se puede aplicar hoy y el primer paso (LOI, registro o propuesta) vence hoy o después.
- `upcoming`: tiene fecha de apertura futura publicada para este ciclo.
- `rolling`: acepta solicitudes de forma continua y hay alguna señal de que está vigente (dice «now accepting» o tiene fechas de este año).
- `closed`: el primer paso ya venció, o la página dice que está cerrada.
- `awarded`: es un premio, grant o award ya concedido, con beneficiarios.
- `not_a_call`: no es una convocatoria. Puede ser un informe, una noticia, un evento, un directorio, la página general de un financiador o la cohorte seleccionada.
- `unknown`: la fuente oficial no permite saberlo.

## 2. `deadline`
La fecha del **primer paso** que puede dar el solicitante hoy, en formato `YYYY-MM-DD`. Si hay LOI y propuesta completa, cuenta la LOI. Para `rolling` o cuando no hay fecha, deja `null`.

## 3. `identity_correct`
`true` si el registro del sistema (nombre, organismo, identificadores y URL) describe **una** oportunidad real y la describe bien. `false` si mezcla dos oportunidades, si el número o el organismo son de otra, o si el nombre corresponde a otra página. `null` para ítems que solo vienen del ancla o de la búsqueda manual.

## 4. `scope`
- `on`: lo que la convocatoria dice que financia incluye claramente el proyecto del perfil (tema **y** tipo de trabajo).
- `partial`: hay solape real, pero hace falta adaptar el proyecto o solo cubre una parte.
- `off`: es otro campo, o la convocatoria excluye explícitamente ese tipo de trabajo o esa población. Compartir palabras como «research», «data» o «innovation» no basta para `partial`.

## 5. `hard_eligibility`
- `eligible`: con lo que dice el perfil, se cumplen **todas** las reglas duras publicadas (tipo de entidad, país, PI, small business, componente extranjero, cost share, partner obligatorio y requisitos propios de la convocatoria).
- `ineligible`: al menos una regla dura **no** se cumple con lo que dice el perfil.
- `undetermined`: ninguna regla falla, pero al menos una depende de un dato que el perfil no tiene. Un dato desconocido **nunca** cuenta como cumplido.

## 6. `route`
- `direct_apply`: el perfil puede aplicar como solicitante principal.
- `partner_subaward`: solo puede participar como socio, subaward o co-PI de una institución elegible.
- `procurement_vendor`: la vía es vender un servicio a quien recibe el financiamiento, o una licitación.
- `future_cycle`: no hay ciclo abierto, pero el programa es recurrente y encaja.
- `not_actionable`: no existe una vía realista.

## 7. Criterios (solo en las filas que los piden)
Para cada criterio pedido, el estado es uno de estos cinco:
- `met`: hay una cita en la fuente oficial **y** un dato en el perfil que lo cumplen.
- `not_met`: hay una cita **y** un dato en el perfil que lo incumplen.
- `unknown`: falta la cita o falta el dato del perfil.
- `not_applicable`: la convocatoria no impone ese requisito. Solo si leíste el texto completo de la convocatoria.
- `conflict`: dos fuentes oficiales dicen cosas contradictorias.

Copia la URL y la cita literal que usaste.

## 8. `confidence`
- `high`: la fuente oficial es explícita.
- `medium`: requiere interpretación razonable.
- `low`: tuviste que inferir o te faltó información.

## 9. Taxonomía de fallos (H8, lectura de fallos)
Para cada caso perdido, es decir, un positivo que no llegó al top-20 de una condición, elige **una** causa principal:

| Código | Causa |
|---|---|
| F1 `never_retrieved` | No apareció en ningún resultado de búsqueda de la corrida |
| F2 `retrieved_not_fetched` | Apareció en los resultados, pero no se descargó |
| F3 `fetch_failed` | Se intentó descargar y falló, o el texto quedó vacío |
| F4 `extraction_miss` | Se descargó, pero no se creó la entidad, o la identidad quedó mal |
| F5 `validity_error` | Status o deadline mal calculados |
| F6 `judge_error` | El judge marcó un criterio duro de forma incorrecta |
| F7 `ranking_error` | Se juzgó bien, pero quedó por debajo del puesto 20 por el orden |
| F8 `stopped_early` | La paciencia o el presupuesto cortaron la búsqueda antes de llegar a él |
| F9 `merge_error` | Se fusionó con otra oportunidad, o quedó partido en dos |

Para leer un fallo, basta con `steps.jsonl` y `result.json` de la corrida.
