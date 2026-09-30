/* ─────────────────────────────────────────────────────────────────────────────
   Modelo derivado de una evaluación. Todo sale de los contratos existentes
   (Job, Lead, paths, hops, evidence, breakdown, jev, run events, network graph).
   Nada de lo que se calcula aquí inventa evidencia: cuando un dato falta,
   se marca como faltante y se explica.
   ───────────────────────────────────────────────────────────────────────────── */
import type { NetworkGraphData } from '../accountApi';
import type { Evidence, Job, Lead, WarmPlan } from '../researchApi';
import type { LiveRunEvent } from '../liveRunModel';
import { classifySource, SOURCE_META, type SourceKey } from '../sources';

export type Confidence = 'alta' | 'media' | 'baja';
export const CONF_LABEL: Record<string, string> = { alta: 'High', media: 'Medium', baja: 'Low' };
export const CONF_RANK: Record<string, number> = { alta: 3, media: 2, baja: 1 };
export const BUCKET_LABEL: Record<string, string> = { top: 'Priority', radar: 'Radar', discarded: 'Discarded' };
export const BUCKET_PLURAL: Record<string, string> = { top: 'Priority', radar: 'Radar', discarded: 'Discarded' };
export const FACTOR_LABEL: Record<string, string> = {
  fit: 'Topic fit', type: 'Funding type', timing: 'Timing', path: 'Documented relationship (warm path)',
  contact: 'Contact channel', amountFit: 'Amount fit', mandate: 'No funding authority (academic PI)',
};
export const FACTOR_HELP: Record<string, string> = {
  fit: 'Share of sector terms found in the evidence (0–1).',
  type: '1 if the candidate\'s category matches what you seek; 0.15 if adjacent.',
  timing: 'Open with enough time: 1 · open, no date: 0.4 · recent activity: 0.6 · short deadline: 0.2 · unknown: 0.1 · closed: 0.',
  path: 'Best warm path strength (product of each hop).',
  contact: 'Public email: 1 · other public channel: 0.4 · none: 0.',
  amountFit: 'Published ceiling ≥ your target: 1 · lower: 0 · unknown: 0.3.',
  mandate: 'Fixed penalty in financial mode for researchers without an investment mandate.',
};
/** Pesos del motor determinista (research/server/research/core.mjs → evaluate). */
export const WEIGHTS: Record<'strategic' | 'financial', Record<string, number>> = {
  strategic: { fit: 35, type: 20, timing: 10, path: 30, contact: 5, amountFit: 0 },
  financial: { fit: 25, type: 25, timing: 25, path: 5, contact: 10, amountFit: 10 },
};
export const MODE_LABEL = { strategic: 'Relationships', financial: 'Funding and timing' } as const;

const norm = (s = '') => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export { norm };

/* ───────── Evidencia ───────── */
export const isDemoJob = (job: Job) => job.mode === 'demo' || job.leads.some((l) => l.demo);
/** Familia de fuente. En la demo ejecutiva se clasifica por el nombre del proveedor simulado. */
export function familyOf(e: Evidence, demo = false): SourceKey {
  return classifySource(e.source, demo ? e.url.replace(/example\.org/g, '') : e.url);
}
export const familyLabel = (k: SourceKey) => SOURCE_META[k].label;

/* ───────── Relaciones y caminos ───────── */
export type RelationKind = 'authenticated' | 'mutual' | 'public_interaction' | 'coauthorship' | 'same_org' | 'imported' | 'affiliation' | 'cold_channel' | 'other';
export const RELATION_LABEL: Record<RelationKind, string> = {
  authenticated: 'Confirmed direct connection',
  mutual: 'Confirmed mutual contact',
  public_interaction: 'Public interaction',
  coauthorship: 'Co-authorship / shared institution',
  same_org: 'Same organization / team',
  imported: 'Imported contact',
  affiliation: 'Affiliation (works at)',
  cold_channel: 'Public channel, no relationship',
  other: 'Documented relationship',
};
export function relationKind(text = ''): RelationKind {
  const t = norm(text);
  if (/primer grado|autenticad|first degree|first-degree|authenticated/.test(t)) return 'authenticated';
  if (/compartida|mutu|shared connection/.test(t)) return 'mutual';
  if (/interaccion|comentario|reaccion|interaction|comment|reaction/.test(t)) return 'public_interaction';
  if (/coautor|co-author|coauthor|afiliacion historica|past affiliation|coincidencia institucional|shared institution/.test(t)) return 'coauthorship';
  if (/misma empresa|same company|advisor|equipo|team/.test(t)) return 'same_org';
  if (/csv|export|importad|imported/.test(t)) return 'imported';
  return 'other';
}
/** Estado epistémico de una relación: qué tanto sabemos que existe. */
export type LinkStatus = 'verified' | 'documented' | 'hypothesis';
export const STATUS_LABEL: Record<LinkStatus, string> = { verified: 'Verified', documented: 'Documented · inferred closeness', hypothesis: 'Unverified hypothesis' };
export const STATUS_HELP: Record<LinkStatus, string> = {
  verified: 'An authenticated or primary source confirms the link.',
  documented: 'Evidence proves a fact (co-authorship, team, interaction), not trust for an intro.',
  hypothesis: 'No verifiable evidence of the link. Working hypothesis.',
};
const STATUS_RANK: Record<LinkStatus, number> = { verified: 3, documented: 2, hypothesis: 1 };

export type NormHop = {
  index: number; from: string; to: string; relation: string; strength: number; url: string | null;
  kind: RelationKind; status: LinkStatus; evidence: Evidence[]; verifiedCount: number;
  latest: string | null;
};
export type NormPath = {
  id: string; nodes: string[]; hops: NormHop[];
  /** Fuerza reportada por el motor (0–1). */
  strength: number;
  /** Producto de la fuerza de cada salto; se usa para auditar la fuerza reportada. */
  product: number;
  hypothesis: boolean; status: LinkStatus; weakest: NormHop; hopCount: number;
  /** Persona a quien pedir la introducción (null = relación directa). */
  introducer: string | null;
  evidenceCount: number;
};

/** Normaliza, fusiona duplicados (mismos nodos) y ordena los caminos de un candidato. */
export function pathsOf(lead: Lead): NormPath[] {
  const byNodes = new Map<string, Lead['paths'][number]>();
  for (const p of lead.paths || []) {
    const key = p.nodes.map(norm).join('>');
    const prev = byNodes.get(key);
    if (!prev) { byNodes.set(key, { ...p, hops: p.hops.map((h) => ({ ...h, evidenceIds: [...h.evidenceIds] })) }); continue; }
    prev.strength = Math.max(prev.strength, p.strength);
    prev.hypothesis = prev.hypothesis && p.hypothesis;
    p.hops.forEach((h, i) => { if (prev.hops[i]) prev.hops[i].evidenceIds = [...new Set([...prev.hops[i].evidenceIds, ...h.evidenceIds])]; });
  }
  const evidenceById = new Map(lead.evidence.map((e) => [e.id, e]));
  return [...byNodes.values()].map((p, pi) => {
    const hops: NormHop[] = p.hops.map((h, index) => {
      const ev = h.evidenceIds.map((id) => evidenceById.get(id)).filter(Boolean) as Evidence[];
      const verifiedCount = ev.filter((e) => e.verified).length;
      const kind = relationKind(h.relation);
      // Sin evidencia verificada → hipótesis. Camino no hipotético (sesión autenticada) → verificada.
      // Evidencia verificada de un hecho, pero cercanía no confirmada → documentada.
      const status: LinkStatus = !ev.length || !verifiedCount ? 'hypothesis' : !p.hypothesis ? 'verified' : 'documented';
      const latest = ev.map((e) => e.retrievedAt).sort().at(-1) || null;
      return { index, from: h.from, to: h.to, relation: h.relation, strength: h.strength, url: h.url, kind, status, evidence: ev, verifiedCount, latest };
    });
    const weakest = hops.reduce((a, b) => (b.strength < a.strength ? b : a), hops[0]);
    const status = hops.reduce<LinkStatus>((s, h) => (STATUS_RANK[h.status] < STATUS_RANK[s] ? h.status : s), 'verified');
    return {
      id: `${lead.id}:p${pi}`, nodes: p.nodes, hops, strength: p.strength,
      product: hops.reduce((n, h) => n * h.strength, 1), hypothesis: p.hypothesis, status, weakest,
      hopCount: hops.length, introducer: p.nodes.length > 2 ? p.nodes[1] : null,
      evidenceCount: new Set(hops.flatMap((h) => h.evidence.map((e) => e.id))).size,
    };
  }).filter((p) => p.hops.length).sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status] || b.strength - a.strength || a.hopCount - b.hopCount);
}
export const bestPath = (lead: Lead) => pathsOf(lead)[0] || null;

/* ───────── Warm path for every candidate ─────────
   The run attaches lead.warmPlan (server). Older runs and the demo get the same rule here:
   with no one in the network, the warm path is BUILT — advice first, then updates before the round. */
const addDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
export function warmPlanOf(lead: Lead): WarmPlan | null {
  if (lead.warmPlan) return lead.warmPlan;
  if (lead.bucket === 'discarded') return null;
  const first = (lead.person || '').split(' ')[0] || lead.org;
  const p = bestPath(lead);
  if (lead.fundingType === 'grant' || lead.kind === 'opportunity') return { route: 'program_officer', label: 'Talk to the program officer', built: false, cadenceDays: null, why: 'Grants are warmer when the program officer already knows your project before you submit.', steps: [{ when: addDays(0), what: 'Email the program officer a 5-line summary and one fit question.' }, { when: addDays(14), what: 'Adjust the aims to their answer.' }] };
  if (p?.introducer) return { route: 'intro', label: `Warm intro via ${p.introducer}`, built: true, via: p.introducer, cadenceDays: 90, why: `${p.introducer} connects you to ${first}.`, steps: [{ when: addDays(0), what: `Update ${p.introducer} and ask for a double opt-in intro.` }, { when: addDays(7), what: `Ask ${first} for feedback and permission to send updates.` }, { when: addDays(90), what: `Send ${first} your next update.` }] };
  if (p) return { route: 'direct', label: 'Direct relationship', built: true, cadenceDays: 90, why: `You already know ${first}.`, steps: [{ when: addDays(0), what: `Reconnect with ${first} with one specific question.` }, { when: addDays(90), what: 'Send your investor update.' }] };
  const angle = ANGLES.map((a) => ({ a, e: lead.evidence.find((e) => a.rx.test(e.quote || '')) })).find((x) => x.e);
  if (angle) return { route: angle.a.route, label: angle.a.label, built: false, cadenceDays: 90, updates: 2, hook: angle.a.hook, source: 'signals', evidence: { id: angle.e!.id, url: angle.e!.url, quote: (angle.e!.quote || '').slice(0, 240) }, why: angle.a.hook,
    steps: [...angle.a.steps(first).map((what, i) => ({ when: addDays(i * 7), what })), { when: addDays(90), what: 'Send your first investor update, referencing that first exchange.' }, { when: addDays(180), what: 'Update 2, then ask for a meeting when the round opens.' }] };
  const partner = lead.fundingType === 'partnering' || lead.fundingType === 'sponsorship';
  return { route: partner ? 'advice' : 'updates', label: partner ? 'Build it: advice first' : 'Build it: updates every 90 days', built: false, cadenceDays: 90, updates: 3, why: `No one in your network connects to ${lead.person || lead.org} yet. Build the relationship before the round.`,
    steps: [{ when: addDays(0), what: `Ask ${first} for feedback on one question (not money) and permission to send updates.` }, { when: addDays(90), what: 'First investor update: progress, one number, one ask.' }, { when: addDays(180), what: 'Update 2: show momentum.' }, { when: addDays(270), what: 'Update 3, then ask for a meeting when the round opens.' }] };
}
const ROUTE_SHORT: Record<string, string> = { updates: 'Build · updates', advice: 'Build · advice', program_officer: 'Program officer', portfolio_founder: 'Via a founder they backed', office_hours: 'Their open door', event: 'At an event', content: 'Via their content', thesis: 'Their thesis', research_link: 'Through the science', shared_affiliation: 'Shared affiliation', customer_or_partner: 'Customer / partner', co_investor: 'Via a co-investor', community: 'Their community' };
export const warmShort = (w: WarmPlan) => (w.route === 'updates' && w.cadenceDays ? `Build · updates /${w.cadenceDays}d` : ROUTE_SHORT[w.route] || w.label);
/* Same angles as the server (warmPlan.mjs): a concrete door found in the candidate's own evidence. */
const ANGLES: { route: string; rx: RegExp; label: string; hook: string; steps: (f: string) => string[] }[] = [
  { route: 'portfolio_founder', rx: /\b(portfolio|invested in|led the (?:seed|round|series)|backed|co-?led)\b/i, label: 'Via a founder they backed', hook: 'Founders they already funded are the most trusted intro a fund gets.', steps: (f) => ['Ask one founder from their portfolio for 15 minutes of fundraising advice.', `If it goes well, ask whether they'd mention you to ${f}.`] },
  { route: 'office_hours', rx: /\b(office hours|pitch us|applications? (?:are )?open|accelerator|fellowship|cohort|request for (?:startups|proposals)|open until|now accepting|call for (?:proposals|applications|pilots))\b/i, label: 'Use their open door', hook: 'They publicly invite founders in: a sanctioned entry.', steps: () => ['Apply to or book their office hours, tailored to what they say they look for.', 'Afterwards, ask permission to send updates.'] },
  { route: 'event', rx: /\b(conference|summit|panel|keynote|speaker|webinar|meetup|fireside|demo day)\b/i, label: 'Meet them at an event', hook: 'A sharp question at their talk is a natural first touch.', steps: (f) => [`Attend ${f}'s next talk and ask one sharp question tied to your space.`, 'Follow up within 48h with one data point of yours.'] },
  { route: 'content', rx: /\b(podcast|episode|newsletter|blog|substack|op-?ed|interview|article)\b/i, label: 'Engage with what they publish', hook: 'Answering their thinking with your data makes you memorable.', steps: (f) => [`Reply to ${f}'s most relevant piece with one insight or number (no ask).`, 'A week later, ask one question their piece left open.'] },
  { route: 'thesis', rx: /\b(thesis|we invest in|we (?:look|are looking) for|mandate|investment areas?)\b/i, label: 'Answer their published thesis', hook: 'Mirroring their own words shows fit before the first call.', steps: (f) => [`Write 4 lines to ${f} mapping you to their stated thesis; ask for feedback, not money.`] },
  { route: 'research_link', rx: /\b(co-?author|publication|paper|study|trial|investigator|lab)\b/i, label: 'Through the science', hook: 'Shared research is a peer-to-peer opener.', steps: (f) => [`Share with ${f} a result related to their work and ask for critique.`, 'If they engage, invite them to advise on the pilot.'] },
];

/* ───────── Recomendación operativa (regla determinista y explícita) ───────── */
export type NextAction = { kind: 'intro' | 'direct' | 'build' | 'cold' | 'research' | 'monitor' | 'skip' | 'apply'; label: string; detail: string; rule: string };
export function nextAction(lead: Lead): NextAction {
  const path = bestPath(lead);
  const gap = lead.missing.find((m) => !/elegibilidad geografica|geographic eligibility/i.test(norm(m))) || lead.missing[0];
  if (lead.bucket === 'discarded') return { kind: 'skip', label: lead.kind === 'opportunity' ? 'Don\'t apply' : 'Don\'t contact', detail: lead.discard || 'Discarded by rules or feedback.', rule: 'List = discarded' };
  // Convocatorias: se aplica en el portal oficial, no se escribe a nadie (salvo pregunta opcional al contacto publicado).
  const gp = lead.grantPlan;
  if (lead.kind === 'opportunity' && gp) {
    const a = gp.apply;
    const label = a?.verdict === 'not_feasible' ? `Next cycle${a.nextDeadline ? ` · ${a.nextDeadline}` : ''}` : a?.verdict === 'closed' ? 'Closed' : a?.portal ? `Apply on ${a.portal.name}` : 'Apply on the official page';
    return { kind: 'apply', label, detail: gp.nextAction, rule: 'Grant call → apply through the official portal' };
  }
  if (lead.bucket === 'radar') return { kind: 'monitor', label: 'Monitor', detail: radarReason(lead), rule: 'List = radar' };
  if (path && path.introducer) return { kind: 'intro', label: `Ask ${path.introducer} for an intro`, detail: `${path.hopCount} hops · weakest link ${Math.round(path.weakest.strength * 100)}% (${path.weakest.from} → ${path.weakest.to}). First confirm ${path.introducer} is willing to introduce you.`, rule: 'Priority + path with connector' };
  if (path) return { kind: 'direct', label: 'Reach out directly', detail: `1-hop relationship: ${path.hops[0].relation}.`, rule: 'Priority + direct relationship' };
  const plan = warmPlanOf(lead);
  if (plan && !plan.built) return { kind: 'build', label: plan.label, detail: plan.steps[0]?.what || plan.why, rule: 'Priority + no network path → build the warm path' };
  if (lead.contact) return { kind: 'cold', label: `Cold outreach (${lead.contact.type === 'email' ? 'public email' : lead.contact.type === 'linkedin' ? 'LinkedIn' : 'public channel'})`, detail: `No warm path. Before writing: ${gap || 'check mandate and fit'}.`, rule: 'Priority + no path + public channel' };
  return { kind: 'research', label: 'Finish research', detail: gap ? `Missing: ${gap}.` : 'Find the right person and channel.', rule: 'Priority + no path or channel' };
}
export function radarReason(lead: Lead): string {
  if (lead.jev && lead.missing.some((m) => /decision agent/i.test(m))) return lead.missing.find((m) => /decision agent/i.test(m))!;
  if (lead.status === 'closed') return 'Closed or past deadline: wait for the next cycle.';
  if (lead.status === 'forecasted') return 'Forecast, not open yet.';
  if (lead.kind === 'radar') return 'Radar source: future cycle or no open call.';
  if (lead.daysToDeadline != null) return `Closes in ${lead.daysToDeadline} days, under your minimum.`;
  return 'Timing doesn\'t meet your minimum.';
}

/* ───────── Salud de fuentes (desde los eventos estructurados del run) ───────── */
export type SourceState = 'ok' | 'empty' | 'error' | 'not_configured' | 'skipped' | 'running';
export const SOURCE_STATE_LABEL: Record<SourceState, string> = { ok: 'Ran', empty: 'No results', error: 'Failed', not_configured: 'Off', skipped: 'Skipped', running: 'Running' };
export type SourceHealthItem = {
  name: string; state: SourceState; results: number | null; durationMs: number | null; calls: number;
  failedCalls: number; messages: string[]; reason: string; fix: string | null; tech: string | null; consumesCredit: boolean;
};
const CREDIT = /people search|web reader|semantic search|web search|deep search|news search|answer search|page reader|decision agent|contact finder/i;
/* Lenguaje de negocio para el usuario; el detalle técnico (variable de entorno) queda aparte para el administrador. */
const KEY_FIX: [RegExp, string, string][] = [
  [/Semantic Search key/, 'Semantic web search is off for your org.', 'Semantic Search key in the server settings, then restart the research server.'],
  [/Web Search key/, 'Broad web search is off (optional: unverified leads only).', 'Web Search key in the server settings.'],
  [/Contact Finder key/, 'Email lookup is off for your org.', 'Contact Finder key in the server settings.'],
  [/Web Reader key/, 'People search is off for your org.', 'Web Reader key in the server settings; each run uses paid credit.'],
  [/People Search key/, 'People search is off for your org.', 'Older evaluation: used a previous people-search key (now Web Reader).'],
  [/Decision Agent key/, 'The AI second opinion is off.', 'Decision Agent key in the server settings.'],
];
const keyInfo = (msg: string) => KEY_FIX.find(([re]) => re.test(msg));
const fixFor = (msg: string) => (keyInfo(msg) ? 'Ask your admin to turn it on.' : null);
export const plainReason = (msg: string) => keyInfo(msg)?.[1] || msg;
export const techDetail = (msg: string) => keyInfo(msg)?.[2] || null;

export function sourceHealth(job: Job): SourceHealthItem[] {
  const events: LiveRunEvent[] = job.run?.events || [];
  const items = new Map<string, SourceHealthItem>();
  const get = (name: string) => {
    if (!items.has(name)) items.set(name, { name, state: 'running', results: null, durationMs: null, calls: 0, failedCalls: 0, messages: [], reason: '', fix: null, tech: null, consumesCredit: CREDIT.test(name) });
    return items.get(name)!;
  };
  if (events.length) {
    for (const e of events) {
      if (e.phase === 'planning' && e.status === 'pending' && /omitid|pendiente|skipped|pending/i.test(e.title + e.message)) {
        const name = e.provider || e.message.split(':')[0].trim();
        if (name === 'Decision Agent') continue;
        const it = get(name); it.state = 'not_configured'; it.reason = plainReason(e.message); it.fix = fixFor(e.message); it.tech = techDetail(e.message);
        continue;
      }
      if (!e.provider || e.provider === 'Decision Agent') continue;
      const it = get(e.provider);
      if (e.phase === 'api_request') it.calls++;
      if (e.phase === 'api_response' && (e.status === 'error' || ((e.detail as { httpStatus?: number } | undefined)?.httpStatus || 0) >= 400)) it.failedCalls++;
      if (e.phase === 'warning' || e.phase === 'error') it.messages.push(e.message);
      if (e.phase === 'source_completed') {
        it.results = e.resultCount ?? 0; it.durationMs = e.durationMs ?? null;
        it.state = e.status === 'error' ? 'error' : (e.resultCount || 0) > 0 ? 'ok' : 'empty';
        it.reason = e.message;
      }
    }
  } else {
    // Investigaciones anteriores al registro estructurado: se leen los mensajes legados.
    for (const e of job.events) {
      const name = e.message.split(':')[0].replace(/\s*\(.*\)$/, '').trim();
      if (!name || name.length > 40 || /^estrategia|^evaluando|^borradores|candidatos priorizados|^strategy|^evaluating|^drafts|candidates prioritized/i.test(name)) continue;
      const it = get(name);
      if (e.phase === 'configuration') { it.state = 'not_configured'; it.reason = plainReason(e.message); it.fix = fixFor(e.message); it.tech = techDetail(e.message); }
      else if (e.phase === 'warning') { it.state = it.state === 'ok' ? 'ok' : 'error'; it.messages.push(e.message); it.reason = e.message; }
      else if (e.phase === 'reading') { const n = Number(e.message.match(/(\d+) (?:candidatos|personas|candidates|people)/)?.[1] || 0); it.results = n; it.state = n ? 'ok' : 'empty'; it.reason = e.message; }
    }
  }
  for (const it of items.values()) if (it.state === 'running' && !['queued', 'running'].includes(job.status)) { it.state = it.messages.length ? 'error' : 'empty'; it.reason ||= it.messages[0] || 'The source didn\'t report completion.'; }
  for (const it of items.values()) if (it.state === 'error' && !it.reason) it.reason = it.messages[0] || 'Unspecified error.';
  return [...items.values()].filter((i) => i.name !== 'People Search' && i.name !== 'Web Reader').sort((a, b) => stateOrder(a.state) - stateOrder(b.state) || a.name.localeCompare(b.name));
}
const stateOrder = (s: SourceState) => ({ error: 0, not_configured: 1, empty: 2, running: 3, skipped: 4, ok: 5 })[s];

/* ───────── Apify: estado explicado (nunca un «0» aislado) ───────── */
export type ApifyStatus = {
  state: 'demo' | 'disabled' | 'not_configured' | 'no_eligible' | 'ran' | 'ran_empty' | 'error' | 'not_reached';
  headline: string; explanation: string; action: string | null; coverage: string; tech?: string | null;
  runs: number; items: number; people: number; durationMs: number | null; actors: string[]; creditUsed: boolean;
};
export function apifyStatus(job: Job): ApifyStatus {
  const PEOPLE_SRC = /people search|web reader/i;
  const events = (job.run?.events || []).filter((e) => e.provider === 'People Search' || e.provider === 'Web Reader' || PEOPLE_SRC.test(e.message));
  const people = job.leads.filter((l) => l.evidence.some((e) => PEOPLE_SRC.test(e.source))).length;
  const base = { runs: 0, items: 0, people, durationMs: null as number | null, actors: [] as string[], creditUsed: false,
    coverage: 'Finds the named decision-makers at each organization.' };
  if (job.mode === 'demo' && !job.run?.events.some((e) => e.provider === 'People Search' || e.provider === 'Web Reader')) return { ...base, state: 'demo', headline: 'Not run (demo)', explanation: 'The demo doesn\'t query external sources. No credit used.', action: null };
  if (!job.brief.useApify) return { ...base, state: 'disabled', headline: 'Off for this evaluation', explanation: 'People search was off to save credit.', action: 'Turn it on in Setup → Network.' };
  const legacy = job.events.filter((e) => PEOPLE_SRC.test(e.message));
  if (events.some((e) => /People Search key|Web Reader key/.test(e.message)) || legacy.some((e) => /People Search key|Web Reader key/.test(e.message))) return { ...base, state: 'not_configured', headline: 'Not run: turned off', explanation: 'People search is off for your org. No credit used.', action: 'Ask your admin to turn it on and run again.', tech: 'Web Reader key in the server settings' };
  const requests = events.filter((e) => e.phase === 'api_request');
  const responses = events.filter((e) => e.phase === 'api_response');
  const actors = [...new Set(requests.map((e) => e.message.match(/Actor ([\w./-]+)/)?.[1]).filter(Boolean) as string[])];
  const items = responses.reduce((n, e) => n + (e.resultCount || 0), 0);
  const completed = events.find((e) => e.phase === 'source_completed');
  const warn = events.find((e) => e.phase === 'warning');
  const stats = { ...base, runs: requests.length, items, actors, durationMs: completed?.durationMs ?? null, creditUsed: requests.length > 0 };
  if (warn || completed?.status === 'error') return { ...stats, state: 'error', headline: 'Failed during the run', explanation: `${warn?.message || completed?.message}. Other sources' results were kept.`, action: 'Run again; if it fails again, tell your admin.', tech: 'Check the Web Reader key and balance in the server settings' };
  if (events.some((e) => /Sin organizaciones|No eligible organizations|No organizations/i.test(e.title))) return { ...stats, state: 'no_eligible', headline: 'No eligible organizations', explanation: 'No public page returned organizations to search.', action: 'Widen sector or geography in Setup and run again.', tech: 'Limits: WEB_MAX_PAGES and WEB_MAX_PEOPLE' };
  if (completed) return (completed.resultCount || 0) > 0
    ? { ...stats, state: 'ran', headline: `${requests.length} ${requests.length === 1 ? 'run' : 'runs'} · ${items} records · ${people} people in candidates`, explanation: 'Read public pages and found named people with roles, quoting each page. Paid per use.', action: null, tech: 'Provider: Web Reader' }
    : { ...stats, state: 'ran_empty', headline: 'Ran with no results', explanation: `${requests.length} searches found no people. May have used credit.`, action: 'Adjust sector or target orgs and run again.', tech: 'Queries built from profile sector and stage' };
  if (legacy.length) { const ok = legacy.find((e) => e.phase === 'reading'); return ok ? { ...stats, state: 'ran', headline: ok.message, explanation: 'Older evaluation without call log.', action: null } : { ...stats, state: 'error', headline: 'Inconclusive', explanation: legacy.at(-1)!.message, action: null }; }
  return { ...stats, state: 'not_reached', headline: 'Didn\'t run', explanation: job.status === 'failed' ? 'The evaluation stopped before enrichment.' : 'No people-search calls recorded.', action: 'Run again with people search on.' };
}

/* ───────── Jev: capa de decisión estructurada ───────── */
export type JevStatus = { state: 'demo' | 'not_configured' | 'ran' | 'error' | 'no_candidates' | 'not_reached'; headline: string; explanation: string; action: string | null; tech?: string | null; decisions: number; routedToRadar: number; model: string | null; durationMs: number | null };
export function jevStatus(job: Job): JevStatus {
  const events = (job.run?.events || []).filter((e) => e.provider === 'Decision Agent');
  const withJev = job.leads.filter((l) => l.jev);
  const routed = withJev.filter((l) => l.bucket === 'radar' && l.missing.some((m) => /decision agent/i.test(m))).length;
  const base = { decisions: withJev.length, routedToRadar: routed, model: withJev[0]?.jev?.model || null, durationMs: events.find((e) => e.status === 'success')?.durationMs ?? null };
  if (withJev.length) return { ...base, state: 'ran', headline: `${withJev.length} reviewed · ${routed} sent to review`, explanation: 'The Decision Agent scores fit (0–4) and evidence sufficiency. It can only move a priority to radar.', action: null };
  const legacy = job.events.find((e) => /decision agent/i.test(e.message));
  if (job.mode === 'demo') return { ...base, state: 'demo', headline: 'Not run (demo)', explanation: 'The server demo doesn\'t call the Decision Agent.', action: null };
  if (events.some((e) => e.status === 'pending') || /Decision Agent key/.test(legacy?.message || '')) return { ...base, state: 'not_configured', headline: 'Off', explanation: 'Rules-only ranking. No AI model decided anything.', action: 'Optional: ask your admin to turn on the Decision Agent.', tech: 'Decision Agent key in the server settings' };
  const warn = events.find((e) => e.phase === 'warning') || (legacy?.phase === 'warning' ? legacy : null);
  if (warn) return { ...base, state: 'error', headline: 'Decision Agent didn\'t respond', explanation: `${warn.message}`, action: 'Retry; the rules ranking was kept.' };
  if (!job.leads.some((l) => l.bucket !== 'discarded')) return { ...base, state: 'no_candidates', headline: 'No eligible candidates', explanation: 'The Decision Agent only reviews active candidates.', action: null };
  return { ...base, state: 'not_reached', headline: 'No Decision Agent record', explanation: 'This evaluation left no decision-layer record.', action: null };
}

/* ───────── Resumen ejecutivo ───────── */
export type Summary = {
  total: number; buckets: Record<'top' | 'radar' | 'discarded', number>; active: number;
  actionable: number; actionableWithPerson: number;
  withPath: number; pathStatus: Record<LinkStatus, number>;
  evidence: { total: number; verified: number; urls: number; byFamily: { key: SourceKey; total: number; verified: number }[] };
  coverage: { key: string; label: string; count: number; of: number; help: string }[];
  confidence: Record<Confidence, number>; confidenceMedian: Confidence | null; confidenceRange: [Confidence, Confidence] | null;
  risks: { label: string; count: number; critical: boolean; leadIds: string[] }[]; criticalCount: number;
  durationMs: number | null; scoreRange: [number, number] | null;
};
const CONF_BY_RANK: Confidence[] = ['baja', 'baja', 'media', 'alta'];
export function summarize(job: Job): Summary {
  const demo = isDemoJob(job);
  const L = job.leads;
  const active = L.filter((l) => l.bucket !== 'discarded');
  const buckets = { top: 0, radar: 0, discarded: 0 } as Summary['buckets'];
  for (const l of L) if (l.bucket in buckets) buckets[l.bucket as keyof typeof buckets]++;
  const top = L.filter((l) => l.bucket === 'top');
  const pathStatus: Record<LinkStatus, number> = { verified: 0, documented: 0, hypothesis: 0 };
  let withPath = 0;
  for (const l of active) { const p = bestPath(l); if (p) { withPath++; pathStatus[p.status]++; } }
  const allEv = new Map<string, Evidence>();
  for (const l of L) for (const e of l.evidence) allEv.set(e.id, e);
  const fam = new Map<SourceKey, { total: number; verified: number }>();
  for (const e of allEv.values()) { const k = familyOf(e, demo); const f = fam.get(k) || { total: 0, verified: 0 }; f.total++; if (e.verified) f.verified++; fam.set(k, f); }
  const conf = { alta: 0, media: 0, baja: 0 } as Record<Confidence, number>;
  for (const l of active) conf[(l.confidence as Confidence) in conf ? (l.confidence as Confidence) : 'baja']++;
  const ranks = active.map((l) => CONF_RANK[l.confidence] || 1).sort((a, b) => a - b);
  const riskMap = new Map<string, { label: string; count: number; critical: boolean; leadIds: string[] }>();
  const addRisk = (label: string, critical: boolean, id: string) => { const r = riskMap.get(label) || { label, count: 0, critical, leadIds: [] }; r.count++; r.leadIds.push(id); riskMap.set(label, r); };
  for (const l of active) {
    if (l.risks.includes('competitor_conflict')) addRisk('Possible competitor', true, l.id);
    if (!l.evidence.some((e) => e.verified)) addRisk('No verified evidence', true, l.id);
    if (l.jev?.action === 'discard') addRisk('Decision Agent suggests discarding', true, l.id);
    if (l.bucket === 'top' && !l.person) addRisk('Priority without a named decision-maker', true, l.id);
    for (const r of l.risks) if (r !== 'competitor_conflict' && !r.startsWith('DEMO')) addRisk(r.replace(/: .*/, ''), false, l.id);
  }
  const risks = [...riskMap.values()].sort((a, b) => Number(b.critical) - Number(a.critical) || b.count - a.count);
  const end = job.finishedAt || job.run?.events.at(-1)?.at || null;
  const scores = active.map((l) => l.score);
  const verifiedLead = active.filter((l) => l.evidence.some((e) => e.verified)).length;
  return {
    total: L.length, buckets, active: active.length, actionable: top.length, actionableWithPerson: top.filter((l) => l.person).length,
    withPath, pathStatus,
    evidence: { total: allEv.size, verified: [...allEv.values()].filter((e) => e.verified).length, urls: new Set([...allEv.values()].map((e) => e.url)).size, byFamily: [...fam.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.total - a.total) },
    coverage: [
      { key: 'verified', label: '≥ 1 verified evidence', count: verifiedLead, of: active.length, help: 'Read at the original source (URL + quote + date).' },
      { key: 'person', label: 'Named person', count: active.filter((l) => l.person).length, of: active.length, help: 'Without a person there\'s nobody to be introduced to.' },
      { key: 'role', label: 'Confirmed role', count: active.filter((l) => l.role).length, of: active.length, help: 'The role shows mandate and authority.' },
      { key: 'multi', label: '≥ 2 source types', count: active.filter((l) => new Set(l.evidence.map((e) => familyOf(e, demo))).size >= 2).length, of: active.length, help: 'Two independent sources reduce single-source risk.' },
      { key: 'channel', label: 'Public channel', count: active.filter((l) => l.contact).length, of: active.length, help: 'Published email or profile; emails are never guessed.' },
      { key: 'path', label: 'Warm path', count: withPath, of: active.length, help: 'At least one evidenced path from you or your team.' },
    ],
    confidence: conf,
    confidenceMedian: ranks.length ? CONF_BY_RANK[ranks[Math.floor((ranks.length - 1) / 2)]] : null,
    confidenceRange: ranks.length ? [CONF_BY_RANK[ranks[0]], CONF_BY_RANK[ranks.at(-1)!]] : null,
    risks, criticalCount: risks.filter((r) => r.critical).reduce((n, r) => n + r.count, 0),
    durationMs: end ? Date.parse(end) - Date.parse(job.createdAt) : null,
    scoreRange: scores.length ? [Math.min(...scores), Math.max(...scores)] : null,
  };
}

/* Recomendación principal y siguientes acciones del sistema. */
export function headline(job: Job, s: Summary, apify: ApifyStatus, jev: JevStatus): { title: string; detail: string; lead: Lead | null; actions: { label: string; detail: string; leadId?: string; target?: 'network' | 'setup' | 'sources' }[] } {
  const top = job.leads.filter((l) => l.bucket === 'top').sort((a, b) => a.rank - b.rank);
  const first = top.find((l) => bestPath(l) && l.person) || top.find((l) => l.person) || top[0] || null;
  const actions: { label: string; detail: string; leadId?: string; target?: 'network' | 'setup' | 'sources' }[] = [];
  for (const l of top.slice(0, 3)) { const a = nextAction(l); actions.push({ label: `${a.label} · ${l.person || l.org}`, detail: a.detail, leadId: l.id }); }
  if (!s.withPath) actions.push({ label: 'Grow your network to find warm paths', detail: 'No candidate overlaps with your network. Try Analyze my LinkedIn.', target: 'network' });
  if (apify.state === 'not_configured' || apify.state === 'no_eligible') actions.push({ label: 'Turn on people search', detail: apify.action || apify.explanation, target: 'sources' });
  if (jev.state === 'not_configured') actions.push({ label: 'Turn on the AI second opinion (optional)', detail: 'Checks evidence before prioritizing.', target: 'sources' });
  if (!first) return { title: 'No actionable candidates', detail: s.total ? `${s.buckets.radar} on radar and ${s.buckets.discarded} discarded. Check failed sources or widen criteria.` : 'No source returned candidates.', lead: null, actions };
  const p = bestPath(first);
  const a = nextAction(first);
  return {
    title: `${a.label}${a.kind === 'intro' ? ` to reach ${first.person || first.org}` : a.kind === 'direct' || a.kind === 'cold' ? `: ${first.person || first.org}` : ` · ${first.person || first.org}`}`,
    detail: `${first.person ? `${first.role || 'Role not confirmed'} · ${first.org}. ` : ''}Priority ${first.score}/100 (#${first.rank} of ${s.buckets.top}) · confidence ${CONF_LABEL[first.confidence]?.toLowerCase() || first.confidence}${p ? ` · path ${STATUS_LABEL[p.status].toLowerCase()}, strength ${Math.round(p.strength * 100)}%` : ' · no warm path'}.`,
    lead: first, actions,
  };
}

/* ───────── Grafo de relaciones ───────── */
export type GKind = 'founder' | 'team' | 'contact' | 'intermediary' | 'candidate' | 'investor' | 'organization';
export const GKIND_LABEL: Record<GKind, string> = { founder: 'You', team: 'Team', contact: 'Contact', intermediary: 'Connector', candidate: 'Candidate', investor: 'Investor', organization: 'Organization' };
export type GNode = { id: string; label: string; sub: string; kind: GKind; leadId?: string; bucket?: string; score?: number; confidence?: string; url?: string | null; depth: number; isOrg?: boolean };
export type GEdgeType = 'verified' | 'documented' | 'hypothesis';
export type GEdge = {
  id: string; from: string; to: string; type: GEdgeType; rel: RelationKind; label: string; strength: number | null;
  source: string; date: string | null; evidence: Evidence[]; url: string | null; why: string; leadIds: string[];
};
export type Graph = { nodes: GNode[]; edges: GEdge[]; truncated: number; pathEdges: Map<string, { all: Set<string>; best: Set<string> }> };

const intro: Record<RelationKind, string> = {
  authenticated: 'Confirmed direct connection: you can reach out yourself.',
  mutual: 'Confirmed mutual contact: the natural connector.',
  public_interaction: 'Recent public interaction: a good icebreaker, not proof of closeness.',
  coauthorship: 'Co-authorship or shared institution: confirm it\'s current.',
  same_org: 'Same organization or team: an internal route.',
  imported: 'From your imported contacts: confirm identity first.',
  affiliation: 'Candidate affiliation: validates mandate.',
  cold_channel: 'No relationship: public channel only.',
  other: 'Documented by the listed source.',
};
export const introReason = (k: RelationKind) => intro[k];

export function buildGraph(job: Job, account: NetworkGraphData | null, opts: { limit: number; includeDiscarded: boolean; ensure?: string | null }): Graph {
  const demo = isDemoJob(job);
  const you = job.brief.name || 'You';
  const nodes = new Map<string, GNode>();
  const edges = new Map<string, GEdge>();
  const pathEdges: Graph['pathEdges'] = new Map();
  const personId = (name: string) => `p:${norm(name)}`;
  nodes.set('you', { id: 'you', label: you, sub: job.brief.role ? `${job.brief.role} · ${job.brief.organization || job.brief.company}` : job.brief.company, kind: 'founder', depth: 0 });
  const alias = new Map<string, string>([[norm(you), 'you']]);
  const idFor = (name: string) => alias.get(norm(name)) || personId(name);
  const teamNames = new Set<string>();
  for (const l of job.leads) for (const e of l.evidence) if (e.field === 'team') { const n = e.quote.replace(/^((advisor|prof\.?|professor|dr\.?|ceo|cso|cfo)\s+)+/i, ''); teamNames.add(norm(n.split('·')[0].trim())); }
  const addEdge = (e: Omit<GEdge, 'id'>) => {
    const id = `${e.from}>${e.to}`;
    const prev = edges.get(id);
    if (!prev) { edges.set(id, { ...e, id }); return; }
    const rank = { verified: 3, documented: 2, hypothesis: 1 };
    prev.evidence = [...new Map([...prev.evidence, ...e.evidence].map((x) => [x.id, x])).values()];
    prev.leadIds = [...new Set([...prev.leadIds, ...e.leadIds])];
    if (rank[e.type] > rank[prev.type]) { prev.type = e.type; prev.label = e.label; prev.rel = e.rel; prev.why = e.why; }
    prev.strength = Math.max(prev.strength ?? 0, e.strength ?? 0);
    prev.date = [prev.date, e.date].filter(Boolean).sort().at(-1) || null;
  };
  const pool = job.leads.filter((l) => opts.includeDiscarded || l.bucket !== 'discarded')
    .sort((a, b) => (a.bucket === b.bucket ? a.rank - b.rank : ['top', 'radar', 'discarded'].indexOf(a.bucket) - ['top', 'radar', 'discarded'].indexOf(b.bucket)));
  const shown = pool.slice(0, opts.limit);
  const forced = opts.ensure ? job.leads.find((l) => l.id === opts.ensure) : null;
  if (forced && !shown.includes(forced)) shown.push(forced);
  for (const l of shown) {
    const cid = `lead:${l.id}`;
    const investor = l.fundingType === 'investment' || /invest|partner|capital|ventures|fund/i.test(`${l.role || ''} ${l.org}`);
    nodes.set(cid, { id: cid, label: l.person || l.org, sub: l.person ? `${l.role || 'Role not confirmed'} · ${l.org}` : l.title, kind: investor ? 'investor' : 'candidate', isOrg: !l.person, leadId: l.id, bucket: l.bucket, score: l.score, confidence: l.confidence, url: l.contact?.type === 'linkedin' ? l.contact.value : null, depth: 2 });
    if (l.person) alias.set(norm(l.person), cid);
    if (l.person && l.org) {
      const oid = `org:${norm(l.org)}`;
      if (!nodes.has(oid)) nodes.set(oid, { id: oid, label: l.org, sub: 'Organization', kind: 'organization', depth: 3 });
      const ev = l.evidence.filter((e) => ['person', 'profile', 'title', 'role'].includes(e.field));
      addEdge({ from: cid, to: oid, type: ev.some((e) => e.verified) ? 'verified' : ev.length ? 'documented' : 'hypothesis', rel: 'affiliation', label: `Affiliation per ${ev[0] ? ev[0].source : 'the candidate source'}`, strength: null, source: ev[0]?.source || '—', date: ev.map((e) => e.retrievedAt).sort().at(-1) || null, evidence: ev, url: ev[0]?.url || null, why: intro.affiliation, leadIds: [l.id] });
    }
  }
  for (const l of shown) {
    const cid = `lead:${l.id}`;
    const paths = pathsOf(l);
    const record = { all: new Set<string>(), best: new Set<string>() };
    pathEdges.set(l.id, record);
    for (const [pi, p] of paths.entries()) {
      p.hops.forEach((h, i) => {
        const from = i === 0 ? 'you' : idFor(h.from);
        const to = i === p.hops.length - 1 ? cid : idFor(h.to);
        record.all.add(`${from}>${to}`); if (pi === 0) record.best.add(`${from}>${to}`);
        for (const [nid, name] of [[from, h.from], [to, h.to]] as const) if (!nodes.has(nid)) nodes.set(nid, { id: nid, label: name, sub: teamNames.has(norm(name)) ? 'Team / advisor' : 'Connector', kind: teamNames.has(norm(name)) ? 'team' : 'intermediary', depth: 1 });
        addEdge({ from, to, type: h.status === 'verified' ? 'verified' : h.status === 'documented' ? 'documented' : 'hypothesis', rel: h.kind, label: h.relation, strength: h.strength, source: h.evidence[0]?.source || 'Path engine', date: h.latest, evidence: h.evidence, url: h.url, why: intro[h.kind], leadIds: [l.id] });
      });
    }
    if (!paths.length && l.contact) record.all.add(`you>${cid}`);
    if (!paths.length && l.contact) addEdge({ from: 'you', to: cid, type: 'hypothesis', rel: 'cold_channel', label: `Public channel: ${l.contact.type === 'email' ? 'email' : l.contact.type === 'linkedin' ? 'LinkedIn' : l.contact.type}`, strength: null, source: l.contact.provenance, date: null, evidence: [], url: l.contact.type === 'email' ? null : l.contact.value, why: intro.cold_channel, leadIds: [l.id] });
  }
  if (account && !demo) {
    const acc = new Map<string, string>();
    for (const n of account.nodes) {
      if (n.id === account.ownerId) { acc.set(n.id, 'you'); continue; }
      const existing = alias.get(norm(n.label)) || (nodes.has(personId(n.label)) ? personId(n.label) : null);
      if (existing) { acc.set(n.id, existing); continue; }
      const id = `acc:${n.id}`; acc.set(n.id, id);
      nodes.set(id, { id, label: n.label, sub: n.subtitle || 'Contact', kind: 'contact', url: n.url, depth: 1 });
    }
    for (const e of account.edges) {
      const from = acc.get(e.from), to = acc.get(e.to);
      if (!from || !to) continue;
      const rel: RelationKind = e.kind === 'connected_1st' ? 'authenticated' : e.kind === 'mutual_connection' ? 'mutual' : e.kind === 'public_interaction' ? 'public_interaction' : 'imported';
      addEdge({ from, to, type: e.verified ? 'verified' : 'documented', rel, label: RELATION_LABEL[rel], strength: e.strength, source: e.source, date: account.updatedAt, evidence: [], url: e.evidenceUrl, why: intro[rel], leadIds: [] });
    }
  } else if (account && demo) {
    // En la demo, la red del founder viene dentro del mismo dataset ficticio.
    for (const n of account.nodes) if (n.id !== account.ownerId && !alias.has(norm(n.label)) && !nodes.has(personId(n.label))) nodes.set(personId(n.label), { id: personId(n.label), label: n.label, sub: n.subtitle, kind: n.kind === 'team' ? 'team' : 'contact', depth: 1 });
    const idOf = (id: string) => { if (id === account.ownerId) return 'you'; const n = account.nodes.find((x) => x.id === id); return n ? idFor(n.label) : null; };
    for (const e of account.edges) {
      const from = idOf(e.from), to = idOf(e.to); if (!from || !to || !nodes.has(from) || !nodes.has(to)) continue;
      const rel: RelationKind = e.kind === 'connected_1st' ? 'authenticated' : e.kind === 'mutual_connection' ? 'mutual' : e.kind === 'public_interaction' ? 'public_interaction' : e.kind === 'team' ? 'same_org' : 'imported';
      addEdge({ from, to, type: e.verified ? 'verified' : 'documented', rel, label: RELATION_LABEL[rel], strength: e.strength, source: e.source, date: account.updatedAt, evidence: [], url: e.evidenceUrl, why: intro[rel], leadIds: [] });
    }
  }
  return { pathEdges, nodes: [...nodes.values()], edges: [...edges.values()], truncated: Math.max(0, pool.length - shown.filter((l) => pool.includes(l)).length) };
}

/* ───────── Traza de decisión ───────── */
export type TraceNode = { id: string; label: string; value?: string; tone?: 'pos' | 'neg' | 'neutral' | 'warn'; note?: string; children?: TraceNode[] };
export function decisionTrace(lead: Lead, job: Job): TraceNode {
  const demo = isDemoJob(job);
  const mode = job.brief.mode === 'financial' ? 'financial' : 'strategic';
  const paths = pathsOf(lead);
  const best = paths[0] || null;
  const verified = lead.evidence.filter((e) => e.verified).length;
  const kinds = new Map<RelationKind, number>();
  for (const p of paths) for (const h of p.hops) kinds.set(h.kind, (kinds.get(h.kind) || 0) + 1);
  const fams = [...new Set(lead.evidence.map((e) => familyLabel(familyOf(e, demo))))];
  const rawSum = lead.breakdown.reduce((n, f) => n + f.points, 0);
  const penalty = verified ? 1 : 0.5;
  const factor = (key: string) => lead.breakdown.find((f) => f.factor === key);
  const val = (key: string) => { const f = factor(key); return f && f.max ? f.points / f.max : null; };
  const deadline = lead.deadline ? `${lead.deadline}${lead.daysToDeadline != null ? ` (${lead.daysToDeadline} days)` : ''}` : 'no published date';
  const bucketRule = lead.bucket === 'discarded' ? `Discarded: ${lead.discard}` : lead.bucket === 'radar' ? `Radar: ${radarReason(lead)}` : 'Priority: no exclusion or radar rule applies.';
  const j = lead.jev;
  const action = nextAction(lead);
  return {
    id: 'root', label: `Decision: ${BUCKET_LABEL[lead.bucket] || lead.bucket} · #${lead.rank}`, value: `${lead.score}/100`, tone: lead.bucket === 'top' ? 'pos' : lead.bucket === 'radar' ? 'warn' : 'neg',
    children: [
      { id: 'ev', label: 'Evidence', value: `${lead.evidence.length} pieces · ${verified} verified`, note: `Sources: ${fams.join(', ') || 'none'}`, children: [
        { id: 'ev-direct', label: 'Documented direct relationship', value: String((kinds.get('authenticated') || 0) + (kinds.get('mutual') || 0)), tone: (kinds.get('authenticated') || kinds.get('mutual')) ? 'pos' : 'neutral' },
        { id: 'ev-org', label: 'Shared organization', value: String(kinds.get('same_org') || 0), tone: kinds.get('same_org') ? 'pos' : 'neutral' },
        { id: 'ev-pub', label: 'Public interaction', value: String(kinds.get('public_interaction') || 0), tone: kinds.get('public_interaction') ? 'pos' : 'neutral' },
        { id: 'ev-inst', label: 'Shared institution / co-authorship', value: String(kinds.get('coauthorship') || 0), tone: kinds.get('coauthorship') ? 'pos' : 'neutral' },
        { id: 'ev-id', label: 'Identity, role or opportunity', value: String(lead.evidence.filter((e) => ['person', 'profile', 'title', 'opportunity', 'work', 'role'].includes(e.field)).length), note: lead.person ? `Person: ${lead.person}` : 'No named person' },
      ] },
      { id: 'rules', label: 'Deterministic rules', value: `Σ ${rawSum.toFixed(1)} × ${penalty} = ${lead.score}`, note: `Mode ${MODE_LABEL[mode].toLowerCase()}: weights ${Object.entries(WEIGHTS[mode]).filter(([, w]) => w).map(([k, w]) => `${FACTOR_LABEL[k].split(' (')[0].toLowerCase()} ${w}`).join(' · ')}`, children: [
        { id: 'r-time', label: 'Timing', value: val('timing') == null ? '—' : `${(val('timing')!).toFixed(2)} → ${factor('timing')!.points} pts`, note: `Status ${lead.status}; closes ${deadline}; minimum ${job.brief.minDays} days.`, tone: (val('timing') || 0) >= 0.6 ? 'pos' : 'neg' },
        { id: 'r-str', label: 'Path strength', value: best ? `${best.strength.toFixed(3)} → ${factor('path')?.points ?? 0} pts` : '0 → 0 pts', note: best ? `Π hops = ${best.hops.map((h) => h.strength.toFixed(2)).join(' × ')} = ${best.product.toFixed(3)}` : 'No documented path: this factor adds 0.', tone: best ? 'pos' : 'neg' },
        { id: 'r-hops', label: 'Hops', value: best ? String(best.hopCount) : '—', note: best ? 'Each hop multiplies strength by ≤ 1.' : 'N/A.' },
        { id: 'r-cov', label: 'Evidence coverage', value: `× ${penalty}`, note: verified ? 'At least one verified piece: no penalty.' : 'No verified evidence: score × 0.5 and discarded.', tone: verified ? 'pos' : 'neg' },
        ...lead.breakdown.filter((f) => !['timing', 'path'].includes(f.factor) && (f.max || f.points)).map((f) => ({ id: `r-${f.factor}`, label: FACTOR_LABEL[f.factor] || f.factor, value: f.max ? `${(f.points / f.max).toFixed(2)} × ${f.max} = ${f.points} pts` : `${f.points} pts`, note: FACTOR_HELP[f.factor], tone: (f.points < 0 ? 'neg' : f.max && f.points / f.max >= 0.5 ? 'pos' : 'neutral') as TraceNode['tone'] })),
        { id: 'r-bucket', label: 'List rule', value: BUCKET_LABEL[lead.bucket], note: bucketRule, tone: lead.bucket === 'top' ? 'pos' : 'warn' },
      ] },
      j ? { id: 'jev', label: 'Decision Agent review', value: `${j.action === 'prioritize' ? 'Prioritize' : j.action === 'investigate_more' ? 'Dig deeper' : 'Review to discard'} · ${Math.round(j.actionConfidence * 100)}%`, note: `Model ${j.model}. Action probabilities, not investment odds.`, children: [
        { id: 'j-pos', label: 'Positive signals', value: [j.strategicFit >= 3 ? `fit ${j.strategicFit.toFixed(1)}/4` : '', j.evidenceSufficient >= 0.65 ? `enough evidence ${Math.round(j.evidenceSufficient * 100)}%` : ''].filter(Boolean).join(' · ') || 'none strong', tone: 'pos' },
        { id: 'j-neg', label: 'Negative signals', value: [j.strategicFit < 2 ? `fit ${j.strategicFit.toFixed(1)}/4` : '', j.evidenceSufficient < 0.65 ? `insufficient evidence ${Math.round(j.evidenceSufficient * 100)}% (< 65 %)` : '', j.actionConfidence < 0.55 ? `confidence ${Math.round(j.actionConfidence * 100)}% (< 55 %)` : ''].filter(Boolean).join(' · ') || 'none', tone: 'neg' },
        { id: 'j-risk', label: 'Risks', value: String(lead.risks.length), note: lead.risks.map((r) => (r === 'competitor_conflict' ? 'possible competitor' : r)).join(' · ') || 'No risks.' },
        { id: 'j-unc', label: 'Uncertainty', value: Object.entries(j.actionProbabilities).map(([k, v]) => `${k === 'prioritize' ? 'prioritize' : k === 'investigate_more' ? 'dig deeper' : 'discard'} ${Math.round(v * 100)}%`).join(' · ') || '—', note: 'Routing: if Jev asks to dig deeper or discard, or confidence < 55% or evidence < 65%, a priority moves to radar.' },
      ] } : { id: 'jev', label: 'Decision Agent review', value: 'Not run', tone: 'neutral', note: jevStatus(job).explanation },
      { id: 'out', label: 'Result', value: action.label, tone: lead.bucket === 'top' ? 'pos' : 'warn', children: [
        { id: 'o-path', label: 'Recommended path', value: best ? best.nodes.join(' → ') : 'None', note: best ? `${STATUS_LABEL[best.status]} · strength ${Math.round(best.strength * 100)}% · weakest link ${Math.round(best.weakest.strength * 100)}%` : 'No documented relationship.' },
        { id: 'o-alt', label: 'Alternatives', value: String(Math.max(0, paths.length - 1)), note: paths.slice(1).map((p) => `${p.nodes.join(' → ')} (${Math.round(p.strength * 100)}%)`).join(' · ') || 'No alternatives.' },
        { id: 'o-act', label: 'Proposed action', value: action.label, note: `${action.detail} Rule: ${action.rule}.` },
      ] },
    ],
  };
}

/** Contribuciones ordenadas para el nivel 2 de la explicación ejecutiva. */
export function contributions(lead: Lead) {
  const verified = lead.evidence.some((e) => e.verified);
  const penalty = verified ? 1 : 0.5;
  return {
    penalty,
    items: lead.breakdown.filter((f) => f.max || f.points).map((f) => ({ key: f.factor, label: FACTOR_LABEL[f.factor] || f.factor, points: f.points, max: f.max, missed: Math.max(0, f.max - f.points), value: f.max ? f.points / f.max : null }))
      .sort((a, b) => b.points - a.points),
  };
}
export function oneLiner(lead: Lead, job: Job) {
  const p = bestPath(lead);
  const a = nextAction(lead);
  const top = [...lead.breakdown].sort((x, y) => y.points - x.points)[0];
  return `${lead.person || lead.org} is ${BUCKET_LABEL[lead.bucket]?.toLowerCase()} (#${lead.rank}) with priority ${lead.score}/100, driven mostly by ${FACTOR_LABEL[top?.factor || '']?.toLowerCase() || 'its factors'}; data confidence ${CONF_LABEL[lead.confidence]?.toLowerCase() || lead.confidence}; ${p ? `${STATUS_LABEL[p.status].toLowerCase()} path of ${p.hopCount} ${p.hopCount === 1 ? 'hop' : 'hops'}` : 'no warm path'}. Next step: ${a.label.toLowerCase()}.${isDemoJob(job) ? ' (Demo data.)' : ''}`;
}
