/* Herramientas acotadas del agente V14: referencias, presupuestos y registro uniforme. */
import { multiSearch } from '../searchApis.mjs';
import { fetchPage } from '../localSearch.mjs';
import { crawl4aiRead } from '../crawl4ai.mjs';
import { firecrawlRead, jinaRead } from '../searchApis.mjs';
import { extractLinks } from '../discovery.mjs';
import { hostKind } from '../verify.mjs';
import { ApolloBudget, createApolloClient } from '../../../capital/apollo.mjs';

const clip = (v, n = 12000) => String(v ?? '').replace(/<\/?\s*page_data\s*>/gi, '[tag removed]').slice(0, n);
const noopTrace = { event: () => null, page: () => ({}) };
const json = async (fetcher, url, init = {}) => { const r = await fetcher(url, init); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
const rowsOf = (data) => Array.isArray(data) ? data : data?.results || data?.response?.award || data?.hits?.hits || [];

export function createTools({ env = process.env, fetcher = fetch, signal, trace = noopTrace, limits = {}, apollo = null, readers = {} } = {}) {
  const refs = new Map(); let searches = 0; let opens = 0; let rejectedRefs = 0; let exaSpent = 0; let searchSeq = 0; let pageSeq = 0;
  const breaker = {};
  const caps = { searches: Number(limits.searches) || 20, opens: Number(limits.opens) || 30, apolloCredits: Number(limits.apolloCredits) || 25, exaUsd: Number.isFinite(Number(limits.exaUsdCap)) ? Number(limits.exaUsdCap) : Infinity };
  const apolloClient = apollo || createApolloClient({ apiKey: env.APOLLO_API_KEY, fetcher, budget: new ApolloBudget({ perRun: caps.apolloCredits, perDay: 50 }) });
  const record = (tool, args, started, result, extra = {}) => trace.event('tool_call', { tool, args, results_n: Array.isArray(result) ? result.length : Number(result?.results?.length || result?.rows?.length || 0), ms_call: Date.now() - started, ...extra });
  const fail = (tool, args, started, error, extra = {}) => { record(tool, args, started, [], { error: String(error?.code || error?.message || error), ...extra }); return { error: String(error?.code || error?.message || error) }; };

  async function search(args = {}) {
    const started = Date.now();
    if (searches >= caps.searches) return fail('search', args, started, 'budget');
    searches++; const id = ++searchSeq;
    try {
      const found = await (readers.search || multiSearch)(String(args.query || ''), { env, fetcher, signal, breaker, limit: Math.min(10, Number(args.n) || 10), recency: args.recency || '' });
      const results = found.slice(0, 10).map((row, i) => {
        const ref = `s${id}.${i + 1}`; refs.set(ref, { url: row.url, title: row.title || '', snippet: row.description || '', markdown: row.markdown || '' });
        return { ref, url: row.url, title: row.title || '', snippet: row.description || '', providers: row.providers || [row.provider].filter(Boolean), host_hint: hostKind(row.url) };
      });
      const cost = Object.values(found.stats || {}).reduce((n, x) => n + (Number(x.costUsd) || 0), Number(found.costUsd) || 0);
      if (found.stats && Object.keys(found.stats).length) for (const [provider, stat] of Object.entries(found.stats)) {
        trace.event('tool_call', { tool: 'search', provider, args, results_n: Number(stat.returned) || 0, ms_call: Number(stat.ms) || 0, cost_usd: Number(stat.costUsd) || 0, ...(stat.error ? { error: stat.error } : {}), ...(args.from_lead ? { from_lead: args.from_lead } : {}) });
      } else record('search', args, started, results, { provider: 'injected', cost_usd: cost, ...(args.from_lead ? { from_lead: args.from_lead } : {}) });
      exaSpent += Number(found.stats?.exa?.costUsd) || 0;
      if (exaSpent >= caps.exaUsd) breaker.exa = { off: true, reason: `V14 Exa cap ${caps.exaUsd.toFixed(4)} USD` };
      return { results, cost_usd: cost };
    } catch (error) { return fail('search', args, started, error); }
  }

  async function open(args = {}) {
    const started = Date.now(); const row = refs.get(args.ref);
    if (!row) { rejectedRefs++; return fail('open', args, started, 'rejected_ref', { rejected_ref: true }); }
    if (hostKind(row.url) === 'social') return fail('open', args, started, 'blocked_social');
    if (opens >= caps.opens) return fail('open', args, started, 'budget');
    opens++;
    try {
      let page = null; let via = '';
      // Texto oficial ya provisto (registro federal): se usa tal cual, sin descargar.
      if (row.official && row.markdown) { page = { url: row.url, title: row.title, text: row.markdown }; via = 'registry'; }
      else if (readers.cached?.get?.(row.url)) { page = readers.cached.get(row.url); via = 'prefetch'; }   // descargada mientras GPTR buscaba
      else if (readers.open) { page = await readers.open(row.url, { row, env, fetcher, signal }); via = 'injected'; }
      else if (row.markdown?.length > 80) { page = { url: row.url, title: row.title, text: row.markdown }; via = 'search'; }
      // args.cheap: solo lectores gratuitos (triage de muchas páginas); nunca gasta créditos de Jina o Firecrawl.
      else for (const [name, reader] of (args.cheap ? [['direct', (u, o) => fetchPage(u, { ...o, timeoutMs: Number(env.GPTR_CHEAP_TIMEOUT_MS) || 6000 })]] : [['direct', fetchPage], ['crawl4ai', crawl4aiRead], ['jina', jinaRead], ['firecrawl', firecrawlRead]])) {
        try { page = await reader(row.url, { env, fetcher, signal }); } catch { page = null; }
        if (page) { via = name; break; }
      }
      if (!page) return fail('open', args, started, 'read_failed');
      const ref = `p${++pageSeq}`; const links = extractLinks(page.html || page.text, page.url || row.url).slice(0, 60).map((link, i) => {
        const linkRef = `${ref}.l${i + 1}`; refs.set(linkRef, link); return { ref: linkRef, text: link.text, url: link.url };
      });
      trace.page({ ref, url: page.url || row.url, title: page.title || row.title, text: page.text || '', via, found_by: { tool: 'open', ref: args.ref }, read: true });
      const result = { ref, url: page.url || row.url, title: page.title || row.title, chars: String(page.text || '').length, text: `<page_data>${clip(page.text)}</page_data>`, links, via };
      record('open', args, started, [result]); return result;
    } catch (error) { return fail('open', args, started, error); }
  }

  async function apolloTool(args = {}) {
    const started = Date.now(); const before = apolloClient.stats?.creditsEstimated || 0;
    try {
      const response = args.op === 'organization'
        ? await apolloClient.organizationSearch({ domain: args.domain, name: args.name, perPage: args.n || 5 })
        : args.op === 'people' ? await apolloClient.peopleSearch({ domain: args.domain, titles: args.titles || [], perPage: args.n || 5 })
          : args.op === 'match' ? await apolloClient.peopleMatch({ id: args.id, organization: args.domain || '' })
          : (() => { throw new Error('invalid_apollo_op'); })();
      const rows = response.data?.organizations || response.data?.accounts || response.data?.people || (response.data?.person ? [response.data.person] : []);
      record('apollo', args, started, rows, { credits: (apolloClient.stats?.creditsEstimated || 0) - before }); return { rows, credits_estimated: (apolloClient.stats?.creditsEstimated || 0) - before };
    } catch (error) { return fail('apollo', args, started, error, { credits: (apolloClient.stats?.creditsEstimated || 0) - before }); }
  }

  async function entityFunding(args = {}) {
    const started = Date.now(); const entity = clip(args.entity, 200); const topic = clip(args.topic, 200); const common = { headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, signal };
    try {
      const calls = [
        json(fetcher, 'https://api.reporter.nih.gov/v2/projects/search', { ...common, method: 'POST', body: JSON.stringify({ criteria: { org_names: [entity], ...(topic ? { advanced_text_search: { search_text: topic } } : {}) }, limit: 20 }) }),
        json(fetcher, `https://api.nsf.gov/services/v1/awards.json?${new URLSearchParams({ awardeeName: entity, ...(topic ? { keyword: topic } : {}) })}`, common),
        json(fetcher, `https://api.www.sbir.gov/public/api/awards?${new URLSearchParams({ firm: entity, ...(topic ? { keyword: topic } : {}) })}`, common),
        json(fetcher, `https://efts.sec.gov/LATEST/search-index?${new URLSearchParams({ q: entity, forms: 'D' })}`, { ...common, headers: { ...common.headers, 'User-Agent': env.SEC_USER_AGENT || 'IGC research contact@example.org' } }),
      ];
      const settled = await Promise.allSettled(calls); const rows = settled.flatMap((x) => x.status === 'fulfilled' ? rowsOf(x.value) : []).map((x) => ({ funder: x.funder || x.agency || x._source?.display_names?.[0] || null, recipient: x.organization?.org_name || x.awardeeName || x.firm || entity, amount: x.award_amount || x.fundsObligatedAmt || x.amount || null, date: x.project_start_date || x.startDate || x.date || null, source: x.source || 'registry', url: x.url || null }));
      record('entity_funding', args, started, rows); return { rows };
    } catch (error) { return fail('entity_funding', args, started, error); }
  }

  async function registry(args = {}) {
    const started = Date.now();
    try {
      const endpoints = { grants_gov: ['https://api.grants.gov/v1/api/search2', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword: args.query, rows: 10 }), signal }], reporter: ['https://api.reporter.nih.gov/v2/projects/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ criteria: { advanced_text_search: { search_text: args.query } }, limit: 10 }), signal }], nsf: [`https://api.nsf.gov/services/v1/awards.json?${new URLSearchParams({ keyword: args.query })}`, { signal }], sbir: [`https://api.www.sbir.gov/public/api/solicitations?${new URLSearchParams({ keyword: args.query, open: '1', rows: '10' })}`, { signal }] };
      if (!endpoints[args.source]) throw new Error('invalid_registry'); const [url, init] = endpoints[args.source]; const data = await json(fetcher, url, init); const rows = rowsOf(data?.data?.oppHits || data);
      record('registry', args, started, rows); return { rows };
    } catch (error) { return fail('registry', args, started, error); }
  }

  const note = async (args = {}) => { const at = Date.now(); record('note', args, at, []); return { ok: true }; };
  const ask_user = async (args = {}) => { const at = Date.now(); const out = { answered: false }; record('ask_user', args, at, []); trace.event('ask_user', { questions: args.questions || [], answered: false }); return out; };
  const finish = async (args = {}) => { const at = Date.now(); record('finish', args, at, []); trace.event('finish', { reason: String(args.reason || 'agent') }); return { ok: true }; };
  return { search, open, apollo: apolloTool, entity_funding: entityFunding, registry, note, ask_user, finish, refs, usage: () => ({ searches, opens, rejected_ref: rejectedRefs, apollo_credits: apolloClient.stats?.creditsEstimated || 0, exa_usd: exaSpent }) };
}
