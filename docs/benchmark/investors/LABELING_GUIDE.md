# Guía de etiquetado — benchmark de inversionistas v0

## Principios

Etiqueta la firma institucional, no una persona, vehículo, empresa del portfolio, artículo o página. Usa fuentes oficiales siempre que existan. Un directorio o base de datos puede descubrir una firma, pero no decide por sí solo identidad, actividad ni fit. Conserva URL, cita literal, fecha de consulta y cualquier contradicción.

Una inversión histórica no demuestra actividad actual. La mera existencia de un sitio web tampoco. Compartir sector no demuestra etapa, cheque, ronda o geografía. La ausencia de información siempre produce `unknown`; nunca `met`.

Apollo no determina el label de un fondo. Una conexión de LinkedIn no demuestra warm path, disposición a presentar ni relación real.

## Identidad y tipo

`identity_correct=true` solo cuando las páginas del ítem pertenecen a la misma firma indicada por el `stable_id`. Usa `null` si no es decidible. Cambios de nombre, aliases, dominios alternativos y vehículos de una firma se unen. No unas firmas distintas por compartir matriz o una palabra del nombre.

`entity_kind=institutional_investor` cubre VC, CVC, family office con venture verificable, red ángel institucional y accelerator/venture studio que invierte capital mediante un proceso verificable. Clasifica personas, portfolio companies, proveedores y aceleradoras sin capital en su categoría expresa.

## Actividad y fit

- `active`: evidencia oficial reciente de nuevas inversiones.
- `possibly_active`: firma existente con tesis vigente, sin evidencia reciente suficiente.
- `inactive`: cerró, dejó de invertir, cambió de actividad o declara no hacer nuevas inversiones.
- `unknown`: las fuentes no permiten decidir.

Para sector usa `on`, `partial`, `off` o `unknown`. Para etapa, geografía, cheque y ronda usa `met`, `not_met` o `unknown`. Business model y lead admiten además `not_applicable`.

Marca `hard_eligibility=ineligible` ante firma inactiva o una exclusión explícita y aplicable de geografía, etapa, tipo de compañía o rango de cheque verificado sin solapamiento. `unknown` en uno o más criterios duros normalmente lleva a `undetermined`, no a `eligible`.

Un portfolio conflict es `potential` o `direct` según evidencia, pero no vuelve ineligible a la firma salvo exclusión explícita. Regístralo como señal separada.

## Relevancia, confianza y ganancia

`strong` exige evidencia suficiente y consistente de compatibilidad. `plausible` permite algunos unknown sin ningún hard not_met. `weak` es una pista que necesita investigación. `irrelevant` incluye identidad incorrecta, entidad no inversora o incompatibilidad clara.

La confianza expresa la calidad y consistencia de las fuentes, no entusiasmo. La función de ganancia vive en código y aplica exactamente el protocolo. `gain=2` no predice inversión, respuesta ni reunión.

## Conflictos y revisión

No resuelvas una contradicción ocultándola. Conserva ambas citas y explica en notas cuál fuente es más reciente u oficial. El segundo revisor recibe una hoja ciega con los mismos campos. Los desacuerdos se adjudican sin revelar condición, seed o ranking.
