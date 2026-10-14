# V14 · Cambios

Documento en curso. Se completa en F4.2.

## F2.0 · Fecha de hoy

- `asDate(today)` normaliza `Date`, `AAAA-MM-DD` o vacío a medianoche UTC.
- OpenAlex y EDGAR reciben la fecha normalizada.
- Este arreglo cambia la expansión lateral: elimina el error medido en F1
  `today.getUTCFullYear is not a function`; F1 no se repite, según el plan.

