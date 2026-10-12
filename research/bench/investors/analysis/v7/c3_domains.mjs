#!/usr/bin/env node
// C3 (H12): cuántos fetches de v5 (B2, 36 corridas de pares) habría evitado la regla "saltar un dominio tras 2 fallos sin
// ningún fetch bueno en la misma corrida". Simulación en orden de eventos; sin red. Uso: node .../c3_domains.mjs
import { loadRuns, DIRS, host } from './common.mjs';
const runs = loadRuns(DIRS.pairs).filter(r => r.cond === 'B2');
let fetches = 0, failed = 0, skipped = 0, skippedButWouldSucceed = 0; const byDomain = {};
for (const r of runs) {
  const fails = new Map(), ok = new Set();
  for (const e of r.ev) if (e.event === 'fetch_end') {
    fetches++; const h = host(e.url), bad = !e.ok || (e.text_chars ?? 0) < 200;
    if ((fails.get(h) ?? 0) >= 2 && !ok.has(h)) { skipped++; if (!bad) skippedButWouldSucceed++; byDomain[h] = (byDomain[h] ?? 0) + 1; continue; }
    if (bad) { failed++; fails.set(h, (fails.get(h) ?? 0) + 1); } else ok.add(h);
  }
}
const top = Object.entries(byDomain).sort((a, b) => b[1] - a[1]).slice(0, 12);
const named = ['innogy.ventures', 'superscout.co', 'assetmanagement.apg.nl', 'idbinvest.org'].map(d => [d, byDomain[d] ?? 0]);
console.log(JSON.stringify({ runs: runs.length, fetch_end: fetches, failed_counted: failed, skipped_by_rule: skipped, skipped_that_would_have_succeeded: skippedButWouldSucceed, named_domains: Object.fromEntries(named), top_domains: Object.fromEntries(top) }, null, 1));
