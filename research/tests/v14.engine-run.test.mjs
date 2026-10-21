import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('F1.3 engine-run --trace crea events, summary y pages con fixture local', () => {
  const root = mkdtempSync(join(tmpdir(), 'v14-engine-run-')); const brief = join(root, 'brief.json'); const out = join(root, 'out');
  writeFileSync(brief, JSON.stringify({ company: 'IGC', industry: 'Alzheimer risk', fundingTypes: ['grant'], entityType: 'for_profit', country: 'US' }));
  const run = spawnSync(process.execPath, ['scripts/engine-run.mjs', '--brief', brief, '--objectives', 'grant', '--today', '2026-10-12', '--no-cache', '--trace', '--out', out], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env, ENGINE_TEST_FIXTURE: '1', ENGINE_LLM_URL: 'http://fixture/v1', ENGINE_LLM_MODEL: 'fixture' },
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(existsSync(join(out, 'events.jsonl')), true);
  assert.equal(existsSync(join(out, 'summary.json')), true);
  assert.equal(existsSync(join(out, 'pages')), true);
});

test('F1.3 engine-run reporta los roles reales cuando el agente usa overrides', () => {
  const root = mkdtempSync(join(tmpdir(), 'v14-engine-run-roles-')); const brief = join(root, 'brief.json'); const out = join(root, 'out');
  writeFileSync(brief, JSON.stringify({ company: 'IGC', industry: 'Alzheimer risk', fundingTypes: ['grant'] }));
  const run = spawnSync(process.execPath, ['scripts/engine-run.mjs', '--brief', brief, '--objectives', 'grant', '--today', '2026-10-19', '--no-cache', '--trace', '--out', out], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', env: {
      ...process.env, ENGINE_TEST_FIXTURE: '1', ENGINE_AGENT: '1', ENGINE_AGENT_PARALLEL: '1',
      ENGINE_LLM_URL: 'http://engine/v1', ENGINE_LLM_MODEL: 'engine-model',
      ENGINE_AGENT_LLM_URL: 'http://agent/v1', ENGINE_AGENT_LLM_MODEL: 'agent-model',
      COMPILER_LLM_URL: 'http://compiler/v1', COMPILER_LLM_MODEL: 'compiler-model',
      JUDGE_LLM_URL: 'http://judge/v1', JUDGE_LLM_MODEL: 'judge-model',
      ENGINE_AGENT_UNDERSTAND_ROLE: 'agent', ENGINE_AGENT_ASSESS_ROLE: 'agent',
    },
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const report = readFileSync(join(out, 'report.md'), 'utf8'); const result = JSON.parse(readFileSync(join(out, 'result.json'), 'utf8'));
  assert.match(report, /Modelo de comprensión: `agent-model` \(agent\)/);
  assert.match(report, /Modelo lector\/evaluador: `agent-model` \(agent\)/);
  assert.deepEqual(result.agent_models.assess, { role: 'agent', model: 'agent-model', url: 'http://agent/v1' });
});
