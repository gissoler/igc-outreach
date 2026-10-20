/* Herramientas acotadas del agente V14: referencias, presupuestos y registro uniforme. */
import { multiSearch } from '../searchApis.mjs';
import { fetchPage } from '../localSearch.mjs';
import { crawl4aiRead } from '../crawl4ai.mjs';
import { firecrawlRead, jinaRead } from '../searchApis.mjs';
import { extractLinks } from '../discovery.mjs';
import { hostKind } from '../verify.mjs';
import { ApolloBudget, createApolloClient } from '../../../capital/apollo.mjs';
import { foaIdsIn, grantsGovSearch, simplerGrantsSearch } from '../grantSources.mjs';

const clip = (v, n = 12000) => String(v ?? '').replace(/<\/?\s*page_data\s*>/gi, '[tag removed]').slice(0, n);
const noopTrace = { event: () => null, page: () => ({}) };
const json = async (fetcher, url, init = {}) => { const r = await fetcher(url, init); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
/** Cliente mínimo con la forma de providers.mjs#makeClient().json que usan grantSources.mjs (sin registro de vivo). */
export const registryClient = (fetcher = fetch, signal) => ({ json: async (url, body, headers = {}) => { const r = await fetcher(url, { method: body ? 'POST' : 'GET', headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}), signal }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); } });
/** URL oficial del NIH Guide a partir de un identificador oficial (RFA/PA/PAR/NOT); no se inventa nada fuera de ese patrón. */
export function nihGuideUrl(number) {
  const id = String(number || '').trim().toUpperCase(); if (!foaIdsIn(id).includes(id)) return null;
  const dir = id.startsWith('RFA-') ? 'rfa-files' : id.startsWith('NOT-') ? 'notice-files' : /^PAR?-/.test(id) ? 'pa-files' : null;
  return dir ? `https://grants.nih.gov/grants/guide/${dir}/${id}.html` : null;
}
/** Texto de una ficha de registro (campos oficiales, en el orden en que los da la API). */
export function registryText(hit, source) {
  const d = hit._simplerDetail?.synopsis || {};
  return [`Official registry record (${source === 'simpler' ? 'Simpler.Grants.gov' : 'Grants.gov'}).`, `Opportunity title: ${hit.title || ''}.`, hit.number ? `Opportunity number: ${hit.number}.` : '', `Agency: ${hit.agency || d.agencyName || ''}.`,
    hit.oppStatus ? `Opportunity status: ${hit.oppStatus}.` : '', hit.openDate ? `Posted date: ${hit.openDate}.` : '', hit.closeDate ? `Close date: ${hit.closeDate}.` : '',
    d.awardCeiling ? `Award ceiling: ${d.awardCeiling}.` : '', d.applicantEligibilityDesc ? `Applicant eligibility: ${d.applicantEligibilityDesc}` : '', d.synopsisDesc ? `Summary: ${String(d.synopsisDesc).slice(0, 4000)}` : '',
    d.fundingDescLinkUrl ? `Additional information: ${d.fundingDescLinkUrl}` : ''].filter(Boolean).join('\n');
}
const rowsOf = (data) => Array.isArray(data) ? data : data?.results || data?.response?.award || data?.hits?.hits || [];

export function createTools({ env = process.env, fetcher = fetch, signal, trace = noopTrace, limits = {}, apollo = null, readers = {} } = {}) {
  const refs = new Map(); let searches = 0; let opens = 0; let rejectedRefs = 0; let exaSpent = 0; let searchSeq = 0; let pageSeq = 0; let registrySeq = 0;
  // ENGINE_SEARCH_PROVIDERS_OFF=jina,… apaga proveedores desde el inicio (p. ej. sin saldo conocido) sin gastar una llamada.
  const breaker = Object.fromEntries(String(env.ENGINE_SEARCH_PROVIDERS_OFF || '').split(',').map((p) => p.trim().toLowerCase()).filter(Boolean).map((p) => [p, { fails: 0, off: true, reason: 'disabled by ENGINE_SEARCH_PROVIDERS_OFF' }]));
  const announcedOff = new Set();
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
      // P0.8 · Por proveedor se guardan las URL que devolvió (hasta 10), no solo cuántas; un proveedor apagado por
      // saldo/clave (p. ej. Jina HTTP 402) se anuncia una vez con `provider_disabled` y deja de llamarse en esta corrida.
      if (found.stats && Object.keys(found.stats).length) for (const [provider, stat] of Object.entries(found.stats)) {
        const urls = found.filter((row) => (row.providers || [row.provider]).includes(provider)).slice(0, 10).map((row) => row.url);
        trace.event('tool_call', { tool: 'search', provider, args, results_n: Number(stat.returned) || 0, urls, ms_call: Number(stat.ms) || 0, cost_usd: Number(stat.costUsd) || 0, ...(stat.error ? { error: stat.error } : {}), ...(stat.disabled ? { disabled: true } : {}), ...(args.from_lead ? { from_lead: args.from_lead } : {}) });
        if (stat.disabled && !announcedOff.has(provider)) { announcedOff.add(provider); trace.event('provider_disabled', { provider, reason: String(stat.disabled).slice(0, 240), after_calls: searches }); }
      } else record('search', args, started, results, { provider: 'injected', urls: results.map((r) => r.url).slice(0, 10), cost_usd: cost, ...(args.from_lead ? { from_lead: args.from_lead } : {}) });
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
      if (readers.open) { page = await readers.open(row.url, { row, env, fetcher, signal }); via = 'injected'; }
      else if (row.markdown?.length > 80) { page = { url: row.url, title: row.title, text: row.markdown }; via = row.via || 'search'; }
      else for (const [name, reader] of [['direct', fetchPage], ['crawl4ai', crawl4aiRead], ['jina', jinaRead], ['firecrawl', firecrawlRead]]) {
        page = await reader(row.url, { env, fetcher, signal }); if (page) { via = name; break; }
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
          : (() => { throw new Error('invalid_apollo_op'); })();
      const rows = response.data?.organizations || response.data?.accounts || response.data?.people || [];
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

  /** Registros oficiales. simpler / grants_gov devuelven convocatorias abiertas o en forecast con refs abribles (el texto del
   *  registro se lee sin red); reporter / nsf / sbir devuelven inteligencia (premios pasados, solicitudes SBIR). Gratis: no
   *  consume el presupuesto de búsquedas web, pero abrir sus refs sí consume aperturas. */
  async function registry(args = {}) {
    const started = Date.now(); const source = String(args.source || '').trim(); const query = clip(args.query, 200);
    try {
      let rows;
      if (source === 'simpler' || source === 'grants_gov') {
        const hits = source === 'simpler'
          ? (env.SIMPLER_GRANTS_API_KEY ? (await simplerGrantsSearch(registryClient(fetcher, signal), { keyword: query, rows: Math.min(25, Number(args.n) || 10) }, { apiKey: env.SIMPLER_GRANTS_API_KEY })).hits : (() => { throw new Error('simpler_not_configured'); })())
          : (await grantsGovSearch(registryClient(fetcher, signal), { keyword: query, rows: Math.min(25, Number(args.n) || 10) })).hits;
        const id = ++registrySeq;
        rows = hits.slice(0, Math.min(25, Number(args.n) || 10)).map((hit, i) => {
          const ref = `r${id}.${i + 1}`; const url = hit.url || (hit.id ? `https://www.grants.gov/search-results-detail/${hit.id}` : '');
          const text = registryText(hit, source); refs.set(ref, { url, title: hit.title || hit.number || '', snippet: '', markdown: text, via: 'registry' });
          const guide = nihGuideUrl(hit.number); let guideRef = null;
          if (guide) { guideRef = `${ref}.g`; refs.set(guideRef, { url: guide, title: `${hit.number} (NIH Guide)`, snippet: '', markdown: '' }); }
          return { ref, url, title: hit.title || '', number: hit.number || null, agency: hit.agency || hit.agencyName || null, status: hit.oppStatus || null, close_date: hit.closeDate || null, ...(guideRef ? { guide_ref: guideRef } : {}), source };
        });
      } else {
        const endpoints = { reporter: ['https://api.reporter.nih.gov/v2/projects/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ criteria: { advanced_text_search: { search_text: query } }, limit: 10 }), signal }], nsf: [`https://api.nsf.gov/services/v1/awards.json?${new URLSearchParams({ keyword: query })}`, { signal }], sbir: [`https://api.www.sbir.gov/public/api/solicitations?${new URLSearchParams({ keyword: query, open: '1', rows: '10' })}`, { signal }] };
        if (!endpoints[source]) throw new Error('invalid_registry'); const [url, init] = endpoints[source]; const data = await json(fetcher, url, init); rows = rowsOf(data?.data?.oppHits || data);
      }
      record('registry', args, started, rows, { urls: rows.map((r) => r.url).filter(Boolean).slice(0, 10) }); return { rows };
    } catch (error) { return fail('registry', args, started, error); }
  }

  const note = async (args = {}) => { const at = Date.now(); record('note', args, at, []); return { ok: true }; };
  const ask_user = async (args = {}) => { const at = Date.now(); const out = { answered: false }; record('ask_user', args, at, []); trace.event('ask_user', { questions: args.questions || [], answered: false }); return out; };
  const finish = async (args = {}) => { const at = Date.now(); record('finish', args, at, []); trace.event('finish', { reason: String(args.reason || 'agent') }); return { ok: true }; };
  return { search, open, apollo: apolloTool, apolloClient, disabledProviders: () => Object.fromEntries(Object.entries(breaker).filter(([, b]) => b.off).map(([p, b]) => [p, b.reason])), entity_funding: entityFunding, registry, note, ask_user, finish, refs, usage: () => ({ searches, opens, rejected_ref: rejectedRefs, apollo_credits: apolloClient.stats?.creditsEstimated || 0, exa_usd: exaSpent }) };
}
