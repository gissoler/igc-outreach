import { createHash } from 'node:crypto';
import { validateCapital } from './contracts.mjs';
import { normalizeRecommendedTools, selectCapitalTool } from './tools.mjs';

const clip = (value, n = 300) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const slug = (value) => clip(value, 120).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'route';
const hash = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 10);
const asArray = (value, max = 12) => (Array.isArray(value) ? value : []).map((x) => clip(x, 300)).filter(Boolean).slice(0, max);
const date = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : new Date().toISOString().slice(0, 10);

export const CAPITAL_STRATEGY_SYSTEM = [
  'You are planning funding research, not deciding product positioning for the founder.',
  'Return 3-6 routes. The first must preserve the founder-declared segment. Adjacent segments are hypotheses until evidence is attached.',
  'For each route propose concise, verifiable questions about comparables, documented funding, prizes, grants, pilots, corporate venture, debt or VC as applicable.',
  'Do not reveal private reasoning or chain-of-thought. rationale must be a short, auditable justification only.',
  'Do not invent company names, funders, awards or relationships. If not already evidenced in the input, leave comparables, funders and evidence empty.',
  'Apollo can be recommended only after an organization is identified; it cannot establish relevance, friendship, trust, a warm intro or intent to invest.',
].join('\n');

function inputFromBrief(brief, asOf) {
  return {
    company_context: clip(brief.company || brief.organization || brief.venture, 300),
    product_description: clip(brief.product || brief.description || brief.oneLiner, 600),
    problem_solved: clip(brief.problem || brief.criteria || brief.description, 500),
    development_stage: clip(brief.stage || brief.round, 120),
    geography: clip(brief.geography || [brief.city, brief.state, brief.country].filter(Boolean).join(', '), 200),
    declared_segment: clip(brief.industry || brief.segment || 'Segment not confirmed', 240),
    business_model: clip(brief.businessModel || brief.entityType || '', 160),
    capital: clip([...(brief.fundingTypes || []), brief.amount].filter(Boolean).join(' · '), 160),
    confirmed_constraints: clip(brief.constraints || brief.exclusions || '', 500),
    as_of: asOf,
  };
}

function fallbackRoutes(input) {
  const declared = input.declared_segment;
  const problem = input.problem_solved || input.product_description || declared;
  const product = input.product_description || declared;
  return [
    { segment: declared, rationale: 'Preserve the segment explicitly supplied by the founder while verifying current funders and mechanisms.', questions: [`Which organizations currently fund ${declared}?`, `Which comparable products in ${declared} have documented financing, grants, awards or pilots?`] },
    { segment: `Adjacent buyer or workflow for: ${clip(problem, 120)}`, rationale: 'Test whether the same problem is funded in a neighboring buyer or workflow without changing the confirmed profile.', questions: [`Which adjacent buyers pay to solve ${clip(problem, 100)}?`, 'Which verified comparable products serve those buyers and who funded them?'] },
    { segment: `Enabling infrastructure around: ${clip(product, 120)}`, rationale: 'Test whether funders frame the product as enabling infrastructure rather than only as the declared vertical.', questions: [`Which products enable the same outcome as ${clip(product, 100)}?`, 'What grants, challenges, pilots, corporate venture programs or investors funded those products?'] },
  ];
}

function rawRoutes(output, input) {
  const proposed = Array.isArray(output?.proposed_routes) ? output.proposed_routes : Array.isArray(output?.routes) ? output.routes : [];
  const rows = proposed.length >= 2 ? proposed : fallbackRoutes(input);
  if (!rows.some((route) => clip(route.segment).toLowerCase() === input.declared_segment.toLowerCase())) rows.unshift(fallbackRoutes(input)[0]);
  return rows.slice(0, 6);
}

function normalizeRoute(raw, index, input, limits, available) {
  const segment = clip(raw.segment || (index === 0 ? input.declared_segment : `Adjacent route ${index}`), 240);
  const questions = asArray(raw.questions || raw.queries, 8);
  const seeded = questions.length ? questions : [`Which comparable products in ${segment} have documented funding?`];
  const queries = seeded.slice(0, limits.max_queries_per_route).map((question, qIndex) => {
    const selection = selectCapitalTool(question, { available });
    const query = clip(typeof raw.queries?.[qIndex] === 'object' ? raw.queries[qIndex].query : question, 300);
    return {
      query_id: `query:${index + 1}_${qIndex + 1}_${hash(query)}`,
      question: clip(typeof raw.queries?.[qIndex] === 'object' ? raw.queries[qIndex].question || question : question, 300),
      query,
      recommended_tool: selection.tool,
      reason: selection.reason,
      estimated_cost_usd: 0,
    };
  });
  const evidence = (Array.isArray(raw.evidence) ? raw.evidence : []).flatMap((item) => {
    const url = clip(item?.url, 1000), quote = clip(item?.quote, 1000);
    if (!/^https?:\/\//.test(url) || !quote) return [];
    return [{ source: clip(item.source || new URL(url).hostname, 160), url, quote, retrieved_at: date(item.retrieved_at || input.as_of), supports: clip(item.supports || segment, 240) }];
  }).slice(0, 20);
  const status = raw.status === 'rejected' ? 'rejected' : evidence.length ? 'evidence_backed' : 'hypothesis';
  const recommended = normalizeRecommendedTools(raw.recommended_tools, queries.map((q) => q.question).join(' '), { available });
  return {
    route_id: `route:${slug(segment)}_${index + 1}`,
    segment,
    status,
    rationale: clip(raw.rationale || 'Hypothesis to test with primary-source evidence.', 800),
    comparables: evidence.length ? asArray(raw.comparables, 12) : [],
    funding_mechanisms: asArray(raw.funding_mechanisms, 12),
    example_funders: evidence.length ? asArray(raw.example_funders, 12) : [],
    queries,
    recommended_tools: recommended,
    evidence,
    risks: [...new Set([...asArray(raw.risks, 12), ...(status === 'hypothesis' ? ['This route is a hypothesis until primary-source evidence supports it.'] : [])])],
    open_questions: asArray(raw.open_questions, 12),
  };
}

export async function buildCapitalStrategyContext(brief, {
  asOf = new Date().toISOString().slice(0, 10),
  plan = null,
  available = {},
  maxRoutes = 6,
  maxQueries = 18,
  maxCalls = 24,
  maxMs = 120000,
  maxCostUsd = 1,
} = {}) {
  const input = inputFromBrief(brief, asOf);
  const routeLimit = Math.min(6, Math.max(3, Number(maxRoutes) || 6));
  const queryLimit = Math.max(1, Number(maxQueries) || 18);
  const limits = {
    max_routes: routeLimit,
    max_queries: queryLimit,
    max_calls: Math.max(1, Number(maxCalls) || 24),
    max_ms: Math.max(1, Number(maxMs) || 120000),
    max_cost_usd: Math.max(0, Number(maxCostUsd) || 0),
    max_queries_per_route: Math.max(1, Math.floor(queryLimit / routeLimit)),
  };
  let output = null; let plannerError = null; const started = Date.now();
  if (plan) {
    try { output = await plan({ system: CAPITAL_STRATEGY_SYSTEM, input }); }
    catch (error) { plannerError = clip(error?.message || 'planner failed', 240); }
  }
  const routes = rawRoutes(output, input).slice(0, limits.max_routes).map((route, index) => normalizeRoute(route, index, input, limits, available));
  while (routes.length < 3) routes.push(normalizeRoute(fallbackRoutes(input)[routes.length], routes.length, input, limits, available));
  const toolCalls = [{
    call_id: `call:strategy_planner_${hash(JSON.stringify(input))}`,
    question: 'Which capital strategies and adjacent segments should be researched?',
    tool: 'llm', reason: 'Create structured hypotheses and concrete research questions without changing the confirmed founder profile.',
    estimated_cost_usd: 0, result: plannerError ? 'error' : plan ? 'success' : 'skipped', new_evidence: 0,
    error: plannerError, latency_ms: Math.max(0, Date.now() - started),
  }];
  for (const route of routes) for (const query of route.queries) toolCalls.push({ call_id: `call:${query.query_id.slice(6)}`, question: query.question, tool: query.recommended_tool, reason: query.reason, estimated_cost_usd: query.estimated_cost_usd, result: 'planned', new_evidence: 0, error: null, latency_ms: 0 });
  const result = {
    schema_version: 'capital_strategy_context/1', as_of: date(asOf),
    declared_segment: { name: input.declared_segment, source: brief.industry ? 'brief.industry' : brief.segment ? 'brief.segment' : 'not_confirmed', confirmed: Boolean(brief.industry || brief.segment) },
    proposed_routes: routes,
    tool_calls: toolCalls.slice(0, limits.max_calls + 1),
    limits: { max_routes: limits.max_routes, max_queries: limits.max_queries, max_calls: limits.max_calls, max_ms: limits.max_ms, max_cost_usd: limits.max_cost_usd },
  };
  return validateCapital('capital_strategy_context', result);
}

export function capitalQueries(context, { tools = ['searxng', 'official_grants', 'funding_round_sources'] } = {}) {
  const allowed = new Set(tools);
  return context.proposed_routes.flatMap((route) => route.queries.map((query) => ({ ...query, route_id: route.route_id }))).filter((query) => allowed.has(query.recommended_tool));
}

/** Adds only literal, dated evidence returned by the verified research engine. */
export function attachCapitalEvidence(context, findings = [], asOf = context.as_of) {
  const routes = context.proposed_routes.map((route) => {
    const queries = new Set(route.queries.map((q) => q.query.toLowerCase()));
    const matched = findings.filter((f) => queries.has(String(f.query || '').toLowerCase()) && /^https?:\/\//.test(String(f.url || '')) && String(f.quotes?.identity || '').trim());
    const evidence = matched.slice(0, 12).map((f) => ({ source: clip(f.name || new URL(f.url).hostname, 160), url: f.url, quote: clip(f.quotes.identity, 1000), retrieved_at: date(asOf), supports: clip(`Comparable, funder or mechanism discovered for ${route.segment}`, 240) }));
    const names = matched.map((f) => clip(f.name, 200)).filter(Boolean);
    return evidence.length ? { ...route, status: 'evidence_backed', evidence: [...route.evidence, ...evidence].slice(0, 20), comparables: [...new Set([...route.comparables, ...names])].slice(0, 12) } : route;
  });
  return validateCapital('capital_strategy_context', { ...context, proposed_routes: routes });
}

export function recordCapitalToolResults(context, executions = []) {
  const byQuery = new Map(executions.map((item) => [String(item.query_id), item]));
  const tool_calls = context.tool_calls.map((call) => {
    const item = byQuery.get(call.call_id.replace(/^call:/, 'query:'));
    if (!item) return call;
    return { ...call, result: item.error ? 'error' : item.new_evidence > 0 ? 'success' : 'empty', new_evidence: Math.max(0, Number(item.new_evidence) || 0), error: item.error ? clip(item.error, 240) : null, latency_ms: Math.max(0, Math.floor(Number(item.latency_ms) || 0)) };
  });
  return validateCapital('capital_strategy_context', { ...context, tool_calls });
}
