#!/usr/bin/env node
// Gasto estimado en Exa a partir de events.jsonl: solo cuentan las llamadas NO cacheadas (attempts[].cached === false).
// Tarifa (exa.ai/pricing, 2026-10-11): búsqueda auto 7 USD/1.000 hasta 10 resultados (+1 USD/1.000 por resultado extra);
// contenido 1 USD/1.000 páginas por tipo (texto y highlights = 2 tipos). Es una estimación: el cobro real lo da el panel de Exa.
// Uso: node exa_spend.mjs --dirs outA,outB [--since 2026-10-11T22:00:00Z] [--json]
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const arg = n => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? null : process.argv[i + 1]; };
const dirs = (arg('dirs') ?? '').split(',').filter(Boolean), since = arg('since') ? Date.parse(arg('since')) : 0;
const P = { search: 0.007, extra_result: 0.001, content_per_type: 0.001, content_types: 2 };
let paid = 0, cached = 0, results = 0, usd = 0, failed = 0;
for (const d of dirs) {
  const f = resolve(d, 'events.jsonl'); if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line) continue; let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.event !== 'search_end' || Date.parse(e.timestamp) < since) continue;
    for (const a of e.attempts ?? []) {
      if (a.provider !== 'exa') continue;
      if (a.cached) { cached++; continue; }
      const n = a.results ?? 0; if (a.error) failed++;   // una llamada con error puede haberse cobrado o no; se cuenta como cobrada (cota alta)
      paid++; results += n; usd += P.search + Math.max(0, n - 10) * P.extra_result + n * P.content_per_type * P.content_types;
    }
  }
}
const out = { paid_searches: paid, cached_searches: cached, results_returned: results, failed_calls_counted: failed, estimated_usd: +usd.toFixed(2) };
console.log(process.argv.includes('--json') ? JSON.stringify(out) : `${out.estimated_usd}`);
if (!process.argv.includes('--json') && process.argv.includes('--verbose')) console.error(JSON.stringify(out));
