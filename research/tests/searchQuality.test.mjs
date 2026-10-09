/* Casos reportados el 30/09/2026 (búsqueda de grants) y reglas de vigencia, tipo de página y elegibilidad.
   Páginas reales en tests/fixtures/search-quality-cases.json; las lecturas del modelo reproducen lo que hizo el
   modelo en el run e02c75fb (citas sin relación, fecha que no está en la cita, "eligible: yes"). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDates, datesIn, deadlineDecision, milestones } from '../server/research/dates.mjs';
import { classifyPage } from '../server/research/pageType.mjs';
import { applicantProfile, checkApplicant } from '../server/research/applicant.mjs';
import { verifyOpportunity, literalIn } from '../server/research/verify.mjs';
import { verifyFinding, runObjective, engineLeads, yearFix, planQueries } from '../server/research/engine.mjs';
import { evaluate, candidate, evidence } from '../server/research/core.mjs';
import { searchRowsToLeads } from '../server/research/orchestrator.mjs';
import { buildExplanation, checkSummary } from '../server/research/explain.mjs';
import { buildRunAudit } from '../server/research/runAudit.mjs';

const fx = JSON.parse(readFileSync(new URL('./fixtures/search-quality-cases.json', import.meta.url), 'utf8'));
const mentiva = JSON.parse(readFileSync(new URL('../eval/briefs/mentiva.json', import.meta.url), 'utf8'));
const page = (id) => fx.pages.find((p) => p.id === id);
const TODAY = '2026-09-30';
const LOI_BLOCK = 'UPCOMING DEADLINES Letter of Intent: September 14, 2026; Invited Full Proposal: TBD. ELIGIBILITY Existing companies and new startups are both eligible.';

/* ── Caso 2 · informe de impacto de Biohub ── */
test('Biohub: un informe de impacto (blog) no es una convocatoria aunque el modelo diga "program"', () => {
  const p = page('biohub');
  assert.equal(classifyPage({ url: p.url, title: p.title, text: p.text }).type, 'report');
  const v = verifyFinding(fx.modelReads.biohub, p, 'grant', { today: TODAY, brief: mentiva });
  assert.equal(v.keep, false);
  assert.equal(v.drop, 'not_a_call:report');
  assert.equal(v.verdict, 'skip');
  assert.ok(v.flags.includes('fake_quote:deadline'), 'la cita de plazo del modelo no está en la página');
  assert.equal(v.eligible, 'unclear', 'una frase cualquiera no prueba elegibilidad');
  assert.ok(v.flags.includes('model_eligibility_overruled'));
});

/* ── Caso 3 · taller para estudiantes de UW-Madison ── */
test('UW-Madison I-Corps: evento/cohorte para estudiantes y faculty → cerrado, no es convocatoria y no elegible', () => {
  const p = page('uw');
  const v = verifyFinding(fx.modelReads.uw, p, 'grant', { today: TODAY, brief: mentiva });
  assert.equal(v.keep, false);
  assert.deepEqual(v.reasons, ['closed', 'not_a_call:event', 'not_eligible', 'scope_mismatch']);
  assert.equal(v.deadline, '2026-09-09');
  assert.ok(literalIn(v.deadlineQuote, p.text) && v.deadlineQuote.includes('September 9th, 2026'));
  assert.ok(v.flags.includes('deadline_conflict'), 'el modelo propuso la sesión final (12/11) como plazo');
  assert.equal(v.eligibility.decision, 'no');
  assert.match(v.eligibility.quote, /graduate student/);
  // Aunque fuera antes del plazo, sigue siendo un evento para estudiantes: nunca entra.
  const early = verifyFinding(fx.modelReads.uw, p, 'grant', { today: '2026-09-01', brief: mentiva });
  assert.equal(early.keep, false); assert.equal(early.drop, 'not_a_call:event'); assert.ok(early.reasons.includes('not_eligible'));
});

/* ── Caso 4 · LOI vencida, propuesta completa por invitación ── */
test('bloque "LOI Sept 14 2026 / Full proposal TBD" con hoy=2026-09-30 → cerrada para nosotros', () => {
  const d = deadlineDecision(LOI_BLOCK, { today: TODAY });
  assert.equal(d.status, 'closed');
  assert.equal(d.deadline, '2026-09-14');
  assert.equal(d.phase, 'loi');
  assert.ok(d.flags.includes('entry_phase_closed') && d.flags.includes('next_phase_by_invitation'));
  const ms = milestones(LOI_BLOCK);
  assert.equal(ms.find((m) => m.iso === '2026-09-14').phase, 'loi');
  assert.equal(ms.find((m) => m.tbd).phase, 'invited');
  // El modelo dice "open" y cita la línea TBD: el código decide cerrada.
  const v = verifyOpportunity({ status: 'open', deadline: null, official: true, eligible: 'yes', non_dilutive: 'yes', quotes: { status: 'Invited Full Proposal: TBD' } }, { url: 'https://funder.example.org/rfp', text: LOI_BLOCK }, { today: TODAY, brief: mentiva });
  assert.equal(v.status, 'closed'); assert.equal(v.drop, 'closed'); assert.equal(v.verdict, 'skip');
  // Antes del 14/09 la fase de entrada (LOI) es la fecha accionable.
  const before = deadlineDecision(LOI_BLOCK, { today: '2026-09-10' });
  assert.equal(before.status, 'open'); assert.equal(before.deadline, '2026-09-14');
  // Con LOI opcional manda el plazo de la propuesta.
  const optional = deadlineDecision('Letter of Intent (optional): September 14, 2026. Full proposal deadline: November 30, 2026.', { today: TODAY });
  assert.equal(optional.status, 'open'); assert.equal(optional.deadline, '2026-11-30');
});

test('página real de ADDF (guardada por la app): LOI 14/09/2026 vencida → cerrada; además pide retorno de la inversión', () => {
  const p = page('addf');
  const v = verifyFinding(fx.modelReads.addf, p, 'grant', { today: TODAY, brief: mentiva });
  assert.equal(v.drop, 'closed');
  assert.equal(v.deadline, '2026-09-14');
  assert.equal(v.deadlineQuote, 'Letter of Intent September 14, 2026');
  assert.ok(v.flags.includes('entry_phase_closed') && v.flags.includes('may_require_return'));
});

/* ── Parser de fechas ── */
test('fechas: formatos numéricos, idiomas, rangos, mes/año, trimestres y sin año', () => {
  const d = datesIn('15/10/2026 · 10/15/2026 · 2026-11-03 · 18-Sep-2026 · 14 de septiembre de 2026 · 5 mai 2027 · 14. Oktober 2026 · 3 de março de 2027 · 1 settembre 2026 · 20 décembre 2026');
  for (const x of ['2026-10-15', '2026-11-03', '2026-09-18', '2026-09-14', '2027-05-05', '2026-10-14', '2027-03-03', '2026-09-01', '2026-12-20']) assert.ok(d.includes(x), x);
  const amb = parseDates('Deadline: 03/11/2026').find((x) => x.iso);
  assert.equal(amb.ambiguous, true); assert.deepEqual([amb.iso, amb.alt].sort(), ['2026-03-11', '2026-11-03']);
  const range = parseDates('Virtual | Oct 01-Nov 12, 2026').find((x) => x.range);
  assert.deepEqual(range.range, { start: '2026-10-01', end: '2026-11-12' });
  assert.deepEqual(parseDates('Submissions accepted 1–15 March 2027').find((x) => x.range).range, { start: '2027-03-01', end: '2027-03-15' });
  const cross = deadlineDecision('Submissions will be accepted from December 1, 2026 to January 15, 2027.', { today: TODAY });
  assert.equal(cross.status, 'upcoming'); assert.equal(cross.deadline, '2027-01-15'); assert.equal(cross.opens, '2026-12-01');
  assert.equal(parseDates('Results expected in Q4 2026').find((x) => x.precision === 'quarter').iso, '2026-12-31');
  assert.equal(parseDates('Call closes in October 2026').find((x) => x.precision === 'month').iso, '2026-10-31');
  const noYear = parseDates('Apply by September 14');
  assert.ok(noYear.every((x) => !x.iso) && noYear.some((x) => x.yearless));
  assert.ok(!datesIn('Apply by September 14').length, 'una fecha sin año nunca verifica un plazo');
  assert.ok(deadlineDecision('Deadline: September 14. Apply online.', { today: TODAY }).flags.includes('deadline_without_year'));
});

test('varias fechas: próximo corte; eventos y publicación no son plazo', () => {
  const cut = deadlineDecision('Cut-off dates: 7 January 2026, 4 March 2026 and 4 November 2026. Apply via the portal.', { today: TODAY });
  assert.equal(cut.deadline, '2026-11-04'); assert.equal(cut.status, 'open');
  const ev = deadlineDecision('Posted September 1, 2026. Info session: October 20, 2026. Applications close 15 August 2026.', { today: TODAY });
  assert.equal(ev.status, 'closed'); assert.equal(ev.deadline, '2026-08-15');
  assert.equal(milestones('Info session: October 20, 2026').find((m) => m.iso).phase, 'event');
});

test('rolling: con señal de vigencia queda abierta sin fecha (a verificar); sin señal no es vigente', () => {
  const on = verifyOpportunity({ status: 'open', official: true, eligible: 'yes', non_dilutive: 'yes', quotes: {} }, { url: 'https://acc.example.org/apply', text: 'Applications are now open. We review applications on a rolling basis. Open to startups anywhere in the world.' }, { today: TODAY, brief: mentiva });
  assert.equal(on.status, 'open'); assert.ok(on.flags.includes('rolling')); assert.equal(on.deadline, null);
  assert.equal(on.tier, 'verify'); assert.equal(on.verdict, 'watch', 'sin fecha nunca va a la lista principal');
  const off = deadlineDecision('Applications accepted on a rolling basis. Last updated March 3, 2024.', { today: TODAY });
  assert.notEqual(off.status, 'rolling'); assert.ok(off.flags.includes('rolling_without_current_signal') || off.status === 'closed');
  const offWithout = deadlineDecision('We accept applications on a rolling basis.', { today: TODAY });
  assert.equal(offWithout.status, 'unknown'); assert.ok(offWithout.flags.includes('rolling_without_current_signal'));
});

test('fecha inventada por el modelo que no está en la página → no se usa ni permite apply', () => {
  const p = { url: 'https://prize.example.org/call', text: 'Mental health prize for startups. Apply online. Open to startups anywhere in the world.' };
  const v = verifyOpportunity({ status: 'open', deadline: '2026-12-15', official: true, eligible: 'yes', non_dilutive: 'yes', quotes: { deadline: 'Applications close 15 December 2026' } }, p, { today: TODAY, brief: mentiva });
  assert.equal(v.deadline, null);
  assert.ok(v.flags.includes('model_date_not_in_page') && v.flags.includes('fake_quote:deadline'));
  assert.notEqual(v.verdict, 'apply'); assert.notEqual(v.tier, 'main');
});

test('edición anterior: fechas y título de años pasados → cerrada (obsoleta)', () => {
  const old = deadlineDecision('2025 Innovation Challenge. Apply by June 1, 2025. Winners announced August 2025.', { today: TODAY, title: '2025 Innovation Challenge' });
  assert.equal(old.status, 'closed'); assert.ok(old.flags.includes('previous_edition'));
  const titleOnly = deadlineDecision('The challenge invites startups to apply online. Eligibility: startups.', { today: TODAY, title: '2024 Digital Health Prize', url: 'https://x.org/2024-prize' });
  assert.equal(titleOnly.status, 'closed'); assert.ok(titleOnly.flags.includes('previous_edition'));
});

/* ── Tipo de página ── */
test('tipo de página: blog, noticia, cohorte, evento y directorio no son convocatoria; la convocatoria sí', () => {
  assert.equal(classifyPage({ url: 'https://x.org/blog/tips', text: 'Ten tips for founders. Apply now to our newsletter.' }).isCall, false);
  assert.equal(classifyPage({ url: 'https://x.org/p', text: 'Acme today announced the 2026 cohort. Meet the 2026 cohort of founders.' }).type, 'cohort');
  assert.equal(classifyPage({ url: 'https://x.org/events/demo-day', text: 'Join us. Apply by May 1, 2026.' }).type, 'event');
  assert.equal(classifyPage({ url: 'https://x.org/news/x', text: 'Press release. Acme today announced a new fund.' }).type, 'news');
  assert.equal(classifyPage({ url: 'https://x.org/resources', text: 'Top 50 grants for startups in 2026.' }).type, 'directory');
  const call = classifyPage({ url: 'https://x.org/prize', text: 'The Prize awards $50,000. How to apply: submit your application by 1 December 2026.' });
  assert.equal(call.type, 'call'); assert.match(call.applyQuote, /How to apply/);
  assert.equal(classifyPage({ url: 'https://x.org/about', text: 'We are a foundation that believes in health for all.' }).type, 'program_page');
});

/* ── Elegibilidad ── */
test('elegibilidad: el código la decide contra el brief (startup con fines de lucro) y con cita', () => {
  const prof = applicantProfile(mentiva);
  assert.equal(prof.entity, 'for_profit_startup'); assert.deepEqual(prof.outside.sort(), ['EU', 'US']);
  assert.equal(checkApplicant('Eligibility: open to registered nonprofits and charities only.', prof).decision, 'no');
  assert.equal(checkApplicant('Who can apply: universities and research institutes.', prof).decision, 'no');
  assert.equal(checkApplicant('Eligibility: for-profit companies are not eligible.', prof).decision, 'no');
  assert.equal(checkApplicant('Teams must be student-led.', prof).decision, 'no');
  const yes = checkApplicant('Eligibility: early-stage startups and SMEs from any country are eligible.', prof);
  assert.equal(yes.decision, 'yes'); assert.match(yes.quote, /startups/);
  assert.equal(checkApplicant('Applicants must be incorporated in the United States.', prof).decision, 'no', 'Mentiva está fuera de EE. UU.');
  const global = applicantProfile({ geography: 'GLOBAL' });
  const us = checkApplicant('Eligibility: small businesses incorporated in the United States.', global);
  assert.equal(us.decision, 'unclear'); assert.ok(us.flags.includes('country_restricted:US'));
  assert.equal(checkApplicant('We fund amazing ideas.', prof).decision, 'unclear');
});

test('sin elegibilidad confirmada nunca es "apply", aunque la fecha esté verificada', () => {
  const p = { url: 'https://prize.example.org/call', text: 'Health prize. The application deadline is 15 November 2026. Eligibility: small businesses incorporated in the United States.' };
  const v = verifyOpportunity({ status: 'open', deadline: '2026-11-15', official: true, eligible: 'yes', non_dilutive: 'yes', quotes: { deadline: 'The application deadline is 15 November 2026' } }, p, { today: TODAY, brief: { geography: 'GLOBAL' } });
  assert.equal(v.deadline, '2026-11-15'); assert.equal(v.eligible, 'unclear'); assert.equal(v.tier, 'verify'); assert.equal(v.verdict, 'watch');
});

/* ── Motor completo, traza y lista principal ── */
const casesChat = async ({ name, user }) => {
  if (name === 'plan') return { json: { queries: [{ query: '2024 Chan Zuckerberg Initiative Neurodegeneration Challenge Network', family: 'foundations' }, { query: 'NSF I-Corps 2026 cohort', family: 'us federal' }, { query: 'Alzheimer drug discovery RFP', family: 'foundations' }] } };
  const id = fx.pages.find((p) => user.includes(`PAGE URL: ${p.url}`))?.id;
  return { json: fx.modelReads[id] || {}, model: 'sim' };
};

test('motor: los tres casos reales se descartan con motivo y recorrido; el año viejo de la consulta se corrige', async () => {
  const seen = [];
  const search = async (q) => { seen.push(q); return fx.pages.map((p) => ({ url: p.url, title: p.title, markdown: p.text, providers: ['exa'] })); };
  const r = await runObjective('grant', mentiva, { chat: casesChat, search, today: TODAY, rounds: 1 });
  assert.equal(r.findings.length, 0);
  assert.equal(r.audit.dropped['not_a_call:report'], 1); assert.equal(r.audit.dropped.closed, 2);
  assert.ok(seen.includes('2026 Chan Zuckerberg Initiative Neurodegeneration Challenge Network'), JSON.stringify(seen));
  assert.equal(r.audit.yearFixed, 1);
  assert.equal(r.audit.interpretation.applicant.entity, 'for_profit_startup'); assert.equal(r.audit.interpretation.today, TODAY);
  const t = r.audit.traces.find((x) => x.url === page('uw').url);
  assert.equal(t.drop, 'closed'); assert.ok(t.read.out && t.verify.checks.length >= 5); assert.equal(t.today, TODAY);
  assert.ok(t.queries.length >= 1 && t.providers.includes('exa'));
});

test('conflicto de fechas entre fuentes: mismo programa con plazos distintos → a verificar', async () => {
  const mk = (n, d) => ({ url: `https://src${n}.example.org/prize`, title: 'Mind Prize', markdown: `Mind Prize for mental health startups. The application deadline is ${d}. Open to startups anywhere in the world. Grant, no equity.` });
  const pages = [mk(1, '15 November 2026'), mk(2, '30 November 2026')];
  const chat = async ({ name, user }) => {
    if (name === 'plan') return { json: { queries: [] } };
    const d = /deadline is ([^.]+)\./.exec(user)[1];
    return { json: { relevant: true, kind: 'program', name: 'Mind Prize', official: true, status: 'open', deadline: null, eligible: 'yes', non_dilutive: 'yes', money: 'prize', quotes: { identity: 'Mind Prize for mental health startups.', deadline: `The application deadline is ${d}` } } };
  };
  const r = await runObjective('grant', mentiva, { chat, search: async () => pages, today: TODAY, rounds: 1 });
  assert.equal(r.findings.length, 2);
  for (const f of r.findings) { assert.ok(f.flags.includes('date_conflict_between_sources')); assert.equal(f.verdict, 'watch'); }
});

test('segunda lectura: una página recortada por el buscador (sin fechas) se descarga completa y se re-verifica', async () => {
  const short = { url: 'https://prize.example.org/call', title: 'Mind Prize', markdown: 'Mind Prize for mental health startups. The prize supports early-stage founders building digital wellbeing tools across the world. '.repeat(4) + 'More details below about the programme and its partners.' }; // recortada por el buscador (> 400 caracteres)
  const full = `${short.markdown} How to apply: submit your application online. The application deadline is 15 November 2026. Eligibility: open to startups anywhere in the world.`;
  const chat = async ({ name }) => (name === 'plan' ? { json: { queries: [] } } : { json: { relevant: true, kind: 'program', name: 'Mind Prize', official: true, status: 'open', deadline: null, eligible: 'yes', non_dilutive: 'yes', money: 'prize', quotes: { identity: 'Mind Prize for mental health startups.' } } });
  const r = await runObjective('grant', mentiva, { chat, search: async () => [short], today: TODAY, rounds: 1, reread: true, pageFetcher: async () => ({ url: short.url, title: 'Mind Prize', text: full }), reader: async () => null });
  assert.equal(r.audit.reread, 1); assert.equal(r.audit.rereadImproved, 1);
  assert.equal(r.findings[0].deadline, '2026-11-15'); assert.equal(r.findings[0].verdict, 'apply');
  assert.match(r.findings[0].trace.fetchedVia, /reread/);
});

test('lista principal: una convocatoria del motor "a verificar" va a radar; la verificada, a prioridad', () => {
  const ok = { objective: 'grant', url: 'https://prize.example.org/call', title: 'Prize', query: 'q', family: 'f', providers: ['exa'], name: 'Prize', status: 'open', deadline: '2026-11-15', deadlineQuote: 'The application deadline is 15 November 2026', daysLeft: 46, eligible: 'yes', verdict: 'apply', tier: 'main', flags: [], quotes: { identity: 'Mental health prize.', deadline: 'The application deadline is 15 November 2026', eligible: 'Open to startups anywhere' }, blockers: [], reasons: [], today: TODAY };
  const verify = { ...ok, url: 'https://other.example.org/call', name: 'Other', deadline: null, deadlineQuote: '', verdict: 'watch', tier: 'verify', status: 'unknown', blockers: ['Deadline not verified on the page'] };
  const ranked = evaluate(engineLeads([ok, verify]), { ...mentiva, exclusions: '', minDays: 30, mode: 'strategic' }, new Set(), new Date(`${TODAY}T12:00:00Z`), [{ term: 'mental health' }]);
  assert.equal(ranked.find((l) => l.title === 'Prize').bucket, 'top');
  const o = ranked.find((l) => l.title === 'Other');
  assert.equal(o.bucket, 'radar'); assert.match(o.gate.reason, /Deadline not verified/);
});

test('contacto sacado de una convocatoria cerrada (Hunter) no queda en prioridad', () => {
  const opp = candidate({ externalId: 'addf', org: 'ADDF', title: 'Drug Development RFP', kind: 'radar', fundingType: 'grant', status: 'closed', deadline: '2026-09-14', evidence: [evidence('ADDF', page('addf').url, 'Letter of Intent September 14, 2026', 'opportunity')] });
  const person = candidate({ person: 'Jane Roe', role: 'Chief Science Officer', org: 'ADDF', title: 'Chief Science Officer at ADDF', kind: 'person', fundingType: 'investment', contact: { type: 'email', value: 'jroe@alzdiscovery.org' }, evidence: [evidence('ADDF', page('addf').url, 'The Drug Development RFP supports IND-enabling studies', 'opportunity')], parentKey: 'opportunity:addf' });
  const ranked = evaluate([opp, person], { ...mentiva, fundingTypes: ['grant', 'investment'], exclusions: '', minDays: 30, mode: 'strategic' }, new Set(), new Date(`${TODAY}T12:00:00Z`), [{ term: 'drug development' }]);
  const p = ranked.find((l) => l.person === 'Jane Roe');
  assert.notEqual(p.bucket, 'top'); assert.ok(p.missing.some((m) => /Linked opportunity/.test(m)));
});

test('búsqueda sin modelo (APIs directas): el informe de Biohub se descarta; nada queda "open" por defecto', () => {
  const rows = [{ url: page('biohub').url, title: page('biohub').title, description: 'NDCN impact report', markdown: page('biohub').text, providers: ['exa'] }, { url: 'https://snip.example.org/grant', title: 'Grant', description: 'Apply for our grant program', markdown: '', providers: ['serper'] }];
  const leads = searchRowsToLeads(rows, mentiva, { objective: 'grant', query: 'alzheimer grant' });
  const bio = leads.find((l) => l.contact.value === page('biohub').url);
  assert.equal(bio.codeCheck.tier, 'drop'); assert.ok(bio.trace && bio.trace.verify.pageType.type === 'report');
  const snip = leads.find((l) => l.contact.value.includes('snip'));
  assert.equal(snip.status, 'unknown'); assert.equal(snip.codeCheck.tier, 'verify');
  const ranked = evaluate(leads, { ...mentiva, exclusions: '', minDays: 30, mode: 'strategic' }, new Set(), new Date(`${TODAY}T12:00:00Z`), []);
  assert.equal(ranked.filter((l) => l.bucket === 'top').length, 0);
  const b = ranked.find((l) => l.contact.value === page('biohub').url);
  assert.equal(b.bucket, 'discarded'); assert.equal(b.gate.tier, 'drop'); assert.match(b.gate.reason, /Not a call/);
});

/* ── Consultas con año, explicación y auditoría ── */
test('año en consultas: años pasados → año en curso; el prompt del plan pide el año', async () => {
  assert.equal(yearFix('2024 CZI NDCN grant', TODAY).query, '2026 CZI NDCN grant');
  assert.equal(yearFix('EIC Accelerator 2027 cut-off', TODAY).query, 'EIC Accelerator 2027 cut-off');
  assert.equal(yearFix('EIC Accelerator', TODAY, true, true).query, 'EIC Accelerator 2026');
  assert.equal(yearFix('seed fund 2024', TODAY, false).query, 'seed fund 2024', 'objetivos sin fecha no se tocan');
  let prompt = '';
  await planQueries('grant', mentiva, { chat: async ({ user }) => { prompt = user; return { json: { queries: [] } }; }, today: TODAY });
  assert.match(prompt, /include the year 2026/);
});

test('explicación: el resumen de la IA se descarta si inventa fecha, cifra, "abierta" o elegibilidad', () => {
  const p = { url: 'https://prize.example.org/call', text: 'Mind Prize by Acme Foundation (Europe) awards $50,000 to mental health startups. The application deadline is 15 November 2026. Open to startups anywhere in the world.' };
  const v = verifyOpportunity({ status: 'open', deadline: '2026-11-15', official: true, eligible: 'yes', non_dilutive: 'yes', quotes: { deadline: 'The application deadline is 15 November 2026', eligible: 'Open to startups anywhere in the world' } }, p, { today: TODAY, brief: mentiva });
  assert.equal(v.verdict, 'apply');
  assert.equal(checkSummary('Acme Foundation (Europa) ofrece $50,000 a startups de salud mental; cierra el 15 November 2026.', p, v).ok, true);
  assert.equal(checkSummary('Ofrece $80,000; cierra el 15 November 2026.', p, v).ok, false);
  assert.equal(checkSummary('Cierra el 30 November 2026.', p, v).ok, false);
  const e = buildExplanation(v, { summary: 'Acme Foundation ofrece $50,000 a startups; cierra el 15 November 2026.', name: 'Mind Prize', url: p.url, page: p });
  assert.ok(e.ai); assert.match(e.facts, /Cierra el 2026-11-15/); assert.match(e.facts, /Elegible porque/);
  const closed = { ...v, status: 'closed', verdict: 'skip', eligible: 'unclear', deadline: null, dates: { reason: 'Deadline passed' } };
  const e2 = buildExplanation(closed, { summary: 'La convocatoria está abierta y somos elegibles.', name: 'X', url: p.url, page: p });
  assert.equal(e2.ai, null); assert.ok(e2.aiRejected); assert.ok(e2.unverified.includes('fecha de cierre'));
});

test('auditoría de la corrida: contadores por motivo y recorrido de los descartados', async () => {
  const search = async () => fx.pages.map((p) => ({ url: p.url, title: p.title, markdown: p.text, providers: ['exa'] }));
  const r = await runObjective('grant', mentiva, { chat: casesChat, search, today: TODAY, rounds: 1 });
  const a = buildRunAudit({ engineRuns: [r.audit], leads: [], brief: mentiva, today: TODAY });
  assert.equal(a.counters.pagesRead, 3); assert.equal(a.counters.droppedByEngine.closed, 2);
  assert.equal(a.discarded.length, 3); assert.equal(a.interpretations[0].objective, 'grant');
  assert.ok(a.queries.some((q) => q.original === '2024 Chan Zuckerberg Initiative Neurodegeneration Challenge Network'));
});
