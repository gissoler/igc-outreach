# Benchmark de búsqueda y ranking de inversionistas v0

Harness hermano e independiente del benchmark de grants. Evalúa discovery y ranking de firmas institucionales; no personas, contactos, warm paths ni probabilidad de inversión.

## Directorios aislados

- contratos: `docs/contracts/investor/`
- protocolo y labeling: `docs/benchmark/investors/`
- prompts y hashes: `prompts/investor/`
- casos/config/output: `research/bench/investors/{cases,config,out}/`
- fixtures: `research/tests/agent/fixtures/investor-world-v0/`

La caché y las salidas futuras deben quedar dentro de `research/bench/investors/out/<bench_id>/`; nunca se leen ni escriben paths de `research/bench/out/` de grants.

## Comandos

```bash
node research/bench/investors/cli.mjs validate --config research/bench/investors/config/v0.json --cases research/bench/investors/cases
node research/bench/investors/cli.mjs run-all --config <frozen-fixture-config> --cases <fixture-cases> --world <world.mjs>
node research/bench/investors/cli.mjs pool --bench <bench-id>
node research/bench/investors/cli.mjs preannotate --bench <bench-id> --fixture <preannotations.jsonl>
node research/bench/investors/cli.mjs sample --bench <bench-id> --seed 7
node research/bench/investors/cli.mjs import-labels --bench <bench-id> --file <sheet.csv> --role adjudicator --annotator <id>
node research/bench/investors/cli.mjs metrics --bench <bench-id>
node research/bench/investors/cli.mjs decide --bench <bench-id>
```

En esta entrega solo se ejecutan `validate` y pruebas offline. `run-all` admite `fixture` y la composición futura con SearXNG + flota LLM, pero la configuración real permanece `draft`, con placeholders explícitos; no puede iniciarse una corrida formal hasta congelar el protocolo y autorizar gasto.

## Arquitectura

Las tres condiciones comparten ejecución, extracción, identidad, deduplicación, judge, ranking y presupuestos. B0 carga plantillas versionadas; B1 hace una llamada inicial al planner; B2 usa esa misma llamada y luego pasos adaptativos. El judge se ejecuta después de discovery y no participa en reflexión ni parada.

Se reutilizan el cliente/cache/search/fetch existentes solo en una futura composición externa. La v0 implementada aquí usa dependencias inyectadas y fixtures, evitando cualquier supuesto de grants, deadlines o elegibilidad para convocatorias.
