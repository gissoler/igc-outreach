# Diagnóstico completo del motor de inversionistas (12-10-2026)

Todo medido con datos ya pagados (corridas v7 y v8, diagnósticos v8 y v9). Scripts en research/bench/investors/analysis/v9/ (pipeline_v8.mjs, sin_gasto_report.mjs, diagnostico.v9.mjs).

## 1. La cadena, eslabón por eslabón, para el oro

| Eslabón | Resultado medido | ¿Es el límite? |
|---|---|---|
| Brief → consultas por tema (planner gpt-oss) | El planner escribe frases largas ("website of a venture-capital firm that invests in seed-stage fintech…"). Probadas 6 formas de consulta (cortas, largas, category company, 25/30/50 resultados): el sitio del oro sale en ≤ 1 de 6 casos con cualquiera | Sí, para llegar al oro por tema. No es la redacción: Exa por tema devuelve otras firmas |
| Consultas de listas ("top VC firms <sector> <país>") | El nombre del oro está en las páginas abiertas en 5 de 6 casos (p01–p06) y 5 de 6 (p07–p12), entre 150 y 300 nombres | No: el nombre llega |
| Extractor LLM de las páginas de listas (tope 10 por página) | Lista al oro en 3 de 6; la verificación de cita lo descarta en los 3 | Sí (en v8) |
| Orden de resolución (8 primeras, orden de aparición) | 0 intentos de resolver el oro en 18 corridas | Sí (en v8) |
| Búsqueda por nombre en Exa ("<nombre>" venture capital) | Sitio del oro en el puesto 1 en 12 de 12 | No |
| Verificación en su sitio (cita literal, regla sin cambios) | Aceptado en 10 de 12 (fallan p04 y p09 en todas sus páginas) | Solo en 2 casos |

Conclusión: el motor pierde el oro entre "el nombre aparece en una lista" y "se busca por nombre". Es exactamente lo que hace distinto a Claude o Gemini: con el brief piensan en nombres de fondos, leen las listas y eligen con criterio, y luego verifican por nombre.

## 2. En qué se fue el dinero de Exa en v8 (18 corridas, último intento)

| Tipo de consulta | Búsquedas | Exa pagadas | USD (0.0089) | Firmas únicas aceptadas | Firmas gain ≥ 2 |
|---|---|---|---|---|---|
| Resolución por nombre (nombres sacados de listas) | 223 | 108 | 0.961 | 41 | 0 |
| Planner: pasos adaptativos | 65 | 65 | 0.579 | 59 | 1 |
| Profundización (páginas de firmas ya aceptadas) | 180 | 42 | 0.374 | 60 | 4 |
| Listas | 36 | 29 | 0.258 | 24 | 3 |
| Planner: lote inicial (fijo, de la caché v5) | 108 | 0 | 0 | 75 | 3 |

El 44% del gasto (108 de 244 llamadas) fue a resolver nombres de listas y no dio ninguna firma gain ≥ 2. Causa: los nombres venían con el tipo de la tabla pegado ("Kaszek VC Fund"; 36 resoluciones) y el emparejador nombre–dominio rechazaba sitios correctos con dominios cortos o siglas (109 no_domain; el sitio propio estaba en los resultados en unas 47). Ese gasto se puede quitar sin perder nada.

## 3. Arreglo (brazo v9, ya construido, mismo stack: Exa + gpt-oss en Voltage Park)

1. Fase de listas de v8 apagada (quita las 108 resoluciones inútiles). Las 2 consultas de listas se siguen haciendo (están en la caché: 0 USD) y sus nombres se sacan sin LLM ni tope.
2. gpt-oss recibe el brief y esos nombres y propone 40 fondos ordenados por ajuste, con dominio, como haría un asistente que lee sus resultados de búsqueda. También puede proponer fondos que conoce y no están en las listas.
3. Cada fondo se verifica en su sitio: primero el dominio propuesto (0 USD de Exa), si falla la búsqueda por nombre (1 llamada; cacheada entre réplicas). Regla de cita sin cambios.
4. Después sigue el planner como en v8.

Lo único que no se puede medir desde aquí es si gpt-oss elige el oro entre esos nombres. go-v9.sh lo mide primero, sin gastar Exa, en los 12 casos, y solo lanza la corrida si lo nombra en ≥ 4 de 6. Si no llega, el cuello de botella queda probado: es el modelo (le llega el nombre y no lo elige). Costo Exa de la corrida: hasta US$ 3.49, tope US$ 5.

## 4. Veredicto (prueba de nombres ejecutada por el usuario, 12-10, 21:53; V9-NOMBRES.md)

NO-GO. El cuello de botella es el LLM (openai/gpt-oss-120b). Sin Exa gastado.

| Caso | Oro entre los nombres de las listas que recibe el LLM (puesto) | gpt-oss solo con su conocimiento | gpt-oss leyendo las listas |
|---|---|---|---|
| p01 | 20 | no | no |
| p02 | 101 | no | no |
| p03 | 77 | no | no |
| p04 | 70 | no | 9 |
| p05 | no está | no | no |
| p06 | 27 | no | no |
| p07 | 35 | 1 | 3 |
| p08 | 4 | 1 | 1 |
| p09 | 99 | no | no |
| p10 | 20 | 9 | 10 |
| p11 | 3 | no | no |
| p12 | no está | no | no |

El nombre del oro le llega al LLM en 10 de 12 casos y lo elige en 4 (1 de 6 en p01–p06). En p11 está en el puesto 3 de lo que recibe y no lo elige. Firmas gain ≥ 2 nombradas: 8 de 64 leyendo listas, 6 de 64 sin ellas. Exa (12/12 por nombre), la verificación (10/12) y las consultas quedan descartados como límite.
