#!/usr/bin/env node
// V8 (análisis posterior a la corrida, NO pre-registrado): embudo de la fase de listas, por caso y sobre las páginas únicas de lista
// abiertas en las 3 réplicas: páginas con el nombre del oro → firmas que el modelo listó (candidates_raw) → firmas que pasan la
// verificación de cita (candidates) → oro como candidato crudo → oro verificado → oro resuelto. Solo relectura de events.jsonl y cache.sqlite de v8.
// Uso (desde research/): node bench/investors/analysis/v8/list_funnel.mjs [--v8 <out v8>] [--md f] [--json f]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openReadOnlyCache } from '../../cache-layers.v7.mjs';
import { normalizeUrl } from '../../../../agent/docs.mjs';
import { verifiedCandidates, isLiteralIn, matchText } from '../../extractor.mjs';
import { loadCase, nameIn, CASES_A } from './queries.v8.mjs';
import { OUT } from '../v7/common.mjs';
const arg = n => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? null : process.argv[i + 1]; };
const D = resolve(arg('v8') ?? resolve(OUT, 'investors-internal-2026-10-12-v8'));
const bench = JSON.parse(readFileSync(resolve(D, 'fingerprint.json'), 'utf8')).bench_id;
const ev = readFileSync(resolve(D, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const layer = openReadOnlyCache({ path: resolve(D, 'cache.sqlite'), namespace: `investors-${bench}` });
const fetchText = new Map(); for (const r of layer.all('fetch')) if (r.value?.text) fetchText.set(r.key, r.value.text);
const llm = [...layer.all('llm')].map(r => r.value.json).filter(j => j && Array.isArray(j.candidates));
const rows = [], detail = [];
for (const c of CASES_A) {
  const k = loadCase(c), tag = `syn-${c}__`;
  const opened = ev.filter(e => e.event === 'search_opened' && e.origin === 'list_discovery' && e.run_id.includes(tag));
  const urls = [...new Set(opened.flatMap(o => o.opened.map(i => o.urls[i])))];
  const pages = urls.filter(u => fetchText.has(normalizeUrl(u)));
  const withGold = pages.filter(u => nameIn(fetchText.get(normalizeUrl(u)), k.gold.aliases));
  const ex = u => ev.find(e => e.event === 'extract_end' && e.url === u && e.run_id.includes(tag));
  const raw = pages.reduce((a, u) => a + (ex(u)?.candidates_raw ?? 0), 0), ver = pages.reduce((a, u) => a + (ex(u)?.candidates ?? 0), 0);
  const goldRaw = llm.flatMap(j => j.candidates.filter(cd => nameIn(cd.name, k.gold.aliases)));
  let goldVerified = 0;
  for (const cd of goldRaw) {
    const page = withGold.map(u => fetchText.get(normalizeUrl(u))).find(t => isLiteralIn(t, cd.quote)) ?? null;
    const literal = Boolean(page), v = page ? verifiedCandidates({ document: { text: page }, extraction: { candidates: [cd] } }).length > 0 : false;
    if (v) goldVerified++;
    detail.push({ case: c, name: cd.name, quote: String(cd.quote).slice(0, 160), quote_literal_in_page: literal, name_in_quote: matchText(cd.quote).includes(matchText(cd.name)), verified: v });
  }
  const resolved = ev.filter(e => e.event === 'resolution_end' && e.run_id.includes(tag) && nameIn(e.name, k.gold.aliases)).length;
  rows.push({ case: c, gold: k.gold.domain, list_pages_unique: pages.length, pages_with_gold_name: withGold.length, candidates_raw: raw, candidates_verified: ver, gold_raw_candidate: goldRaw.length, gold_verified_candidate: goldVerified, gold_resolution_attempts: resolved });
}
layer.close();
const md = ['# V8 — Embudo de la fase de listas (análisis posterior, no pre-registrado)', '', `Fuente: ${D.split('/research/').at(-1)} (events.jsonl y cache.sqlite). Páginas únicas de lista abiertas en las 3 réplicas de cada caso.`, '',
  '| Caso | Oro | Páginas de lista | Con el nombre del oro | Firmas listadas por el modelo | Firmas que pasan la verificación de cita | Oro listado por el modelo en alguna extracción de la caché v8 | Oro que pasa la verificación | Intentos de resolver el oro |', '|---|---|---|---|---|---|---|---|---|',
  ...rows.map(r => `| ${r.case} | ${r.gold} | ${r.list_pages_unique} | ${r.pages_with_gold_name} | ${r.candidates_raw} | ${r.candidates_verified} | ${r.gold_raw_candidate} | ${r.gold_verified_candidate} | ${r.gold_resolution_attempts} |`), '',
  '| Caso | Nombre listado por el modelo | Cita literal en la página | La cita contiene el nombre | Pasa | Cita (160 caracteres) |', '|---|---|---|---|---|---|',
  ...detail.map(d => `| ${d.case} | ${d.name} | ${d.quote_literal_in_page ? 'sí' : 'no'} | ${d.name_in_quote ? 'sí' : 'no'} | ${d.verified ? 'sí' : 'no'} | ${d.quote.replace(/\|/g, '/').replace(/\n/g, ' ')} |`)];
console.log(JSON.stringify({ rows, detail }, null, 1));
if (arg('json')) writeFileSync(arg('json'), `${JSON.stringify({ rows, detail }, null, 1)}\n`);
if (arg('md')) writeFileSync(arg('md'), `${md.join('\n')}\n`);
