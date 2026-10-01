// Rutas HTTP de la capa de análisis. Todas son locales (el servidor solo acepta localhost) y ninguna envía mensajes.
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chatJSON, fleetConfig } from './fleet.mjs';
import { loadVehicles } from './momentum.mjs';
import { rankRevealed } from './revealed.mjs';
import { armsFromEvents, chooseArm, importOutreachRows, networkAggregate, summarizeOutreach, validateOutreach, CHANNELS, ARGUMENTS, OUTCOMES, OUTCOME_LABEL } from './outreach.mjs';
import { deadlineAlerts, evaluateOpportunity, IGC_PROFILE, opportunityFromLead, profileFromBrief, toICS } from './eligibility.mjs';
import { meetingBrief, simulateTurn } from './voice.mjs';
import { personKey } from './entities.mjs';
import { parseCsv } from './extractEval.mjs';

const CREATIVE_ROUTES = ['portfolio_founder', 'office_hours', 'event', 'content', 'thesis', 'research_link', 'shared_affiliation', 'customer_or_partner', 'co_investor', 'community', 'updates', 'advice'];
const CREATIVE_SYSTEM = `You are an ingenious fundraising strategist. The founder has NO one in their network who knows this target. Find the smartest, most specific way to become warm with THIS person before asking for money.
Think beyond "send updates": a founder they backed, their office hours or program, an event where they speak, something they published, their stated thesis, shared research, a customer or partner in common, a co-investor, a community they run, a pilot that makes them come to you.
Rules: use ONLY facts in "evidence" and cite one with evidence_id. No invented names, events or dates. The first move must be doable this week and ask for advice, feedback or a small yes, never money. Be concrete (name the piece, program or company from the evidence). "hook" is one sentence on why this angle works for this person. English, short.`;
/* Model text: drop leaked citations like "(evidence_id: …)" and cut at a word boundary, never mid-word. */
const tidy = (v, n) => {
  const t = String(v || '').replace(/\s*[([]\s*evidence[_ ]?ids?\s*[:=][^)\]]*[)\]]/gi, '').replace(/\s*\bevidence[_ ]?id\s*[:=]\s*\S+/gi, '').replace(/\s+([.,;:])/g, '$1').replace(/\s{2,}/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n - 1);
  const at = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('. ') + 1);
  return `${(at > n * 0.5 ? cut.slice(0, at) : cut).replace(/[\s,;:.\-–—(]+$/, '')}…`;
};
const CREATIVE_SCHEMA = { type: 'object', additionalProperties: false, required: ['route', 'label', 'hook', 'first_move', 'second_move', 'why', 'evidence_id'], properties: {
  route: { type: 'string', enum: CREATIVE_ROUTES }, label: { type: 'string' }, hook: { type: 'string' }, first_move: { type: 'string' }, second_move: { type: 'string' }, why: { type: 'string' }, evidence_id: { type: 'string' } } };

/** Pasos que corren dentro de la evaluación: elegibilidad de grants y fondos que invierten hoy (tesis revelada). */
export function createRunEnrichers({ store, env = process.env, fetcher = fetch }) {
  const A = store.analysis;
  const profilePath = resolve(env.ELIGIBILITY_PROFILE_PATH || 'data/eligibility_profile.json');
  const igcProfile = () => existsSync(profilePath) ? { ...IGC_PROFILE, ...JSON.parse(readFileSync(profilePath, 'utf8')) } : IGC_PROFILE;
  // El perfil de IGC solo vale si el trabajo es de IGC; en cualquier otro proyecto se evalúa con lo que dice el brief.
  const eligibilityProfile = (brief) => {
    const igc = igcProfile();
    const name = String(igc.name || '').toLowerCase().split(/\s+/)[0];
    const mine = [brief?.venture, brief?.organization, brief?.company, brief?.product].filter(Boolean).join(' ').toLowerCase();
    return name && mine.includes(name) ? igc : profileFromBrief(brief || {});
  };
  let vehicles = null;
  const getVehicles = () => (vehicles ??= loadVehicles(resolve(env.FUND_VEHICLES_PATH || 'data/fund_vehicles.json')));
  return [
    { name: 'Grant eligibility', run: async (job, { signal }) => {
      const leads = (job.leads || []).filter((l) => l.fundingType === 'grant' && l.kind === 'opportunity' && l.bucket !== 'discarded');
      if (!leads.length) return { skipped: true, count: 0, message: 'Grant eligibility: no grant calls in this run.' };
      const out = [];
      for (const lead of leads.slice(0, 15)) {
        signal?.throwIfAborted();
        const e = await evaluateOpportunity(opportunityFromLead(lead), { profile: eligibilityProfile(job.brief), env, fetcher });
        A.saveGrantEvaluation(String(e.id), e);
        lead.eligibility = { verdict: e.verdict, closed: e.closed, questions: e.questions.slice(0, 3), method: e.method };
        out.push({ id: String(e.id), leadId: lead.id, title: e.title, agency: e.agency, url: e.url, closeDate: e.closeDate, awardCeiling: e.awardCeiling, verdict: e.verdict, closed: e.closed });
      }
      job.grants = { evaluations: out, alerts: deadlineAlerts(out).slice(0, 5) };
      const ok = out.filter((g) => g.verdict === '✔').length;
      return { count: out.length, message: `Grant eligibility: ${out.length} calls checked rule by rule; ${ok} eligible, ${out.filter((g) => g.verdict === '?').length} need data.` };
    } },
    { name: 'Creative warm paths', run: async (job, { signal }) => {
      if (!fleetConfig(env).roles.chat.ready) return { skipped: true, count: 0, message: 'Creative warm paths: no chat model configured; rule-based angles kept.' };
      const b = job.brief || {};
      const targets = (job.leads || []).filter((l) => l.fundingType !== 'grant' && l.kind !== 'opportunity' && l.warmPlan && !l.warmPlan.built && l.bucket !== 'discarded').sort((x, y) => (y.score || 0) - (x.score || 0)).slice(0, 12);
      if (!targets.length) return { skipped: true, count: 0, message: 'Creative warm paths: every candidate already has a network path.' };
      let improved = 0;
      for (const lead of targets) {
        signal?.throwIfAborted();
        const ev = (lead.evidence || []).slice(0, 12).map((e) => ({ id: e.id, source: e.source, url: e.url, quote: String(e.quote || '').slice(0, 300) }));
        try {
          const { json } = await chatJSON({
            system: CREATIVE_SYSTEM,
            user: JSON.stringify({ founder: { name: b.name, company: b.company, product: b.product, stage: b.stage, industry: b.industry, geography: b.geography, timeline: b.timeline || null, description: String(b.description || '').slice(0, 600) },
              target: { person: lead.person, role: lead.role, org: lead.org, title: lead.title, affiliations: lead.affiliations || [] }, evidence: ev, current_plan: { route: lead.warmPlan.route, label: lead.warmPlan.label } }),
            schema: CREATIVE_SCHEMA, name: 'warm_path', role: 'chat', temperature: 0.4,
          }, { env, fetcher, signal });
          const hit = ev.find((e) => e.id === json.evidence_id);
          if (!hit || !json.first_move || !json.hook) continue; // sin cita, no se acepta
          const plan = lead.warmPlan;
          const tail = plan.steps.filter((st) => /update|meeting/i.test(st.what));
          const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
          lead.warmPlan = { ...plan, route: CREATIVE_ROUTES.includes(json.route) ? json.route : plan.route, label: String(json.label || plan.label).slice(0, 60), hook: tidy(json.hook, 220), source: 'ai', evidence: { id: hit.id, url: hit.url, quote: hit.quote.slice(0, 240) },
            why: tidy(json.why || plan.why, 400), steps: [{ when: day(0), what: tidy(json.first_move, 260) }, ...(json.second_move ? [{ when: day(10), what: tidy(json.second_move, 260) }] : []), ...tail] };
          improved += 1;
        } catch { /* se mantiene el plan por reglas */ }
      }
      return { count: improved, message: `Creative warm paths: ${improved} of ${targets.length} candidates got a specific angle from the evidence.` };
    } },
    { name: 'Active investors', run: async (job) => {
      if (!(job.brief?.fundingTypes || []).includes('investment')) return { skipped: true, count: 0, message: 'Active investors: not requested in this run.' };
      if (!A.dealCount()) return { skipped: true, count: 0, message: 'Active investors: deals database is empty; revealed-thesis ranking skipped.' };
      const b = job.brief || {};
      const profile = [b.stage, b.industry, b.geography, b.product, b.description].filter(Boolean).join(' · ').slice(0, 2000);
      if (!profile) return { skipped: true, count: 0, message: 'Active investors: no profile text.' };
      const asOf = new Date().toISOString().slice(0, 10);
      const model = fleetConfig(env).roles.embed.model || 'lexico';
      const r = await rankRevealed(profile, { deals: A.deals({ before: asOf }), asOf, vehicles: getVehicles(), env, fetcher, cache: A.embeddings(model), onEmbedding: (id, v) => A.saveEmbedding(id, model, v) });
      const funds = r.funds.slice(0, 12).map((f) => ({ fundId: f.fundId, rank: f.rank, name: f.name, dealsInWindow: f.dealsInWindow, leads: f.leads, inactive: Boolean(f.momentum?.inactive), signals: (f.momentum?.signals || []).slice(0, 3).map((x) => ({ type: x.type, label: x.label, url: x.evidence?.[0]?.url || null })), why: f.explanation?.[0] ? { text: f.explanation[0].text, url: f.explanation[0].url } : null }));
      job.activeInvestors = { asOf, funds, universe: r.funds.length };
      const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const lead of job.leads || []) { const f = funds.find((x) => norm(x.name) && norm(x.name) === norm(lead.org)); if (f) lead.activeFund = { rank: f.rank, dealsInWindow: f.dealsInWindow }; }
      return { count: funds.length, message: `Active investors: ${funds.length} funds with similar deals in the last 24 months.` };
    } },
  ];
}

export function createAnalysisRoutes({ store, env = process.env, authUser, fetcher = fetch }) {
  const A = store.analysis;
  let vehicles = null;
  const getVehicles = () => (vehicles ??= loadVehicles(resolve(env.FUND_VEHICLES_PATH || 'data/fund_vehicles.json')));
  const resultsDir = resolve(env.EVAL_RESULTS_DIR || '../backend/eval/results');
  const profilePath = resolve(env.ELIGIBILITY_PROFILE_PATH || 'data/eligibility_profile.json');
  const eligibilityProfile = () => existsSync(profilePath) ? { ...IGC_PROFILE, ...JSON.parse(readFileSync(profilePath, 'utf8')) } : IGC_PROFILE;
  const latestBacktest = () => {
    if (!existsSync(resultsDir)) return null;
    const f = readdirSync(resultsDir).filter((x) => /^backtest_.*\.json$/.test(x)).sort().at(-1);
    if (!f) return null;
    const r = JSON.parse(readFileSync(resolve(resultsDir, f), 'utf8'));
    return { file: f, at: r.at, table: r.table, coverage: r.coverage, vsBaseline: r.vsBaseline, vsApp: r.vsApp, decision: r.decision, rounds: r.rows?.length || 0 };
  };

  return async function handle(req, path, body, json, res, requestUrl) {
    const user = authUser(req);
    const uid = user?.id || null;
    if (req.method === 'GET' && path === '/api/research/analysis/status') {
      const cfg = fleetConfig(env);
      return json(200, {
        deals: A.dealCount(), funds: A.fundCount(), vehicles: getVehicles().count, vehiclesSource: getVehicles().source,
        fleet: Object.fromEntries(Object.entries(cfg.roles).map(([k, v]) => [k, v.ready ? v.model : null])),
        voicePeople: A.voicePeople(), outreach: A.outreachFor(uid).length, judgments: A.judgments().length,
        backtest: latestBacktest(),
      });
    }
    if (req.method === 'POST' && path === '/api/research/analysis/revealed') {
      const profile = String(body.profile || '').slice(0, 4000);
      if (!profile) return json(400, { error: 'Describe the profile (sector, stage, country, product).' });
      const asOf = /^\d{4}-\d{2}-\d{2}$/.test(body.asOf || '') ? body.asOf : new Date().toISOString().slice(0, 10);
      const model = fleetConfig(env).roles.embed.model || 'lexico';
      const cache = A.embeddings(model);
      const r = await rankRevealed(profile, { deals: A.deals({ before: asOf }), asOf, vehicles: getVehicles(), env, fetcher, cache, stage: body.stage, sector: body.sector, onEmbedding: (id, v) => A.saveEmbedding(id, model, v) });
      return json(200, { ...r, funds: r.funds.slice(0, Math.min(50, Number(body.limit) || 20)), universe: { deals: A.dealCount(), funds: r.funds.length } });
    }
    if (req.method === 'GET' && path === '/api/research/analysis/backtest') return json(200, latestBacktest() || { empty: true, note: 'No results yet. Run scripts/backtest.mjs.' });

    // Pilar B / C / Módulo 6
    if (path === '/api/research/outreach' && req.method === 'GET') {
      const events = A.outreachFor(uid);
      return json(200, { events, byChannel: summarizeOutreach(events, { by: 'channel' }), byArgument: summarizeOutreach(events, { by: 'argument' }), nextVariant: chooseArm(armsFromEvents(events)), options: { channels: CHANNELS, arguments: ARGUMENTS, outcomes: OUTCOMES.map((o) => ({ key: o, label: OUTCOME_LABEL[o] })) } });
    }
    if (path === '/api/research/outreach' && req.method === 'POST') {
      try { const e = validateOutreach(body, { userId: uid }); A.saveOutreach(e); return json(201, e); } catch (e) { return json(400, { error: e.message }); }
    }
    const m = path.match(/^\/api\/research\/outreach\/([\w-]{8,64})$/);
    if (m && req.method === 'PUT') {
      const prev = A.outreach(m[1]);
      if (!prev || prev.userId !== uid) return json(404, { error: 'Outreach not found.' });
      try { const e = validateOutreach(body, { userId: uid, existing: prev }); A.saveOutreach(e); return json(200, e); } catch (e) { return json(400, { error: e.message }); }
    }
    if (path === '/api/research/outreach/import' && req.method === 'POST') {
      if (typeof body.csv !== 'string' || body.csv.length > 1_000_000) return json(400, { error: 'Send the CSV as text.' });
      const { events, errors } = importOutreachRows(parseCsv(body.csv), { userId: uid, shared: Boolean(body.shared) });
      for (const e of events) A.saveOutreach(e);
      return json(200, { imported: events.length, errors: errors.slice(0, 20) });
    }
    if (path === '/api/research/outreach/network' && req.method === 'GET') {
      const q = requestUrl.searchParams;
      return json(200, networkAggregate(A.sharedOutreach(), { fund: q.get('fund'), sector: q.get('sector'), stage: q.get('stage') }));
    }

    // Módulo 5
    if (path === '/api/research/grants' && req.method === 'GET') {
      const evals = A.grantEvaluations();
      return json(200, { evaluations: evals, alerts: deadlineAlerts(evals), profile: eligibilityProfile() });
    }
    if (path === '/api/research/grants/profile' && req.method === 'PUT') {
      const allowed = Object.keys(IGC_PROFILE).filter((k) => k !== 'name');
      const next = { ...eligibilityProfile() };
      for (const [k, v] of Object.entries(body || {})) if (allowed.includes(k) && (v === null || typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string')) next[k] = { value: v, source: `Confirmed by ${user?.name || 'the user'} in the app (${new Date().toISOString().slice(0, 10)})` };
      mkdirSync(dirname(profilePath), { recursive: true });
      writeFileSync(profilePath, JSON.stringify(next, null, 2));
      return json(200, next);
    }
    if (path === '/api/research/grants/evaluate' && req.method === 'POST') {
      let opps = [];
      if (body.jobId) { const job = store.get(body.jobId); if (!job || (job.userId && job.userId !== uid)) return json(404, { error: 'Run not found.' }); opps = (job.leads || []).filter((l) => l.fundingType === 'grant' && l.kind === 'opportunity').map(opportunityFromLead); }
      else if (body.opportunity) opps = [body.opportunity];
      if (!opps.length) return json(400, { error: 'No calls to evaluate.' });
      const out = [];
      for (const o of opps.slice(0, 40)) { const e = await evaluateOpportunity(o, { profile: eligibilityProfile(), env, fetcher }); A.saveGrantEvaluation(String(e.id), e); out.push(e); }
      return json(200, { evaluations: out, alerts: deadlineAlerts(out) });
    }
    if (path === '/api/research/grants/calendar.ics' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="grant-deadlines.ics"' });
      res.end(toICS(A.grantEvaluations()));
      return true;
    }

    // Módulo 3
    if (path === '/api/research/voice' && req.method === 'GET') return json(200, { people: A.voicePeople() });
    if (path === '/api/research/voice/brief' && req.method === 'POST') {
      const chunks = A.chunks(personKey(body.person || ''));
      if (!chunks.length) return json(404, { error: 'No indexed sources for that person. Add them with scripts/voice.mjs.' });
      const facts = Array.isArray(body.facts) ? body.facts.filter((f) => f?.text && f?.source).slice(0, 20) : [];
      return json(200, await meetingBrief({ person: body.person, chunks, profileText: String(body.profile || '').slice(0, 2000), profileFacts: facts, similarDeals: Array.isArray(body.similarDeals) ? body.similarDeals.slice(0, 5) : [] }, { env, fetcher }));
    }
    if (path === '/api/research/voice/simulate' && req.method === 'POST') {
      const chunks = A.chunks(personKey(body.person || ''));
      if (!chunks.length) return json(404, { error: 'No indexed sources for that person.' });
      if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 2000) return json(400, { error: 'Invalid message.' });
      return json(200, await simulateTurn({ person: body.person, chunks, history: Array.isArray(body.history) ? body.history.slice(-10) : [], message: body.message }, { env, fetcher }));
    }
    return false;
  };
}

/** Registra un juicio (aprobado/rechazado) para learning-to-rank a partir del feedback de un lead. */
export function judgmentFromFeedback(job, lead, feedback) {
  return { id: randomUUID(), userId: job.userId || null, kind: 'lead', query: `${job.brief.industry || ''} ${job.brief.stage || ''} ${job.brief.geography || ''}`.trim(), itemId: lead.key, itemText: `${lead.title} ${lead.org} ${String(lead.searchText || '').slice(0, 800)}`, label: feedback.decision === 'approve' ? 1 : feedback.decision === 'reject' ? 0 : feedback.decision === 'connector_accepted' ? 1 : 0, reason: feedback.reason, at: feedback.at };
}
