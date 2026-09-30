import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createStore } from '../server/research/store.mjs';
import { runResearch } from '../server/research/pipeline.mjs';
import { createReplayFetcher } from '../eval/replay.mjs';
import { aggregateMetrics, evaluateRun } from '../eval/metrics.mjs';

const arg = (name, fallback = '') => { const at = process.argv.indexOf(name); return at >= 0 ? process.argv[at + 1] : fallback; };
const variant = arg('--variant', 'A').toUpperCase();
const goldDir = resolve(arg('--gold', 'eval/gold'));
const replayRoot = resolve(arg('--replay', 'eval/replay'));
if (!/^[A-F]$/.test(variant)) throw new Error('Use --variant A..F.');
const flags = {
  A: {}, B: { AGENTIC_FOLLOWUP: '1' }, C: { AGENTIC_FOLLOWUP: '1', AGENTIC_READ: '1' },
  D: { AGENTIC_FOLLOWUP: '1', AGENTIC_READ: '1', AGENTIC_LOOP: '1' },
  E: { AGENTIC_FOLLOWUP: '1', AGENTIC_READ: '1', AGENTIC_LOOP: '1', LOOP_LLM_PLANNER: '1' },
  F: { AGENTIC_FOLLOWUP: '1', AGENTIC_READ: '1', AGENTIC_LOOP: '1', LOOP_LLM_PLANNER: '1' },
}[variant];
const files = readdirSync(goldDir).filter((file) => file.endsWith('.json') && !file.endsWith('.example.json'));
if (!files.length) throw new Error(`No adjudicated gold cases in ${goldDir}.`);
const rows = [];
for (const file of files) {
  const gold = JSON.parse(readFileSync(join(goldDir, file), 'utf8'));
  const scratch = mkdtempSync(join(tmpdir(), 'outreach-eval-'));
  const store = createStore(join(scratch, 'research.sqlite'));
  const now = new Date().toISOString();
  const job = { id: randomUUID(), brief: gold.brief, mode: 'live', status: 'queued', createdAt: now, events: [], leads: [], senderEvidence: [], userId: null };
  store.save(job);
  try {
    await runResearch(job, store, { env: { ...process.env, ...flags, RESEARCH_BROWSER: 'off' }, fetcher: createReplayFetcher(join(replayRoot, gold.id)) });
    rows.push(evaluateRun(job, gold));
  } finally { store.close(); rmSync(scratch, { recursive: true, force: true }); }
}
console.log(JSON.stringify({ variant, metrics: aggregateMetrics(rows), cases: rows }, null, 2));

