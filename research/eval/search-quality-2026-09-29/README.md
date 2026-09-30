# Revisión de calidad de búsqueda — grants para Mentiva (29/09/2026)

Run analizado: `8f544426` (data/research.sqlite, 22:53 UTC), brief Mentiva · grant · GLOBAL · prototype/pre-seed.
Referencia: `reference-list.md` (búsqueda web con todas las URLs abiertas y comprobadas; no Gemini). Parche: `search-quality.patch` (`git apply` desde la raíz del repo).

## Cómo busca hoy el motor (modo "solo grants")
- Consultas: `expandTerms` = la industria tal cual ("wellness mental health digital health") + 3 términos del modelo local
  ("mental well-being tracking", "emotional health monitoring", "self-awareness tools"). `grantQueries` descarta "GLOBAL".
- Fuentes: Grants.gov (4 consultas, 15 hits cada una) + NIH RePORTER (0 resultados, y sus leads se descartan por diseño)
  + 3 búsquedas Firecrawl de 6 resultados. Exa, Serper y el bucle agentic están apagados cuando el run es solo grants.
- Lectura: Grants.gov trae el detalle oficial por API. Las páginas web no se leen: se usa el markdown de Firecrawl
  y una regex busca la fecha. `read.mjs` necesita la flota y extrae datos de inversores, no de convocatorias.
- Score (`evaluate`): fit 35 (palabras en común con el tema) + tipo 20 + timing 25 + monto 20 (0,3 sin monto).
  Sin elegibilidad ni geografía en el score.

## Evidencia clave
- Grants.gov respondió 837 / 433 / 855 / 469 hits por consulta. `diversifyGrantHits` (round-robin por agencia)
  eligió 12 avisos fuera de tema (Mozambique, Túnez, NIOSH, FDA cardiotoxicidad, DoD HIV) y dejó fuera 11 avisos
  de NIH sobre salud mental o salud digital que venían en la misma respuesta (PAR-25-285/288/289, RFA-MH-27-180,
  PAR-25-449, FOR-NS-25-017, PAR-28-039...).
- 6 de 18 resultados web eran Facebook/LinkedIn/Instagram (sin contenido) y 3 de 12 aceptados eran agregadores
  (fundsforngos, startupgrantsindia, vestbee).
- 10 de 12 oportunidades web sin fecha → estado "open" por defecto → 9 en la lista prioritaria.
- La regex de fecha falla con "Deadline: 30 June 2026", "**Apply by** April 5, 2023", "deadline of 18 September 2026",
  ISO y "through October 19, 2026".
- Fit: CDC "STI Prevention" 0,67 (74 pts) y DoD HIV 0,50 frente a 1,0 de un encaje real; una página larga (NIA) llega a 1,0.
- Elegibilidad: el enricher usa el perfil de IGC Pharma para Mentiva (`routes.mjs`) y acepta un ✖ de la flota que
  contradice la lista oficial (PAR-25-136 admite for-profit y extranjeros; la flota citó "U.S. Territory or Possession").
- `grantManager.mjs` cambió después del run (23:08 UTC): ahora sí descarta cerradas y ✖. Con el ✖ falso, eso
  descarta la convocatoria federal más relevante.

## Replay offline del mismo run con el parche (sin búsquedas nuevas)
Prioritarios: 14 → 1 (PAR-25-136). Wellcome (cerrada 18/09), BIDs (30/06) y Telosity pasan a descartadas; DoD HIV,
Modern Slavery, CDC Indonesia, NSF y Túnez salen por fuera de tema; Headstream, IMH, NIA y Hollomon quedan en radar
"sin fecha". One Mind queda en radar como urgente (19/10, menos de 30 días). Las búsquedas nuevas (consultas 4 y 5,
filtro de un año) necesitan un run real para medirse.
