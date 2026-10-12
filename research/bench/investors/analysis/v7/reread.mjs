#!/usr/bin/env node
// C2 (H4/H5): relectura SIN red y SIN LLM de las páginas que el v5 perdió solo por missing_literal_quote.
// Conjunto: corridas B2 de investors-internal-2026-10-09-v5-pairs (36), pares dominio-corrida con página de inversionista
// nunca aceptada cuyo motivo más frecuente es missing_literal_quote (290 en el diagnóstico). Texto de la página: caché de
// fetch o texto del buscador; salida del modelo: caché LLM (misma clave que la corrida). Se pasa por extractor.mjs (control:
// debe reproducir el rechazo) y por extractor.v7.mjs. Uso (desde research/): node bench/investors/analysis/v7/reread.mjs [--json f]
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { normalizeUrl } from '../../../../agent/docs.mjs';
import { render, sanitizePageText } from '../../../../agent/prompts.mjs';
import { loadInvestorPrompt } from '../../prompts.mjs';
import { extractFixtureInvestorV2 } from '../../extractor.mjs';
import { extractFixtureInvestorV7 } from '../../extractor.v7.mjs';
import { loadRuns, DIRS, host, openLayers, loadLabels, investorGain } from './common.mjs';
const arg = n => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? null : process.argv[i + 1]; };
const sha = v => createHash('sha256').update(String(v)).digest('hex');
const P = loadInvestorPrompt('extractor', 'v3', { manifest: 'manifest.v5.json' });
const TODAY = '2026-10-09', FS = { step: 0, search_index: 0, order: 0, query_id: null };
const runs = loadRuns(DIRS.pairs).filter(r => r.cond === 'B2');
const layers = openLayers();
const searchTexts = new Map();
for (const l of layers) for (const row of l.all('search')) for (const r of row.value ?? []) if (r.text) { if (!searchTexts.has(r.url)) searchTexts.set(r.url, new Set()); searchTexts.get(r.url).add(r.text); }
const textsFor = url => { const out = []; for (const l of layers) { const h = l.get('fetch', normalizeUrl(url)); if (h?.value?.text) out.push(h.value.text); } for (const t of searchTexts.get(url) ?? []) out.push(t); return [...new Set(out)]; };
const llmGet = (text, url) => { const safe = sanitizePageText(text).replaceAll('{{', '{ {').replaceAll('}}', '} }').slice(0, 24000); const user = render(P.user, { today: TODAY, url, page_text: safe }); const key = sha([P.sha256, sha(user), 'investor_extraction.v2', 0, 0].join('|')); for (const l of layers) { const h = l.get('llm', key); if (h) return h.value.json; } return null; };

const groups = new Map();
for (const r of runs) for (const e of r.ev) if (e.event === 'extract_end' && e.kind === 'institutional_investor') { const k = `${r.rid}|${host(e.url)}`; if (!groups.has(k)) groups.set(k, { run: r, evs: [] }); groups.get(k).evs.push(e); }
const targets = [...groups].filter(([, g]) => !g.evs.some(e => e.accepted)).filter(([, g]) => { const c = {}; for (const e of g.evs) c[e.rejected_kind] = (c[e.rejected_kind] ?? 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0] === 'missing_literal_quote'; });
const L = loadLabels();
const rows = [];
for (const [k, g] of targets) {
  const r = g.run, labelCase = `inv-case-syn-${r.case}`;
  const out = { group: k, run_id: r.rid, case: r.case, variant: r.variant, seed: r.seed, domain: k.split('|')[1], extractions: 0, reconstructed: 0, v5_reproduced: 0, v7_accepted: 0, stable_ids: [], quote_checks: {}, quote_sources: {} };
  for (const e of g.evs.filter(e => e.rejected_kind === 'missing_literal_quote')) {
    out.extractions++;
    let got = null; for (const t of textsFor(e.url)) { const j = llmGet(t, e.url); if (j) { got = { t, j }; break; } }
    if (!got) continue; out.reconstructed++;
    const doc = { url: e.url, title: e.url, text: got.t };
    const v5 = extractFixtureInvestorV2({ document: doc, extraction: got.j, today: TODAY, firstSeen: FS });
    if (v5.rejected_kind === 'missing_literal_quote') out.v5_reproduced++;
    const v7 = extractFixtureInvestorV7({ document: doc, extraction: got.j, today: TODAY, firstSeen: FS });
    out.quote_checks[v7.meta.quote_check] = (out.quote_checks[v7.meta.quote_check] ?? 0) + 1;
    if (v7.entity) { out.v7_accepted++; out.quote_sources[v7.meta.quote_source] = (out.quote_sources[v7.meta.quote_source] ?? 0) + 1; if (!out.stable_ids.includes(v7.entity.stable_id)) out.stable_ids.push(v7.entity.stable_id); }
    else out.quote_checks[`rejected:${v7.rejected_kind}`] = (out.quote_checks[`rejected:${v7.rejected_kind}`] ?? 0) + 1;
  }
  out.labels = out.stable_ids.map(id => L.get(`${labelCase}|${id}`)).filter(Boolean).map(l => ({ stable_id: l.stable_id, gain: investorGain(l) }));
  // Etiqueta del dominio aunque v7 no lo acepte (para saber qué se pierde).
  out.domain_label = [...L.values()].filter(l => l.case_id === labelCase && l.stable_id === `inv:domain:${out.domain}`).map(l => investorGain(l))[0] ?? null;
  rows.push(out);
}
const sumk = f => rows.reduce((a, r) => a + f(r), 0), tally = key => rows.reduce((acc, r) => { for (const [k, v] of Object.entries(r[key])) acc[k] = (acc[k] ?? 0) + v; return acc; }, {});
const passed = rows.filter(r => r.v7_accepted > 0);
const count = xs => xs.reduce((a, g) => { a[g] = (a[g] ?? 0) + 1; return a; }, {});
const summary = {
  b2_runs: runs.length, groups: rows.length, extractions: sumk(r => r.extractions), reconstructed: sumk(r => r.reconstructed), v5_reproduced: sumk(r => r.v5_reproduced),
  v7_accepted_extractions: sumk(r => r.v7_accepted), v7_groups_passing: passed.length,
  v7_unique_case_firms_passing: new Set(passed.flatMap(r => r.stable_ids.map(id => `${r.case}|${id}`))).size,
  groups_with_domain_label: rows.filter(r => r.domain_label != null).length, groups_with_domain_label_gain: count(rows.filter(r => r.domain_label != null).map(r => r.domain_label)),
  passing_groups_with_label: passed.filter(r => r.labels.length).length, passing_label_gain: count(passed.flatMap(r => r.labels.map(l => l.gain))),
  passing_unlabeled_groups: passed.filter(r => !r.labels.length).length,
  quote_checks: tally('quote_checks'), quote_sources_of_accepted: tally('quote_sources'),
  gold_p04_golden_ventures: rows.filter(r => r.domain === 'golden.ventures').map(r => ({ run_id: r.run_id, v7_accepted: r.v7_accepted, checks: r.quote_checks })),
  boldtcapital: rows.filter(r => r.domain === 'boldtcapital.com').map(r => ({ run_id: r.run_id, v7_accepted: r.v7_accepted, checks: r.quote_checks })),
  llm_calls: 0, exa_calls: 0
};
for (const l of layers) l.close();
console.log(JSON.stringify(summary, null, 1));
if (arg('json')) writeFileSync(arg('json'), `${JSON.stringify({ summary, rows }, null, 1)}\n`);
