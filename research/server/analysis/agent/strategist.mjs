// Estratega + crítico: con TODAS las fichas arma el roadmap de la ronda, un crítico lo ataca y el estratega lo corrige.
import { chatJSON, fleetConfig } from '../fleet.mjs';
import { clip, numbersIn } from './evidence.mjs';

export const STRATEGIST_SYSTEM = `You are the senior partner at a fundraising consultancy. You receive contact cards (D1, D2…) from your analysts, founder facts (C…) and sourced playbook rules (P…).
Your deliverable is the round roadmap, as you'd present it to the founder:
- Honest diagnosis: where they stand and what's missing for an investor to say yes.
- Strategy thesis in 2–3 sentences.
- Phases with time window, goal and exit criteria.
- Concrete actions: who, what, through whom and why, citing cards.
- First week, update plan (cadence and topics), what NOT to do, and risks.
Rules: only name people in the cards. Every action and diagnosis point has refs (D…, C…, P…). Don't invent figures. Every contact must end up with a warm path: first connectors with real relationships; for everyone else, build the relationship with advice asks and periodic investor updates (state the cadence and how many updates before the round). The money ask only comes at the end, to people who have already seen updates. Write in English.`;

const REF_ITEM = { type: 'object', additionalProperties: false, required: ['text', 'refs'], properties: { text: { type: 'string' }, refs: { type: 'array', items: { type: 'string' } } } };
const ACTION = { type: 'object', additionalProperties: false, required: ['who', 'what', 'via', 'why', 'refs'], properties: { who: { type: 'string' }, what: { type: 'string' }, via: { type: 'string' }, why: { type: 'string' }, refs: { type: 'array', items: { type: 'string' } } } };
export const ROADMAP_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['headline', 'diagnosis', 'thesis', 'phases', 'first_week', 'update_plan', 'do_not', 'risks'],
  properties: {
    headline: { type: 'string' },
    diagnosis: { type: 'array', maxItems: 6, items: REF_ITEM },
    thesis: { type: 'string' },
    phases: { type: 'array', maxItems: 4, items: { type: 'object', additionalProperties: false, required: ['name', 'window', 'goal', 'exit_criteria', 'actions'], properties: { name: { type: 'string' }, window: { type: 'string' }, goal: { type: 'string' }, exit_criteria: { type: 'array', items: { type: 'string' } }, actions: { type: 'array', maxItems: 8, items: ACTION } } } },
    first_week: { type: 'array', maxItems: 6, items: ACTION },
    update_plan: { type: 'object', additionalProperties: false, required: ['cadence_days', 'themes'], properties: { cadence_days: { type: 'number' }, themes: { type: 'array', maxItems: 4, items: REF_ITEM } } },
    do_not: { type: 'array', maxItems: 5, items: REF_ITEM },
    risks: { type: 'array', maxItems: 5, items: REF_ITEM },
  },
};
export const CRITIC_SYSTEM = `You are a skeptical investor and demanding consultant reviewing a fundraising roadmap. Look for: money asks without a relationship, weak paths treated as strong, misclassified people (non-deciders), steps that don't follow from the cards, missing milestones before asking, and ignored risks. Cite cards (D…). Be concrete: problem and fix. Write in English.`;
const CRITIC_SCHEMA = { type: 'object', additionalProperties: false, required: ['issues', 'verdict'], properties: { verdict: { type: 'string', enum: ['sólido', 'corregir', 'rehacer'] }, issues: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['severity', 'issue', 'fix', 'refs'], properties: { severity: { type: 'string', enum: ['alta', 'media', 'baja'] }, issue: { type: 'string' }, fix: { type: 'string' }, refs: { type: 'array', items: { type: 'string' } } } } } } };

/** Paquete compacto de fichas para el estratega (D-ids). */
export function strategyPack({ dossiers, brief, update, playbook, outreach = [] }) {
  const D = dossiers.map((x, i) => ({ id: `D${i + 1}`, x }));
  const C = [
    { id: 'C1', text: `${brief.venture || brief.company}: ${brief.oneLiner || brief.product || ''}. Round ${brief.round || brief.stage || '—'}, US$${brief.amount || '—'}, ${brief.geography || ''}. Backing: ${brief.organization || brief.company}.` },
    ...(update ? [...update.metrics.filter((m) => m.public).map((m) => `${m.name}: ${m.value}${m.previous ? ` (previously ${m.previous})` : ''}`), ...update.highlights.filter((h) => h.public).map((h) => h.text)].map((t, i) => ({ id: `C${i + 2}`, text: t })) : []),
  ];
  const text = [
    'CARDS:',
    ...D.map(({ id, x }) => { const d = x.dossier; return `[${id}] ${x.person}${x.org ? ` (${x.org})` : ''} · role: ${d.role.kind}${d.role.title ? ` (${d.role.title})` : ''} · fit: ${d.fit.verdict} · confidence: ${d.confidence}
  summary: ${clip(d.summary, 350)}
  current focus: ${d.current_focus.map((c) => c.text).join(' | ') || '—'}
  paths: ${d.warm_paths.map((p) => `via ${p.via} (${p.relationship}, ${Math.round(p.strength * 100)} %, ${p.would_introduce})`).join(' | ') || 'none'}
  route: ${d.best_route.type}${d.best_route.via ? ` via ${d.best_route.via}` : ''} — ${clip(d.best_route.why, 200)}
  ask: ${clip(d.ask.text, 160)} · when: ${clip(d.timing.when, 80)}
  risks: ${d.risks.join(' | ') || '—'}`; }),
    '', 'FOUNDER FACTS:', ...C.map((c) => `[${c.id}] ${c.text}`),
    '', 'PLAYBOOK:', ...playbook.map((p) => `[${p.id}] ${p.rule}`),
    '', `HISTORY: ${outreach.length ? outreach.slice(0, 20).map((e) => `${e.sentAt} ${e.person || e.fundName} ${e.channel}→${e.outcome}`).join('; ') : 'no outreach logged'}`,
  ].join('\n');
  return { text, ids: new Set([...D.map((d) => d.id), ...C.map((c) => c.id), ...playbook.map((p) => p.id)]), names: dossiers.flatMap((x) => [x.person, x.org, ...x.dossier.warm_paths.map((p) => p.via)]).filter(Boolean) };
}

/** Verifica el roadmap: refs existentes, personas conocidas y sin cifras nuevas. */
export function verifyRoadmap(r, pack, brief) {
  const reasons = [];
  const allowedNums = new Set(numbersIn(pack.text));
  const okRefs = (refs) => (refs || []).filter((x) => pack.ids.has(x));
  const known = [...pack.names, brief.name, 'tú', 'fundador', 'fundadora', brief.venture, brief.company, brief.organization].filter(Boolean).map((x) => String(x).toLowerCase());
  const whoOk = (w) => { const s = String(w || '').toLowerCase(); return !s || known.some((k) => s.includes(k.split(' (')[0]) || k.includes(s)); };
  const noNew = (t) => numbersIn(t).every((n) => allowedNums.has(n));
  const item = (x, label) => { const refs = okRefs(x.refs); if (!refs.length) { reasons.push(`${label} without valid refs: "${clip(x.text, 70)}"`); return null; } if (!noNew(x.text)) { reasons.push(`${label} with new figures: "${clip(x.text, 70)}"`); return null; } return { ...x, refs }; };
  const action = (a, label) => { const refs = okRefs(a.refs); if (!refs.length) { reasons.push(`${label} without refs: "${clip(a.what, 70)}"`); return null; } if (!whoOk(a.who)) { reasons.push(`${label} with a person not in the cards: ${a.who}`); return null; } if (!noNew(`${a.what} ${a.why}`)) { reasons.push(`${label} with new figures`); return null; } return { ...a, refs }; };
  const out = {
    ...r,
    diagnosis: (r.diagnosis || []).map((x) => item(x, 'diagnosis')).filter(Boolean),
    phases: (r.phases || []).map((p) => ({ ...p, actions: (p.actions || []).map((a) => action(a, `action (${p.name})`)).filter(Boolean) })),
    first_week: (r.first_week || []).map((a) => action(a, 'first week')).filter(Boolean),
    update_plan: { cadence_days: Math.max(30, Math.min(180, Number(r.update_plan?.cadence_days) || 120)), themes: (r.update_plan?.themes || []).map((x) => item(x, 'update topic')).filter(Boolean) },
    do_not: (r.do_not || []).map((x) => item(x, 'don\'t')).filter(Boolean),
    risks: (r.risks || []).map((x) => item(x, 'risk')).filter(Boolean),
  };
  if (!noNew(out.headline)) { reasons.push('headline with new figures'); out.headline = 'Round roadmap'; }
  out.verification = { dropped: reasons.length, reasons };
  return out;
}

const strategistRole = (env) => { const r = fleetConfig(env).roles; return r.reasoning.ready ? 'reasoning' : r.chat.ready ? 'chat' : 'small'; };

/** Estratega → crítico → (si hace falta) revisión. */
export async function buildRoadmap({ dossiers, brief, update, playbook, outreach }, { env, fetcher, signal, onEvent = () => {} }) {
  const pack = strategyPack({ dossiers, brief, update, playbook, outreach });
  const role = strategistRole(env);
  onEvent({ type: 'phase', message: `Strategist (${role}) building the roadmap with ${dossiers.length} cards…` });
  const first = await chatJSON({ system: STRATEGIST_SYSTEM, user: `${pack.text}

Build the roadmap.`, schema: ROADMAP_SCHEMA, name: 'roadmap', temperature: 0.3, role }, { env, fetcher, signal });
  onEvent({ type: 'phase', message: 'Critic reviewing the roadmap…' });
  let critic = null;
  try { critic = (await chatJSON({ system: CRITIC_SYSTEM, user: `${pack.text}

PROPOSED ROADMAP:
${JSON.stringify(first.json)}`, schema: CRITIC_SCHEMA, name: 'critica', temperature: 0.2, role: fleetConfig(env).roles.chat.ready ? 'chat' : role }, { env, fetcher, signal })).json; } catch (e) { critic = { verdict: 'sólido', issues: [], error: e.message }; }
  let final = first.json, revised = false;
  if (critic.verdict !== 'sólido' && critic.issues?.some((i) => i.severity !== 'baja')) {
    onEvent({ type: 'phase', message: `Addressing ${critic.issues.length} critic notes…` });
    try { final = (await chatJSON({ system: STRATEGIST_SYSTEM, user: `${pack.text}

YOUR PREVIOUS ROADMAP:
${JSON.stringify(first.json)}

CRITIC NOTES:
${critic.issues.map((i) => `- [${i.severity}] ${i.issue} → ${i.fix}`).join('\n')}

Deliver the revised roadmap.`, schema: ROADMAP_SCHEMA, name: 'roadmap', temperature: 0.2, role }, { env, fetcher, signal })).json; revised = true; } catch { /* se queda con el primero */ }
  }
  return { roadmap: verifyRoadmap(final, pack, brief), critic, revised, model: first.model, role, training: { system: STRATEGIST_SYSTEM, input: pack.text, output: JSON.stringify(final), first: JSON.stringify(first.json) } };
}
