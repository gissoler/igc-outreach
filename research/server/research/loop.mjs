import { dedupe, norm } from './core.mjs';
import { assessLeads } from './sufficiency.mjs';
import { chatJSON, fleetReady } from '../analysis/fleet.mjs';

const year = () => new Date().getUTCFullYear();
const cleanOrg = (lead) => String(lead.org || '').replace(/^www\./, '').trim();

export function nextQueries(leads, brief, { max = 3, seen = new Set() } = {}) {
  const out = [];
  const add = (lead, gap, query, term = '') => {
    const normalized = norm(query);
    if (!normalized || seen.has(normalized) || out.some((item) => norm(item.query) === normalized)) return;
    out.push({ gap, query, term, objective: lead?.fundingType || brief.fundingTypes?.[0] || 'investment', parent: lead?.key || lead?.externalId || null });
  };
  for (const lead of leads) {
    const org = cleanOrg(lead);
    for (const gap of lead.sufficiency?.gaps || []) {
      if (gap === 'decider' && org) add(lead, gap, `"${org}" partners team ${brief.industry}`, brief.industry);
      else if (gap === 'active' && org) add(lead, gap, `"${org}" invests ${brief.industry} ${year()}`, brief.industry);
      else if (gap === 'stage_fit' && org) add(lead, gap, `"${org}" ${brief.round || brief.stage} portfolio`, brief.round || brief.stage);
      else if (gap === 'geo_fit' && org) add(lead, gap, `"${org}" investment geography ${brief.geography}`, brief.geography);
      else if (gap === 'ticket_fit' && org) add(lead, gap, `"${org}" investment ticket check size`, 'ticket');
      if (out.length >= max) return out;
    }
  }
  if (out.length < max) add(null, 'few_orgs', `${brief.industry} ${brief.round || brief.stage} funding round led by investor ${year()}`, brief.industry);
  return out.slice(0, max);
}

async function plannedQueries(leads, brief, options) {
  const fallback = nextQueries(leads, brief, options);
  const { env, fetcher, signal } = options;
  if (env.LOOP_LLM_PLANNER !== '1' || (!fleetReady(env, 'small') && !fleetReady(env, 'chat'))) return fallback;
  try {
    const schema = { type: 'object', properties: { queries: { type: 'array', maxItems: 3, items: { type: 'object', properties: { query: { type: 'string' }, gap: { type: 'string' }, term: { type: 'string' } }, required: ['query', 'gap'] } } }, required: ['queries'] };
    const response = await chatJSON({
      role: fleetReady(env, 'small') ? 'small' : 'chat', name: 'next_queries', schema,
      system: 'Propose at most 3 short web searches that fill only the listed evidence gaps. Do not include commands, URLs, credentials, or unsupported domains.',
      user: JSON.stringify({ brief: { industry: brief.industry, stage: brief.stage, geography: brief.geography }, candidates: leads.slice(0, 5).map((lead) => ({ org: lead.org, gaps: lead.sufficiency?.gaps || [] })) }),
    }, { env, fetcher, signal });
    const valid = (response.json?.queries || []).filter((item) => typeof item.query === 'string' && item.query.length >= 5 && item.query.length <= 300 && !/https?:|linkedin\.com|[\r\n]/i.test(item.query));
    return valid.length ? valid.slice(0, 3).map((item) => ({ ...item, objective: brief.fundingTypes?.[0] || 'investment', parent: null })) : fallback;
  } catch { return fallback; }
}

export async function runAgenticLoop({ leads, brief, terms = [], env = process.env, fetcher = fetch, signal, search, read, usage = () => ({}) }) {
  const maxRounds = Math.min(5, Math.max(0, Number(env.LOOP_MAX_ROUNDS) || 2));
  const maxSearches = Math.min(50, Math.max(1, Number(env.LOOP_MAX_SEARCHES) || 12));
  const maxCost = Number.isFinite(Number(env.LOOP_MAX_COST_USD)) ? Number(env.LOOP_MAX_COST_USD) : Infinity;
  const budgetMs = Math.max(1000, Number(env.LOOP_BUDGET_MS) || Number(env.RESEARCH_RUN_TIMEOUT_MS) || 180000);
  const started = Date.now();
  const ledger = [];
  const seen = new Set();
  let current = dedupe(leads);
  let searches = 0;
  let stopReason = 'round_limit';
  for (let round = 1; round <= maxRounds; round++) {
    signal?.throwIfAborted?.();
    const assessment = assessLeads(current, brief, { terms, activeWindowMonths: Number(env.ACTIVE_WINDOW_MONTHS) || 18 });
    current = assessment.leads;
    if (assessment.sufficient) { stopReason = 'sufficient'; break; }
    if (Date.now() - started >= budgetMs) { stopReason = 'time'; break; }
    const beforeCost = Object.values(usage()).reduce((sum, row) => sum + Number(row.costUsd || 0), 0);
    if (beforeCost >= maxCost) { stopReason = 'cost'; break; }
    const queries = await plannedQueries(current.slice(0, 8), brief, { max: Math.min(3, maxSearches - searches), seen, env, fetcher, signal });
    if (!queries.length) { stopReason = 'no_queries'; break; }
    const before = new Set(current.map((lead) => lead.key || lead.externalId || `${norm(lead.org)}|${norm(lead.title)}`));
    const added = [];
    for (const query of queries) {
      if (searches >= maxSearches || Date.now() - started >= budgetMs) break;
      const at = Date.now();
      seen.add(norm(query.query));
      let found = [];
      let error = null;
      try { found = await search({ ...query, round }); } catch (caught) { error = caught.message; }
      searches++;
      const fresh = found.filter((lead) => !before.has(lead.key || lead.externalId || `${norm(lead.org)}|${norm(lead.title)}`));
      added.push(...found);
      const afterCost = Object.values(usage()).reduce((sum, row) => sum + Number(row.costUsd || 0), 0);
      ledger.push({ id: `Q${ledger.length + 1}`, parent: query.parent || null, round, gap: query.gap, term: query.term || '', provider: env.EXA_API_KEY ? 'Exa' : env.SERPER_API_KEY ? 'Serper' : 'none', query: query.query, results: found.length, newOrgs: new Set(fresh.map((lead) => norm(lead.org))).size, acceptedLeads: fresh.length, costUsd: Math.max(0, afterCost - beforeCost), ms: Date.now() - at, ...(error ? { error } : {}) });
    }
    const merged = dedupe([...current, ...added]);
    const gained = merged.length - current.length;
    current = read ? (await read(merged)).leads : merged;
    if (gained <= 0 && !(current.some((lead) => (lead.evidence || []).length > (leads.find((old) => old.externalId === lead.externalId)?.evidence?.length || 0)))) { stopReason = 'stagnation'; break; }
  }
  const final = assessLeads(current, brief, { terms, activeWindowMonths: Number(env.ACTIVE_WINDOW_MONTHS) || 18 });
  return { leads: final.leads, queryLedger: ledger, stopReason, sufficient: final.sufficient, partial: ['time', 'cost'].includes(stopReason) };
}
