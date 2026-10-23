// V16 · Family offices como fuente propia de inversionistas: consultas dedicadas, EDGAR y Apollo; una inversión directa citada reemplaza la tesis.
import test from 'node:test';
import assert from 'node:assert/strict';
import { investorQueries, sectorOf } from '../server/research/investors/sector.mjs';
import { orgEvidence } from '../server/research/investors/evidence.mjs';
import { apolloFamilyOffices, edgarFamilyOffices, familyOfficeQueries, isFamilyOfficeName } from '../server/research/investors/familyOffices.mjs';
import { harvestInvestors, prefetchInvestors, runInvestorStage, withReserved } from '../server/research/investors/pipeline.mjs';

const TODAY = '2026-10-19';
const BRIEF = { company: 'Zeta AI', industry: 'AI drug discovery', product: 'small molecule binding prediction platform', oneLiner: 'AI virtual screening for small-molecule drug discovery', constraints: 'Exact search terms: AI drug discovery investor.', fundingTypes: ['investment'] };
const CONFIRMED = { ...BRIEF, entityType: 'for-profit company', country: 'United States', geography: 'Applicant incorporated in the stated country', stage: 'seed' };

/* ── mundo offline ── */
const PAGES = {
  'https://smithfamilyoffice.com/': { title: 'Smith Family Office', text: 'Smith Family Office is a single-family office based in Boston. We are long-term partners to founders and families. [Portfolio](https://smithfamilyoffice.com/portfolio) [Contact](https://smithfamilyoffice.com/contact)' },
  'https://smithfamilyoffice.com/portfolio': { title: 'Portfolio', text: 'Our portfolio. BindCo is building an AI drug discovery platform for small molecules, backed by Smith Family Office since 2025.' },
  'https://smithfamilyoffice.com/contact': { title: 'Contact', text: 'Get in touch with our team to share your plan.' },
  'https://jonesfamilycapital.com/': { title: 'Jones Family Capital', text: 'Jones Family Capital is a multi-family office. We invest in real estate and consumer brands across the United States. Contact us at info@jonesfamilycapital.com for inquiries.' },
  'https://www.fiercebiotech.com/biotech/bindco-seed': { title: 'BindCo raises $8M seed', text: 'BindCo, an AI drug discovery startup, today announced an $8M seed round. The round was led by Alpha Fund, with participation from Rivera Family Office.' },
  'https://riverafamilyoffice.com/': { title: 'Rivera Family Office', text: 'Rivera Family Office is a single family office. We invest our family capital directly in private companies and partner with founders for the long term. Reach out to us to start a conversation.' },
  'https://pointonefamilyoffice.com/': { title: 'PointOne Family Office | Direct investments', text: 'PointOne Family Office is a single-family office. We invest directly in early-stage AI drug discovery companies. Contact us to share your deck.' },
  'https://genericvc.com/': { title: 'Generic Ventures', text: 'Generic Ventures is a venture capital firm. We invest in early-stage AI drug discovery companies around the world and back founders from the first check. Get in touch with our team.' },
};
const SEARCH = (q) => {
  if (/^"Rivera Family Office" family office$/.test(q)) return ['https://riverafamilyoffice.com/'];
  if (/^"PointOne Family Office" family office$/.test(q)) return ['https://pointonefamilyoffice.com/'];
  if (/^"/.test(q)) return [];
  if (/participation from family office/.test(q)) return ['https://www.fiercebiotech.com/biotech/bindco-seed'];
  if (/family office/.test(q)) return ['https://smithfamilyoffice.com/', 'https://jonesfamilycapital.com/'];
  return ['https://genericvc.com/'];
};
function worldTools() {
  const refs = new Map(); let s = 0; let p = 0; const calls = { search: [], open: 0, apollo: [] };
  const linksOf = (url, text) => [...String(text).matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)].map((m, i) => ({ ref: `${url}#l${i}`, text: m[1], url: m[2] }))
    .concat([...String(text).matchAll(/\b([\w.-]+@[\w.-]+\.[a-z]{2,})\b/g)].map((m) => ({ text: m[1], url: `mailto:${m[1]}` })));
  return {
    refs, calls,
    async search({ query }) { calls.search.push(query); const id = ++s; return { results: SEARCH(query).map((url, i) => { const ref = `s${id}.${i + 1}`; refs.set(ref, { url, title: PAGES[url]?.title || url }); return { ref, url, title: PAGES[url]?.title || url, snippet: String(PAGES[url]?.text || '').slice(0, 160) }; }) }; },
    async open({ ref }) {
      calls.open++; const row = refs.get(ref); if (!row) return { error: 'rejected_ref' }; const page = PAGES[row.url]; if (!page) return { error: 'read_failed' };
      const links = linksOf(row.url, page.text); for (const l of links) if (l.ref) refs.set(l.ref, { url: l.url, title: l.text });
      return { ref: `p${++p}`, url: row.url, title: page.title, text: `<page_data>${page.text}</page_data>`, links };
    },
  };
}
const events = () => { const rows = []; return { rows, event: (type, data) => rows.push({ type, ...data }) }; };
const edgarFetcher = (calls = []) => async (url, init) => {
  calls.push({ url, init });
  return { ok: true, status: 200, json: async () => ({ hits: { hits: [
    { _source: { form: 'D/A', file_date: '2025-04-08', display_names: ['JUGGERNAUT FUND LP  (CIK 0001219173)'] } },
    { _source: { form: 'D', file_date: '2025-12-22', biz_states: ['TX'], display_names: ['PointOne Family Office, LLC  (CIK 0002102280)'] } },
    { _source: { form: 'D/A', file_date: '2026-03-25', display_names: ['PointOne Family Office, LLC  (CIK 0002102280)'] } },
    { _source: { form: 'D/A', file_date: '2025-11-12', display_names: ['CHARTWELL FAMILY FUND TFI LP  (CIK 0001257767)'] } },
  ] } }) };
};

test('V16-FO-01 consultas propias de family office: salen del brief, el país solo si está confirmado, sin nombres escritos a mano', () => {
  const qs = familyOfficeQueries(BRIEF);
  assert.equal(qs.length, 4); assert.ok(qs.every((q) => /family office/i.test(q)));
  assert.ok(qs.some((q) => /participation from family office/.test(q)), 'rondas donde participaron (fuente de nombres)');
  assert.ok(qs.some((q) => /portfolio/.test(q)), 'su portafolio');
  assert.ok(!qs.some((q) => /United States/.test(q)));
  assert.ok(familyOfficeQueries(BRIEF, { country: 'United States' }).some((q) => /family offices in United States/.test(q)));
  assert.equal(investorQueries(BRIEF).filter((q) => /family offices?/i.test(q)).length >= 2, true, 'las consultas generales no cambian');
  assert.equal(isFamilyOfficeName('Smith Family Office'), true); assert.equal(isFamilyOfficeName('Walton Family Capital'), true); assert.equal(isFamilyOfficeName('Alpha Fund'), false);
});

test('V16-FO-02 EDGAR: sin SEC_USER_AGENT no llama; con él, ventana de dos años hasta today y solo filers con «family» en el nombre, sin sufijo legal', async () => {
  const calls = [];
  assert.deepEqual(await edgarFamilyOffices({ fetcher: edgarFetcher(calls), env: {}, today: TODAY }), { names: [], query: null, hits: 0, reason: 'no_sec_user_agent' });
  assert.equal((await edgarFamilyOffices({ env: { SEC_USER_AGENT: 'x y@z.org' }, today: TODAY })).reason, 'no_fetcher');
  assert.equal(calls.length, 0);
  const out = await edgarFamilyOffices({ fetcher: edgarFetcher(calls), env: { SEC_USER_AGENT: 'IGC research ops@example.org' }, today: TODAY });
  assert.equal(calls.length, 1);
  const u = new URL(calls[0].url); assert.equal(u.searchParams.get('q'), '"family office"'); assert.equal(u.searchParams.get('forms'), 'D,13F-HR');
  assert.equal(u.searchParams.get('startdt'), '2024-10-19'); assert.equal(u.searchParams.get('enddt'), TODAY);
  assert.equal(calls[0].init.headers['User-Agent'], 'IGC research ops@example.org');
  assert.deepEqual(out.names.map((x) => x.name), ['PointOne Family Office', 'Chartwell Family Fund Tfi']);
  assert.match(out.names[0].from, /CIK=2102280$/); assert.deepEqual(out.names[0].states, ['TX']);
});

test('V16-FO-03 evidencia: family office sin tesis; su portafolio o una noticia que lo nombra prueban la inversión directa en el sector', () => {
  const sector = sectorOf(BRIEF);
  const pg = (url) => ({ url, title: PAGES[url].title, text: PAGES[url].text, links: [] });
  const smith = orgEvidence({ pages: [pg('https://smithfamilyoffice.com/'), pg('https://smithfamilyoffice.com/portfolio')], sector, brief: BRIEF, today: TODAY, org: { key: 'smithfamilyoffice.com', names: ['Smith Family Office'] } });
  assert.equal(smith.familyOffice, true); assert.equal(smith.investor.ok, true); assert.equal(smith.thesis.ok, false);
  assert.equal(smith.deals.ok, true); assert.equal(smith.deals.value, 'specific'); assert.equal(smith.deals.url, 'https://smithfamilyoffice.com/portfolio'); assert.equal(smith.deals.year, 2025);
  const rivera = orgEvidence({ pages: [pg('https://riverafamilyoffice.com/')], dealPages: [pg('https://www.fiercebiotech.com/biotech/bindco-seed')], sector, brief: BRIEF, today: TODAY, org: { key: 'riverafamilyoffice.com', names: ['Rivera Family Office'] } });
  assert.equal(rivera.deals.ok, true); assert.equal(rivera.deals.from, 'news'); assert.match(rivera.deals.quote, /participation from Rivera Family Office/);
  // una noticia que no lo nombra no prueba nada; un family office fuera del sector no tiene inversión directa
  const other = orgEvidence({ pages: [pg('https://riverafamilyoffice.com/')], dealPages: [{ url: 'https://news.example/x', title: 'x', text: 'BindCo, an AI drug discovery startup, today announced an $8M seed round. The round was led by Alpha Fund, with participation from Beta Angels.' }], sector, brief: BRIEF, today: TODAY, org: { key: 'riverafamilyoffice.com', names: ['Rivera Family Office'] } });
  assert.equal(other.deals.ok, false);
  const jones = orgEvidence({ pages: [pg('https://jonesfamilycapital.com/')], sector, brief: BRIEF, today: TODAY, org: { key: 'jonesfamilycapital.com', names: ['Jones Family Capital'] } });
  assert.equal(jones.familyOffice, true); assert.equal(jones.deals.ok, false);
  const vc = orgEvidence({ pages: [pg('https://genericvc.com/')], sector, brief: BRIEF, today: TODAY, org: { key: 'genericvc.com', names: ['Generic Ventures'] } });
  assert.equal(vc.familyOffice, false);
});

test('V16-FO-04 etapa completa: family offices con inversión directa quedan en «verify» con la cita; sin inversión en el sector se descartan con razón propia', async () => {
  const trace = events(); const tools = worldTools();
  const out = await runInvestorStage({ tools, brief: BRIEF, today: TODAY, trace, env: {} });
  assert.ok(tools.calls.search.some((q) => /^single family office direct investments biotech/.test(q)), 'consultas dedicadas');
  assert.ok(tools.calls.search.includes('"Rivera Family Office" family office'), 'el nombre de la noticia se resuelve como family office');
  const smith = out.findings.find((f) => f.org.key === 'smithfamilyoffice.com');
  assert.ok(smith, 'Smith retenido');
  assert.equal(smith.investor_type, 'family_office'); assert.equal(smith.tier, 'verify'); assert.equal(smith.fit.topic, 'deal');
  assert.ok(smith.blockers.some((b) => /Family office without a published sector thesis/.test(b)));
  assert.equal(smith.evidence.deal.url, 'https://smithfamilyoffice.com/portfolio'); assert.ok(smith.quotes.deal);
  assert.ok(smith.org.via.includes('family_office'));
  const rivera = out.findings.find((f) => f.org.key === 'riverafamilyoffice.com');
  assert.ok(rivera, 'Rivera retenido por la noticia de ronda');
  assert.equal(rivera.evidence.deal.from, 'news'); assert.equal(rivera.evidence.deal.url, 'https://www.fiercebiotech.com/biotech/bindco-seed');
  assert.deepEqual(rivera.org.deal_pages, ['https://www.fiercebiotech.com/biotech/bindco-seed']);
  assert.equal(trace.rows.some((r) => r.type === 'investor_org' && r.reason === 'quote_audit_failed'), false, 'la cita de la noticia pasa la auditoría literal');
  assert.equal(out.findings.some((f) => f.org.key === 'jonesfamilycapital.com'), false);
  assert.equal(out.funnel.dropped.family_office_no_sector_deal, 1);
  const vc = out.findings.find((f) => f.org.key === 'genericvc.com'); assert.ok(vc); assert.equal(vc.investor_type, null); assert.equal(vc.fit.topic, 'yes');
  assert.equal(out.funnel.family_office.kept, 2); assert.equal(out.funnel.family_office.by_deal, 2);
  assert.match(out.statusLine, /Family offices: \d+ candidatos → 2 retenidos \(2 por inversión directa/);
});

test('V16-FO-05 ENGINE_INVESTOR_FAMILY_OFFICES=0 apaga la rama: sin consultas propias, sin EDGAR y sin Apollo', async () => {
  const tools = worldTools();
  const { stats } = await harvestInvestors({ tools, brief: BRIEF, today: TODAY, env: { ENGINE_INVESTOR_FAMILY_OFFICES: '0' } });
  assert.equal(stats.family_office.queries.length, 0); assert.equal(stats.family_office.on, false);
  assert.equal(stats.family_office.edgar.reason_not_called, 'family_offices_off'); assert.equal(stats.family_office.apollo.reason_not_called, 'family_offices_off');
  assert.ok(!tools.calls.search.some((q) => /^single family office/.test(q)));
});

test('V16-FO-06 EDGAR en la cosecha: nombres resueltos a su sitio con «family office», vía edgar; sin SEC_USER_AGENT queda la razón', async () => {
  const tools = worldTools(); const fcalls = [];
  const { cands, stats } = await harvestInvestors({ tools, brief: BRIEF, today: TODAY, env: { SEC_USER_AGENT: 'IGC research ops@example.org' }, fetcher: edgarFetcher(fcalls) });
  assert.equal(fcalls.length, 1);
  assert.ok(tools.calls.search.includes('"PointOne Family Office" family office'));
  const c = cands.get('pointonefamilyoffice.com'); assert.ok(c, 'candidato desde EDGAR');
  assert.ok(c.via.has('edgar') && c.via.has('family_office')); assert.ok([...c.sources].some((s) => s.startsWith('edgar:')));
  assert.equal(stats.family_office.edgar.names, 2); assert.equal(stats.family_office.edgar.resolved, 1);
  const off = await harvestInvestors({ tools: worldTools(), brief: BRIEF, today: TODAY, env: {}, fetcher: edgarFetcher(fcalls) });
  assert.equal(fcalls.length, 1, 'sin SEC_USER_AGENT no hay llamada'); assert.equal(off.stats.family_office.edgar.reason_not_called, 'no_sec_user_agent');
  const failing = await harvestInvestors({ tools: worldTools(), brief: BRIEF, today: TODAY, env: { SEC_USER_AGENT: 'x y@z.org' }, fetcher: async () => ({ ok: false, status: 503 }) });
  assert.match(failing.stats.family_office.edgar.error, /HTTP 503/); assert.ok(failing.cands.size > 0, 'si EDGAR falla la cosecha sigue');
});

test('V16-FO-07 Apollo: con APOLLO_ENABLED=1 pide la etiqueta «family office» (en el país confirmado); apagado deja la razón y no gasta', async () => {
  const tools = worldTools();
  tools.apolloSource = async (args) => { tools.calls.apollo.push(args); tools.refs.set('a1.1', { url: 'https://pointonefamilyoffice.com/', title: 'PointOne Family Office' }); return { rows: [{ ref: 'a1.1', url: 'https://pointonefamilyoffice.com/', name: 'PointOne Family Office', industry: 'investment management', source: 'apollo' }], credits_estimated: 1 }; };
  const { cands, stats } = await harvestInvestors({ tools, brief: CONFIRMED, today: TODAY, env: { APOLLO_ENABLED: '1' } });
  assert.deepEqual(tools.calls.apollo, [{ keywords: ['family office'], location: 'United States', n: 8 }]);
  const c = cands.get('pointonefamilyoffice.com'); assert.ok(c.via.has('apollo') && c.via.has('family_office')); assert.ok(c.sources.has('apollo:family_office'));
  assert.equal(stats.family_office.apollo.credits, 1);
  assert.equal((await apolloFamilyOffices({ tools, env: {} })).reason, 'apollo_disabled');
  assert.equal((await apolloFamilyOffices({ tools, env: { APOLLO_ENABLED: '1', ENGINE_INVESTOR_FO_APOLLO: '0' } })).reason, 'fo_apollo_off');
  assert.equal(tools.calls.apollo.length, 1);
});

test('V16-FO-08 cupo reservado: los family offices entran al filtro aunque tengan menos fuentes que los VC', async () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: i, fo: i >= 7 }));
  assert.deepEqual(withReserved(rows, 5, (x) => x.fo, 2).map((x) => x.id), [0, 1, 2, 7, 8]);
  assert.deepEqual(withReserved(rows, 5, (x) => x.fo, 0).map((x) => x.id), [0, 1, 2, 3, 4]);
  assert.deepEqual(withReserved(rows.slice(0, 4), 5, (x) => x.fo, 2).map((x) => x.id), [0, 1, 2, 3]);
  const tools = worldTools();
  const pre = await prefetchInvestors({ tools, brief: BRIEF, today: TODAY, env: { ENGINE_INVESTOR_SCREEN: '1', ENGINE_INVESTOR_FO_SLOTS: '2' } });
  assert.ok([...pre.opened.keys()].filter((k) => /family/.test(k)).length >= 1, 'con cupo 1 de filtro, un family office igual se abre');
});

test('V16-FO-09 la interfaz recibe el tipo y la inversión directa: el lead lleva investorType, directInvestment y la cita como evidencia con su URL', async () => {
  const { engineLeads } = await import('../server/research/engine.mjs');
  const out = await runInvestorStage({ tools: worldTools(), brief: BRIEF, today: TODAY, env: {} });
  const leads = engineLeads(out.findings);
  const rivera = leads.find((l) => l.org === 'Rivera Family Office');
  assert.ok(rivera); assert.equal(rivera.investorType, 'family_office');
  assert.equal(rivera.directInvestment.url, 'https://www.fiercebiotech.com/biotech/bindco-seed'); assert.equal(rivera.directInvestment.from, 'news');
  assert.ok(rivera.evidence.some((e) => /direct investment/.test(e.source) && e.url === rivera.directInvestment.url && /Rivera Family Office/.test(e.quote)));
  assert.ok(rivera.missing.includes('Thesis not published: fit rests on a direct investment'));
  const vc = leads.find((l) => l.org === 'Generic Ventures'); assert.equal(vc.investorType, undefined); assert.equal(vc.directInvestment, undefined);
});
