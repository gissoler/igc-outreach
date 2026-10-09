// Validación del workspace para configs v6 (investor_run_config/4). Las configs v2/v3 se delegan a cli.mjs sin cambios.
// Casos y perfiles se validan con la misma rutina de v5 sobre una vista v3 de la config (mismos campos, sin `relevance`, manifest v5);
// la vista se escribe en out/ (ignorado por git) y no sustituye a la config real.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateInvestor, investorRepoRoot } from './contracts.mjs';
import { loadInvestorPrompt } from './prompts.mjs';
import { validateInvestorWorkspace } from './cli.mjs';

export function validateWorkspaceV6({ configPath, casesDir }) {
  const raw = JSON.parse(readFileSync(configPath, 'utf8'));
  if (raw.schema_version !== 'investor_run_config/4') return validateInvestorWorkspace({ configPath, casesDir });
  const config = validateInvestor('investor_run_config.v4', raw), opts = { manifest: config.prompts.manifest };
  for (const id of ['b0_templates', 'planner', 'extractor', 'judge', 'preannotator']) loadInvestorPrompt(id, config.prompts[id], opts);
  loadInvestorPrompt('relevance', config.relevance.embeddings.prompt, opts);
  const { relevance, ...rest } = raw; void relevance;
  const dir = resolve(investorRepoRoot, 'research/bench/investors/out'); mkdirSync(dir, { recursive: true });
  const view = resolve(dir, `.v3view-${config.bench_id}.json`);
  writeFileSync(view, JSON.stringify({ ...rest, schema_version: 'investor_run_config/3', prompts: { ...rest.prompts, manifest: 'manifest.v5.json' } }));
  return { config, cases: validateInvestorWorkspace({ configPath: view, casesDir }).cases };
}
