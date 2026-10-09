#!/usr/bin/env node
// FIX-17 — perfil → informe. Corre B2 (o la condición pedida) con dependencias reales y escribe result.json + report.md.
// No inventa campos: el informe solo imprime judgments y sources[].field_evidence / quote.
// Uso: node --env-file=research/.env research/bench/investors/find.mjs --config <v4> --profile <perfil.json> --condition B2 --seed 101 --out <dir>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FIELD = { 'INV-SECTOR': 'sectors', 'INV-STAGE': 'stages', 'INV-GEO': 'geographies', 'INV-TYPE': 'investor_type' };
const esc = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/** Cita literal + URL que respaldan un criterio, o null. */
export function criterionCitation(entity, criterion) {
  if (criterion.criterion_id === 'INV-SECTOR' && /^Sector quote: /.test(criterion.rationale ?? '')) {
    const quote = criterion.rationale.replace(/^Sector quote: /, ''); const src = entity.sources.find(s => (s.quote ?? '').includes(quote) || Object.values(s.field_evidence ?? {}).some(v => v.includes(quote)));
    return { quote, url: src?.url ?? entity.sources[0]?.url ?? null };
  }
  const f = FIELD[criterion.criterion_id];
  for (const s of entity.sources ?? []) if (s.field_evidence?.[f]) return { quote: s.field_evidence[f], url: s.url };
  return null;
}

export function exclusionReason(judgment) {
  const bad = judgment.criteria.filter(c => c.state === 'not_met' && ['INV-ACTIVE', 'INV-TYPE', 'INV-STAGE', 'INV-GEO', 'INV-CHECK', 'INV-BUSINESS-MODEL', 'INV-REGULATORY'].includes(c.criterion_id)).map(c => c.criterion_id);
  if (bad.length) return `criterio duro not_met: ${bad.join(', ')}`;
  if (judgment.sector_fit === 'off') return 'sector off';
  if (judgment.active_status === 'inactive') return 'inactiva';
  return null;
}

export function renderInvestorReport(result, profile) {
  const ent = new Map(result.entities.map(e => [e.stable_id, e])), jud = new Map(result.judgments.map(j => [j.stable_id, j]));
  const lines = [`# Inversionistas para ${esc(profile.fields.name.value)}`, '', `Condición ${result.condition} · parada: ${result.stop_reason} · búsquedas ${result.totals.searches} · páginas ${result.totals.fetches} · firmas ${result.entities.length} · recomendadas (gain ≥ 2) ${result.ranked.filter(x => x.gain >= 2).length}`, ''];
  if (result.abstained) lines.push(`**Sin recomendaciones.** abstention_reason: \`${result.abstention_reason ?? 'n/a'}\``, '');
  lines.push('| Rank | Gain | Firma | Dominio | Actividad | Sector | Etapa | Geografía | Tipo |', '|---|---|---|---|---|---|---|---|---|');
  for (const r of result.ranked) {
    const e = ent.get(r.stable_id), j = jud.get(r.stable_id);
    const cell = id => { const c = j.criteria.find(x => x.criterion_id === id); return c ? esc(c.state) : 'unknown'; };
    lines.push(`| ${r.rank} | ${r.gain} | ${esc(e.canonical_name)} | ${esc(e.official_domain ?? '—')} | ${esc(e.active_status)} | ${cell('INV-SECTOR')} (${esc(j.sector_fit)}) | ${cell('INV-STAGE')} | ${cell('INV-GEO')} | ${cell('INV-TYPE')} |`);
  }
  lines.push('', '## Evidencia por firma', '');
  for (const r of result.ranked) {
    const e = ent.get(r.stable_id), j = jud.get(r.stable_id);
    lines.push(`### ${r.rank}. ${esc(e.canonical_name)} — gain ${r.gain}`, '');
    const q = e.sources.find(s => s.quote); if (q) lines.push(`- Identidad e inversión: “${esc(q.quote)}” — ${q.url}`);
    for (const c of j.criteria.filter(c => FIELD[c.criterion_id] && c.state !== 'unknown')) { const cit = criterionCitation(e, c); lines.push(`- ${c.criterion_id} = ${c.state}: ${cit ? `“${esc(cit.quote)}” — ${cit.url}` : 'sin cita'}`); }
    if (r.gain === 0) lines.push(`- Excluida: ${exclusionReason(j) ?? j.overall_relevance}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = n => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? null : process.argv[i + 1]; };
  const { createBenchCache } = await import('../../agent/cache.mjs');
  const { createFetchTool } = await import('../../agent/tools/fetch.mjs');
  const { runInvestorDiscovery } = await import('./engine.mjs');
  const { loadInvestorPrompt } = await import('./prompts.mjs');
  const { createInvestorLlm, createLiveInvestorDeps } = await import('./external.mjs');
  const { createFailoverSearchTool } = await import('./search-failover.mjs');
  const { validateInvestor } = await import('./contracts.mjs');
  const repo = resolve(import.meta.dirname, '../../..');
  const config = JSON.parse(readFileSync(resolve(arg('config')), 'utf8'));
  const profile = validateInvestor('investor_profile', JSON.parse(readFileSync(resolve(arg('profile')), 'utf8')));
  const condition = arg('condition') || 'B2', seed = Number(arg('seed') || 101), out = resolve(arg('out')); mkdirSync(out, { recursive: true });
  const opts = config.prompts.manifest ? { manifest: config.prompts.manifest } : {};
  const cache = createBenchCache({ path: resolve(out, 'cache.sqlite'), namespace: `investors-find-${config.bench_id}` });
  try {
    const search = createFailoverSearchTool({ providers: config.search.providers, env: process.env, cache, resultsPerQuery: config.search.results_per_query, exaContentsChars: config.search.exa_contents_chars ?? null, exaType: config.search.exa_type ?? null, exaHighlights: config.search.exa_highlights === true });
    const fetch = createFetchTool({ env: process.env, cache }), llm = createInvestorLlm({ env: process.env, cache, family: config.agent_model.family });
    const deps = createLiveInvestorDeps({ search, fetch, llm, plannerPrompt: loadInvestorPrompt('planner', config.prompts.planner, opts), extractorPrompt: loadInvestorPrompt('extractor', config.prompts.extractor, opts), judgePrompt: (config.engine_v ?? 1) >= 2 ? loadInvestorPrompt('judge', config.prompts.judge, opts) : null, config, seed });
    const catalog = JSON.parse(readFileSync(resolve(repo, 'docs/contracts/investor/criteria_catalog.investor.v1.json'), 'utf8'));
    const templates = loadInvestorPrompt('b0_templates', config.prompts.b0_templates, opts).templates;
    const result = await runInvestorDiscovery({ caseObj: { case_id: 'inv-case-find-adhoc' }, profile, condition, config, templates, catalog, deps });
    writeFileSync(resolve(out, 'result.json'), `${JSON.stringify({ ...result, seed }, null, 2)}\n`);
    writeFileSync(resolve(out, 'report.md'), renderInvestorReport(result, profile));
    if (result.abstained) writeFileSync(resolve(out, 'abstention_reason'), `${result.abstention_reason ?? 'unknown'}\n`);
    console.log(JSON.stringify({ out, entities: result.entities.length, recommended: result.ranked.filter(x => x.gain >= 2).length, abstention_reason: result.abstention_reason ?? null }));
  } finally { cache.close(); }
}
