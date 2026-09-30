/* Segunda lectura con extractor externo (Firecrawl JSON): el extractor extrae con cita, el código decide.
   Casos: periodo de contrato tomado como plazo (Seattle), fecha escrita de un modo que el lector por patrones no ve,
   cita inventada por el extractor, discrepancia entre lecturas, fecha que el código no sabe leer, tope y fallo fatal. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { milestones, deadlineDecision } from '../server/research/dates.mjs';
import { verifyOpportunity } from '../server/research/verify.mjs';
import { extractedFacts, compactExtraction, EXTRACT_SCHEMA } from '../server/research/extract.mjs';
import { firecrawlExtract, resetProviderBreakers } from '../server/research/webscrape.mjs';
import { runObjective } from '../server/research/engine.mjs';

const mentiva = JSON.parse(readFileSync(new URL('../eval/briefs/mentiva.json', import.meta.url), 'utf8'));
const TODAY = '2026-09-30';
const ELIG = 'Open to for-profit startups and small businesses worldwide.';
const page = (body) => ({ url: 'https://funder.example.org/grants/alpha', title: 'Alpha Challenge', text: `Alpha Challenge for digital wellbeing. ${body} How to apply: submit your application through our online portal. ${ELIG}` });
const read = { status: 'open', official: true, eligible: 'yes', non_dilutive: 'yes', kind: 'program', quotes: {} };
const ex = (json, markdown = '') => extractedFacts({ json, markdown }, markdown, { today: TODAY });
const run = (p, extraction) => verifyOpportunity(read, p, { today: TODAY, brief: mentiva, extraction });

/* ── Seattle: el periodo del contrato no es un plazo (también sin extractor) ── */
test('periodo de contrato "from … to …" no es plazo de solicitud', () => {
  const text = 'Youth Mental Health Therapeutic Services Grant open now. $1M in funding is available for the contract period from September 1, 2026 to August 31, 2027. All applicants must complete the online application via Submittable.';
  const dd = deadlineDecision(text, { today: TODAY });
  assert.equal(dd.deadline, null); assert.notEqual(dd.status, 'open');
  assert.ok(milestones(text).every((m) => m.phase === 'event'));
  // una ventana de solicitud real sigue funcionando
  const win = deadlineDecision('Applications open December 1, 2026 to January 15, 2027.', { today: TODAY });
  assert.equal(win.deadline, '2027-01-15');
});

/* ── El lector por patrones no ve la fecha; el extractor la etiqueta y el código la lee en la cita ── */
test('fecha que el lector por patrones no ve: la adopta desde la cita verificada del extractor', () => {
  const p = page('Interested teams need to get their dossier in by 15 January 2027 at noon CET.');
  const before = run(p);
  assert.equal(before.status, 'unknown'); assert.equal(before.deadline, null); assert.notEqual(before.tier, 'main');
  const e = ex({ is_open_call: true, dates: [{ phase: 'application_deadline', quote: 'get their dossier in by 15 January 2027 at noon CET' }], eligibility_quote: ELIG }, p.text);
  assert.equal(e.decision.deadline, '2027-01-15');
  const after = run(p, e);
  assert.equal(after.status, 'open'); assert.equal(after.deadline, '2027-01-15'); assert.equal(after.daysLeft, 107);
  assert.ok(after.flags.includes('dates_from_extractor'));
  assert.ok(after.deadlineQuote.includes('15 January 2027'));
  assert.equal(after.eligible, 'yes'); assert.equal(after.tier, 'main'); assert.equal(after.verdict, 'apply');
});

test('cita inventada por el extractor: se rechaza y no decide nada', () => {
  const p = page('Interested teams need to get their dossier in by 15 January 2027 at noon CET.');
  const e = ex({ is_open_call: true, dates: [{ phase: 'application_deadline', quote: 'Applications close on 1 December 2026' }] }, p.text);
  assert.equal(e.phases.length, 0); assert.equal(e.rejected.length, 1); assert.equal(e.rejected[0].why, 'quote_not_on_page');
  const v = run(p, e);
  assert.equal(v.status, 'unknown'); assert.equal(v.deadline, null); assert.notEqual(v.tier, 'main');
});

test('el extractor no puede elegir fechas de periodo de proyecto, eventos o resultados como plazo', () => {
  const p = page('Info webinar on 10 October 2026. Projects run from 1 March 2027 to 28 February 2028. Winners announced on 20 December 2026.');
  const e = ex({ is_open_call: true, dates: [{ phase: 'event', quote: 'Info webinar on 10 October 2026' }, { phase: 'project_period', quote: 'Projects run from 1 March 2027 to 28 February 2028' }, { phase: 'results_announcement', quote: 'Winners announced on 20 December 2026' }] }, p.text);
  assert.equal(e.decision, null); assert.equal(e.ignored.length, 3);
  const v = run(p, e);
  assert.equal(v.deadline, null); assert.notEqual(v.tier, 'main');
});

/* ── Coinciden / discrepan ── */
test('las dos lecturas coinciden → "extractor_confirmed" y sigue en la lista principal', () => {
  const p = page('Application deadline: 15 January 2027.');
  const e = ex({ is_open_call: true, dates: [{ phase: 'application_deadline', quote: 'Application deadline: 15 January 2027' }] }, p.text);
  const v = run(p, e);
  assert.ok(v.flags.includes('extractor_confirmed')); assert.equal(v.deadline, '2027-01-15'); assert.equal(v.tier, 'main');
  assert.ok(v.checks.find((c) => c.check === 'extractor').ok);
});

test('discrepan en el plazo → estado desconocido y a verificar (nunca la lista principal)', () => {
  const p = page('Application deadline: 15 January 2027. Previous round: applications closed on 3 March 2026.');
  const e = ex({ is_open_call: true, dates: [{ phase: 'application_deadline', quote: 'applications closed on 3 March 2026' }] }, p.text);
  const v = run(p, e);
  assert.ok(v.flags.includes('extractor_conflict')); assert.equal(v.status, 'unknown'); assert.equal(v.deadline, null);
  assert.equal(v.tier, 'verify'); assert.ok(v.blockers.some((b) => /extractor says/i.test(b)));
});

test('el lector halló una fecha y el extractor no la confirma como plazo → a verificar', () => {
  const p = page('Application deadline: 15 January 2027.');
  const v = run(p, ex({ is_open_call: true, dates: [] }, p.text));
  assert.ok(v.flags.includes('extractor_conflict')); assert.equal(v.tier, 'verify'); assert.equal(v.deadline, null);
});

test('el extractor dice que la página declara cerrada → no puede quedar abierta', () => {
  const p = page('Application deadline: 15 January 2027.');
  const v = run(p, ex({ is_open_call: true, page_says_closed: true, dates: [{ phase: 'application_deadline', quote: 'Application deadline: 15 January 2027' }] }, p.text));
  assert.notEqual(v.tier, 'main'); assert.ok(v.flags.includes('extractor_conflict'));
});

test('el extractor no ve una convocatoria abierta → a verificar', () => {
  const p = page('Application deadline: 15 January 2027.');
  const v = run(p, ex({ is_open_call: false, dates: [{ phase: 'application_deadline', quote: 'Application deadline: 15 January 2027' }] }, p.text));
  assert.ok(v.flags.includes('extractor_says_not_a_call')); assert.equal(v.tier, 'verify');
});

/* ── Fecha con cita verificada que el código no sabe leer ── */
test('cita literal con una fecha que el código no sabe leer: no decide, se muestra para revisarla', () => {
  const p = page('Teams must get their dossier in by the fifteenth of January, 2027.');
  const e = ex({ is_open_call: true, dates: [{ phase: 'application_deadline', quote: 'get their dossier in by the fifteenth of January, 2027', date_iso: '2027-01-15' }] }, p.text);
  assert.equal(e.unparsed.length, 1); assert.equal(e.unparsed[0].date_iso, '2027-01-15'); assert.equal(e.decision?.status || 'unknown', 'unknown'); assert.equal(e.decision?.deadline || null, null);
  const v = run(p, e);
  assert.equal(v.status, 'unknown'); assert.equal(v.deadline, null); assert.equal(v.tier, 'verify'); assert.equal(v.keep, true);
  assert.ok(v.flags.includes('date_unparsed_quote')); assert.ok(v.blockers.some((b) => b.includes('fifteenth of January')));
  // date_iso sin el año en la cita no se anota
  const e2 = ex({ is_open_call: true, dates: [{ phase: 'application_deadline', quote: 'get their dossier in by the fifteenth of January', date_iso: '2027-01-15' }] }, 'Teams must get their dossier in by the fifteenth of January. More text here.');
  assert.equal(e2.unparsed[0].date_iso, '');
});

test('una cita vieja en la página tampoco sube: LOI vencida sigue mandando aunque el extractor la etiquete', () => {
  const p = page('Letter of Intent: September 14, 2026; Invited Full Proposal: TBD.');
  const e = ex({ is_open_call: true, dates: [{ phase: 'loi_or_preproposal_deadline', quote: 'Letter of Intent: September 14, 2026' }, { phase: 'invited_full_proposal', quote: 'Invited Full Proposal: TBD' }] }, p.text);
  assert.equal(e.decision.status, 'closed');
  const v = run(p, e);
  assert.equal(v.drop, 'closed'); assert.ok(v.flags.includes('extractor_confirmed'));
});

test('elegibilidad: una cita literal del extractor aclara lo que el texto dejaba dudoso, y un "no" gana', () => {
  const body = 'Application deadline: 15 January 2027. Who can apply: registered nonprofit organizations and universities only.';
  const p = { url: 'https://funder.example.org/grants/beta', title: 'Beta', text: `Beta Challenge. ${body} How to apply: submit your application through our online portal.` };
  const e = ex({ is_open_call: true, dates: [{ phase: 'application_deadline', quote: 'Application deadline: 15 January 2027' }], eligibility_quote: 'registered nonprofit organizations and universities only' }, p.text);
  const v = verifyOpportunity({ ...read, eligible: 'yes' }, p, { today: TODAY, brief: mentiva, extraction: e });
  assert.equal(v.eligible, 'no'); assert.equal(v.drop, 'not_eligible');
});

/* ── Esquema, compacto y llamada a Firecrawl ── */
test('el esquema pide citas literales y no deja al modelo clasificar el estado', () => {
  assert.ok(EXTRACT_SCHEMA.properties.dates.items.required.includes('quote'));
  assert.ok(!('status' in EXTRACT_SCHEMA.properties));
  const c = compactExtraction(ex({ is_open_call: true, dates: [] }, ''), { credits: 5 });
  assert.equal(c.credits, 5); assert.equal(c.ok, true);
});

test('firecrawlExtract: pide markdown + json con esquema, lee data.json y nunca lanza', async () => {
  resetProviderBreakers();
  const calls = [];
  const fetcher = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ success: true, creditsUsed: 5, data: { markdown: '# Alpha\nDeadline 15 January 2027', json: { is_open_call: true, dates: [] } } }), { status: 200 }); };
  const r = await firecrawlExtract('https://funder.example.org/a', { env: { FIRECRAWL_API_KEY: 'k' }, fetcher });
  assert.equal(r.credits, 5); assert.ok(r.markdown.includes('Deadline')); assert.equal(r.json.is_open_call, true);
  assert.ok(calls[0].url.endsWith('/v2/scrape')); assert.equal(calls[0].body.formats[0], 'markdown'); assert.equal(calls[0].body.formats[1].type, 'json');
  assert.equal(calls[0].body.onlyMainContent, false);
  assert.equal(await firecrawlExtract('https://www.linkedin.com/x', { env: { FIRECRAWL_API_KEY: 'k' }, fetcher }), null);
  assert.equal(await firecrawlExtract('https://funder.example.org/a', { env: {}, fetcher }), null);
  const bad = async () => new Response('{"error":"boom"}', { status: 400 });
  const failed = await firecrawlExtract('https://funder.example.org/b', { env: { FIRECRAWL_API_KEY: 'k' }, fetcher: bad });
  assert.ok(/400.*boom/.test(failed.error)); assert.ok(!failed.fatal);
  const noJson = async () => new Response(JSON.stringify({ success: true, data: { markdown: 'x'.repeat(200) } }), { status: 200 });
  assert.ok(/without JSON/.test((await firecrawlExtract('https://funder.example.org/d', { env: { FIRECRAWL_API_KEY: 'k' }, fetcher: noJson })).error));
  const noCredits = async () => new Response('{"error":"Insufficient credits"}', { status: 402 });
  const fatal = await firecrawlExtract('https://funder.example.org/c', { env: { FIRECRAWL_API_KEY: 'k' }, fetcher: noCredits });
  assert.equal(fatal.fatal, true); resetProviderBreakers();
});

/* ── Motor: solo candidatas, con tope, y un fallo fatal lo apaga ── */
const mkPages = (n) => Array.from({ length: n }, (_, i) => ({ url: `https://f${i}.example.org/call`, title: `Call ${i}`, markdown: `Call ${i} for mental health startups. Teams need to get their dossier in by 15 January 2027 at noon. Open to for-profit startups worldwide. Grant, no equity. How to apply: submit your application through our online portal.`, providers: ['exa'] }));
const chat = async ({ name }) => name === 'plan' ? { json: { queries: [] } } : { json: { relevant: true, kind: 'program', name: 'Call', official: true, status: 'open', deadline: null, eligible: 'yes', non_dilutive: 'yes', money: 'grant', page_type: 'call', quotes: { identity: 'for mental health startups' } } };

test('motor: el extractor recupera la fecha, respeta el tope y deja traza y contadores', async () => {
  const seen = [];
  const extractor = async (url) => { seen.push(url); return { json: { is_open_call: true, dates: [{ phase: 'application_deadline', quote: 'get their dossier in by 15 January 2027 at noon' }] }, markdown: '', credits: 5, ms: 10 }; };
  const r = await runObjective('grant', mentiva, { chat, search: async () => mkPages(4), today: TODAY, rounds: 1, extractor, env: { ENGINE_EXTRACT_MAX: '3' } });
  assert.equal(r.audit.extracted, 3); assert.equal(seen.length, 3); assert.equal(r.audit.extractCredits, 15);
  const withDate = r.findings.filter((f) => f.deadline === '2027-01-15');
  assert.equal(withDate.length, 3);
  assert.ok(withDate.every((f) => f.flags.includes('dates_from_extractor') && f.trace.extraction.deadline === '2027-01-15' && f.trace.extraction.credits === 5));
  assert.equal(r.findings.filter((f) => !f.deadline).length, 1);
  assert.equal(r.audit.extractChanged, 3);
});

test('motor: un fallo fatal del extractor (sin créditos) lo apaga para el resto y se registra', async () => {
  let n = 0;
  const extractor = async () => { n++; return { fatal: true, error: 'Firecrawl HTTP 402 (out of credits)' }; };
  const r = await runObjective('grant', mentiva, { chat, search: async () => mkPages(4), today: TODAY, rounds: 1, extractor, concurrency: 1 });
  assert.equal(n, 1); assert.ok(r.audit.errors.some((e) => /Extractor: .*402/.test(e)));
  assert.equal(r.findings.length, 4);
});

test('motor: sin extractor (o con ENGINE_EXTRACT=off) todo funciona como antes', async () => {
  const r = await runObjective('grant', mentiva, { chat, search: async () => mkPages(2), today: TODAY, rounds: 1 });
  assert.equal(r.audit.extracted, 0); assert.ok(r.findings.every((f) => !f.trace.extraction));
});

test('motor: un fallo no fatal del extractor se registra con su motivo y no gasta el tope de lecturas logradas', async () => {
  let n = 0;
  const extractor = async () => { n++; return n <= 2 ? { error: 'Firecrawl: timed out' } : { json: { is_open_call: true, dates: [{ phase: 'application_deadline', quote: 'get their dossier in by 15 January 2027 at noon' }] }, markdown: '', credits: 5 }; };
  const r = await runObjective('grant', mentiva, { chat, search: async () => mkPages(6), today: TODAY, rounds: 1, extractor, concurrency: 1, env: { ENGINE_EXTRACT_MAX: '3' } });
  assert.equal(r.audit.extractFailed, 2); assert.equal(r.audit.extracted, 3);
  assert.equal(r.audit.errors.filter((e) => /Extractor: Firecrawl: timed out/.test(e)).length, 2);
  assert.ok(r.findings.some((f) => f.trace.extraction?.ok === false && /timed out/.test(f.trace.extraction.error)));
});

test('trazas: cientos de páginas omitidas sin leer no dejan fuera a las leídas y descartadas', async () => {
  const closed = mkPages(200).map((p) => ({ ...p, markdown: p.markdown.replace('Teams need to get their dossier in by 15 January 2027 at noon.', 'Application deadline: 15 January 2026.') }));
  const r = await runObjective('grant', mentiva, { chat, search: async () => closed, today: TODAY, rounds: 1, env: { ENGINE_MAX_PAGES: '5', ENGINE_TRACE_MAX: '50' } });
  const read = r.audit.traces.filter((t) => t.read);
  const skipped = r.audit.traces.filter((t) => t.read === null && t.verdict === 'skip');
  assert.equal(read.length, 5); assert.ok(read.every((t) => t.drop === 'closed'));
  assert.equal(skipped.length, 80); assert.equal(r.audit.skipped.over_page_budget, 195);
});
