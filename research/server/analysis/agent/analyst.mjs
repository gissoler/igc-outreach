// Analista por contacto: un agente en la flota que investiga a UNA persona con herramientas y escribe su ficha.
// La IA decide qué buscar, cómo juzgar la relación (warm path) y qué recomendar. El código solo verifica citas y cifras.
import { chatJSON, fleetConfig } from '../fleet.mjs';
import { Notebook, checkClaim, checkClaims, clip } from './evidence.mjs';
import { createTools, TOOL_SPECS } from './tools.mjs';

export const ANALYST_SYSTEM = `You are a senior fundraising advisor for digital health startups (LatAm and US). You work for a founder and analyze ONE person at a time.
Your job is a real consultant's: understand who they are, what they fund TODAY, whether they decide, and above all HOW to reach them through the founder's network (warm path) and WHAT to ask.

Method:
1. Review the initial evidence (ids E…). Identify what's missing to decide.
2. Use tools to fill gaps: current role, recent investments (last 18 months), thesis, public statements, and the real relationship between the connector and this person (worked together? co-invested? only on the same list?).
3. Stop when you have what you need or nothing more to find. Stay within the allowed searches.

Hard rules:
- Only facts with an evidence id count. Don't invent names, figures, dates or relationships.
- Appearing on the same page is NOT a relationship. Judge strength by type (direct work > co-investment > same board/event > same large org > mention only), recency and reciprocity.
- Never recommend asking for money without a relationship: first advice, permission for updates, or a double opt-in intro.
- A warm path is not only a network intro. When nobody connects to this person, the warm path is BUILT: ask for advice (no money), get permission for updates, and send periodic investor updates for 2–4 cycles before the round. Recommend that route (update_en_frio = build the relationship with updates) instead of a cold pitch, with a cadence that fits the founder's timeline.
- If they don't decide (investor relations, platform, press), say so and treat them as a connector.
- Write in English, direct, like a client memo.`;

const STEP_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['thought', 'action', 'args'],
  properties: {
    thought: { type: 'string' },
    action: { type: 'string', enum: [...Object.keys(TOOL_SPECS), 'finish'] },
    args: { type: 'object', additionalProperties: false, properties: { query: { type: 'string' }, url: { type: 'string' }, focus: { type: 'string' }, fund: { type: 'string' }, person: { type: 'string' }, name: { type: 'string' } } },
  },
};
const CLAIM = { type: 'object', additionalProperties: false, required: ['text', 'evidence'], properties: { text: { type: 'string' }, evidence: { type: 'array', items: { type: 'string' } } } };
export const DOSSIER_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['summary', 'role', 'current_focus', 'fit', 'warm_paths', 'best_route', 'common_ground', 'ask', 'timing', 'risks', 'open_questions', 'confidence'],
  properties: {
    summary: { type: 'string' },
    role: { type: 'object', additionalProperties: false, required: ['kind', 'title', 'evidence'], properties: { kind: { type: 'string', enum: ['decisor', 'influye', 'conector', 'no_relevante', 'incierto'] }, title: { type: 'string' }, evidence: { type: 'array', items: { type: 'string' } } } },
    current_focus: { type: 'array', maxItems: 5, items: CLAIM },
    fit: { type: 'object', additionalProperties: false, required: ['verdict', 'reasons'], properties: { verdict: { type: 'string', enum: ['alto', 'medio', 'bajo', 'descartar', 'incierto'] }, reasons: { type: 'array', maxItems: 4, items: CLAIM } } },
    warm_paths: { type: 'array', maxItems: 4, items: { type: 'object', additionalProperties: false, required: ['via', 'relationship', 'strength', 'would_introduce', 'reasoning', 'evidence'], properties: { via: { type: 'string' }, relationship: { type: 'string', enum: ['trabajo_directo', 'coinversion', 'consejo_o_evento', 'misma_organizacion', 'solo_mencion', 'desconocida'] }, strength: { type: 'number' }, would_introduce: { type: 'string', enum: ['probable', 'incierto', 'improbable'] }, reasoning: { type: 'string' }, evidence: { type: 'array', items: { type: 'string' } } } } },
    best_route: { type: 'object', additionalProperties: false, required: ['type', 'via', 'why'], properties: { type: { type: 'string', enum: ['intro_doble_opt_in', 'pedido_de_consejo', 'evento', 'update_en_frio', 'via_conector_interno', 'no_contactar_aun', 'descartar'] }, via: { type: 'string' }, why: { type: 'string' } } },
    common_ground: { type: 'array', maxItems: 3, items: CLAIM },
    ask: { type: 'object', additionalProperties: false, required: ['text', 'why'], properties: { text: { type: 'string' }, why: { type: 'string' } } },
    timing: { type: 'object', additionalProperties: false, required: ['when', 'why'], properties: { when: { type: 'string' }, why: { type: 'string' } } },
    risks: { type: 'array', maxItems: 4, items: { type: 'string' } },
    open_questions: { type: 'array', maxItems: 4, items: { type: 'string' } },
    confidence: { type: 'string', enum: ['alta', 'media', 'baja'] },
  },
};

/** Siembra la libreta con lo que la evaluación ya sabe de la persona, su camino y el fundador. */
export function seedNotebook(contact, ctx) {
  const nb = new Notebook('E');
  const ids = [];
  const push = (e) => { const id = nb.add(e); if (id) ids.push(id); };
  for (const e of contact.evidence || []) push({ source: e.source || 'evaluation', url: e.url, text: e.quote, date: e.retrievedAt?.slice(0, 10) || null });
  for (const p of contact.paths || []) for (const h of p.hops || []) push({ source: 'camino (evaluación)', url: h.url || null, text: `${h.from} → ${h.to}: ${h.relation || 'relationship without detail'}${p.hypothesis ? ' (hypothesis)' : ''}`, kind: 'path' });
  for (const t of contact.connectorTargets || []) push({ source: 'camino (evaluación)', url: t.url || null, text: `${contact.person} → ${t.name}: ${t.relation || 'relationship without detail'}${t.hypothesis ? ' (hypothesis)' : ''}`, kind: 'path' });
  const b = ctx.brief || {};
  const facts = new Notebook('C');
  facts.add({ source: 'perfil del fundador', text: `${b.name || 'Founder'} (${b.role || 'role not stated'}) at ${b.company || ''}. Startup: ${b.venture || b.company}. ${b.oneLiner || ''} ${b.description || ''}`.trim() });
  facts.add({ source: 'perfil del fundador', text: `Round: ${b.round || b.stage || 'not stated'}; target amount US$${b.amount || 'not stated'}; geography ${b.geography || 'not stated'}; sector ${b.industry || ''}. Constraints: ${b.constraints || 'none'}.` });
  const u = ctx.update;
  if (u) {
    for (const m of u.metrics.filter((x) => x.public)) facts.add({ source: `update ${u.period}`, text: `${m.name}: ${m.value}${m.unit ? ` ${m.unit}` : ''}${m.previous ? ` (previously ${m.previous})` : ''}` });
    for (const h of [...u.highlights, ...u.market, ...u.nextMilestones].filter((x) => x.public)) facts.add({ source: `update ${u.period}`, text: h.text });
  }
  return { nb, seedIds: ids, facts };
}

const contactLine = (c) => `${c.person}${c.role ? `, ${c.role}` : ''}${c.org ? ` at ${c.org}` : ''} — expected role: ${c.mode === 'connector' ? 'CONNECTOR (analyze whether and how they\'d introduce you to their decision-makers)' : 'TARGET (possible funder)'}`;

/** Bucle de investigación: el modelo elige herramienta; el código la ejecuta y guarda la evidencia. */
export async function investigate(contact, ctx, { env, fetcher, signal, maxSteps = 6, onEvent = () => {} }) {
  const { nb, facts } = seedNotebook(contact, ctx);
  const tools = createTools({ store: ctx.store, userId: ctx.userId, network: ctx.network, env, fetcher, signal, budget: { web: ctx.webBudget ?? 8 } });
  const trace = [];
  for (let step = 1; step <= maxSteps; step++) {
    const user = [
      `PERSON: ${contactLine(contact)}`,
      `FOUNDER AND STARTUP:
${facts.render()}`,
      `TOOLS:
${Object.values(TOOL_SPECS).join('\n')}
finish {}: you have what you need.`,
      `EVIDENCE SO FAR:
${nb.render() || '(none)'}`,
      trace.length ? `PREVIOUS STEPS:
${trace.map((t) => `${t.step}. ${t.action} ${JSON.stringify(t.args)} → ${clip(t.result, 300)}`).join('\n')}` : '',
      `Step ${step} of ${maxSteps}. Decide the next action. If nothing useful is left to find, use finish.`,
    ].filter(Boolean).join('\n\n');
    let decision;
    try { decision = (await chatJSON({ system: ANALYST_SYSTEM, user, schema: STEP_SCHEMA, name: 'paso', temperature: 0.2, role: ctx.role }, { env, fetcher, signal })).json; }
    catch (e) { trace.push({ step, action: 'error', args: {}, result: e.message }); break; }
    if (decision.action === 'finish') { trace.push({ step, action: 'finish', args: {}, result: decision.thought, thought: decision.thought }); break; }
    let result;
    try { result = await tools[decision.action](decision.args || {}, nb); } catch (e) { result = `Error: ${e.message}`; }
    trace.push({ step, action: decision.action, args: decision.args || {}, result: String(result), thought: decision.thought });
    onEvent({ type: 'step', contact: contact.person, step, action: decision.action, args: decision.args, thought: clip(decision.thought, 200) });
  }
  return { nb, facts, trace };
}

/** Verifica la ficha: todo lo que no tenga evidencia válida (o traiga cifras sin respaldo) se descarta y se cuenta. */
export function verifyDossier(raw, nb, facts, contact) {
  const reasons = [];
  const extra = facts.list().map((f) => f.text).join(' ');
  const d = { ...raw };
  d.current_focus = checkClaims(raw.current_focus, nb, { reasons });
  d.common_ground = checkClaims(raw.common_ground, nb, { extra, reasons });
  d.fit = { verdict: raw.fit?.verdict || 'incierto', reasons: checkClaims(raw.fit?.reasons, nb, { extra, reasons }) };
  if (!d.fit.reasons.length && ['alto', 'medio'].includes(d.fit.verdict)) { reasons.push(`fit "${d.fit.verdict}" without evidence → uncertain`); d.fit.verdict = 'incierto'; }
  const roleEv = (raw.role?.evidence || []).filter((i) => nb.has(i));
  d.role = { kind: roleEv.length ? raw.role?.kind || 'incierto' : 'incierto', title: raw.role?.title || '', evidence: roleEv };
  if (!roleEv.length && raw.role?.kind && raw.role.kind !== 'incierto') reasons.push(`role "${raw.role.kind}" without evidence → uncertain`);
  const knownVia = new Set([...(contact.paths || []).flatMap((p) => (p.hops || []).flatMap((h) => [h.from, h.to])), ...(contact.connectorTargets || []).map((t) => t.name), ...(contact.knownPeople || [])].map((x) => String(x).toLowerCase()));
  d.warm_paths = (raw.warm_paths || []).map((p) => {
    const ev = (p.evidence || []).filter((i) => nb.has(i));
    if (!ev.length) { reasons.push(`path via ${p.via} without evidence`); return null; }
    const known = [...knownVia].some((k) => k && String(p.via).toLowerCase().includes(k.split(' (')[0]));
    const strength = Math.max(0, Math.min(1, Number(p.strength) || 0));
    const capped = p.relationship === 'solo_mencion' || p.relationship === 'desconocida' ? Math.min(strength, 0.3) : strength;
    return { ...p, strength: capped, evidence: ev, knownPath: known };
  }).filter(Boolean);
  const claims = (raw.current_focus?.length || 0) + (raw.common_ground?.length || 0) + (raw.fit?.reasons?.length || 0) + (raw.warm_paths?.length || 0);
  const kept = d.current_focus.length + d.common_ground.length + d.fit.reasons.length + d.warm_paths.length;
  d.verification = { claims, kept, dropped: claims - kept, reasons };
  return d;
}

/** Ficha final. Con samples > 1 genera varias y se queda con la que más afirmaciones sustentadas conserva (best-of-n). */
export async function writeDossier(contact, ctx, { nb, facts, trace }, { env, fetcher, signal, samples = 1 }) {
  const user = [
    `PERSON: ${contactLine(contact)}`,
    `FOUNDER AND STARTUP (ids C…, use as context but NOT as evidence about the person):
${facts.render()}`,
    `EVIDENCE (cite only these ids in "evidence"):
${nb.render() || '(none)'}`,
    `WHAT YOU RESEARCHED:
${trace.map((t) => `${t.step}. ${t.action} ${JSON.stringify(t.args)}${t.thought ? ` — ${clip(t.thought, 160)}` : ''}`).join('\n') || '(no steps)'}`,
    'Write the advisor card. "strength" between 0 and 1. If something can\'t be known from the evidence, put it in open_questions.',
  ].join('\n\n');
  const drafts = [];
  for (let i = 0; i < Math.max(1, samples); i++) {
    try {
      const { json, model } = await chatJSON({ system: ANALYST_SYSTEM, user, schema: DOSSIER_SCHEMA, name: 'ficha', temperature: samples > 1 ? 0.5 : 0.2, role: ctx.role }, { env, fetcher, signal });
      const v = verifyDossier(json, nb, facts, contact);
      drafts.push({ raw: json, dossier: v, model, score: v.verification.kept - 0.5 * v.verification.dropped });
    } catch (e) { drafts.push({ error: e.message, score: -Infinity }); }
  }
  drafts.sort((a, b) => b.score - a.score);
  const best = drafts[0];
  if (!best?.dossier) throw new Error(best?.error || 'The model didn\'t produce a card.');
  return { ...best, input: user, alternatives: drafts.slice(1).filter((d) => d.raw).map((d) => ({ raw: d.raw, score: d.score })) };
}

export async function analyzeContact(contact, ctx, opts) {
  const research = await investigate(contact, ctx, opts);
  const out = await writeDossier(contact, ctx, research, opts);
  return {
    leadKey: contact.leadKey || null, person: contact.person, org: contact.org || null, role: contact.role || null, mode: contact.mode,
    dossier: out.dossier, model: out.model, evidence: research.nb.list(), trace: research.trace,
    training: { system: ANALYST_SYSTEM, input: out.input, output: JSON.stringify(out.raw), alternatives: out.alternatives },
    createdAt: new Date().toISOString(),
  };
}
export const agentRole = (env) => { const r = fleetConfig(env).roles; return r.chat.ready ? 'chat' : r.small.ready ? 'small' : null; };
