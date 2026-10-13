// Pruebas v9 (PROMPT-v11): extractor determinista de nombres de listas, emparejamiento nombre–dominio v9, resolución v9,
// regla del diagnóstico, prueba de no-fuga del oro, huellas v5/v7/v8 y techos sin gasto reproducibles. Sin red ni LLM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { cleanName, extractListNames, rankVariant, nameKey } from '../../bench/investors/list-names.v9.mjs';
import { nameMatchesDomainV9, registrableLabel, stripTypeTail } from '../../bench/investors/resolve-match.v9.mjs';
import { resolveCandidateV9, resolutionQuery } from '../../bench/investors/resolve.v9.mjs';
import { resolveCandidate } from '../../bench/investors/resolve.mjs';
import { nameMatchesDomain } from '../../bench/investors/extractor.mjs';
import { decide, listUrlsToOpen, expectedExaUnits, GOLD_QUERY_NAME, CFG } from '../../bench/investors/analysis/v9/diagnostico.v9.mjs';
import { GOLD_ALIASES, loadCase, CASES_A, CASES_B } from '../../bench/investors/analysis/v8/queries.v8.mjs';

const research = resolve(import.meta.dirname, '../..'), inv = resolve(research, 'bench/investors');
const ALL = [...CASES_A, ...CASES_B];

test('V9-1 no-fuga: ningún nombre ni dominio del oro en los módulos v9 del motor ni en la config v9', () => {
  const files = ['list-names.v9.mjs', 'resolve-match.v9.mjs', 'resolve.v9.mjs', 'config/v9-diagnostico-2026-10-12.json'].map(f => [f, readFileSync(resolve(inv, f), 'utf8').toLowerCase()]);
  for (const c of ALL) {
    const k = loadCase(c), anchor = JSON.parse(readFileSync(resolve(inv, `cases/inv-case-syn-${c}.json`), 'utf8')).anchors[0];
    const needles = [...GOLD_ALIASES[c], GOLD_QUERY_NAME[c], anchor.canonical_name.replace(/\s*\(.*$/, ''), k.gold.domain, k.gold.domain.split('.')[0]].map(s => s.toLowerCase()).filter(s => s.length >= 4);
    for (const [f, text] of files) for (const n of needles) assert.ok(!new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(text), `${c}: "${n}" aparece en ${f}`);
  }
});

test('V9-2 nombres de listas: tablas con tipo pegado, iniciales de avatar, encabezados numerados, listas de inversores y texto', () => {
  const page = ['| Investor | Relevant Deals | Geography |', '| --- | --- | --- |', '| Alfa Beta VC Fund | 34 | Mexico |', '| Gamma Angel | 3 | Chile |',
    'QU Quanta Xylo Partners', 'Venture Capital View profile ↗', '### 4. Delta Growth Partners', 'Investors', 'Epsilon Capital, Zeta, Eta Ventures',
    'In 2024 the round was led by Theta Ventures and Iota Capital Group with others.', '## Top investors in Mexico', 'Mexico City', 'Seed, Series A'].join('\n');
  const names = extractListNames(page, { extraGeneric: ['Mexico'] }).map(x => x.name);
  for (const n of ['Alfa Beta', 'Gamma', 'Quanta Xylo Partners', 'Delta Growth Partners', 'Epsilon Capital', 'Zeta', 'Eta Ventures', 'Theta Ventures', 'Iota Capital Group']) assert.ok(names.includes(n), `${n} en ${names}`);
  for (const n of ['Investor', 'Top investors in Mexico', 'Seed, Series A']) assert.ok(!names.includes(n), n);
  assert.equal(cleanName('| ---'), null); assert.equal(cleanName('Series B'), null); assert.equal(cleanName('Fund'), null);
  assert.equal(cleanName('7. Kappa Fund'), 'Kappa Fund');
});

test('V9-3 orden firm_pages: más páginas que la citan primero; empate por primera aparición; solo nombres con forma de firma', () => {
  const pages = [{ url: 'a', text: '| Uno Capital | 1 |\n| Dos Ventures | 2 |\nTres' }, { url: 'b', text: 'Dos Ventures backs startups.\n| Cuatro Partners | 3 |' }, { url: 'c', text: 'Dos Ventures and Uno Capital.' }];
  const r = rankVariant(pages, 'firm_pages');
  assert.deepEqual(r.map(x => [x.name, x.pages]), [['Dos Ventures', 3], ['Uno Capital', 2], ['Cuatro Partners', 1]]);
  assert.ok(!r.some(x => x.name === 'Tres'));
  assert.equal(nameKey('Café & Co.'), 'cafe and co');
});

test('V9-4 emparejamiento v9: dominios cortos, siglas, etiqueta registrable, sin tipo pegado; la regla v8 sigue valiendo', () => {
  for (const [n, h] of [['Hi Ventures', 'hi.vc'], ['Community Investment Management', 'cim-llc.com'], ['EQT Ventures – Climate Tech', 'v3.eqtventures.com'], ['Qbic Fund', 'qbic.be'], ['New Enterprise Associates', 'nea.com'], ['Advanced Technology Ventures (ATV)', 'atvcapital.com'], ['Bessemer Venture Partners', 'bvp.com']]) assert.ok(nameMatchesDomainV9(n, h), `${n} ~ ${h}`);
  for (const [n, h] of [['Hi Ventures', 'hightail.com'], ['Omega Fund', 'worldbank.org'], ['Sigma Capital', 'linkedin.com'], ['Rho Partners', 'shizune.co'], ['Nu Ventures', 'en.wikipedia.org']]) assert.ok(!nameMatchesDomainV9(n, h), `${n} !~ ${h}`);
  for (const [n, h] of [['Alpha Partners', 'alphapartners.com'], ['Betafund', 'betafund.vc']]) { assert.ok(nameMatchesDomain(n, h)); assert.ok(nameMatchesDomainV9(n, h)); }
  assert.equal(registrableLabel('www.x.co.uk'), 'x'); assert.equal(registrableLabel('group.bank'), 'group');
  assert.equal(stripTypeTail('Kappa Ventures VC Fund'), 'Kappa Ventures'); assert.equal(stripTypeTail('Lambda Capital'), 'Lambda Capital');
});

test('V9-5 resolución v9: con el emparejador y la consulta por defecto da lo mismo que resolve.mjs; con v9 encuentra hosts cortos', async () => {
  const mk = (rows, extracted) => {
    const log = { queries: [] };
    return { log, ctx: { deps: { search: async q => { log.queries.push(q); return { results: rows }; } }, config: { resolution: { suffix: 'venture capital' } }, canSearch: () => true, canFetch: () => true, remainingSearches: () => 5, onSearch: () => {}, denied: () => false, seenUrl: () => false, fetchPage: async () => ({ text: 'x'.repeat(300) }), extract: async () => extracted } };
  };
  const ent = d => ({ entity: { canonical_name: 'Hi Ventures', aliases: [], official_domain: d } });
  const rows = [{ url: 'https://www.linkedin.com/company/x' }, { url: 'https://hi.vc/' }];
  const a = mk(rows, ent('hi.vc')), b = mk(rows, ent('hi.vc')), c = mk(rows, ent('hi.vc'));
  const r0 = await resolveCandidate({ name: 'Hi Ventures' }, a.ctx), r1 = await resolveCandidateV9({ name: 'Hi Ventures' }, b.ctx), r2 = await resolveCandidateV9({ name: 'Hi Ventures VC Fund' }, c.ctx, { matcher: nameMatchesDomainV9, stripTail: true });
  assert.equal(r0.outcome, 'no_domain'); assert.equal(r1.outcome, 'no_domain'); assert.deepEqual(a.log.queries, b.log.queries);
  assert.equal(r2.outcome, 'accepted'); assert.equal(c.log.queries[0], '"Hi Ventures" venture capital');
  assert.equal(resolutionQuery('Mu Capital VC Fund', 'venture capital', { stripTail: true }), '"Mu Capital" venture capital');
  const d = mk([{ url: 'https://hi.vc/' }], ent('other.com'));
  assert.equal((await resolveCandidateV9({ name: 'Hi Ventures' }, d.ctx, { matcher: nameMatchesDomainV9 })).outcome, 'rejected:not_first_party');   // la regla de primera parte no cambia
});

test('V9-6 regla del diagnóstico: límite Exa con ≥4 de 12 sin el sitio; GO condicional solo con ≥4 de 6 en A y en B por Serper', () => {
  const row = (c, o) => ({ case: c, exa_top10: true, sel: true, acc_exa: false, acc_serper: true, ...o });
  const good = [...CASES_A, ...CASES_B].map(c => row(c));
  assert.equal(decide(good).go_L128_serper, true); assert.equal(decide(good).limit_is_exa, false);
  const badA = good.map(r => CASES_A.slice(0, 3).includes(r.case) ? { ...r, acc_serper: false } : r);
  assert.equal(decide(badA).A_pass_serper, 3); assert.equal(decide(badA).verdict, 'NO-GO');
  const exaMiss = good.map((r, i) => i < 4 ? { ...r, exa_top10: false } : r);
  assert.equal(decide(exaMiss).limit_is_exa, true);
  const notSel = good.map(r => CASES_B.slice(0, 3).includes(r.case) ? { ...r, sel: false } : r);
  assert.equal(decide(notSel).go_L128_serper, false);
});

test('V9-7 política de apertura de listas (la de v8): por puesto, ≤2 por sitio, 6 por consulta, lista negra', () => {
  const rows = [['q1', 1, 'https://a.com/1'], ['q1', 2, 'https://a.com/2'], ['q1', 3, 'https://a.com/3'], ['q1', 4, 'https://crunchbase.com/x'], ['q1', 5, 'https://b.com/'], ['q1', 6, 'https://c.com/'], ['q1', 7, 'https://d.com/'], ['q1', 8, 'https://e.com/'], ['q1', 9, 'https://f.com/'], ['q2', 1, 'https://a.com/1'], ['q2', 2, 'https://g.com/']].map(([query, rank, url]) => ({ query, rank, url }));
  assert.deepEqual(listUrlsToOpen(rows), ['https://a.com/1', 'https://a.com/2', 'https://b.com/', 'https://c.com/', 'https://d.com/', 'https://e.com/', 'https://g.com/']);
  assert.equal(expectedExaUnits(), 12); assert.ok(12 * CFG.caps.exa_usd_per_call <= CFG.caps.exa_usd);
});

test('V9-8 huellas: v5 (89), v7 (110) y v8 (111) idénticas; la config v9 es aparte y frozen', () => {
  for (const [cfg, n] of [['v5-2026-10-09', 89], ['v7-2026-10-12', 110], ['v8-2026-10-12', 111]]) {
    const out = spawnSync(process.execPath, ['bench/investors/freeze.mjs', '--config', `bench/investors/config/${cfg}.json`, '--check'], { cwd: research, encoding: 'utf8' });
    assert.equal(out.status, 0, out.stdout + out.stderr); const j = JSON.parse(out.stdout.trim().split('\n').at(-1));
    assert.equal(j.fingerprint_files, n, cfg); assert.equal(j.identical, n, cfg);
  }
  assert.equal(CFG.status, 'frozen'); assert.notEqual(CFG.bench_id, JSON.parse(readFileSync(resolve(inv, 'config/v8-2026-10-12.json'), 'utf8')).bench_id);
});

const caches = existsSync(resolve(inv, 'out/investors-internal-2026-10-12-v8/cache.sqlite')) && existsSync(resolve(inv, 'out/v8-diagnostico-2026-10-12/cache.sqlite'));
test('V9-9 techos sin gasto reproducibles desde las cachés (selección por réplica: K=64 → 2 casos, K=128 → 4 casos)', { skip: !caches && 'sin cachés v8' }, async () => {
  const { replicaRows } = await import('../../bench/investors/analysis/v9/ceiling_replicas.mjs');
  const rows = replicaRows(), sel = K => CASES_A.filter(c => rows.filter(r => r.case === c && r.rank && r.rank <= K).length >= 2);
  assert.deepEqual(sel(64), ['p01', 'p06']); assert.deepEqual(sel(128), ['p01', 'p02', 'p03', 'p06']);
  assert.equal(rows.length, 18);
});

test('V9-10 diagnóstico de punta a punta en modo simulado (sin red ni LLM): 12 unidades medidas por exa_spend, decisión y no repite', { skip: !caches && 'sin cachés v8' }, () => {
  const d = mkdtempSync(resolve(tmpdir(), 'v9d-'));
  const env = { ...process.env, V9_DIAG_MOCK: '1', V9_DIAG_OUT: d };
  const run = spawnSync(process.execPath, ['--no-warnings', 'bench/investors/analysis/v9/diagnostico.v9.mjs', '--cap-usd', '0.25', '--stop-file', resolve(d, '.stop')], { cwd: research, env, encoding: 'utf8', timeout: 240000 });
  assert.equal(run.status, 0, run.stderr.slice(-500));
  const r = JSON.parse(readFileSync(resolve(d, 'result.json'), 'utf8'));
  assert.equal(r.rows.length, 12); assert.equal(r.paid_units, 12); assert.equal(r.decision.A_selected_k, 4);
  const sp = spawnSync(process.execPath, ['bench/investors/analysis/exa_spend.mjs', '--dirs', d, '--usd-per-call', '0.0089'], { cwd: research, encoding: 'utf8' });
  assert.equal(sp.stdout.trim(), '0.107');
  const again = spawnSync(process.execPath, ['--no-warnings', 'bench/investors/analysis/v9/diagnostico.v9.mjs'], { cwd: research, env, encoding: 'utf8' });
  assert.match(again.stdout, /ya ejecutado/);
  const tight = spawnSync(process.execPath, ['--no-warnings', 'bench/investors/analysis/v9/diagnostico.v9.mjs', '--dry-run', '--cap-usd', '0.05'], { cwd: research, env, encoding: 'utf8' });
  assert.equal(tight.status, 4);   // costo esperado 0.107 > tope: no se ejecuta
});
