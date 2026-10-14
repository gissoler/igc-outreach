import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
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
