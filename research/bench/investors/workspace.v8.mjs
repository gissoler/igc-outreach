// Validación del workspace para la config v8 (investor_run_config/6). Igual que workspace.v6.mjs: valida el esquema v5 de
// config, los prompts del manifest v7 (mismos prompts) y el lote inicial fijo; casos y perfiles se validan con la rutina de v5 sobre una vista v3
// (sin las claves nuevas) que se escribe en out/ (ignorado por git) y no sustituye a la config real.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateInvestor, investorRepoRoot } from './contracts.mjs';
import { loadInvestorPrompt } from './prompts.mjs';
import { validateInvestorWorkspace } from './cli.mjs';

export function validateWorkspaceV8({ configPath, casesDir }) {
  const raw = JSON.parse(readFileSync(configPath, 'utf8'));
  if (raw.schema_version !== 'investor_run_config/6') throw new Error('run-experiment.v8 requiere una config investor_run_config/6');
  const config = validateInvestor('investor_run_config.v6', raw), opts = { manifest: config.prompts.manifest };
  for (const id of ['b0_templates', 'planner', 'extractor', 'judge', 'preannotator']) loadInvestorPrompt(id, config.prompts[id], opts);
  const inv = resolve(investorRepoRoot, 'research/bench/investors');
  if (config.b2.fixed_initial_batch) {
    const fixed = JSON.parse(readFileSync(resolve(inv, 'config', config.b2.fixed_initial_batch), 'utf8'));
    if (fixed.schema_version !== 'investor_fixed_initial_batch/1') throw new Error('lote inicial fijo con esquema desconocido');
    if (fixed.prompt_sha256 !== loadInvestorPrompt('planner', config.prompts.planner, opts).sha256) throw new Error('el lote inicial fijo no es del prompt planner de esta config');
    for (const c of Object.values(fixed.cases)) validateInvestor('investor_planner_output.v2', c.output);
  }
  for (const l of config.cache_layers) if (!existsSync(resolve(inv, l.path))) throw new Error(`falta la caché de lectura ${l.path}`);
  const { fetch_domain_skip, cache_layers, extractor_impl, ...rest } = raw; void fetch_domain_skip; void cache_layers; void extractor_impl;
  const { min_searches_before_stop, fixed_initial_batch, list_discovery, ...b2 } = rest.b2; void min_searches_before_stop; void fixed_initial_batch; void list_discovery;
  const dir = resolve(inv, 'out'); mkdirSync(dir, { recursive: true });
  const view = resolve(dir, `.v3view-${config.bench_id}.json`);
  writeFileSync(view, JSON.stringify({ ...rest, b2, schema_version: 'investor_run_config/3', prompts: { ...rest.prompts, manifest: 'manifest.v5.json' } }));
  return { config, cases: validateInvestorWorkspace({ configPath: view, casesDir }).cases };
}
