#!/usr/bin/env node
// V9 prueba de nombres (sin Exa): cada proveedor disponible propone hasta 40 fondos por caso (p01–p12) con el prompt candidates/v1.
// Mide: oro en la lista (por nombre o dominio) y su puesto; firmas etiquetadas gain>=2 en la lista. Elige proveedor y aplica la regla
// pre-registrada (V9-PREREGISTRO.md §6): GO si el elegido nombra el oro en ≥ 4 de 6 casos de p01–p06.
// Las listas se guardan en la caché de la corrida v9 (misma clave): la corrida formal usa exactamente las mismas.
// Uso, desde research/: node --env-file=.env bench/investors/analysis/v9/names_check.mjs [--providers fleet,anthropic,gemini]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createBenchCache } from '../../../../agent/cache.mjs';
import { createNameCandidates, availableProviders } from '../../name-candidates.v9.mjs';
import { createHash } from 'node:crypto';
import { normalizeUrl } from '../../../../agent/docs.mjs';
import { loadCase, CASES_A, CASES_B, host, v8cache, diagListRows, closeAll } from './data.v9.mjs';
import { listDiscoveryQueries } from '../../list-discovery.v8.mjs';
import { rankVariant } from '../../list-names.v9.mjs';
import { GOLD_NAMES_V9 } from './ceiling_lists.mjs';
import { nameKey } from '../../list-names.v9.mjs';
import { loadLabels, investorGain, INV } from '../v7/common.mjs';
const arg = n => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? null : process.argv[i + 1]; };
const CFG = JSON.parse(readFileSync(resolve(INV, 'config/v9-2026-10-13.json'), 'utf8')), MC = CFG.b2.model_candidates;
const OUT = process.env.V9_RUN_OUT ? resolve(process.env.V9_RUN_OUT) : resolve(INV, 'out', CFG.bench_id), NOUT = process.env.V9_NAMES_OUT ? resolve(process.env.V9_NAMES_OUT) : resolve(INV, 'out', 'v9-nombres-2026-10-13');
const ALL = [...CASES_A, ...CASES_B], L = loadLabels();
const pool = c => JSON.parse(readFileSync(resolve(INV, `gold/v3/pool/inv-case-syn-${c}.json`), 'utf8'));
// Pistas de listas como las verá el motor v9: misma búsqueda (clave de search-failover con los parámetros de la config) leída de la
// caché v8, misma política de apertura y páginas de la caché v8. p07–p12 (sin corrida del motor): texto Exa del diagnóstico v8.
const sha = v => createHash('sha256').update(String(v)).digest('hex');
const DENY = CFG.fetch_denylist;
export function listHints(c, max = MC.max_hints ?? 300) {
  const prof = JSON.parse(readFileSync(resolve(INV, `cases/profiles/inv-case-syn-${c}.json`), 'utf8')), k = loadCase(c);
  const pages = [];
  for (const q of listDiscoveryQueries(prof, 2)) {
    const key = sha(`c${CFG.search.exa_contents_chars}|t${CFG.search.exa_type}|${CFG.search.exa_highlights ? 'h|' : ''}exa|${CFG.search.results_per_query}||${q.trim().toLowerCase()}`);
    const rows = v8cache().get('search', key)?.value;
    if (!rows) { for (const r of diagListRows(c).filter(r => r.query === q)) pages.push({ url: r.url, text: `${r.title}\n${r.text}` }); continue; }
    const perHost = new Map(); let n = 0;
    for (const r of [...rows].sort((a, b) => a.rank - b.rank)) {
      const h = host(r.url); if (!h || DENY.some(d => h === d || h.endsWith(`.${d}`)) || n >= (MC.list_fetch_per_query ?? 6) || (perHost.get(h) ?? 0) >= 2) continue;
      perHost.set(h, (perHost.get(h) ?? 0) + 1); n++;
      const t = v8cache().get('fetch', normalizeUrl(r.url))?.value?.text ?? ''; const text = t.length >= 200 ? t : (r.text ?? '');
      if (text.length >= 200) pages.push({ url: r.url, text });
    }
  }
  return rankVariant(pages, 'firm_pages', { extraGeneric: [k.fields.sector, ...(k.fields.subsectors ?? []), ...(k.fields.target_markets ?? [])] }).slice(0, max).map(x => x.name);
}
const matchName = (a, b) => { const x = nameKey(a), y = nameKey(b); return !!x && !!y && (x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `)); };
export function scoreCase(c, firms) {
  const k = loadCase(c), gi = firms.findIndex(f => (f.domain && (f.domain === k.gold.domain || f.domain.endsWith(`.${k.gold.domain}`))) || GOLD_NAMES_V9[c].some(g => matchName(f.name, g)));
  const names = new Map(pool(c).map(p => [p.stable_id, p.name.replace(/\s*\(.*?\)\s*/g, ' ').trim()]));
  const g2 = [...L.values()].filter(l => l.case_id === `inv-case-syn-${c}` && investorGain(l) >= 2).map(l => ({ id: l.stable_id, name: names.get(l.stable_id) ?? '' }));
  const g2hit = g2.filter(t => firms.some(f => (f.domain && t.id === `inv:domain:${f.domain}`) || (t.name && matchName(f.name, t.name))));
  return { case: c, firms: firms.length, with_domain: firms.filter(f => f.domain).length, gold_rank: gi < 0 ? null : gi + 1, gain2: g2.length, gain2_named: g2hit.length };
}
export function choose(summary) {
  const ok = Object.entries(summary).filter(([, s]) => !s.error);
  ok.sort(([pa, a], [pb, b]) => b.A_gold - a.A_gold || b.B_gold - a.B_gold || b.gain2_named - a.gain2_named || (pa.startsWith('fleet') ? -1 : pb.startsWith('fleet') ? 1 : 0));
  const [provider, s] = ok[0] ?? [null, null];
  return { provider, go: !!s && s.A_gold >= 4, A_gold: s?.A_gold ?? 0, B_gold: s?.B_gold ?? 0 };
}
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  const providers = (arg('providers') ?? 'fleet,fleet_lists').split(',').filter(Boolean);
  mkdirSync(OUT, { recursive: true }); mkdirSync(NOUT, { recursive: true });
  const cache = createBenchCache({ path: resolve(OUT, 'cache.sqlite'), namespace: `investors-${CFG.bench_id}` });
  const result = { executed_at: new Date().toISOString(), providers, rows: {}, summary: {} };
  for (const p of providers) {
    const lists = p.endsWith('_lists'), base = p.replace(/_lists$/, '');
    const nc = createNameCandidates({ provider: base, env: process.env, cache, max: MC.max_firms, web: MC.web !== false, manifest: MC.manifest, promptVersion: lists ? 'v2' : MC.prompt });
    const rows = [], t0 = Date.now(); let error = null, model = null, web = null, tokens = 0;
    const work = [...ALL]; const worker = async () => { while (work.length) { const c = work.shift(); try { const prof = JSON.parse(readFileSync(resolve(INV, `cases/profiles/inv-case-syn-${c}.json`), 'utf8')); const hints = lists ? listHints(c) : null; const r = await nc({ profile: prof, hints }); model = r.model; web = r.web; tokens += r.tokens ?? 0; rows.push({ ...scoreCase(c, r.firms), cached: r.cached, hints: hints?.length ?? null, gold_in_hints: hints ? scoreCase(c, hints.map(name => ({ name, domain: null }))).gold_rank : null }); console.log(`${p} ${c}: ${r.firms.length} fondos, oro ${rows.at(-1).gold_rank ? `en el puesto ${rows.at(-1).gold_rank}` : 'no'}`); } catch (e) { error = String(e.message).slice(0, 300); rows.push({ case: c, error }); console.log(`${p} ${c}: ERROR ${error}`); } } };
    await Promise.all([1, 2, 3, 4].map(worker));
    rows.sort((a, b) => a.case.localeCompare(b.case));
    const okRows = rows.filter(r => !r.error), A = okRows.filter(r => CASES_A.includes(r.case)), B = okRows.filter(r => CASES_B.includes(r.case));
    result.rows[p] = rows;
    result.summary[p] = { model, web, seconds: Math.round((Date.now() - t0) / 1000), tokens, errors: rows.filter(r => r.error).length, error: rows.length === rows.filter(r => r.error).length ? error : null,
      A_gold: A.filter(r => r.gold_rank).length, B_gold: B.filter(r => r.gold_rank).length, gain2_named: okRows.reduce((a, r) => a + r.gain2_named, 0), gain2_total: okRows.reduce((a, r) => a + r.gain2, 0) };
  }
  cache.close(); closeAll();
  result.decision = choose(result.summary);
  writeFileSync(resolve(NOUT, 'result.json'), `${JSON.stringify(result, null, 1)}\n`);
  writeFileSync(resolve(NOUT, 'chosen_provider.txt'), `${result.decision.provider ?? ''}\n`);
  const md = ['# V9 — Prueba de nombres (candidatos del modelo, sin Exa)', '', `Ejecutada: ${result.executed_at}. Prompt candidates/v1, hasta ${MC.max_firms} fondos por caso. Regla (V9-PREREGISTRO.md §6): GO si el proveedor elegido nombra el oro en ≥ 4 de 6 casos de p01–p06.`, '',
    '| Proveedor | Modelo | Búsqueda web | Oro nombrado p01–p06 | p07–p12 | Firmas gain ≥ 2 nombradas | Errores | Segundos |', '|---|---|---|---|---|---|---|---|',
    ...Object.entries(result.summary).map(([p, s]) => `| ${p} | ${s.model ?? '—'} | ${s.web ? 'sí' : 'no'} | ${s.A_gold} | ${s.B_gold} | ${s.gain2_named} de ${s.gain2_total} | ${s.errors}${s.error ? ` (${s.error.slice(0, 80)})` : ''} | ${s.seconds} |`), '',
    '| Caso | ' + providers.map(p => `${p}: puesto del oro`).join(' | ') + ' | Oro entre los nombres de las listas (puesto) |', '|---|' + providers.map(() => '---').join('|') + '|---|',
    ...ALL.map(c => `| ${c} | ` + providers.map(p => { const r = result.rows[p].find(x => x.case === c); return r?.error ? 'error' : (r?.gold_rank ?? '—'); }).join(' | ') + ` | ${Object.values(result.rows).flat().find(x => x.case === c && x.hints != null)?.gold_in_hints ?? '—'} |`), '',
    `Elegido: **${result.decision.provider ?? 'ninguno'}** (oro en ${result.decision.A_gold} de 6 en p01–p06, ${result.decision.B_gold} de 6 en p07–p12). Resultado: **${result.decision.go ? 'GO: se lanza la corrida formal v9' : 'NO-GO: no se lanza la corrida'}**.`];
  writeFileSync(arg('md') ?? resolve(NOUT, 'V9-NOMBRES.md'), `${md.join('\n')}\n`);
  console.log(JSON.stringify({ summary: result.summary, decision: result.decision }));
  const anyOk = Object.values(result.summary).some(x => x.errors < ALL.length);
  process.exit(result.decision.go ? 0 : anyOk ? 5 : 6);
}
