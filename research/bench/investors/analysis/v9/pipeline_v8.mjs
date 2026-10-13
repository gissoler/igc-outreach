// V9 (solo relectura): de dónde salen el gasto de Exa y las firmas en v8, por tipo de consulta. Último intento de cada corrida.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { lastAttempts, readEvents, loadLabels, investorGain } from '../v7/common.mjs';
const D = resolve(import.meta.dirname, '../../out/investors-internal-2026-10-12-v8'), L = loadLabels();
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };
const runs = lastAttempts(readEvents(D)), S = {}, add = (k, f, n = 1) => { S[k] ??= { exa_paid: 0, searches: 0, results: 0, opened: 0, accepted: 0, firms: new Set(), gain2: new Set() }; S[k][f] += n; };
const examples = {};
for (const [rid, evs] of runs) {
  const cs = rid.match(/syn-(p\d\d)/)[1]; let ctx = 'otro';
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i];
    if (e.event === 'resolution_start') ctx = 'resolución por nombre';
    if (e.event === 'resolution_end' || e.event === 'deepening_end') ctx = 'otro';
    if (e.event === 'deepening_start') ctx = 'profundización';
    if (e.event === 'search_end') {
      const so = evs.slice(i + 1, i + 4).find(x => x.event === 'search_opened' && x.query === e.query);
      const k = so ? ({ list_discovery: 'listas', 'planner:initial': 'planner: lote inicial', 'planner:adaptive': 'planner: pasos' }[so.origin] ?? so.origin) : ctx;
      add(k, 'searches'); add(k, 'exa_paid', (e.attempts ?? []).filter(a => a.provider === 'exa' && !a.cached).length); add(k, 'results', e.results ?? 0);
      if (so) { add(k, 'opened', so.opened.length); ctx = k; if (cs === 'p01' && rid.endsWith('s101')) (examples[k] ??= []).push(e.query); }
    }
    if (e.event === 'extract_end' && e.accepted) { const h = host(e.url); add(ctx, 'accepted'); S[ctx].firms.add(`${cs}|${h}`); const l = L.get(`inv-case-syn-${cs}|inv:domain:${h}`); if (l && investorGain(l) >= 2) S[ctx].gain2.add(`${cs}|${h}`); }
  }
}
const rows = Object.entries(S).map(([k, v]) => ({ tipo: k, busquedas: v.searches, exa_pagadas: v.exa_paid, usd: +(v.exa_paid * 0.0089).toFixed(3), resultados: v.results, paginas_abiertas: v.opened, extracciones_aceptadas: v.accepted, firmas_unicas: v.firms.size, firmas_gain2: v.gain2.size }));
console.table(rows);
for (const [k, qs] of Object.entries(examples)) console.log(`\n${k} (p01 s101):\n  - ${qs.slice(0, 8).join('\n  - ')}`);
