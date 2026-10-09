# Preguntas y supuestos abiertos — v5 (2026-10-09)

Lo que no está ni en `PROMPT-v5.md` ni en `FIX_SPEC-investors-v4.md`. No se inventó: se tomó la opción más conservadora y se anota aquí.

1. **`category` de Exa (Cambio 1.4).** La guía de buenas prácticas (https://exa.ai/docs/search/best-practices, consultada el 2026-10-09) no documenta los valores de `category`. No se pudo verificar contra una respuesta real desde la sesión. **No se usa** `category` ni ningún otro filtro no verificado. Tampoco se usan `livecrawl` (deprecado) ni `contents.maxAgeHours`.
2. **`includeDomains` con proveedores de respaldo.** Solo Exa admite `includeDomains`. Si Exa falla y responde Serper o Tavily, la consulta va sin restricción de dominio (no se añade `site:`, por la regla 1.3) y el motor descarta todo resultado fuera del dominio oficial.
