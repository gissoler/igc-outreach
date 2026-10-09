#!/usr/bin/env node
// FIX-00.T2 — Regresión: re-juzga y re-rankea 10 corridas v3 y exige igualdad exacta con lo guardado.
// Uso: node research/bench/investors/replay-v3.mjs <dir runs de v3> [n=10]
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { judgeInvestor } from './judge.mjs';
import { rankInvestors } from './ranking.mjs';
import { investorRepoRoot as repo } from './contracts.mjs';

const json = path => JSON.parse(readFileSync(path, 'utf8'));
export function replayV3(runsDir, n = 10) {
  const catalog = json(resolve(repo, 'docs/contracts/investor/criteria_catalog.investor.v1.json'));
  const casesDir = resolve(repo, 'research/bench/investors/cases');
  const cases = new Map(readdirSync(casesDir).filter(x => x.endsWith('.json') && x !== 'manifest.json').map(x => { const c = json(resolve(casesDir, x)); return [c.case_id, c]; }));
  const rows = readdirSync(runsDir).sort().slice(0, n).map(dir => {
    const result = json(resolve(runsDir, dir, 'result.json'));
    const profile = json(resolve(repo, cases.get(result.case_id).profile_path));
    const judgments = result.entities.map(entity => judgeInvestor({ entity, profile, catalog }));
    const ranked = rankInvestors(result.entities, judgments);
    return { run_id: dir, entities: result.entities.length, judgments_equal: isDeepStrictEqual(judgments, result.judgments), ranked_equal: isDeepStrictEqual(ranked, result.ranked) };
  });
  return { runs: rows.length, all_equal: rows.length === n && rows.every(x => x.judgments_equal && x.ranked_equal), rows };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const out = replayV3(resolve(process.argv[2]), Number(process.argv[3] || 10));
  console.log(JSON.stringify(out, null, 2)); if (!out.all_equal) process.exitCode = 1;
}
