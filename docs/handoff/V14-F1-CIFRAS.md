# V14 · F1 · Cifras de las trazas

Fecha de ejecución: 13/10/2026. Fecha inyectada al motor: 12/10/2026.
Commit registrado por las corridas: `7f0feeb4c8b652eb3ebb5c7f1fec851413e2b3f1`.

Estas son mediciones de dos corridas del motor actual. No son resultados comerciales.

## Corridas y gasto

Antes de cada corrida, `--dry-run` informó un máximo de 36 llamadas Exa y 0,3204 USD.
El tope fue 5 USD para grant y 4,748 USD para investment, después de restar el gasto medido de grant.

| Métrica | F1 grant | F1 investment |
|---|---:|---:|
| Segundos | 634 | 373 |
| Páginas vistas / leídas | 844 / 80 | 758 / 80 |
| Eventos válidos / totales | 2.244 / 2.244 | 1.973 / 1.973 |
| Descartes con `decided_by` / totales | 843 / 843 | 758 / 758 |
| `decided_by` desconocido | 0 | 0 |
| Verificadas main / verify | 0 / 1 | 0 / 0 |
| Pistas / con seguimiento | 12 / 0 | 0 / 0 |
| Llamadas Exa | 36 | 32 |
| USD Exa | 0,252 | 0,224 |
| Créditos Apollo | 0 | 0 |
| Archivos / funciones ejecutadas | 285 / 3.895 | 285 / 4.965 |

Gasto Exa F1 total: **0,476 USD**. Saldo contra el tope V14 de 5 USD: **4,524 USD**.

## Llamadas de modelo

Formato de tokens: entrada / salida. Los milisegundos son la suma de `ms_call`, no tiempo de pared.

| Caso | Rol | Llamadas | Inválidas | Errores | Tokens | ms |
|---|---|---:|---:|---:|---:|---:|
| grant | planner | 1 | 0 | 0 | 440 / 856 | 4.680 |
| grant | researcher | 2 | 0 | 0 | 10.392 / 618 | 4.381 |
| grant | compiler | 80 | 2 | 2 | 178.684 / 50.842 | 767.757 |
| grant | judge | 80 | 0 | 0 | 238.114 / 149.943 | 1.176.706 |
| grant | followup | 1 | 0 | 0 | 1.012 / 295 | 1.875 |
| grant | reader | 1 | 0 | 0 | 544 / 364 | 2.345 |
| investment | planner | 1 | 0 | 0 | 394 / 680 | 3.797 |
| investment | researcher | 2 | 0 | 0 | 9.670 / 568 | 3.677 |
| investment | compiler | 80 | 0 | 0 | 171.165 / 45.554 | 301.914 |
| investment | judge | 80 | 0 | 0 | 200.200 / 107.592 | 868.411 |
| investment | followup | 1 | 0 | 0 | 715 / 247 | 1.511 |
| investment | reader | 1 | 0 | 0 | 515 / 329 | 3.193 |

Los eventos enlazan las 80 llamadas de compilador y las 80 del juez de cada caso con `page_ref`.
Versiones registradas: `compiler.v13.1`, `judge.v13.1`, `plan`, `research`, `followup` y
`lateral_angles`. Modelos: Qwen/Qwen3-30B-A3B-Instruct-2507 salvo el juez,
openai/gpt-oss-120b.

## Herramientas

| Caso | Herramienta | Llamadas | Resultados | Errores | ms | USD |
|---|---|---:|---:|---:|---:|---:|
| grant | exa | 36 | 286 | 0 | 118.844 | 0,252 |
| grant | you | 36 | 288 | 0 | 29.182 | 0 |
| grant | tavily | 36 | 219 | 0 | 126.635 | 0 |
| grant | serper | 36 | 275 | 0 | 82.071 | 0 |
| grant | jina | 3 | 0 | 3 | 1.683 | 0 |
| grant | expand | 1 | 0 | 0 | 0 | 0 |
| investment | exa | 32 | 256 | 0 | 110.042 | 0,224 |
| investment | you | 32 | 255 | 0 | 22.129 | 0 |
| investment | tavily | 32 | 256 | 0 | 88.333 | 0 |
| investment | serper | 32 | 253 | 0 | 66.719 | 0 |
| investment | jina | 3 | 0 | 3 | 1.940 | 0 |
| investment | expand | 1 | 0 | 0 | 0 | 0 |

## Las 12 preguntas

`node eval/v14/ask.mjs <dir> <n>` devolvió JSON no vacío para 12/12 preguntas en las dos carpetas.

1. Páginas y procedencia: 844 en grant y 758 en investment; cada evento contiene `found_by`.
2. Lectura: 80 páginas leídas en cada caso. Grant dejó 764 sin leer: 102 redes, 75 agregadores y
   587 por tope. Investment dejó 678: 53 redes, 101 agregadores y 524 por tope.
3. Descartes: 843 en grant y 758 en investment; el 100 % incluye motivo y `decided_by`.
4. Fechas: grant registró 903 fechas y días restantes entre -661 y 191 cuando correspondía;
   investment registró 320 fechas y ningún `days_left`, porque el objetivo no usa plazo.
5. Criterios: grant registró decisiones de compilador 77, juez 76 y auditor 77; investment,
   compilador 79 y juez 79. Los veredictos y citas quedan agrupados por `page_ref` y actor.
6. Llamadas, tokens, ms, USD y créditos: están en las dos tablas anteriores y en `summary.json`.
7. Pistas: grant produjo 12 y 0 seguimientos; investment produjo 0. Ninguna produjo finalista.
8. Comprensión del brief: F1 no tiene agente; 0 `understand`, 0 preguntas y 0 cambios de brief en
   ambos casos.
9. Parada: ambos casos terminaron por `run_end:natural_completion`, sin evento de presupuesto.
   El investigador registró `no_actions` en los dos casos.
10. Texto exacto: existen 844/844 archivos referidos por eventos `page` en grant y 758/758 en
    investment.
11. Modelo y prompt: todas las llamadas de compilador y juez tienen modelo, versión y `page_ref`;
    los otros roles registran modelo y versión sin decisión de página.
12. Cobertura: grant ejecutó 285 archivos y 3.895 funciones; investment, 285 y 4.965.

## Descartes de grant

Resultado de `node eval/v14/drops.mjs eval/runs/v14-f1-grant/result.json`:

- 159 trazas del motor; 80 páginas en el resumen, 77 leídas y 3 sin lectura válida.
- 1 hallazgo conservado: veredicto `watch`; 0 `apply`.
- Motivos del recorrido de 80 páginas: `aggregator` 57, `over_page_budget` 23,
  `not_eligible` 15, `closed` 17, `not_a_call:program_page` 9,
  `not_a_call:directory` 4, `wrong_kind:directory` 5, `scope_mismatch` 3,
  `not_relevant` 6, `not_a_call:news` 7, `not_a_call:cohort` 3,
  `wrong_kind:news` 2 y seis motivos con 1 caso cada uno.
- Responsables en ese recorrido: hosts/rutas 57, tope de páginas 23, juez de elegibilidad 13,
  juez de fechas más auditor 17, clasificador de tipo de página 26, lector más regla del objetivo 9,
  juez de alcance 3, regla de solicitante 2, lector 6 y compilador inválido 3.
- Estados del juez: `unknown` 43, `closed` 17, `open` 14, `forecast` 2 y `unverified` 1;
  49 desacuerdos, 1 cierre por fallo y 32 desacuerdos con patrones.
- Expansión: 0 semillas y 0 páginas; el lateral produjo 6 ángulos. OpenAlex registró
  `today.getUTCFullYear is not a function`, defecto que el plan asigna a F2.0.
- Investigación: 2 pasos, 4 búsquedas, 6 aperturas y parada `no_actions`.

## Incidencias observadas

- Grant: 3 descartes `read_failed` decididos por `invalid:compiler`.
- Investment: 79 descartes `read_failed` decididos por `invalid:judge` y 1 por
  `invalid:compiler`. Los eventos `model_call` de investment registraron 0 errores de transporte y
  0 respuestas marcadas como JSON inválido; el descarte pertenece a la validación posterior.
- No apareció ningún motivo con `decided_by` que empiece por `unknown:`.

## Criterios de aceptación F1

| Criterio | Resultado medido |
|---|---|
| (a) 12 preguntas en dos corridas | Cumple: 12/12 y 12/12 |
| (b) 100 % de líneas valida contra `trace/1` | Cumple: 2.244/2.244 y 1.973/1.973 |
| (c) 100 % de `drop` tiene `decided_by` | Cumple: 843/843 y 758/758 |
| (d) Igualdad de `findings` con y sin registro | Cumple: prueba F1.2 en verde |
| (e) Suite igual o mejor que la base | Cumple: 506/505/1 y 191/191; el único fallo general es el aislamiento Apollo previo |

