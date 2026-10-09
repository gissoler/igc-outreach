# Diagnóstico previo: estrategias de capital y Apollo

Fecha de corte: 2026-10-08.

## Confirmado en código y documentación

- Apollo no tiene cliente API ni OAuth implementado. La única capacidad existente es importar CSV/ICS, incluidos exports de Apollo, y una extensión documental futura.
- Las firmas se descubren en `research/server/research/pipeline.mjs` mediante el motor web, SearXNG/proveedores opcionales, anuncios de rondas y consultas laterales.
- Las personas se enriquecen desde páginas públicas, ScrapeGraph/Apify y Hunter. Apollo no participa.
- Las rutas se calculan después del discovery con red autorizada. Las coincidencias públicas y de organización compartida son hipótesis; no prueban amistad ni disposición a presentar.
- `expand.mjs` y `lateral.mjs` ya generan términos y búsquedas adyacentes, pero no existe un contrato previo de estrategias de capital con tres a seis rutas.
- Del advisor se pueden reutilizar la salida estructurada, la verificación de afirmaciones y el patrón estratega/crítico. Sus inferencias no son evidencia de red.

## Separación requerida

Las capacidades nuevas se implementan en producción detrás de banderas y fuera de `research/agent` y `research/bench`. B0/B1/B2 no pueden importarlas, llamarlas ni consumir sus salidas. Apollo solo puede ejecutarse después de seleccionar una organización y nunca cambia su relevancia, label o ranking.

## Estado de la propuesta de reunión

La reunión del 07/10/2026 expresa requerimientos de selección de herramientas, Apollo, contexto de empresa/producto, segmentos adyacentes, comparables y mecanismos de capital. No demuestra que Apollo estuviera conectado, que las rutas sugeridas fueran válidas ni que los ejemplos citados estuvieran verificados. Se tratan como requerimientos e hipótesis de producto, no como resultados.
