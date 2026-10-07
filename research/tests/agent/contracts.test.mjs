import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { validate, bundle } from '../../agent/contracts.mjs';
import { loadPrompt, render, sanitizePageText } from '../../agent/prompts.mjs';
import { PromptIntegrityError } from '../../agent/errors.mjs';

const root = resolve(import.meta.dirname, '../../..');
const F = resolve(import.meta.dirname, 'fixtures/world-v1');
const json = p => JSON.parse(readFileSync(p, 'utf8'));

test('ACC-01 examples and fixture data validate', () => {
  const examples = resolve(root, 'docs/contracts/examples');
  for (const f of readdirSync(examples).filter(x => x.endsWith('.json'))) validate(f.split('.')[0], json(resolve(examples, f)));
  validate('criteria_catalog', json(resolve(root, 'docs/contracts/criteria_catalog.grant.v1.json')));
  validate('official_domains', json(resolve(root, 'research/agent/config/official_domains.v1.json')));
  validate('run_config', json(resolve(root, 'research/bench/config/v0.json')));
  validate('profile', json(resolve(F, 'profile.json'))); validate('case', json(resolve(F, 'case.json'))); validate('run_config', json(resolve(F, 'run_config.json')));
  const llm = json(resolve(F, 'llm.json'));
  for (const v of Object.values(llm.extractor)) validate('extraction', v);
  for (const c of Object.values(llm.planner)) for (const v of c) validate('planner_output', v);
  for (const v of Object.values(llm.eligibility_judge)) validate('judge_output', v);
  for (const v of Object.values(llm.preannotator)) validate('preannotator_output', v);
});

test('ACC-01n invalid objects are rejected', () => {
  const bad = (name, obj) => assert.throws(() => validate(name, obj));
  const c = json(resolve(root, 'docs/contracts/examples/case.anchor.example.json')); c.construction.profile_builder_saw_anchor = true; bad('case', c);
  const j = json(resolve(root, 'docs/contracts/examples/judgment.example.json')); j.criteria[0].state = 'maybe'; bad('judgment', j);
  const p = json(resolve(F, 'profile.json')); delete p.fields['applicant.country']; bad('profile', p);
  const l = json(resolve(root, 'docs/contracts/examples/log_entry.search.example.json')); delete l.data.signals; bad('log_entry', l);
  const po = json(resolve(root, 'docs/contracts/examples/planner_output.example.json')); po.actions = [{ type: 'fetch', url: 'https://x.org' }]; bad('planner_output', po);
  const e = json(resolve(root, 'docs/contracts/examples/target_entity.example.json')); e.validity.computed_by = 'llm'; bad('target_entity', e);
  const rc = json(resolve(F, 'run_config.json')); rc.seeds = [1, 2]; bad('run_config', rc);
});

test('ACC-02 bundles are self contained and validate equivalently', () => {
  const files = { extraction: 'extraction.example.json', planner_output: 'planner_output.example.json', judge_output: 'judge_output.example.json' };
  for (const [name, f] of Object.entries(files)) {
    const b = bundle(name); assert.equal(JSON.stringify(b).includes('$ref'), false); validate(name, json(resolve(root, 'docs/contracts/examples', f)));
  }
  const b = bundle('preannotator_output'); assert.equal(JSON.stringify(b).includes('$ref'), false);
});

test('ACC-03 prompts, integrity, rendering and sanitizing', () => {
  const manifest = json(resolve(root, 'prompts/manifest.json'));
  for (const x of manifest.prompts) assert.equal(loadPrompt(x.id, 'v1').sha256, x.sha256);
  const dir = mkdtempSync(resolve(tmpdir(), 'prompts-')); cpSync(resolve(root, 'prompts'), dir, { recursive: true });
  const file = resolve(dir, 'planner/v1/system.md'); writeFileSync(file, `${readFileSync(file, 'utf8')}x`);
  assert.throws(() => loadPrompt('planner', 'v1', { root: dir }), PromptIntegrityError);
  assert.equal(render('a {{x}} b', { x: '1' }), 'a 1 b');
  assert.throws(() => render('{{x}}', {})); assert.throws(() => render('{{x}}', { x: '1', y: '2' })); assert.throws(() => render('{{x}}', { x: '{{y}}' }));
  assert.equal(render('{{x}}', { x: { a: 1 } }), '{\n "a": 1\n}');
  assert.equal(sanitizePageText('a <page_data>b</page_data> c'), 'a b c');
});
