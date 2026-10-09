# Arquitectura: estrategias de capital y Apollo

Estado: implementado detrás de banderas; fecha 2026-10-08.

## Límites

Estas capacidades pertenecen al pipeline de producción y no al benchmark B0/B1/B2. No modifican `research/agent`, `research/bench`, perfiles congelados, labels, hashes, configuración, pool, métricas ni regla de adopción.

```text
brief confirmado
  └─ capital_strategy_context (opcional, antes de discovery)
       ├─ 3–6 rutas; declarado + hipótesis adyacentes
       ├─ preguntas y router por pregunta
       └─ consultas verificadas por el motor existente
            └─ discovery/ranking de organizaciones (sin Apollo)
                 └─ Apollo Contact & Bridge Resolver (opcional)
                      ├─ organización exacta por dominio
                      ├─ personas por dominio/organización
                      └─ red autorizada: única fuente de verified_network_path
```

La salida de estrategias amplía consultas. No modifica el brief ni el perfil confirmado. Apollo corre después de `evaluate`, recibe solo organizaciones seleccionadas y escribe `job.contactResolution`; nunca se mezcla con `job.leads`, el score o el bucket.

## Contratos versionados

- `capital_strategy_context/1`: segmento declarado, rutas, queries, herramientas, evidencia, riesgos y límites.
- `apollo_preflight/1`: estado, comprobaciones, cuota oficial, alcance observable, latencia, errores y documentación consultada.
- `contact_bridge_result/1`: organización, personas, canales, clasificación de ruta, relaciones y procedencia.

Los schemas viven en `research/capital/schemas/` para no modificar los contratos congelados del benchmark. Todo resultado se valida en el punto de producción mediante `research/capital/contracts.mjs`.

## Router de herramientas

`selectCapitalTool` decide por la pregunta, no por el sector:

- discovery amplio → SearXNG;
- verificación de una página → lector configurado;
- requisitos, fechas y elegibilidad → fuente oficial de grants;
- quién financió un comparable → fuente de ronda/sitio oficial;
- persona en una organización ya seleccionada → Apollo;
- ruta real → red autorizada;
- hipótesis/plan estructurado → LLM.

Cada query conserva pregunta, herramienta, motivo y coste estimado. Cada ejecución conserva resultado, evidencia nueva, error y latencia. Los topes se configuran con `CAPITAL_STRATEGY_*`.

## Estados de relación

- `direct_contact`: canal público directo; no implica relación.
- `public_affiliation`: empleo o afiliación pública.
- `possible_bridge`: puente documentado que requiere confirmación.
- `verified_network_path`: únicamente evidencia adicional de la red autorizada.
- `unresolved`: no existe soporte suficiente.

Apollo no puede convertir `public_affiliation` o un email en warm path. Tampoco demuestra amistad, primer grado, confianza, disposición a presentar, respuesta o intención de invertir.

## Apollo, seguridad y coste

El cliente usa `x-api-key` solo en el servidor. No ofrece operaciones de escritura. El preflight y resolver no crean contactos, listas, secuencias, campañas, tareas ni mensajes. La búsqueda de personas no revela email; un futuro reveal requeriría una bandera y presupuesto separados.

Controles:

- Apollo apagado por defecto (`APOLLO_ENABLED=0`).
- topes estimados por corrida, organización y día de proceso;
- caché compartida en proceso con TTL para evitar búsquedas repetidas;
- máximo de organizaciones y personas por corrida;
- errores de autenticación, plan, créditos o cuota degradan sin detener discovery;
- ninguna clave, cabecera ni cuerpo con credenciales entra en logs o frontend.

## Evaluación separada

`research/capital/evaluation.mjs` define métricas independientes. No se consideran éxito la respuesta, reunión, introducción o inversión sin protocolo humano separado.

## Fallbacks

Si la organización no aparece en Apollo: se comprueba identidad oficial mediante la dependencia inyectada, se consulta equipo/página oficial, se intenta people search por dominio y finalmente se devuelve `not_found`. No se inventan personas. El pipeline de producción conserva resultados de organizaciones aunque Apollo falle.

## Documentación oficial de Apollo consultada el 08/10/2026

- https://docs.apollo.io/reference/authentication
- https://docs.apollo.io/reference/organization-search
- https://docs.apollo.io/reference/people-api-search
- https://docs.apollo.io/reference/view-credit-usage-stats
- https://docs.apollo.io/reference/view-api-usage-stats
- https://docs.apollo.io/docs/api-pricing
