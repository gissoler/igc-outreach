// V15 · Brazo de inversionistas: candidatos sin modelo, expediente por organización y evidencia verificable por código.
import test from 'node:test';
import assert from 'node:assert/strict';
import { literalIn } from '../server/research/verify.mjs';
import { sectorOf, sectorMatch, investorQueries } from '../server/research/investors/sector.mjs';
import { orgEvidence, briefStage, sentencesOf } from '../server/research/investors/evidence.mjs';
import { candidatesFromList, isThirdParty, nameMatchesDomain, namesFromNews, namesFromHeadings, linkedInvestors, orgDisplayName, orgKey, roleOf } from '../server/research/investors/orgs.mjs';
import { runInvestorStage, prefetchInvestors, auditQuotes, openEntry, quickScreen, resolveNames } from '../server/research/investors/pipeline.mjs';
import { proposedInvestorDecision } from '../bench/investors/decide.mjs';

const TODAY = '2026-10-19';
const BRIEF = { company: 'IGC Pharma', product: 'AI-assisted small-molecule discovery for GIP and GLP-1 related metabolic targets', industry: 'obesity metabolic disease GIP GLP-1 drug discovery pharma partnering corporate venture licensing',
  stage: 'experimental capability; candidate and validation status unknown', geography: 'Global search; applicant country and entity type not confirmed',
  constraints: 'Exact search terms: obesity biotech investor; GLP-1 GIP partnership; metabolic drug discovery corporate venture.', fundingTypes: ['investment'] };
const CONFIRMED = { ...BRIEF, entityType: 'for-profit company', country: 'United States', geography: 'Applicant incorporated in the stated country', stage: 'seed' };

/* ── mundo offline ── */
const PAGES = {
  'https://acmebio.vc/': { title: 'Acme Bio Ventures', text: 'Acme Bio Ventures is a venture capital firm. We invest in early-stage obesity and metabolic drug discovery companies around the world. [Our approach](https://acmebio.vc/approach) [Contact](https://acmebio.vc/contact)' },
  'https://acmebio.vc/approach': { title: 'Approach', text: 'We back founders at the seed and Series A stage. We invest globally in companies from anywhere. In 2026 we led the seed round of a new metabolic biotech company. Founders can pitch us at pitch@acmebio.vc with a short deck.' },
  'https://acmebio.vc/contact': { title: 'Contact', text: 'Get in touch with our team about your company and send us your deck today.' },
  'https://operatingco.com/': { title: 'OperatingCo', text: 'OperatingCo is a clinical-stage biotech company developing oral GLP-1 drugs for obesity. Our pipeline includes three programs in metabolic disease and we are hiring.' },
  'https://somelist.com/top-obesity-vcs': { title: 'Top 10 obesity biotech venture capital firms', text: 'Top 10 obesity biotech venture capital firms to know. | [Acme Bio Ventures](https://acmebio.vc/) | [Late Stage Health Fund](https://latefund.com/) | [OperatingCo](https://operatingco.com/) |' },
  'https://latefund.com/': { title: 'Late Stage Health Fund', text: 'Late Stage Health Fund is an investment firm. We invest only in late-stage, Series C and beyond metabolic and obesity companies in the United States. Contact us at info@latefund.com for inquiries.' },
  'https://www.fiercebiotech.com/biotech/obesityco-raises-seed': { title: 'ObesityCo raises $20M seed', text: 'ObesityCo today announced a $20M seed round led by Metabolic Ventures, with participation from Acme Bio Ventures and Other Angels.' },
  'https://metabolicventures.com/': { title: 'Metabolic Ventures', text: 'Metabolic Ventures is a seed fund. We invest in pre-seed and seed companies working on obesity and diabetes therapeutics, only in the United States and Canada. Reach out to us at hello@metabolicventures.com to share your plan.' },
  'https://bigpharma.com/partnering': { title: 'Partnering', text: 'Our business development team reviews partnering and licensing opportunities in obesity and metabolic disease. Submit your partnering proposal through our portal.' },
  'https://igcpharma.com/': { title: 'IGC Pharma', text: 'IGC Pharma is developing therapies for Alzheimer disease and we invest in our own pipeline of obesity research.' },
};
const SEARCH = (q) => {
  if (/^"Metabolic Ventures"/.test(q)) return ['https://www.crunchbase.com/organization/metabolic-ventures', 'https://metabolicventures.com/'];
  if (/^"/.test(q)) return [];
  if (/^top /.test(q)) return ['https://somelist.com/top-obesity-vcs'];
  if (/raises seed round/.test(q)) return ['https://www.fiercebiotech.com/biotech/obesityco-raises-seed'];
  return ['https://acmebio.vc/', 'https://operatingco.com/', 'https://bigpharma.com/partnering', 'https://igcpharma.com/', 'https://www.linkedin.com/company/acme'];
};
function worldTools() {
  const refs = new Map(); let s = 0; let p = 0; const calls = { search: 0, open: 0 };
  const linksOf = (url, text) => [...String(text).matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)].map((m, i) => ({ ref: `${url}#l${i}`, text: m[1], url: m[2] }))
    .concat([...String(text).matchAll(/\b([\w.-]+@[\w.-]+\.[a-z]{2,})\b/g)].map((m) => ({ text: m[1], url: `mailto:${m[1]}` })));
  return {
    refs, calls,
    async search({ query }) { calls.search++; const id = ++s; return { results: SEARCH(query).map((url, i) => { const ref = `s${id}.${i + 1}`; refs.set(ref, { url, title: PAGES[url]?.title || url }); return { ref, url, title: PAGES[url]?.title || url, snippet: String(PAGES[url]?.text || '').slice(0, 120) }; }) }; },
    async open({ ref }) {
      calls.open++; const row = refs.get(ref); if (!row) return { error: 'rejected_ref' }; const page = PAGES[row.url]; if (!page) return { error: 'read_failed' };
      const links = linksOf(row.url, page.text); for (const l of links) if (l.ref) refs.set(l.ref, { url: l.url, title: l.text });
      return { ref: `p${++p}`, url: row.url, title: page.title, text: `<page_data>${page.text}</page_data>`, links };
    },
  };
}
const events = () => { const rows = []; return { rows, event: (type, data) => rows.push({ type, ...data }) }; };

test('V15-INV-01 nombre ↔ dominio sin sufijos ni siglas (el emparejador de v8 rechazaba sitios correctos)', () => {
  assert.equal(nameMatchesDomain('Kaszek VC Fund', 'https://www.kaszek.com/'), true);
  assert.equal(nameMatchesDomain('ARCH Venture Partners', 'https://www.archventure.com/'), true);
  assert.equal(nameMatchesDomain('Sofinnova Partners', 'https://sofinnovapartners.com'), true);
  assert.equal(nameMatchesDomain('RA Capital Management', 'https://www.racap.com'), true);
  assert.equal(nameMatchesDomain('OrbiMed', 'https://orbimed.com'), true);
  assert.equal(nameMatchesDomain('Metabolic Ventures', 'https://www.crunchbase.com/organization/metabolic-ventures'), false);
  assert.equal(nameMatchesDomain('Acme Bio Ventures', 'https://unrelated.com'), false);
  assert.equal(orgKey('https://news.novonordisk.co.uk/x'), 'novonordisk.co.uk');
  assert.equal(isThirdParty('https://www.prnewswire.co.uk/news/x'), true);
});

test('V15-INV-02 listas y noticias son fuentes, no candidatos; los nombres salen por regla', () => {
  assert.equal(roleOf({ url: 'https://somelist.com/top-obesity-vcs', title: 'Top 10 obesity biotech venture capital firms' }), 'list');
  assert.equal(roleOf({ url: 'https://www.fiercebiotech.com/biotech/x', title: 'ObesityCo raises $20M seed' }), 'news');
  assert.equal(roleOf({ url: 'https://acmebio.vc/', title: 'Acme Bio Ventures' }), 'org');
  const list = candidatesFromList({ url: 'https://somelist.com/top-obesity-vcs', links: [{ text: 'Acme Bio Ventures', url: 'https://acmebio.vc/' }, { text: 'read more', url: 'https://x.com/' }, { text: 'Crunchbase', url: 'https://www.crunchbase.com/a' }] });
  assert.deepEqual(list.map((c) => c.key), ['acmebio.vc']);
  assert.deepEqual(namesFromNews(PAGES['https://www.fiercebiotech.com/biotech/obesityco-raises-seed'].text), ['Metabolic Ventures', 'Acme Bio Ventures', 'Other Angels']);
});

test('V15-INV-03 sector: tesis específica vs amplia, y consultas escritas por el código', () => {
  const sec = sectorOf(BRIEF);
  assert.equal(sectorMatch('We invest in obesity companies.', sec).level, 'specific');
  assert.equal(sectorMatch('We invest in biotech and AI companies.', sec).level, 'broad');
  assert.equal(sectorMatch('We invest in fintech.', sec).level, null);
  const qs = investorQueries(BRIEF);
  assert.ok(qs.includes('obesity biotech investor') && qs.some((q) => /^top /.test(q)) && qs.some((q) => /led by$/.test(q)));
  assert.equal(briefStage(BRIEF), 'early'); assert.equal(briefStage({ stage: 'unknown' }), null);
});

test('V15-INV-04 evidencia: cada comprobación cita una frase literal de la página que nombra', () => {
  const pages = ['https://acmebio.vc/', 'https://acmebio.vc/approach'].map((url) => ({ url, ...PAGES[url], links: [] }));
  const ev = orgEvidence({ pages, sector: sectorOf(BRIEF), brief: BRIEF, facts: { country: null }, today: TODAY, org: { key: 'acmebio.vc', names: ['Acme Bio Ventures'] } });
  assert.equal(ev.investor.ok, true); assert.equal(ev.thesis.value, 'specific'); assert.equal(ev.stage.value, 'yes'); assert.equal(ev.geography.value, 'yes'); assert.equal(ev.contact.value, 'pitch'); assert.equal(ev.recent.ok, true);
  for (const k of ['investor', 'thesis', 'stage', 'geography', 'contact', 'recent']) { const page = pages.find((p) => p.url === ev[k].url); assert.ok(page && literalIn(ev[k].quote, page.text), `${k} quote not literal`); }
  // una empresa operativa no se presenta como inversora aunque hable de obesidad y de «our pipeline»
  const op = orgEvidence({ pages: [{ url: 'https://operatingco.com/', ...PAGES['https://operatingco.com/'], links: [] }], sector: sectorOf(BRIEF), brief: BRIEF, facts: { country: null }, today: TODAY, org: { key: 'operatingco.com', names: ['OperatingCo'] } });
  assert.equal(op.investor.ok, false);
  // menús y filas de tabla no son frases
  assert.equal(sentencesOf('Home About Portfolio Team News Contact Careers Login Subscribe').length, 0);
});

test('V15-INV-05 etapa completa sin modelo: descarta empresas, prensa, partnering y la propia empresa; lo retenido es verificable', async () => {
  const tools = worldTools(); const trace = events();
  const out = await runInvestorStage({ tools, brief: BRIEF, today: TODAY, trace, env: {} });
  const keys = out.findings.map((f) => f.org.key);
  assert.ok(keys.includes('acmebio.vc'), 'fund from search/list kept');
  assert.ok(keys.includes('metabolicventures.com'), 'name from news resolved by search and kept');
  for (const k of ['operatingco.com', 'bigpharma.com', 'igcpharma.com', 'fiercebiotech.com', 'somelist.com', 'linkedin.com', 'crunchbase.com']) assert.ok(!keys.includes(k), `${k} must not be retained`);
  assert.equal(out.funnel.dropped.not_investor, 1); assert.equal(out.funnel.dropped.partnering_route, 1);
  assert.deepEqual(out.otherRoutes.map((r) => r.org), ['bigpharma.com']);
  for (const f of out.findings) {
    assert.ok(f.evidence.thesis.quote && f.evidence.investor.quote, 'thesis and investor evidence present');
    assert.deepEqual(auditQuotes(f, new Map(Object.entries(PAGES).map(([url, p]) => [url, { url, text: p.text, links: [] }]))).filter((k) => k !== 'contact'), []);
    assert.notEqual(f.tier, 'main', 'brief does not confirm the applicant: nothing is ready to contact');
  }
  const late = out.findings.find((f) => f.org.key === 'latefund.com');
  assert.ok(late && late.blockers.some((b) => /Stage mismatch/.test(b)), 'growth-only fund flagged by code');
  const acme = out.findings.find((f) => f.org.key === 'acmebio.vc');
  assert.equal(acme.evidence.thesis.level, 'specific'); assert.ok(acme.org.via.includes('list') && acme.org.via.includes('search'));
  assert.match(out.statusLine, /Ninguno listo para contactar: el brief no confirma/);
  assert.ok(trace.rows.some((e) => e.type === 'investor_summary') && trace.rows.filter((e) => e.type === 'investor_org').every((e) => e.decided_by === 'code' || e.decision === 'not_selected' || e.reason === 'quote_audit_failed'));
});

test('V15-INV-06 con hechos del solicitante confirmados, «main» exige todo verificado; la geografía excluyente bloquea', async () => {
  const out = await runInvestorStage({ tools: worldTools(), brief: { ...CONFIRMED, country: 'Colombia' }, today: TODAY, env: {} });
  const acme = out.findings.find((f) => f.org.key === 'acmebio.vc'); const metab = out.findings.find((f) => f.org.key === 'metabolicventures.com');
  assert.equal(acme.tier, 'main'); assert.deepEqual(acme.verified_by_code, { thesis_specific: true, stage: true, geography: true, contact: true, recent: true, applicant_confirmed: true });
  assert.equal(metab.tier, 'verify'); assert.ok(metab.blockers.some((b) => /Geography excludes the applicant \(Colombia\)/.test(b)));
});

test('V15-INV-07 prefetch en paralelo + páginas del agente: lo ya abierto no se vuelve a abrir', async () => {
  const tools = worldTools();
  const pre = await prefetchInvestors({ tools, brief: BRIEF, today: TODAY, env: {} }); const opensAfterPrefetch = tools.calls.open;
  const out = await runInvestorStage({ tools, brief: BRIEF, today: TODAY, env: {}, prefetched: pre, agentPages: [{ url: 'https://acmebio.vc/contact', title: 'Contact', text: PAGES['https://acmebio.vc/contact'].text }] });
  assert.equal(tools.calls.open, opensAfterPrefetch, 'no new opens after prefetch');
  assert.ok(out.findings.find((f) => f.org.key === 'acmebio.vc').org.via.includes('agent'));
});

test('V15-INV-08 regla de decisión: null ya no aprueba por coerción y abstenerse en todo es «no evaluable»', () => {
  const thresholds = { min_recall_gain: 0.05, alpha: 0.05, max_ndcg_drop: 0.02, max_hard_false_positive_rate: 0.1, min_correct_null_abstentions: 2 };
  const comparisons = { vs_b0: { mean_diff: 0.1, sign_test_p_one_sided: 0.01 }, vs_b1: { mean_diff: 0.1, sign_test_p_one_sided: 0.01 } };
  const d = proposedInvestorDecision({ comparisons, b2: { ndcg_delta_min: null, hard_false_positive_rate: null, correct_null_abstentions: 3 }, thresholds });
  assert.equal(d.checks.hard_false_positive_rate, null); assert.equal(d.checks.ndcg_noninferior, null); assert.equal(d.degenerate, true); assert.equal(d.passes_if_approved, false); assert.equal(d.status, 'not_evaluable');
  const ok = proposedInvestorDecision({ comparisons, b2: { ndcg_delta_min: 0, hard_false_positive_rate: 0.05, correct_null_abstentions: 3 }, thresholds });
  assert.equal(ok.passes_if_approved, true);
});

test('V15-INV-09 bucle del agente en investment: la etapa por código reemplaza al juez LLM', async () => {
  const { runAgentObjective } = await import('../server/research/agentic/loop.mjs');
  const base = worldTools(); const trace = events(); const chats = [];
  const tools = { ...base, note: async () => ({ ok: true }), ask_user: async () => ({ answered: false }), finish: async () => ({ ok: true }), apollo: async () => ({ rows: [] }), entity_funding: async () => ({ rows: [] }), registry: async () => ({ rows: [] }), usage: () => ({ searches: base.calls.search, opens: base.calls.open, apollo_credits: 0 }) };
  const finish = { thought: 'done', assessment: null, notes: [], action: { tool: 'finish', args: { reason: 'test', finalists: [] }, from_lead: null } };
  const chat = async (req) => { chats.push(req.name); return { json: finish, model: 'fixture', usage: { prompt_tokens: 1, completion_tokens: 1 } }; };
  const out = await runAgentObjective('investment', BRIEF, { chat, tools, trace, today: TODAY, maxSteps: 3, env: { ENGINE_INVESTOR_DOSSIER: '1', ENGINE_AGENT_UNDERSTAND_MODE: 'profile', ENGINE_AGENT_APOLLO_SEED: '0' } });
  assert.equal(out.audit.search, 'agent+investor_dossier'); assert.equal(out.audit.judge.mode, 'investor_dossier_code');
  assert.ok(!chats.includes('judge'), 'no LLM judge call');
  assert.ok(out.findings.length >= 2 && out.findings.every((f) => f.read_contract === 'investor_dossier' && f.evidence.thesis.quote));
  assert.match(out.audit.status_line, /organizaciones candidatas/);
});

test('V15-INV-10 los eventos nuevos pasan el esquema de traza (una corrida real no se cae con TRACE_INVALID)', async () => {
  const { createTrace } = await import('../server/research/trace.mjs');
  const { mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const trace = createTrace({ dir: mkdtempSync(join(tmpdir(), 'v15-inv-')), runId: 'v15-inv', objective: 'investment' });
  const out = await runInvestorStage({ tools: worldTools(), brief: BRIEF, today: TODAY, trace, env: {} });
  assert.ok(out.findings.length >= 1);
  const pre = await prefetchInvestors({ tools: worldTools(), brief: BRIEF, today: TODAY, trace, env: {} });
  await runInvestorStage({ tools: worldTools(), brief: BRIEF, today: TODAY, trace, env: {}, prefetched: pre });
});

/* ── 20/10 · Lo que dejó ver la primera corrida en vivo de RD-01 ── */
const AI_BRIEF = { company: 'IGC Pharma', industry: 'AI drug discovery', product: 'small molecule binding prediction platform', oneLiner: 'AI virtual screening for small-molecule drug discovery', constraints: 'Exact search terms: AI drug discovery investor.', fundingTypes: ['investment'] };

test('V15-INV-11 medios generales y consultoras no son candidatos (Yahoo, NYT, Fortune, Endpoints, Accenture gastaban aperturas)', () => {
  for (const u of ['https://finance.yahoo.com/news/x', 'https://www.nytimes.com/2026/01/01/x.html', 'https://fortune.com/2026/05/26/x', 'https://endpoints.news/x', 'https://www.accenture.com/us-en/insights/x', 'https://qubit.capital/blog/top-biotech-vc-firms']) assert.equal(isThirdParty(u), true, u);
  for (const u of ['https://www.sanofiventures.com/', 'https://www.airstreet.com/', 'https://www.archventure.com/']) assert.equal(isThirdParty(u), false, u);
});

test('V15-INV-12 tesis: IA × ciencias de la vida en la misma frase es específica para un brief de IA + fármacos; una lista suelta sigue amplia', () => {
  const sector = sectorOf(AI_BRIEF);
  assert.equal(sectorMatch('Our investments support companies in AI-life sciences from Seed to Series B.', sector).level, 'specific');
  assert.equal(sectorMatch('Air Street Capital focuses on AI-first companies, robotics, defense technology, and TechBio and AI-native life sciences.', sector).level, 'specific');
  assert.equal(sectorMatch('Investing in computationally-enabled therapeutic platforms from development candidate through first-in-human.', sector).level, 'specific');
  assert.equal(sectorMatch('We invest in biotech and healthcare companies.', sector).level, 'broad');
  assert.equal(sectorMatch('We invest in AI, fintech, consumer products and, separately, in a few real estate projects across many sectors and cities, plus biotech.', sector).level, 'broad');
  assert.equal(sectorMatch('We invest in consumer fintech.', sector).level, null);
});

test('V15-INV-13 geografía: «escalar empresas globalmente» no es dónde invierte; «invests globally» sí', () => {
  const ev = (text) => orgEvidence({ pages: [{ url: 'https://zfund.vc/', title: 'Z', text, links: [] }], sector: sectorOf(AI_BRIEF), brief: AI_BRIEF, facts: { country: 'United States' }, today: TODAY, org: { key: 'zfund.vc', names: ['Z Fund'] } });
  assert.equal(ev('Our team brings decades of experience in science, finance and AI together to help founders scale companies globally.').geography.value, 'not_stated');
  assert.equal(ev('Z Fund invests globally in early-stage AI drug discovery companies and backs founders from anywhere.').geography.value, 'yes');
});

test('V15-INV-14 el nombre sale de la organización, no del título de la página («Home», un titular)', () => {
  assert.equal(orgDisplayName({ key: 'sanofiventures.com', names: ['Home'] }, [{ url: 'https://www.sanofiventures.com/', title: 'Home', text: 'Sanofi Ventures is the corporate venture capital arm of Sanofi. About Sanofi Ventures.' }]), 'Sanofi Ventures');
  assert.equal(orgDisplayName({ key: 'pfizer.com', names: ['ATOMWISE ENTERS INTO AN EVALUATION'] }, [{ url: 'https://www.pfizer.com/x', title: 'ATOMWISE ENTERS INTO AN EVALUATION', text: 'Pfizer Ventures invests globally. Pfizer Ventures: How We Work.' }]), 'Pfizer Ventures');
  assert.equal(orgDisplayName({ key: 'airstreet.com', names: ['Air Street Capital'] }, []), 'Air Street Capital');
  assert.equal(orgDisplayName({ key: 'nothing.example', names: ['Home'] }, []), 'nothing.example');
});

test('V15-INV-15 home delgada de un dominio que suena a fondo se profundiza; la home se abre en el dominio registrable (no en careers.*)', async () => {
  PAGES['https://careers.zetaventures.com/companies'] = { title: 'Companies', text: 'Portfolio careers. Discover opportunities across our network of companies and jobs.' };
  PAGES['https://zetaventures.com/'] = { title: 'Zeta', text: 'The AI-focused fund. [Approach](https://zetaventures.com/approach)' };
  const tools = worldTools(); tools.refs.set('r1', { url: 'https://careers.zetaventures.com/companies', title: 'Companies' });
  const cand = { key: 'zetaventures.com', names: ['Zeta'], urls: ['https://careers.zetaventures.com/companies'], refs: [{ ref: 'r1', url: 'https://careers.zetaventures.com/companies' }], sources: new Set(['search']), via: new Set(['search']), snippets: [], score: 0 };
  const pages = await openEntry(tools, cand);
  assert.ok(pages.some((p) => p.url === 'https://zetaventures.com/'), 'abre la home del dominio registrable');
  const sector = sectorOf(AI_BRIEF);
  const q = quickScreen(pages.filter((p) => p.url === 'https://zetaventures.com/'), sector, cand);
  const plain = { ...cand, key: 'randomco.com', names: ['RandomCo'] };
  const q2 = quickScreen([{ url: 'https://randomco.com/', title: 'RandomCo', text: 'Welcome to RandomCo. [Approach](https://randomco.com/a)', links: [] }], sector, plain);
  assert.ok(q >= 2, `home delgada de un fondo se profundiza (q=${q})`);
  assert.ok(q2 < 2, `home delgada de un dominio neutro no (q=${q2})`);
});

test('V15-INV-16 cobertura: consultas por arquetipo derivadas del brief, sin nombres de fondos escritos a mano', () => {
  const qs = investorQueries(AI_BRIEF);
  assert.ok(qs.length >= 10 && qs.length <= 12, `n=${qs.length}`);
  assert.ok(qs.some((q) => /corporate venture capital arms/.test(q)) && qs.some((q) => /^most active /.test(q)) && qs.some((q) => /Series A led by/.test(q)));
  assert.ok(!qs.some((q) => /^AI Series A/.test(q)), 'sin consultas vacías de sector');
  assert.equal(new Set(qs.map((q) => q.toLowerCase())).size, qs.length);
});

test('V15-INV-17 resolver nombres: acepta el sitio cuyo título nombra al fondo y suena a inversor; rechaza redes, prensa y homónimos', async () => {
  const rows = (urls) => ({ results: urls.map(([url, title, snippet = ''], i) => ({ ref: `x${i}`, url, title, snippet })) });
  const add = []; const addCand = (key, row) => add.push({ key, ...row });
  const mk = (urls) => ({ search: async () => rows(urls) });
  await resolveNames({ tools: mk([['https://www.linkedin.com/company/zorro', 'Zorro Life Sciences Fund'], ['https://zorrobio.com/', 'Zorro Life Sciences Fund | Early-stage biotech venture capital']]), names: [{ name: 'Zorro Life Sciences Fund', from: 'https://news.example.com/a' }], brief: AI_BRIEF, addCand, source: 'news' });
  assert.deepEqual(add.map((x) => x.key), ['zorrobio.com']);
  add.length = 0;
  const r2 = await resolveNames({ tools: mk([['https://www.forbes.com/zorro', 'Zorro Life Sciences Fund raises'], ['https://zorrocoffee.com/', 'Zorro Coffee Roasters', 'Best coffee in town']]), names: [{ name: 'Zorro Life Sciences Fund', from: 'https://news.example.com/a' }], brief: AI_BRIEF, addCand, source: 'news' });
  assert.equal(add.length, 0); assert.equal(r2.resolved, 0);
});

test('V15-INV-18 segunda ronda: un fondo retenido nombra a sus co-inversores y estos se abren como candidatos nuevos', async () => {
  PAGES['https://alphafund.vc/'] = { title: 'Alpha Fund', text: 'Alpha Fund is a venture capital firm. We invest in AI drug discovery and life sciences companies. [Portfolio news](https://alphafund.vc/portfolio) [Approach](https://alphafund.vc/approach)' };
  PAGES['https://alphafund.vc/approach'] = { title: 'Approach', text: 'We invest in early-stage AI drug discovery companies around the world. Get in touch with our team.' };
  PAGES['https://alphafund.vc/portfolio'] = { title: 'Portfolio', text: 'In 2026 BindCo closed a $12M seed round led by Alpha Fund, with participation from Zorro Life Sciences Fund.' };
  PAGES['https://zorrobio.com/'] = { title: 'Zorro Life Sciences Fund | Early-stage biotech venture capital', text: 'Zorro Life Sciences Fund is a venture capital firm. We invest in early-stage AI drug discovery and biotech companies. [Contact](https://zorrobio.com/contact)' };
  const tools = worldTools(); const baseSearch = tools.search;
  tools.search = async (a) => {
    if (/^"Zorro/.test(a.query)) { const ref = 'zr1'; tools.refs.set(ref, { url: 'https://zorrobio.com/', title: PAGES['https://zorrobio.com/'].title }); return { results: [{ ref, url: 'https://zorrobio.com/', title: PAGES['https://zorrobio.com/'].title, snippet: '' }] }; }
    const out = await baseSearch(a); const ref = `al${Math.random()}`; tools.refs.set(ref, { url: 'https://alphafund.vc/', title: 'Alpha Fund' });
    return { results: [...out.results, { ref, url: 'https://alphafund.vc/', title: 'Alpha Fund', snippet: 'AI drug discovery venture capital' }] };
  };
  const pre = await prefetchInvestors({ tools, brief: AI_BRIEF, today: TODAY, env: {} });
  assert.ok(pre.opened.has('alphafund.vc'));
  assert.ok(pre.cands.has('zorrobio.com'), 'el co-inversor entra como candidato');
  assert.ok(pre.cands.get('zorrobio.com').sources.has('portfolio:alphafund.vc'));
  assert.ok(pre.opened.has('zorrobio.com'), 'y se abre en la misma etapa');
  assert.ok(pre.stats.snowball.added >= 1);
  const off = await prefetchInvestors({ tools, brief: AI_BRIEF, today: TODAY, env: { ENGINE_INVESTOR_SNOWBALL: '0' } });
  assert.equal(off.cands.has('zorrobio.com'), false, 'ENGINE_INVESTOR_SNOWBALL=0 la apaga');
});

test('V15-INV-19 nombres de listas en prosa (títulos), de artículos con viñetas enlazadas y de noticias sin arrastrar la oración siguiente', () => {
  const list = '# Top 5 corporate VCs\n\n## Novo Holdings\n\n*Assets Under Management:* $160 billion\n\n## Lilly Asia Ventures\n\n## Featured Investors\n\n## JacobVogelstein\n\n## Key takeaways\n\n## Johnson & Johnson Innovation\n\n## What this means for founders?';
  assert.deepEqual(namesFromHeadings(list), ['Novo Holdings', 'Lilly Asia Ventures', 'Johnson & Johnson Innovation']);
  const text = 'Major players in biotech financing include firms like:\n\n*   [Andreesen Horowtiz](https://a16z.com/)\n*   [Novo Holdings](https://novoholdings.dk/investments)\n*   [Polaris Partners](https://polarispartners.com/)\n\nOur product is great. See [Moderna](https://www.modernatx.com/) for an example.';
  const links = [...text.matchAll(/\[([^\]]+)\]\((https?:[^)]+)\)/g)].map((m) => ({ text: m[1], url: m[2] }));
  assert.deepEqual(linkedInvestors({ url: 'https://explainer.com/resources/series', text, links }).map((x) => x.key), ['a16z.com', 'novoholdings.dk', 'polarispartners.com']);
  const got = namesFromNews('The round was led by Thrive Capital. The AI market is hot. It closed with participation from Premji. This is new. Existing investors include Demis Hassabis and Jakob Uszkoreit, CEO of Inceptive.');
  assert.deepEqual(got.slice(0, 2), ['Thrive Capital', 'Premji']);   // sin «Thrive Capital. The AI» ni «Premji. This»
  assert.ok(!got.some((n) => /\bCEO\b|\.\s/.test(n)), 'sin cargos ni oraciones arrastradas');
});

test('V15-INV-20 un contacto que es un enlace (sin cita) no hace fallar la auditoría: el fondo se conserva', async () => {
  PAGES['https://linkonly.vc/'] = { title: 'Link Only Ventures', text: 'Link Only Ventures is a venture capital firm. We invest in early-stage AI drug discovery companies around the world. In 2026 we led a seed round for a new AI drug discovery company. [Reach the team](https://linkonly.vc/contact)' };
  PAGES['https://linkonly.vc/contact'] = { title: 'Contact', text: 'Offices in Boston.' };
  const tools = worldTools(); const base = tools.search; const trace = events();
  tools.search = async (a) => { const out = await base(a); const ref = `lo${Math.random()}`; tools.refs.set(ref, { url: 'https://linkonly.vc/', title: 'Link Only Ventures' }); return { results: [...out.results, { ref, url: 'https://linkonly.vc/', title: 'Link Only Ventures', snippet: 'AI drug discovery venture capital' }] }; };
  const out = await runInvestorStage({ tools, brief: AI_BRIEF, today: TODAY, trace, env: {} });
  const f = out.findings.find((x) => x.org.key === 'linkonly.vc');
  assert.ok(f, 'retenido'); assert.equal(f.evidence.contact.kind, 'contact'); assert.ok(f.evidence.contact.url && f.evidence.contact.link);
  assert.equal(trace.rows.some((r) => r.key === 'linkonly.vc' && r.reason === 'quote_audit_failed'), false);
});

test('V15-INV-21 el sujeto es el nombre del fondo («RA Capital founds, funds, and scales companies»); un banco para startups no es inversor', () => {
  const ev = (key, name, text) => orgEvidence({ pages: [{ url: `https://${key}/`, title: name, text, links: [] }], sector: sectorOf(AI_BRIEF), brief: AI_BRIEF, facts: { country: null }, today: TODAY, org: { key, names: [name] } });
  assert.equal(ev('racap.com', 'RA Capital', 'RA Capital founds, funds, and scales companies across healthcare and planetary health to build a healthier future for all.').investor.ok, true);
  assert.equal(ev('amplifypartners.com', 'Amplify Partners', 'Amplify Bio is the first investor for a new generation of technical founders in the life sciences, backing them from the earliest stages.').investor.ok, true);
  assert.equal(ev('rho.co', 'Rho', 'Rho is a fintech company, not a bank. Business banking and corporate cards for startups and scale-ups.').investor.ok, false);
});

test('V15-INV-22 resolver: sin PDF ni subdominios de activos; preqin es base de datos. Un fondo con dos dominios sale una sola vez', async () => {
  const add = []; const addCand = (key, row) => add.push({ key, ...row });
  const tools = { search: async () => ({ results: [{ ref: 'a', url: 'https://assets.novoholdings.dk/novo-holdings-2024-performance-report.pdf', title: 'Novo Holdings performance report', snippet: 'investments' }, { ref: 'b', url: 'https://www.preqin.com/lilly-asia-ventures', title: 'Lilly Asia Ventures profile', snippet: 'venture' }, { ref: 'c', url: 'https://novoholdings.com/', title: 'Novo Holdings | Investments', snippet: 'We invest' }] }) };
  await resolveNames({ tools, names: [{ name: 'Novo Holdings', from: 'https://x.com/l' }, { name: 'Lilly Asia Ventures', from: 'https://x.com/l' }], brief: AI_BRIEF, addCand, source: 'news' });
  assert.deepEqual(add.map((x) => x.key), ['novoholdings.com']);
  assert.deepEqual(namesFromHeadings('## 1. ARCH Venture Partners\n\n## Cure’s Biotech Funding Tracker 2026\n\n## Sequoia Capital'), ['ARCH Venture Partners', 'Sequoia Capital']);
  PAGES['https://dupfund.com/'] = { title: 'Dup Fund', text: 'Dup Fund is a venture capital firm. We invest in early-stage AI drug discovery companies globally. In 2026 we led a seed round. Get in touch with our team.' };
  PAGES['https://dupfund.dk/'] = { title: 'Dup Fund', text: 'Dup Fund is a venture capital firm. We invest in early-stage AI drug discovery companies around the world. In 2026 we led a seed round for a new company. Our team works with founders from the first check to the first clinical data.' };
  const w = worldTools(); const base = w.search;
  w.search = async (a) => { const out = await base(a); const mk = (url) => { const ref = `d${Math.random()}`; w.refs.set(ref, { url, title: 'Dup Fund' }); return { ref, url, title: 'Dup Fund', snippet: 'AI drug discovery venture capital' }; }; return { results: [...out.results, mk('https://dupfund.com/'), mk('https://dupfund.dk/')] }; };
  const out = await runInvestorStage({ tools: w, brief: AI_BRIEF, today: TODAY, env: {} });
  const dup = out.findings.filter((f) => f.org.key.startsWith('dupfund.'));
  assert.equal(dup.length, 1); assert.equal(dup[0].org.also_domains.length, 1); assert.ok(out.funnel.dropped.duplicate_domain >= 1);
});

test('V15-INV-23 firmas de servicios (asesoría, agencia de marketing, base de contactos) no son inversores; una mención suelta en un fondo de verdad no lo descarta', () => {
  const ev = (key, name, pages) => orgEvidence({ pages: pages.map((text, i) => ({ url: `https://${key}/${i ? `p${i}` : ''}`, title: i ? 'Page' : name, text, links: [] })), sector: sectorOf(AI_BRIEF), brief: AI_BRIEF, facts: { country: null }, today: TODAY, org: { key, names: [name] } });
  const flow = ev('flowpartners.io', 'Flow Partners', ['Flow Partners is an investment banking and M&A advisory firm. We advised Elysian Fields on its investment into Orka and supported the deal structuring.', 'Our investor network spans early-stage seed funds and growth-stage investors. We advised founders across many AI deals.']);
  assert.equal(flow.service, true);
  assert.equal(ev('vcagency.com', 'VC Marketing Agency', ['10 Biotech Venture Capital Firms by VC Marketing Agency. A biotech venture capital firm is a specialist investor that funds life-science startups. Our portfolio-company brand building covers identity.']).service, true);
  assert.equal(ev('goodfund.vc', 'Good Fund', ['Good Fund is a venture capital firm. We invest in early-stage AI drug discovery companies around the world. In addition to selective M&A advisory work in the sector, Good Fund conducts research. In 2026 we led a seed round.']).service, false);
});

test('V15-INV-24 dominio ↔ nombre: «Novo Holdings» es novoholdings.com, no novobroadgreenhouse.com; listas con número («10 Biotech Venture Capital Firms») son listas; un perfil de persona no es la tesis', () => {
  assert.equal(nameMatchesDomain('Novo Holdings', 'https://novoholdings.com/'), true);
  assert.equal(nameMatchesDomain('Novo Holdings', 'https://novobroadgreenhouse.com/'), false);
  assert.equal(nameMatchesDomain('Sofinnova Partners', 'https://sofinnova.com/'), true);
  assert.equal(nameMatchesDomain('ARCH Venture Partners', 'https://www.archventure.com/'), true);
  const ev = (text) => orgEvidence({ pages: [{ url: 'https://menlo.vc/', title: 'Menlo', text, links: [] }], sector: sectorOf(AI_BRIEF), brief: AI_BRIEF, facts: { country: null }, today: TODAY, org: { key: 'menlo.vc', names: ['Menlo Ventures'] } });
  assert.equal(ev('The 22 largest drug discovery venture capital firms ranked by team size. Menlo Ventures invests in biotech.').directory, true);
  assert.equal(ev('As a principal at Menlo Ventures, Johnny invests in biotech and life science companies with a focus on novel therapeutics.').thesis.ok, false);
  assert.equal(ev('At Menlo Ventures, he focuses on consumer investing, including AI-native products.').thesis.ok, false);
});

test('V15-INV-25 una frase sobre OTRO fondo en un medio/directorio no cuenta como propia aunque el título de búsqueda lo nombre', () => {
  const ev = (key, titleName, text) => orgEvidence({ pages: [{ url: `https://${key}/guide`, title: titleName, text, links: [] }], sector: sectorOf(AI_BRIEF), brief: AI_BRIEF, facts: { country: null }, today: TODAY, org: { key, names: [titleName] } });
  const a = ev('startupintros.com', 'EQT Life Sciences Funding Guide', 'Looking ahead, EQT Life Sciences is a venture capital firm that invests in early-stage AI drug discovery and biotech companies across Europe.');
  assert.equal(a.investor.ok, false, 'el medio habla de EQT, no de sí mismo');
  const b = ev('angelini-profile.example', 'Angelini Ventures', 'Founded in 2022 with a €300 million evergreen fund commitment, Angelini Ventures invests at Series A and B stages in BioTech companies in Europe.');
  assert.equal(b.investor.ok, false);
  // el sitio propio sí: el nombre coincide con el dominio
  const c = ev('angeliniventures.com', 'Angelini Ventures | Home', 'Founded in 2022 with a €300 million evergreen fund commitment, Angelini Ventures invests at Series A and B stages in BioTech companies in Europe.');
  assert.equal(c.investor.ok, true);
});

test('V15-INV-26 un directorio de varios fondos en primera persona es directorio; las agencias públicas no son inversionistas', () => {
  const text = '5AM Ventures is a leading venture capital firm focused on life science companies. Iaso Ventures builds early-stage neurotech companies. Angelini Ventures invests at Series A and B stages in BioTech. Alpha Capital is a seed fund for medtech startups.';
  const ev = (key, t) => orgEvidence({ pages: [{ url: `https://${key}/participants`, title: 'Participants', text: t, links: [] }], sector: sectorOf(AI_BRIEF), brief: AI_BRIEF, facts: { country: null }, today: TODAY, org: { key, names: ['Participants'] } });
  assert.equal(ev('neurotechpartnering.com', text).directory, true);
  assert.equal(ev('someventures.com', text).directory, false, 'un sitio que suena a fondo puede nombrar a otros (co-inversores)');
  for (const u of ['https://www.nsf.gov/funding', 'https://www.ukri.gov.uk/x', 'https://www.nih.gov/']) assert.equal(isThirdParty(u), true, u);
});
