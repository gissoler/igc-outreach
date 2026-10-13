# V8 — Embudo de la fase de listas (análisis posterior, no pre-registrado)

Fuente: bench/investors/out/investors-internal-2026-10-12-v8 (events.jsonl y cache.sqlite). Páginas únicas de lista abiertas en las 3 réplicas de cada caso.

| Caso | Oro | Páginas de lista | Con el nombre del oro | Firmas listadas por el modelo | Firmas que pasan la verificación de cita | Oro listado por el modelo en alguna extracción de la caché v8 | Oro que pasa la verificación | Intentos de resolver el oro |
|---|---|---|---|---|---|---|---|---|
| p01 | magmapartners.com | 10 | 2 | 50 | 7 | 1 | 0 | 0 |
| p02 | lightrock.com | 14 | 1 | 56 | 10 | 1 | 0 | 0 |
| p03 | celesta.vc | 14 | 1 | 40 | 9 | 0 | 0 | 0 |
| p04 | golden.ventures | 12 | 1 | 30 | 10 | 0 | 0 | 0 |
| p05 | worldfund.vc | 14 | 1 | 49 | 10 | 0 | 0 | 0 |
| p06 | ecapital.vc | 13 | 2 | 60 | 22 | 1 | 0 | 0 |

| Caso | Nombre listado por el modelo | Cita literal en la página | La cita contiene el nombre | Pasa | Cita (160 caracteres) |
|---|---|---|---|---|---|
| p01 | Magma Partners | sí | no | no | Magma specializes in finding, investing, and support the best technology startups in Latin America that want to launch and scale in the US and Latin America. |
| p02 | Lightrock | no | no | no | Current shareholders QED Investors, VEF, SoftBank Vision Fund 1, SoftBank Latin America Fund, Kaszek Ventures, Lightock, Headline, Wellington Management and Adv |
| p06 | eCAPITAL ENTREPRENEURIAL PARTNERS | no | no | no | They have been involved in significant transactions in the cybersecurity domain, including multiple funding rounds for VMRay, a company dedicated to threat dete |
