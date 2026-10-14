# V14 · Discrepancias

## 2026-10-13 · F1.1 bloqueada antes de modificar código

La precondición común de `V14-PLAN-CODEX.md` exige `git status` limpio salvo cambios ajenos en `research/scripts/g355-*` y `research/scripts/tunnel-g355.sh`.

En `main`, commit `336f30b`, `git status --short --branch` mostró, además de esos tres scripts permitidos, estas entradas sin versionar:

```text
docs/handoff/PROMPT-v12-crawl-y-modelo.md
docs/handoff/PROMPT-v13-claude-arquitectura.md
docs/handoff/PROMPT-v13-gpt-despliegue.md
docs/handoff/PROMPT-v14-claude-diagnostico-arquitectura.md
docs/handoff/PROMPT-v14-codex-ejecucion.md
docs/handoff/V13-DESPLIEGUE.md
docs/handoff/_to_delete/
research/eval/briefs/jefe-igc-mint-ad-2026-10-12.json
research/eval/~$calificar-igc-10.xlsx
```

El brief y varios handoffs son entradas de V14, pero el plan no autoriza a Codex a incorporarlos, moverlos, borrarlos ni ignorarlos para declarar limpia la línea base. El archivo `~$calificar-igc-10.xlsx` parece temporal, pero tampoco hay autorización para eliminarlo.

Estado: F1.1 no iniciada; no se modificó código y no se corrieron las suites. Los túneles se comprobaron antes: juez 8016 y compilador 8017 respondieron después de ejecutar `dual-bg` y `dual-status`.

Decisión requerida: indicar qué entradas deben versionarse, conservarse sin versionar, moverse o eliminarse para cumplir la precondición de F1.1.
