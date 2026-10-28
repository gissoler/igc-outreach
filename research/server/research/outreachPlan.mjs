/* ─────────────────────────────────────────────────────────────────────────────
   «Prepare an outreach plan» por candidato (27-10, pedido de Rohit: a quién, cómo, con qué ángulo según
   operaciones previas). El plan separa HECHOS (con fuente), INFERENCIAS y PROPUESTAS:
     · los hechos salen solo del expediente del candidato (citas, URL, fecha) y del perfil confirmado;
     · el modelo redacta, pero cada frase que dice ser un hecho debe citar un id de hecho existente,
       o se rebaja a inferencia; frases que inventan interés, relaciones o condiciones se eliminan;
     · sin modelo (o si falla) se arma un plan por reglas y se dice.
   Nada se envía: el mensaje es un borrador. Una cadencia de seguimiento es una propuesta de producto.
   ───────────────────────────────────────────────────────────────────────────── */
import { intakeTargets } from './intake.mjs';
import { TYPE_LABEL } from './investors/fit.mjs';

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const MATURITY = { idea: 'idea stage', prototype: 'prototype', preclinical: 'preclinical', clinical_phase_1: 'Phase 1', clinical_phase_2: 'Phase 2', clinical_phase_3: 'Phase 3', marketed: 'on the market' };
/** Afirmaciones que el plan nunca puede hacer: interés, relación o condiciones no documentadas. */
const INVENTED = /\b(?:you (?:have |'ve )?(?:expressed|shown|mentioned) interest|as (?:we|you) discussed|(?:my|our) (?:friend|mutual friend|colleague)|you (?:will|would) (?:invest|offer|provide)|(?:they|you) (?:are|is) (?:interested|keen|eager)|agreed to|committed to (?:invest|introduce)|warm intro(?:duction)? from|has offered to introduce|looking forward to your investment)\b/i;

const INTERPRETIVE = /\b(?:show(?:s|ing)? (?:interest|appetite|focus)|suggest\w*|align\w*|interest(?:ed)? in|likely|good fit|fits?\b|mutually|known contacts?|could|would|may|signals?)\b/i;
/** Hechos con id: lo único que el plan puede presentar como hecho. */
export function planFacts(lead, job) {
  const b = job.brief || {}; const fit = lead.investorFit || {};
  const facts = []; let n = 0;
  const add = (text, url = null, at = null, about = 'candidate') => { if (!text) return; facts.push({ id: `F${++n}`, text: clip(text, 360), url, at, about }); };
  const ev = lead.investorEvidence || {};
  if (fit.entity?.quote) add(`${TYPE_LABEL[fit.entity.type] || 'Organization'} per its source: “${fit.entity.quote}”`, fit.entity.url);
  for (const [k, v] of Object.entries(ev)) if (v?.quote) add(`${k[0].toUpperCase()}${k.slice(1)}: “${v.quote}”`, v.url || null);
  for (const d of fit.deals || []) add(`Deal reported: ${d.company}${d.year ? ` (${d.year})` : ''}${d.instruments?.length ? ` · ${d.instruments.join(', ')}` : ''}${d.amount ? ` · ${d.amount.value} (${d.amount.kind === 'round_size' ? 'total round size, not this investor\'s share' : 'reported participation'})` : ''}. Source: “${d.quote}”`, d.url);
  for (const i of fit.instruments || []) if (!(fit.deals || []).some((d) => d.instruments?.includes(i.instrument))) add(`Instrument mentioned: ${i.instrument} — “${i.quote}”`, i.url);
  if (fit.listed?.value === 'listed_evidence') add(`Listed-company financing mentioned: “${fit.listed.quote}”`, fit.listed.url);
  if (lead.directInvestment?.quote) add(`Direct investment: “${lead.directInvestment.quote}”`, lead.directInvestment.url);
  for (const e of (lead.evidence || []).filter((x) => x.verified).slice(0, 4)) if (!facts.some((f) => f.text.includes(clip(e.quote, 60)))) add(`Source (${e.source}): “${e.quote}”`, e.url, e.retrievedAt || null);
  const people = [
    ...(lead.person ? [{ name: lead.person, role: lead.role, email: lead.contact?.type === 'email' ? lead.contact.value : null, provenance: lead.contact?.provenance || 'Found in this run' }] : []),
    ...(lead.contacts || []).map((c) => ({ name: c.name, role: c.role, email: c.email, provenance: c.provenance })),
  ];
  for (const p of people.slice(0, 4)) add(`Contact: ${p.name}${p.role ? `, ${p.role}` : ' (role not confirmed)'}${p.email ? ` · ${p.email}` : ''} — ${p.provenance}`, null, null, 'contact');
  if (lead.contact && lead.contact.type !== 'email') add(`Public channel: ${lead.contact.value} (${lead.contact.provenance || 'from the organization page'})`, lead.contact.type === 'web' ? lead.contact.value : null, null, 'contact');
  const verifiedPaths = (lead.paths || []).filter((p) => p.status === 'verified');
  for (const p of verifiedPaths.slice(0, 2)) add(`Verified relationship path: ${(p.nodes || []).join(' → ')} (willingness to introduce is not established)`, null, null, 'network');
  const company = [b.venture || b.company, b.listing === 'public' || b.round === 'public' ? 'publicly listed' : null, b.oneLiner || clip(b.description, 200), b.product ? `lead product ${b.product}` : null, MATURITY[b.stage] || null].filter(Boolean).join('; ');
  add(`Your company (from the conversation): ${company}`, null, null, 'company');
  return { facts, people, verifiedPaths: verifiedPaths.length, unknown: [b.amount ? null : 'target amount and ticket size', !(fit.deals || []).length ? 'comparable deals by this investor' : null, !people.some((p) => p.role) ? 'a named person with a confirmed investment role' : null].filter(Boolean) };
}

/** Plan por reglas: siempre disponible, sin inventar. */
export function rulePlan(lead, job, f = planFacts(lead, job)) {
  const b = job.brief || {}; const fit = lead.investorFit || {};
  const venture = b.venture || b.company;
  const listed = b.listing === 'public' || b.round === 'public';
  const best = f.people.find((p) => /partner|principal|invest|managing director|cio/i.test(p.role || '')) || f.people.find((p) => p.role) || null;
  const deal = (fit.deals || [])[0];
  const instr = [...new Set([...(fit.deals || []).flatMap((d) => d.instruments || []), ...(fit.instruments || []).map((i) => i.instrument)])];
  const factId = (rx) => f.facts.find((x) => rx.test(x.text))?.id || null;
  const P = (text, basis = 'proposal', source = null) => ({ text, basis, ...(source ? { source } : {}) });
  return {
    objective: [P(`Get a first conversation to confirm whether ${lead.org} invests in ${listed ? 'listed' : 'private'} ${b.industry ? clip(b.industry.split(/[;,]/)[0], 40) : ''} companies like ${venture}, and through which instruments.`.replace(/\s+/g, ' '))],
    who: [best ? P(`${best.name}${best.role ? ` (${best.role})` : ''} — the only named person with a role related to investing; confirm the role is current.`, 'inference', factId(new RegExp(best.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))) : P(`No named person with a confirmed investment role was found. Use the organization's official channel and ask who reviews direct investments.`, 'fact', factId(/^Public channel/))],
    channel: [f.verifiedPaths ? P('A verified relationship path exists; ask that person first whether they are willing to introduce you (not established).', 'inference', factId(/^Verified relationship/)) : P('No verified introduction path: approach directly through the official channel or the contact found. This is a cold approach.', 'fact')],
    angle: [
      deal ? P(`Lead with ${deal.company}${deal.year ? ` (${deal.year})` : ''}: it is a documented deal in this space, so ${venture} can be presented as a comparable opportunity.`, 'inference', factId(new RegExp(deal.company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))) : P(`No comparable deal was found in the sources read; lead with the fit between ${lead.org}'s stated focus and ${venture}.`, 'inference', factId(/^Thesis|per its source/)),
      instr.length ? P(`Sources mention ${instr.join(', ')}. That shows past use, not that they would offer it to ${venture}.`, 'inference', factId(/Instrument|Deal reported/)) : P('No instrument (equity, PIPE, warrants, convertible) is documented for this investor; ask instead of assuming.', 'fact'),
    ],
    supportingDeals: (fit.deals || []).map((d) => P(`${d.company}${d.year ? ` · ${d.year}` : ''}${d.instruments?.length ? ` · ${d.instruments.join(', ')}` : ''}${d.amount ? ` · ${d.amount.value} ${d.amount.kind === 'round_size' ? '(round size, not their share)' : '(reported participation)'}` : ''}`, 'fact', factId(new RegExp(d.company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))))),
    materials: [P(listed ? 'Current investor deck and latest public filings (10-K/10-Q), cash position and planned use of proceeds.' : 'Pitch deck and data room basics: cap table, use of funds, milestones.'), P(`One page on ${b.product || 'the lead program'}: stage, data so far, next milestone and timing (only what is public or approved to share).`), ...(b.amount ? [] : [P('Decide a target amount and ticket range before the meeting; it is still unknown.', 'fact')])],
    draft: {
      subject: `${venture}${listed ? ' (listed)' : ''} — ${clip(b.oneLiner || b.industry || 'introduction', 70)}`,
      body: `Hello${best ? ` ${best.name.split(/\s+/)[0]}` : ''},\n\n${deal ? `I saw ${lead.org}'s involvement in ${deal.company}${deal.year ? ` (${deal.year})` : ''}.` : `I'm reaching out because ${lead.org}'s published focus overlaps with our work.`} ${venture} ${clip(b.oneLiner || b.description || '', 220)}.\n\nWould you be open to a short call to see whether this fits how you invest${listed ? ', including in listed companies' : ''}? I can send a one-page summary first.\n\n[Your name]`,
      basis: 'proposal', note: 'Draft only. Nothing is sent from the app. Review every claim before using it.',
    },
    followUp: [P('Suggested (product proposal, not an agreed cadence): one follow-up after about 7 business days with one new fact; then pause until there is news.')],
    conditions: [P('Continue if they confirm they invest directly in companies like yours and name a contact who decides.'), P('Postpone if timing or ticket size does not match yet; record the reason.'), P('Discard if they confirm they do not invest in listed companies / your stage, or only advise clients without investing directly.')],
    questions: [P('How do you invest in companies like ours: equity, PIPE, convertibles, warrants?'), P('What ticket size and ownership do you usually take, and do you lead or follow?'), P('Who makes the decision and what does your process look like after a first call?'), P('Which companies in your portfolio are closest to us?')],
    unknown: f.unknown, facts: f.facts, by: 'rules',
  };
}

const PLAN_SYSTEM = `You prepare an outreach plan for a company approaching one investor. Use ONLY the facts provided (each has an id like F3). Reply ONLY JSON:
{"objective":[item],"who":[item],"channel":[item],"angle":[item],"materials":[item],"draft":{"subject":string,"body":string},"followUp":[item],"conditions":[item],"questions":[item]}
item = {"text": string, "basis": "fact"|"inference"|"proposal", "source": "F#" or null}
Rules: "fact" items must cite a fact id and say only what that fact says. Anything you conclude is "inference". Recommendations are "proposal". Never claim interest, a relationship, willingness to introduce, terms or that an instrument would be offered. If no verified path exists, say the approach is direct (cold). A past instrument shows past use only. The draft is under 120 words, plain, specific to the facts, with no invented claims, and ends with a short question. Follow-up timing is a suggestion. English only.`;

/** Plan con el modelo del asistente; se valida contra los hechos. Si falla, plan por reglas con el motivo. */
export async function outreachPlan(lead, job, { env = process.env, fetchImpl = fetch } = {}) {
  const f = planFacts(lead, job);
  const base = rulePlan(lead, job, f);
  const t = intakeTargets(env)[0];
  if (!t) return { ...base, note: 'No AI model configured: plan built by rules from the sources.', createdAt: new Date().toISOString() };
  try {
    const r = await fetchImpl(`${t.base}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(t.apiKey ? { Authorization: `Bearer ${t.apiKey}` } : {}) },
      body: JSON.stringify({ model: t.model, temperature: 0.2, ...(t.jsonMode === false ? {} : { response_format: { type: 'json_object' } }), ...(t.reasoningEffort ? { reasoning_effort: t.reasoningEffort } : {}), max_tokens: Math.max(t.maxTokens || 0, 4000),
        messages: [{ role: 'system', content: PLAN_SYSTEM }, { role: 'user', content: JSON.stringify({ investor: { name: lead.org, person: lead.person, role: lead.role, tier: lead.investorFit?.tier, gaps: lead.investorFit?.gaps || [] }, facts: f.facts, unknown: f.unknown, verified_paths: f.verifiedPaths }) }] }),
      signal: AbortSignal.timeout(Number(env.INTAKE_LLM_TIMEOUT_MS) || 90_000),
    });
    if (!r.ok) throw new Error(`The model returned ${r.status}.`);
    const data = await r.json();
    const raw = String(data?.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').match(/\{[\s\S]*\}/)?.[0];
    if (!raw) throw new Error('The model did not return JSON.');
    const m = JSON.parse(raw);
    const ids = new Set(f.facts.map((x) => x.id));
    let removed = 0;
    const clean = (list) => (Array.isArray(list) ? list : []).map((x) => ({ text: clip(x?.text, 500), basis: ['fact', 'inference', 'proposal'].includes(x?.basis) ? x.basis : 'proposal', source: ids.has(x?.source) ? x.source : null }))
      .filter((x) => { if (!x.text || INVENTED.test(x.text)) { removed++; return false; } return true; })
      // Un «hecho» sin fuente, o con lectura interpretativa («showing interest», «aligning», «known contacts»), es una inferencia.
      .map((x) => (x.basis === 'fact' && (!x.source || INTERPRETIVE.test(x.text)) ? { ...x, basis: 'inference' } : x));
    const body = clip(m?.draft?.body, 1400);
    const draft = body && !INVENTED.test(body) ? { subject: clip(m.draft.subject, 140) || base.draft.subject, body: String(m.draft.body).slice(0, 1400), basis: 'proposal', note: base.draft.note } : base.draft;
    const pick = (k) => { const v = clean(m[k]); return v.length ? v : base[k]; };
    const conditions = clean(m.conditions);
    const questions = clean(m.questions);
    return { ...base, objective: pick('objective'), who: pick('who'), channel: pick('channel'), angle: pick('angle'), materials: pick('materials'), followUp: pick('followUp'), conditions: ['continue', 'postpone', 'discard'].every((w) => conditions.some((x) => new RegExp(`\\b${w}`, 'i').test(x.text))) ? conditions : base.conditions, questions: questions.length >= 3 ? questions : [...questions, ...base.questions].slice(0, 5), draft, by: t.model, removed, note: removed ? `${removed} statement(s) removed because they claimed interest, relationships or terms not in the sources.` : null, createdAt: new Date().toISOString() };
  } catch (e) {
    return { ...base, note: `AI model unavailable (${clip(e?.message || e, 120)}): plan built by rules from the sources.`, createdAt: new Date().toISOString() };
  }
}

/** «Find more investors like these»: rasgos con evidencia de los seleccionados → brief nuevo (la búsqueda verifica de nuevo). */
export function similarBrief(job, leads) {
  const b = job.brief || {};
  const orgs = leads.filter((l) => l.fundingType === 'investment');
  const types = [...new Set(orgs.map((l) => l.investorFit?.entity?.type).filter((t) => t && TYPE_LABEL[t] && !['funded_company', 'operating_company', 'wealth_adviser', 'investor', 'unknown'].includes(t)))];
  const instruments = [...new Set(orgs.flatMap((l) => (l.investorFit?.instruments || []).map((i) => i.instrument)))];
  const listed = orgs.some((l) => l.investorFit?.listed?.value === 'listed_evidence');
  const sectors = [...new Set(orgs.flatMap((l) => l.matchedTerms || []))].slice(0, 4);
  const features = [
    types.length ? `Investor type: ${types.map((t) => TYPE_LABEL[t]).join(', ')}` : 'Investor type: not established for the selection',
    sectors.length ? `Sector terms in their evidence: ${sectors.join(', ')}` : null,
    instruments.length ? `Instruments mentioned: ${instruments.join(', ')}` : null,
    listed ? 'Mentions listed-company financing' : null,
  ].filter(Boolean);
  const names = [...new Set(orgs.map((l) => l.org))].slice(0, 6);
  const brief = { ...b, investorTypes: types.length ? types.join(',') : b.investorTypes || '', investorTypesMode: b.investorTypesMode || 'prefer', similarTo: clip(`${names.join('; ')} | ${features.join(' | ')}`, 1500), exclusions: clip([b.exclusions, ...names].filter(Boolean).join(', '), 1000) };
  return { brief, features, seeds: names };
}
