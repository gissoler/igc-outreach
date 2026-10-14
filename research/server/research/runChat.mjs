/* Asistente de la corrida: conversa sobre UNA corrida con su estado completo (brief, candidatos, verificaciones, descartes, contactos,
   fuentes) y su propio historial. Decisión 14-10: sin LangChain/LangGraph. El estado ya vive en un JSON local; basta un bucle corto
   «el modelo pide una herramienta → el código la ejecuta sobre la corrida → responde», con el mismo chatJSON que usa el motor.
   LangGraph aportaría grafos y memoria persistente que aquí resuelven 60 líneas y el store existente, a cambio de otra dependencia,
   otro modo de llamar a vLLM y otra capa que depurar.
   Regla dura: nada que no esté en la corrida. Fechas, URLs y correos de la respuesta se comprueban contra lo que las herramientas
   devolvieron; si el modelo inventa uno, se le pide corregir una vez y, si insiste, la frase se quita y se avisa. */
import { chatJSON, fleetReady } from '../analysis/fleet.mjs';
import { datesIn } from './dates.mjs';

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const MAX_TOOL_STEPS = 4; const HISTORY = 12;

/* ── Vistas compactas de la corrida ─────────────────────────────────── */
const leadName = (l) => clip(l.kind === 'opportunity' || l.fundingType === 'grant' ? l.title || l.org : [l.person, l.org].filter(Boolean).join(' · ') || l.title, 120);
const quoteOf = (l, field) => (l.evidence || []).find((e) => e.field === field)?.quote || '';
export function indexRow(l) {
  return { id: l.id, name: leadName(l), type: l.fundingType, kind: l.kind, list: l.bucket, score: l.score, status: l.status, deadline: l.deadline || null, ...(l.registry?.number ? { number: l.registry.number } : {}), why: clip(l.why?.[0] || l.discard || '', 160) };
}
export function candidateDetail(l) {
  const v = l.verification || {};
  return {
    id: l.id, name: leadName(l), organization: l.org, title: l.title, type: l.fundingType, list: l.bucket, discard_reason: l.discard || null, score: l.score, confidence: l.confidence,
    status: l.status, deadline: l.deadline, days_to_deadline: l.daysToDeadline ?? null, amount: l.amount,
    url: l.contact?.type === 'web' ? l.contact.value : (l.evidence || [])[0]?.url || null,
    registry: l.registry || null,
    deadline_quote: v.deadlineQuote || quoteOf(l, 'deadline') || l.quotes?.deadline || null,
    eligibility_quote: v.eligibility?.quote || quoteOf(l, 'eligibility') || l.quotes?.eligible || null,
    identity_quote: quoteOf(l, 'opportunity') || quoteOf(l, 'profile') || l.quotes?.identity || null,
    verified_by_judge: v.tier === 'main', blockers: (v.blockers || []).slice(0, 6), missing: (l.missing || []).slice(0, 6), risks: (l.risks || []).slice(0, 6),
    contacts: (l.contacts || []).slice(0, 8).map((c) => ({ name: c.name, role: c.role || c.title || null, organization: c.organization || null, email: c.email || null, linkedin: c.linkedin || c.linkedin_url || null, source: c.provenance || c.source || null })),
    person: l.person ? { name: l.person, role: l.role, contact: l.contact?.type === 'email' ? l.contact.value : null } : null,
    warm_path: l.paths?.[0] ? { via: l.paths[0].nodes, strength: l.paths[0].strength } : null,
    application_plan: l.grantPlan ? { decision: l.grantPlan.label, next_action: clip(l.grantPlan.nextAction, 300), portal: l.grantPlan.apply?.portal?.name || null, steps: (l.grantPlan.apply?.steps || []).filter((x) => !x.skip).slice(0, 8).map((x) => `${clip(x.label, 160)}${x.days ? ` (~${x.days} days)` : ''}`), open_items: (l.grantPlan.checklist || []).filter((x) => !x.done).map((x) => clip(x.label, 120)).slice(0, 8) } : null,
    draft: l.draft?.body ? { subject: l.draft.subject, body: clip(l.draft.body, 1500) } : null,
    found_by: (l.foundBy || []).slice(0, 3).map((f) => ({ source: f.provider, query: clip(f.query, 120) })),
  };
}
export function runSummary(job) {
  const b = job.brief || {}; const c = { top: 0, radar: 0, discarded: 0 };
  for (const l of job.leads || []) c[l.bucket] = (c[l.bucket] || 0) + 1;
  return {
    run_id: job.id, status: job.status, started: job.createdAt || null, finished: job.finishedAt || null, timed_out: Boolean(job.timedOut),
    brief: { company: b.company, product: b.product, one_liner: b.oneLiner, industry: b.industry, stage: b.stage, round: b.round, amount_usd: b.amount, use_of_funds: b.useOfFunds, geography: [b.city, b.state, b.country, b.geography].filter(Boolean).join(', '), entity_type: b.entityType, looking_for: b.fundingTypes },
    lists: { act_now: c.top, watch: c.radar, ruled_out: c.discarded },
    engine: (job.runAudit?.counters ? { queries: job.runAudit.counters.queries, pages_read: job.runAudit.counters.pagesRead } : null),
  };
}

/* ── Herramientas sobre la corrida (solo lectura, deterministas) ─────── */
const match = (q) => { const t = String(q || '').toLowerCase().trim(); return (s) => !t || String(s || '').toLowerCase().includes(t); };
export function runTools(job) {
  const leads = job.leads || [];
  const find = (args = {}) => leads.find((l) => l.id === args.id) || leads.find((l) => match(args.query)(`${leadName(l)} ${l.org} ${l.title} ${l.registry?.number || ''}`));
  return {
    list_candidates: (args = {}) => leads.filter((l) => (!args.list || l.bucket === args.list) && (!args.type || l.fundingType === args.type) && match(args.query)(`${leadName(l)} ${l.org} ${l.title}`)).slice(0, 25).map(indexRow),
    candidate: (args = {}) => { const l = find(args); return l ? candidateDetail(l) : { error: 'not_found', hint: 'Use list_candidates to see ids.' }; },
    ruled_out: (args = {}) => ({
      in_list: leads.filter((l) => l.bucket === 'discarded' && match(args.query)(`${leadName(l)} ${l.org} ${l.title}`)).slice(0, 15).map((l) => ({ id: l.id, name: leadName(l), reason: clip(l.discard, 300) })),
      judged_pages: (job.engineDrops || []).filter((d) => match(args.query)(`${d.title} ${d.url}`)).slice(0, 20),
    }),
    sources: () => ({ searches: (job.searchAudit || []).slice(0, 20).map((s) => ({ source: s.provider, query: clip(s.query, 140), returned: s.returned, kept: s.discovered })), warnings: (job.events || []).filter((e) => e.phase === 'warning').slice(-10).map((e) => clip(e.message, 200)) }),
  };
}
const TOOL_HELP = `Tools (call one at a time with {"action":"tool","tool":"<name>","args":{...}}):
- list_candidates {list?: "top"|"radar"|"discarded", type?: "grant"|"investment"|..., query?: text}: rows of this run (id, name, list, deadline, why).
- candidate {id? , query?}: everything this run knows about one candidate: quotes for deadline and eligibility, judge blockers, missing items, contacts (Apollo / registry), application plan and the draft.
- ruled_out {query?}: discarded candidates and pages the judge dropped, each with its reason and the quote behind it.
- sources {}: searches run, sources used and warnings of this run.`;

const SYSTEM = `You are the assistant inside a funding-research app. You talk with the founder about ONE research run that already happened.
Hard rules:
1. Use only facts from the run summary, the conversation and tool results. Never invent programs, people, dates, amounts, emails or links. If the run does not have it, say so plainly and say what would find it (e.g. "the run did not read that page").
2. When the answer depends on a candidate, call a tool first. Quote the page text you rely on (the quotes the tools return) for deadlines and eligibility.
3. Be direct and short: 2-6 sentences or a short list of steps. No greetings, no filler, no generic advice, no template.
4. Ask a question only if a missing fact would change the answer or the search (for example the applicant's entity type for an eligibility question). Ask exactly one, at the end.
5. Drafting a message: write it ready to send, using only the person, organization and facts from the run and the brief; put any fact you do not have in [brackets].
6. Reply in the same language as the draft request or question the user wrote (Spanish if they write Spanish).
Reply only with JSON: either {"action":"tool","tool":"...","args":{...}} or {"action":"answer","answer":"...","cites":["candidate ids you used"],"question":null or "one question"}.
${TOOL_HELP}`;

/* ── Comprobación de que la respuesta no inventa ─────────────────────── */
const URL_RX = /https?:\/\/[^\s)>\]"']+/g; const EMAIL_RX = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
export function ungrounded(answer, corpus) {
  const text = String(answer || ''); const hay = String(corpus || ''); const hayDates = new Set(datesIn(hay)); const bad = [];
  for (const u of text.match(URL_RX) || []) if (!hay.includes(u.replace(/[.,;:]+$/, ''))) bad.push(u);
  for (const e of text.match(EMAIL_RX) || []) if (!hay.toLowerCase().includes(e.toLowerCase().replace(/[.,;:]+$/, ''))) bad.push(e);
  for (const d of datesIn(text)) if (!hayDates.has(d)) bad.push(d);
  return [...new Set(bad)];
}
const dropSentencesWith = (answer, bad) => String(answer).split(/(?<=[.!?])\s+/).filter((s) => !bad.some((b) => s.includes(b) || datesIn(s).includes(b))).join(' ');

/** Un turno de conversación. `job.chat` guarda la memoria; quien llama persiste el job. */
export async function askRun(job, message, { env = process.env, fetcher = fetch, chat = chatJSON, signal, now = new Date() } = {}) {
  const text = clip(message, 2000); if (!text) throw new Error('Empty message.');
  job.chat = Array.isArray(job.chat) ? job.chat : [];
  const tools = runTools(job); const summary = runSummary(job);
  const context = { today: now.toISOString().slice(0, 10), run: summary, candidates_index: (job.leads || []).filter((l) => l.bucket !== 'discarded').slice(0, 40).map(indexRow) };
  let corpus = JSON.stringify(context); const used = [];
  const history = job.chat.slice(-HISTORY).map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));
  const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: `Run context:\n${JSON.stringify(context)}` }, { role: 'assistant', content: '{"action":"answer","answer":"Ready.","cites":[],"question":null}' }, ...history, { role: 'user', content: text }];
  const role = fleetReady(env, 'chat') ? 'chat' : 'engine';
  let out = null; let retried = false;
  for (let step = 0; step <= MAX_TOOL_STEPS + 1; step++) {
    const r = await chat({ messages, name: 'run_chat', role }, { env, fetcher, signal });
    const j = r?.json || {};
    if (j.action === 'tool' && tools[j.tool] && step < MAX_TOOL_STEPS) {
      const result = tools[j.tool](j.args || {}); used.push({ tool: j.tool, args: j.args || {} });
      const s = JSON.stringify(result).slice(0, 12000); corpus += s;
      messages.push({ role: 'assistant', content: JSON.stringify(j) }, { role: 'user', content: `Tool result (${j.tool}):\n${s}\nNow answer, or call another tool if you still need one.` });
      continue;
    }
    const answer = clip(j.answer || j.reply || '', 4000);
    const bad = ungrounded(answer, corpus + text + history.map((h) => h.content).join(' '));
    if (bad.length && !retried) { retried = true; messages.push({ role: 'assistant', content: JSON.stringify(j) }, { role: 'user', content: `These are not in the run data: ${bad.join(', ')}. Rewrite the answer without them (say the run does not have them).` }); continue; }
    out = { answer: bad.length ? `${dropSentencesWith(answer, bad)}\n\n(Removed ${bad.length} detail(s) that are not in this run: ${bad.join(', ')}.)`.trim() : answer, cites: (Array.isArray(j.cites) ? j.cites : []).filter((id) => (job.leads || []).some((l) => l.id === id)), question: j.question ? clip(j.question, 300) : null, tools: used, removed: bad };
    break;
  }
  if (!out) out = { answer: 'I could not finish that answer with the run data. Ask about one candidate by name.', cites: [], question: null, tools: used, removed: [] };
  const reply = [out.answer, out.question].filter(Boolean).join('\n\n');
  job.chat.push({ role: 'user', text, at: now.toISOString() }, { role: 'assistant', text: reply, at: new Date().toISOString(), cites: out.cites, tools: out.tools.map((t) => t.tool) });
  job.chat = job.chat.slice(-60);
  return { reply, ...out };
}
export const chatReady = (env = process.env) => fleetReady(env, 'chat') || fleetReady(env, 'engine');
