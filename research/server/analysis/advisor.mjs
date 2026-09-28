// Agente asesor: lo que un consultor de fundraising agrega sobre la evaluación.
// 1) Reencuadra a cada persona (decisor, conector, plataforma, convocatoria) antes de recomendar.
// 2) Arma la lista corta de "inversionistas preferidos" (playbook de Alan: ~10, máximo 12).
// 3) Explota el warm path: qué conector abre más puertas y qué pedirle.
// 4) Nurturing: updates cada 4–6 meses, personalizados por destinatario y etapa de la relación.
// 5) Dice cuándo abrir la ronda (roadshow) y qué falta.
// El código decide; el modelo (flota vLLM) solo redacta, y cada texto se verifica contra los hechos.
import { randomUUID } from 'node:crypto';
import { chatJSON, fleetConfig } from './fleet.mjs';
import { fundId, personKey, normText } from './entities.mjs';
import { effectiveOutcome } from './outreach.mjs';

const ALAN = 'https://medium.com/alan/our-toolkit-to-raise-28-million-in-10-days-b40dc936084d';
const SUSTER = 'https://medium.com/both-sides-of-the-table/invest-in-lines-not-dots-611f36491d73';
/** Reglas del playbook con su fuente. Citas tomadas el 27-sep-2026 con una herramienta de lectura: verificar literal. */
export const PLAYBOOK = [
  { id: 'P1', rule: 'Update your preferred investors every 4–6 months, including on your market.', url: ALAN, quote: 'Nurture smart and close relationships with VC. Update every 4 to 6 months your preferred investors on your market.' },
  { id: 'P2', rule: 'Shortlist: about 10 funds, 12 max.', url: ALAN, quote: '12 is a maximum in my opinion if you want to keep your energy at the right place.' },
  { id: 'P3', rule: 'Only those who often invest in your geography, business and ticket.', url: ALAN, quote: "Don't waste time when they don't invest often in your geography, business or at other ticket sizes." },
  { id: 'P4', rule: 'Roadshow: same information to everyone at the same time.', url: ALAN, quote: 'Always be transparent, share information to everyone at the same time.' },
  { id: 'P5', rule: 'Meet them early: say you\'re not raising yet, but will in about 6 months.', url: SUSTER, quote: "Meet your potential investors early. Tell them you're not raising money yet but that you will be in the next 6 months or so." },
];
export const DEFAULT_CADENCE_DAYS = 120; // 4 meses (P1); el máximo recomendado es 180
const MAX_LIST = 12;

const FUNDISH = /\b(ventures?|capital|vc|partners|fund|fondo|invest\w*|gv|holdings|angels?|equity)\b|\.vc\b/i;
const PLATFORM = /\b(openvc|signal nfx|angellist|crunchbase|f6s|dealroom|pitchbook|gust)\b/i;
const DECIDER = /\b(general partner|managing partner|founding partner|partner|principal|managing director|head of investments?|investment director|director of investments?|investor|investments?|venture partner|associate|chief investment officer|program officer|program director|socio)\b/i;
const FOUNDER = /\b(co-?founder|founder|fundador|ceo)\b/i;
const IR = /\binvestor relations\b|\brelaci[oó]n con (los )?inversionistas\b/i;

const txt = (v) => String(v ?? '').trim();
const sameOrg = (a, b) => { const x = normText(a), y = normText(b); return Boolean(x && y && (x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `))); };
const ownOrgs = (brief) => [brief.company, brief.organization, brief.venture].map(txt).filter(Boolean);
export const leadKeyOf = (l) => l.key || l.id;
const who = (l) => (l.person ? `${l.person}${l.org ? ` (${l.org})` : ''}` : (l.org || l.title || 'Candidate'));

/** Reencuadre: qué papel juega cada persona en la ronda. Nunca asume que alguien invierte por aparecer en la lista. */
export function classifyLead(lead, brief) {
  const role = txt(lead.role), org = txt(lead.org), text = `${role} ${lead.title || ''}`;
  if (!lead.person || lead.kind === 'opportunity') return { cls: 'convocatoria', label: 'Call / program', reason: 'A call or organization without a named decision-maker: follow its formal process, not a warm path.' };
  if (ownOrgs(brief).some((o) => sameOrg(o, org))) return { cls: 'conector_interno', label: 'Internal connector', reason: IR.test(text) ? `Handles investor relations for ${org}: doesn't invest in ${brief.venture || brief.company}, but knows the investors and analysts who already follow ${org}.` : `Works at ${org}, your own organization: can introduce you, not invest.` };
  if (PLATFORM.test(org)) return { cls: 'plataforma', label: 'Platform or directory', reason: `${org} is a fundraising platform, not a fund: use it as a channel.` };
  if (IR.test(text)) return { cls: 'conector_externo', label: 'Investor relations (connector)', reason: `Handles investor relations for ${org}: knows investors but doesn't make investment decisions.` };
  if (DECIDER.test(text) || (FOUNDER.test(text) && FUNDISH.test(org))) return { cls: 'decisor', label: 'Decision-maker', reason: `Role with decision or recommendation power at ${org || 'the organization'}.` };
  if (!role && FUNDISH.test(org)) return { cls: 'decisor_por_confirmar', label: 'Decision-maker to confirm', reason: `Associated with ${org}, but the role isn't in the source: confirm before writing.` };
  if (FOUNDER.test(text)) return { cls: 'conector_externo', label: 'Founder (possible connector)', reason: `Founder at ${org || 'another company'}: more useful as a connector than an investor.` };
  return { cls: 'otro', label: 'Unclear role', reason: 'No evidence they decide investments or can introduce you.' };
}
const TARGET = new Set(['decisor', 'decisor_por_confirmar']);

const bestPath = (lead) => [...(lead.paths || [])].sort((a, b) => (b.strength || 0) - (a.strength || 0))[0] || null;
const weakest = (path) => (path?.hops?.length ? Math.min(...path.hops.map((h) => h.strength ?? 0)) : 0);

/** Warm path al revés: por cada conector, a cuántos decisores de la lista abre la puerta. */
export function connectorLeverage(leads, brief, classes) {
  const me = normText(brief.name);
  const map = new Map();
  const add = (name, data) => {
    const k = personKey(name);
    if (!k || normText(name) === me) return null;
    if (!map.has(k)) map.set(k, { key: k, name, targets: [], internal: false });
    const c = map.get(k);
    for (const [key, value] of Object.entries(data)) if (value !== undefined) c[key] = value;
    return c;
  };
  for (const lead of leads) {
    const cls = classes.get(leadKeyOf(lead));
    if (cls?.cls === 'conector_interno' || cls?.cls === 'conector_externo') add(lead.person, { internal: cls.cls === 'conector_interno', org: lead.org, role: lead.role, leadKey: leadKeyOf(lead), direct: (lead.paths || []).some((p) => p.hops?.length === 1) });
    if (!TARGET.has(cls?.cls)) continue;
    for (const path of lead.paths || []) {
      const hops = path.hops || [];
      if (hops.length < 2) continue;
      const first = hops[0], last = hops.at(-1);
      const c = add(first.to, {});
      if (!c || c.targets.some((t) => t.leadKey === leadKeyOf(lead))) continue;
      c.targets.push({ leadKey: leadKeyOf(lead), name: who(lead), toMe: first.strength ?? 0, toTarget: last.strength ?? 0, weakest: weakest(path), hypothesis: Boolean(path.hypothesis), relation: last.relation || '', url: last.url || first.url || null });
    }
  }
  return [...map.values()].map((c) => {
    c.targets.sort((a, b) => b.weakest - a.weakest);
    c.score = c.targets.reduce((s, t) => s + t.weakest, 0) + (c.internal ? 0.25 : 0);
    return c;
  }).sort((a, b) => b.targets.length - a.targets.length || b.score - a.score);
}

/** Estado de la relación con un destinatario a partir de los acercamientos registrados. */
export function relationshipState(lead, events, { now = new Date(), cadenceDays = DEFAULT_CADENCE_DAYS } = {}) {
  const pk = personKey(lead.person || ''), fk = fundId(lead.org || '');
  const mine = events.filter((e) => (e.leadKey && e.leadKey === leadKeyOf(lead)) || (pk && personKey(e.person || '') === pk) || (!e.person && fk && e.fundId === fk));
  const out = { touches: mine.length, updates: mine.filter((e) => e.channel === 'update').length, lastTouch: null, nextDue: null, replied: false, meeting: false, declined: false, stage: 'sin_contacto' };
  if (!mine.length) return out;
  const eff = mine.map((e) => effectiveOutcome(e, now));
  out.replied = eff.some((o) => ['pide_info', 'reunion', 'segunda_reunion', 'term_sheet'].includes(o));
  out.meeting = eff.some((o) => ['reunion', 'segunda_reunion', 'term_sheet'].includes(o));
  out.declined = eff.includes('negativa') && !out.meeting;
  out.lastTouch = mine.map((e) => e.sentAt).sort().at(-1);
  out.nextDue = new Date(Date.parse(out.lastTouch) + cadenceDays * 86400000).toISOString().slice(0, 10);
  out.stage = out.declined ? 'descartado' : out.meeting ? 'activo' : (out.updates >= 2 || out.replied) ? 'calentando' : 'en_lista';
  return out;
}
export const STAGE_LABEL = { sin_contacto: 'No contact', en_lista: 'On the update list', calentando: 'Warming up (sees a trend)', activo: 'Meeting in progress', descartado: 'Discarded' };

/** Lista corta de inversionistas preferidos (P2, P3). Devuelve también los excluidos con motivo. */
export function shortlist(leads, brief, classes, { max = MAX_LIST } = {}) {
  const wanted = new Set((brief.fundingTypes || []).map(String));
  const rows = [], excluded = [];
  for (const lead of leads) {
    const c = classes.get(leadKeyOf(lead));
    const reasonOut = !TARGET.has(c.cls) ? c.reason
      : lead.feedback === 'reject' || lead.feedback?.value === 'reject' ? 'You discarded it in the evaluation.'
      : wanted.size && lead.fundingType && !wanted.has(lead.fundingType) ? `Type ${lead.fundingType}, not what you asked for.` : '';
    if (reasonOut) { excluded.push({ leadKey: leadKeyOf(lead), name: who(lead), cls: c.cls, label: c.label, reason: reasonOut }); continue; }
    const p = bestPath(lead);
    const warm = p ? Math.round(weakest(p) * 100) : 0;
    rows.push({ leadKey: leadKeyOf(lead), name: who(lead), person: lead.person, org: lead.org, role: lead.role || null, cls: c.cls, label: c.label, reason: c.reason, score: lead.score ?? 0, warm, pathHops: p?.hops?.length || 0, hypothesis: Boolean(p?.hypothesis), priority: (lead.score ?? 0) + warm * 0.3 - (c.cls === 'decisor_por_confirmar' ? 8 : 0), evidence: (lead.evidence || []).filter((e) => e.verified !== false && e.url).slice(0, 2).map((e) => ({ url: e.url, quote: e.quote })) });
  }
  rows.sort((a, b) => b.priority - a.priority);
  const kept = rows.slice(0, max);
  for (const r of rows.slice(max)) excluded.push({ leadKey: r.leadKey, name: r.name, cls: r.cls, label: r.label, reason: `Beyond the max of ${max} (P2): lower priority.` });
  return { list: kept, excluded };
}

/** Siguiente jugada por destinatario según su etapa y su camino. */
export function nextMove(item, state, connectors, { raisingInMonths = null } = {}) {
  const via = connectors.find((c) => c.targets.some((t) => t.leadKey === item.leadKey));
  const t = via?.targets.find((x) => x.leadKey === item.leadKey);
  if (state.stage === 'descartado') return { kind: 'pausa', text: 'They said no. Remove until the next round; don\'t push.' };
  if (state.stage === 'activo') return { kind: 'reunion', text: 'Meeting set: prepare the brief and log the outcome.' };
  if (state.stage === 'sin_contacto') {
    if (via && t && t.weakest >= 0.5 && !t.hypothesis) return { kind: 'intro', via: via.name, text: `Ask ${via.name} for a double opt-in intro. Ask for advice and permission to send updates, not money (P5).` };
    if (via) return { kind: 'confirmar_conector', via: via.name, text: `First confirm with ${via.name} that they know ${item.person} and will introduce you (weakest link ${Math.round((t?.weakest || 0) * 100)} %${t?.hypothesis ? ', hypothesis' : ''}).` };
    return { kind: 'consejo_frio', text: `No warm path: a short first note via a public channel, with a specific question about their thesis and permission to send updates (P5).${item.cls === 'decisor_por_confirmar' ? ' Confirm their role first.' : ''}` };
  }
  if (state.stage === 'en_lista') return { kind: 'update', text: `Next update on ${state.nextDue} (van ${state.updates}). The second update turns a point into a line.` };
  return { kind: 'roadshow', text: raisingInMonths != null && raisingInMonths <= 1 ? 'Ready for the roadshow: same day as the rest of the list (P4).' : `Warm relationship. When you open the round, include them in the first wave (P4). Meanwhile, update on ${state.nextDue}.` };
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
/** Diagnóstico de consultor sobre la evaluación. Cada hallazgo dice si es verificado [V] o inferencia [I]. */
export function diagnose({ job, classes, list, excluded, connectors, network = [], updates = [], states }) {
  const brief = job.brief || {};
  const F = [];
  const add = (severity, tag, title, detail, leadKeys = []) => F.push({ id: `F${F.length + 1}`, severity, tag, title, detail, leadKeys });
  const top = [...(job.leads || [])].filter((l) => l.bucket === 'top').sort((a, b) => (a.rank || 99) - (b.rank || 99))[0];
  if (top) {
    const c = classes.get(leadKeyOf(top));
    if (!TARGET.has(c.cls)) add('alta', 'V', `The #1 recommendation isn't an investor: ${who(top)}`, `${c.label}. ${c.reason} Use them as a bridge, not a target.`, [leadKeyOf(top)]);
  }
  const plat = excluded.filter((e) => e.cls === 'plataforma');
  if (plat.length) add('media', 'V', `${plat.length} candidate(s) are from a platform, not a fund`, `${plat.map((p) => p.name).join(', ')}. Use them as a channel, not as investors.`, plat.map((p) => p.leadKey));
  const unconfirmed = list.filter((r) => r.cls === 'decisor_por_confirmar');
  if (unconfirmed.length) add('media', 'V', `${unconfirmed.length} of ${list.length} on the shortlist have no confirmed role`, `${unconfirmed.map((r) => r.name).join(', ')}. Writing without confirming the role burns the contact.`, unconfirmed.map((r) => r.leadKey));
  const withPath = list.filter((r) => r.pathHops > 0);
  add(withPath.length ? 'info' : 'alta', 'V', `Warm path for ${withPath.length} of ${list.length} of the shortlist`, withPath.length ? `The best weakest link is ${Math.max(...withPath.map((r) => r.warm))} %. ${withPath.filter((r) => r.hypothesis).length} path(s) are hypotheses: confirm with the connector before asking.` : 'Nobody on the list has a path: build one (updates) or borrow one (connectors in your organization).', withPath.map((r) => r.leadKey));
  const invContacts = network.filter((c) => (DECIDER.test(`${c.role || ''}`) && !IR.test(`${c.role || ''}`)) || (FUNDISH.test(`${c.org || ''}`) && !ownOrgs(brief).some((o) => sameOrg(o, c.org))));
  const fromCsv = network.filter((c) => !c.source || c.source === 'csv' || c.source === 'linkedin_csv').length;
  if (network.length) add(invContacts.length < 3 ? 'alta' : 'info', 'V', `Your network: ${network.length} contacts (${fromCsv} from Connections.csv), ${invContacts.length} at funds or in investment roles`, invContacts.length < 3 ? 'Your direct network barely reaches investors. The real lever is connectors and the relationship you build with updates.' : 'You have investment contacts: prioritize their intros.', []);
  if (connectors[0]) add('info', 'V', `Highest-leverage connector: ${connectors[0].name}`, `Opens the door to ${connectors[0].targets.length} listed decision-maker(s)${connectors[0].internal ? '; also in your organization' : ''}.`, connectors[0].targets.map((t) => t.leadKey));
  const irBridge = connectors.find((c) => c.internal && IR.test(`${c.role || ''}`));
  if (irBridge) add('alta', 'I', `Borrowed network: ${irBridge.name} handles investor relations for ${irBridge.org}`, `Your biggest warm path: the funds and analysts who already follow ${irBridge.org} know you by brand. Ask which of them look at digital health or wellness and who'd take a coffee with no ask. Reg FD: public information only about ${irBridge.org}.`, irBridge.leadKey ? [irBridge.leadKey] : []);
  const wanted = new Set(brief.fundingTypes || []);
  const offType = (job.leads || []).filter((l) => wanted.size && l.fundingType && !wanted.has(l.fundingType));
  if (offType.length) add('media', 'V', `${offType.length} of ${(job.leads || []).length} results are a type you didn't ask for`, `You asked for ${[...wanted].join(', ')}; got ${[...new Set(offType.map((l) => l.fundingType))].join(', ')}. They crowd the list.`, []);
  if (/no diagn[oó]stico|no terapia/i.test(brief.constraints || '') && offType.some((l) => /national institutes of health|centers for disease control/i.test(l.org || ''))) add('media', 'I', 'NIH/CDC calls conflict with your constraints', 'You declared "no diagnosis or therapy"; many NIH/CDC calls require clinical outcomes. Check before spending time.', []);
  const stage = normText(`${brief.stage || ''} ${brief.round || ''}`);
  if (/prototype|prototipo|idea/.test(stage) && Number(brief.amount) >= 1_000_000) add('media', 'I', `US$${Number(brief.amount).toLocaleString('es')} with a prototype: trend first, ask later`, 'With a prototype, sustained progress convinces. Send 2 metric updates before asking for a meeting (P1, P5).', []);
  if (!updates.length) add('alta', 'V', 'No updates logged', 'Without updates there\'s no trend. Fill in the first update here.', []);
  const reached = list.filter((r) => states.get(r.leadKey)?.stage !== 'sin_contacto').length;
  add('info', 'V', `Relationship started with ${reached} of ${list.length} of the list`, `${pct(reached, list.length)}% of the list has heard from you.`, []);
  if (/\bigc\b/i.test(`${brief.company} ${brief.organization}`)) add('info', 'I', 'Regulation FD: IGC Pharma is publicly listed', 'Updates carry only public facts about IGC, same info to everyone at once (P4). Mark anything non-public; the agent blocks it. Not legal advice.', []);
  return F;
}

/** ¿Listo para abrir la ronda? Checklist del playbook. */
export function readiness({ list, states, updates }) {
  const s = list.map((r) => states.get(r.leadKey) || { stage: 'sin_contacto', updates: 0 });
  const latest = updates[0];
  const num = (v) => Number(String(v).replace(/[^\d.-]/g, ''));
  const progress = Boolean(latest?.metrics?.some((m) => m.previous !== '' && Number.isFinite(num(m.value)) && Number.isFinite(num(m.previous)) && num(m.value) > num(m.previous)));
  const checks = [
    { ok: list.length >= 8 && list.length <= MAX_LIST, label: `Shortlist of 8–12 decision-makers (now ${list.length})`, rule: 'P2' },
    { ok: list.length > 0 && s.filter((x) => x.stage !== 'sin_contacto').length >= Math.ceil(list.length * 0.7), label: 'At least 70% of the list knows you', rule: 'P5' },
    { ok: list.length > 0 && s.filter((x) => x.updates >= 2 || x.stage === 'calentando' || x.stage === 'activo').length >= Math.ceil(list.length / 2), label: 'Half got 2+ updates or replied', rule: 'P1' },
    { ok: progress, label: 'The last update shows a rising metric', rule: 'P1' },
  ];
  return { ready: checks.every((c) => c.ok), checks };
}

/** Plan de las próximas semanas, con fechas, a partir del estado actual. */
export function actionPlan({ list, moves, connectors = [], now = new Date(), cadenceDays = DEFAULT_CADENCE_DAYS }) {
  const day = (d) => new Date(now.getTime() + d * 86400000).toISOString().slice(0, 10);
  const steps = [];
  const ir = (connectors || []).find((c) => c.internal && IR.test(`${c.role || ''}`));
  if (ir) steps.push({ when: `${day(0)} → ${day(10)}`, what: `Meeting with ${ir.name}: which investors at ${ir.org} look at digital health or wellness? Add until you have 8–12 decision-makers (P2), public info only (Reg FD).` });
  const confirm = list.filter((r) => r.cls === 'decisor_por_confirmar');
  if (confirm.length) steps.push({ when: `${day(0)} → ${day(7)}`, what: `Confirm the role of ${confirm.map((r) => r.person).join(', ')}.` });
  const byConn = new Map();
  for (const r of list) { const m = moves.get(r.leadKey); if (m?.via) { if (!byConn.has(m.via)) byConn.set(m.via, []); byConn.get(m.via).push(r.person); } }
  for (const [c, people] of byConn) steps.push({ when: `${day(0)} → ${day(14)}`, what: `Talk with ${c}: confirm the relationship and ask for a double opt-in intro to ${people.join(', ')}.` });
  const cold = list.filter((r) => moves.get(r.leadKey)?.kind === 'consejo_frio');
  if (cold.length) steps.push({ when: `${day(7)} → ${day(21)}`, what: `First contact, no money ask, with ${cold.map((r) => r.person).join(', ')} (P5).` });
  steps.push({ when: day(30), what: 'Update #1 to the whole list and connectors, same day (P4).' });
  steps.push({ when: day(30 + cadenceDays), what: 'Update #2. If a metric rose, this opens the door to a meeting.' });
  steps.push({ when: `after ${day(30 + cadenceDays)}`, what: 'If the roadshow checklist is complete: email the whole list the same day, meetings the week after (P4).' });
  return steps;
}

function rulesMemo(findings, list, connectors) {
  const headline = list.length
    ? `Work ${list.length} decision-makers as a relationship, not a mailing list${connectors[0] ? `; start with ${connectors[0].name}` : ''}.`
    : 'No confirmed decision-makers yet: the evaluation found connectors and calls, not investors.';
  const ordered = [...findings.filter((f) => f.severity === 'alta'), ...findings.filter((f) => f.severity === 'media'), ...findings.filter((f) => f.severity === 'info')];
  return { method: 'reglas', headline, paragraphs: ordered.slice(0, 5).map((f) => ({ text: `${f.title}. ${f.detail}`, refs: [f.id] })) };
}

/** Todo el análisis del asesor, determinista. */
export function analyzeJob(job, { events = [], network = [], updates = [], now = new Date(), cadenceDays = DEFAULT_CADENCE_DAYS, raisingInMonths = null } = {}) {
  const brief = job.brief || {};
  const leads = job.leads || [];
  const classes = new Map(leads.map((l) => [leadKeyOf(l), classifyLead(l, brief)]));
  const { list, excluded } = shortlist(leads, brief, classes);
  const connectors = connectorLeverage(leads, brief, classes);
  const states = new Map(leads.map((l) => [leadKeyOf(l), relationshipState(l, events, { now, cadenceDays })]));
  const raising = raisingInMonths ?? updates[0]?.raisingInMonths ?? null;
  const moves = new Map(list.map((r) => [r.leadKey, nextMove(r, states.get(r.leadKey), connectors, { raisingInMonths: raising })]));
  const findings = diagnose({ job, classes, list, excluded, connectors, network, updates, states });
  return {
    jobId: job.id, venture: brief.venture || brief.company, asOf: now.toISOString().slice(0, 10), cadenceDays,
    findings,
    list: list.map((r) => ({ ...r, state: states.get(r.leadKey), stageLabel: STAGE_LABEL[states.get(r.leadKey).stage], move: moves.get(r.leadKey) })),
    excluded,
    connectors: connectors.slice(0, 8).map((c) => ({ ...c, state: c.leadKey ? states.get(c.leadKey) : null })),
    readiness: readiness({ list, states, updates }),
    plan: actionPlan({ list, moves, connectors, now, cadenceDays }),
    playbook: PLAYBOOK,
    memo: rulesMemo(findings, list, connectors),
  };
}

/* ───────── Redacción con la flota (verificada) ───────── */
/** Modelo del asesor: ADVISOR_ROLE (chat por defecto) y, si se entrena, ADVISOR_MODEL = id del adaptador LoRA servido en ese puerto. */
export function advisorTarget(env = process.env) {
  const role = env.ADVISOR_ROLE || 'chat';
  const r = fleetConfig(env).roles[role] || { url: '', model: '' };
  const model = env.ADVISOR_MODEL || r.model;
  return { role, model: env.ADVISOR_MODEL || undefined, ready: Boolean(r.url && model) };
}
const numbersIn = (s) => (String(s).match(/\d+(?:[.,]\d+)*/g) || []).map((n) => n.replace(/[.,]/g, ''));
/** Todo número del texto generado tiene que existir en el material de entrada. */
export function unsupportedNumbers(text, source) {
  const allowed = new Set(numbersIn(source));
  return [...new Set(numbersIn(text))].filter((n) => !allowed.has(n) && n.length > 1);
}

export const MEMO_SYSTEM = `You are a fundraising advisor for digital health founders. You write clear, direct, brief English.
You receive precomputed findings (F1, F2…) and playbook rules (P1…P5).
Rules:
- Only state what's in the package. Each paragraph lists in "refs" the ids supporting it.
- Don't invent names, figures, funds, dates or relationships. If data is missing, say so.
- Talk about relationship and sequence: who first, through whom, what to ask and what not to ask yet.
- Never recommend asking for money without a relationship; recommend advice, permission for updates, or an intro.
- Max 5 paragraphs of 2–3 sentences.`;
export const MEMO_SCHEMA = { type: 'object', additionalProperties: false, required: ['headline', 'paragraphs'], properties: { headline: { type: 'string' }, paragraphs: { type: 'array', maxItems: 5, items: { type: 'object', additionalProperties: false, required: ['text', 'refs'], properties: { text: { type: 'string' }, refs: { type: 'array', items: { type: 'string' } } } } } } };

export function memoPack(a) {
  return JSON.stringify({ venture: a.venture, hallazgos: a.findings.map(({ id, tag, title, detail }) => ({ id, tag, title, detail })), lista_corta: a.list.map((r) => ({ nombre: r.name, papel: r.label, warm: r.warm, etapa: r.stageLabel, jugada: r.move?.text })), conectores: a.connectors.slice(0, 4).map((c) => ({ nombre: c.name, abre: c.targets.map((t) => t.name) })), roadshow: a.readiness.checks.map((c) => `${c.ok ? '✔' : '✖'} ${c.label}`), playbook: a.playbook.map(({ id, rule }) => ({ id, rule })) });
}

/** Memo narrativo con la flota; si el modelo cita ids inexistentes o inventa números, se descarta ese párrafo. */
export async function llmMemo(a, { env = process.env, fetcher = fetch } = {}) {
  const target = advisorTarget(env);
  if (!target.ready) return { ...a.memo, note: 'No fleet: rules memo.' };
  const pack = memoPack(a);
  try {
    const { json, model } = await chatJSON({ system: MEMO_SYSTEM, user: pack, schema: MEMO_SCHEMA, name: 'memo_asesor', temperature: 0.2, role: target.role, model: target.model }, { env, fetcher });
    const ids = new Set([...a.findings.map((f) => f.id), ...a.playbook.map((p) => p.id)]);
    const kept = [], dropped = [];
    for (const p of json.paragraphs || []) {
      const refsOk = Array.isArray(p.refs) && p.refs.length > 0 && p.refs.every((r) => ids.has(r));
      const bad = unsupportedNumbers(p.text, pack);
      (refsOk && !bad.length ? kept : dropped).push(p);
    }
    const headlineOk = !unsupportedNumbers(json.headline, pack).length;
    return { method: `fleet (${model})`, headline: headlineOk ? json.headline : a.memo.headline, paragraphs: kept.length ? kept : a.memo.paragraphs, dropped: dropped.length, input: pack, raw: json };
  } catch (e) { return { ...a.memo, note: `The fleet failed (${e.message}); rules memo.` }; }
}

/* ───────── Updates (nurturing) ───────── */
const items = (v, max = 8) => (Array.isArray(v) ? v : []).map((x) => (typeof x === 'string' ? { text: x, public: true } : x)).filter((x) => txt(x?.text)).slice(0, max).map((x) => ({ text: txt(x.text).slice(0, 400), public: x.public !== false }));
/** Valida el formulario del update. Solo estos hechos (y la evidencia pública del candidato) pueden aparecer en un update. */
export function validateUpdate(input, { userId = null, now = new Date().toISOString() } = {}) {
  if (!input || typeof input !== 'object') throw new Error('The update must be an object.');
  const period = txt(input.period).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(period)) throw new Error('Invalid period (YYYY-MM).');
  const metrics = (Array.isArray(input.metrics) ? input.metrics : []).slice(0, 6).map((m) => ({ name: txt(m?.name).slice(0, 80), value: txt(m?.value).slice(0, 40), previous: txt(m?.previous).slice(0, 40), unit: txt(m?.unit).slice(0, 20), public: m?.public !== false })).filter((m) => m.name && m.value);
  const raw = input.raisingInMonths;
  const u = { id: txt(input.id) || randomUUID(), userId, jobId: txt(input.jobId).slice(0, 80) || null, period, language: input.language === 'es' ? 'es' : 'en', tldr: txt(input.tldr).slice(0, 300), highlights: items(input.highlights), lowlights: items(input.lowlights, 4), market: items(input.market, 3), asks: items(input.asks, 4), nextMilestones: items(input.nextMilestones, 4), metrics, raisingInMonths: raw !== '' && raw !== null && raw !== undefined && Number.isFinite(Number(raw)) ? Math.max(0, Math.min(36, Number(raw))) : null, createdAt: txt(input.createdAt) || now, updatedAt: now };
  if (!u.highlights.length && !u.metrics.length) throw new Error('Include at least one milestone or metric.');
  return u;
}

/** Solo se usa una cita si toca el tema del brief y empieza en una palabra completa (no texto cortado de la página). */
export function relevantEvidence(evidence = [], brief = {}) {
  const words = normText(`${brief.industry || ''} ${brief.product || ''}`).split(' ').filter((w) => w.length > 4);
  for (const e of evidence || []) {
    const q = txt(e?.quote);
    if (!q || !e.url || !/^[A-Z0-9"“(]/.test(q)) continue;
    const nq = normText(q);
    if (words.some((w) => nq.includes(w))) return { url: e.url, quote: q.length > 160 ? `${q.slice(0, q.lastIndexOf(' ', 160))}…` : q };
  }
  return null;
}

const L = {
  es: { hi: 'Hola', tldr: 'En una línea', metrics: 'Métricas', wins: 'Avances', lows: 'Lo que no salió', market: 'Lo que vemos en el mercado', asks: 'En qué nos puedes ayudar', next: 'Próximos hitos', bye: 'Gracias por leer.', from: 'antes', or: ' o ', subject: (v, p) => `${v} · update ${p}`, notRaising: (m) => (m != null ? `No estamos levantando todavía; planeamos abrir la ronda en unos ${m} meses. Te escribo para que nos conozcas antes.` : 'No estamos levantando todavía. Te escribo para que nos conozcas antes.'), why: (org, q) => `Te incluyo por lo que vimos de ${org}: "${q}".`, keep: '¿Te parece bien si te sigo mandando un update breve cada pocos meses?', intro: (n) => `Una petición concreta: si ves encaje, ¿me presentarías a ${n}? Te puedo mandar un texto listo para reenviar.`, open: (m) => (m != null && m <= 1 ? 'Abrimos la ronda este mes y queremos compartirlo contigo al mismo tiempo que con el resto. ¿Tienes 20 minutos?' : null) },
  en: { hi: 'Hi', tldr: 'TL;DR', metrics: 'Metrics', wins: 'Wins', lows: 'Lowlights', market: 'What we see in the market', asks: 'How you can help', next: 'Next milestones', bye: 'Thanks for reading.', from: 'prev.', or: ' or ', subject: (v, p) => `${v} · update ${p}`, notRaising: (m) => (m != null ? `We're not raising yet; we plan to open the round in about ${m} months. I'm writing so you know us before then.` : "We're not raising yet. I'm writing so you know us before then."), why: (org, q) => `I'm including you because of what we saw from ${org}: "${q}".`, keep: 'Would it be ok to keep sending you a short update every few months?', intro: (n) => `One concrete ask: if you see a fit, would you introduce me to ${n}? I can send a forwardable blurb.`, open: (m) => (m != null && m <= 1 ? "We're opening the round this month and want to share it with you at the same time as everyone else. Do you have 20 minutes?" : null) },
};

/**
 * Update para un destinatario: master igual para todos (P4) + personalización + un pedido según la etapa.
 * Los hechos marcados como no públicos nunca salen; se listan en `withheld`.
 */
export function composeUpdate(update, recipient, { brief = {} } = {}) {
  const t = L[update.language] || L.en;
  const venture = brief.venture || brief.company || 'Our startup';
  const withheld = [];
  const pub = (arr) => arr.filter((x) => (x.public ? true : (withheld.push(x.text || x.name), false)));
  const metrics = pub(update.metrics).map((m) => `• ${m.name}: ${m.value}${m.unit ? ` ${m.unit}` : ''}${m.previous ? ` (${t.from}: ${m.previous})` : ''}`);
  const sec = (label, lines) => (lines.length ? { label, text: lines.join('\n') } : null);
  const master = [
    update.tldr ? { label: t.tldr, text: update.tldr } : null,
    sec(t.metrics, metrics),
    sec(t.wins, pub(update.highlights).map((x) => `• ${x.text}`)),
    sec(t.lows, pub(update.lowlights).map((x) => `• ${x.text}`)),
    sec(t.market, pub(update.market).map((x) => `• ${x.text}`)),
    sec(t.next, pub(update.nextMilestones).map((x) => `• ${x.text}`)),
    sec(t.asks, pub(update.asks).map((x) => `• ${x.text}`)),
  ].filter(Boolean);
  const personal = [];
  const r = recipient || {};
  if (r.type === 'connector') {
    const targets = (r.targets || []).slice(0, 2).map((x) => x.name);
    if (targets.length) personal.push({ label: 'Ask', text: t.intro(targets.join(t.or)), kind: 'pedido' });
  } else if (r.type === 'target') {
    const stage = r.state?.stage || 'sin_contacto';
    if (stage === 'sin_contacto' || stage === 'en_lista') personal.push({ label: 'Context', text: t.notRaising(update.raisingInMonths), kind: 'contexto' });
    const ev = relevantEvidence(r.evidence, brief);
    if (ev && r.org) personal.push({ label: 'Why you', text: t.why(r.org, ev.quote), url: ev.url, kind: 'porque', needsReview: true });
    const open = t.open(update.raisingInMonths);
    personal.push({ label: 'Ask', text: (stage === 'calentando' || stage === 'activo') && open ? open : t.keep, kind: 'pedido' });
  }
  const first = (r.person || r.name || '').split(/\s+/)[0] || '';
  const body = [`${t.hi}${first ? ` ${first}` : ''},`, ...personal.filter((p) => p.kind !== 'pedido').map((p) => p.text), ...master.map((s) => `${s.label}\n${s.text}`), ...personal.filter((p) => p.kind === 'pedido').map((p) => p.text), t.bye].join('\n\n');
  const warnings = [];
  if (withheld.length) warnings.push(`${withheld.length} item(s) marked non-public were left out: ${withheld.join('; ')}.`);
  if (/\bigc\b/i.test(`${brief.company} ${brief.organization}`)) warnings.push('IGC is publicly listed: send this update the same day to the whole list, with no material non-public info (Reg FD). Not legal advice.');
  if (personal.some((p) => p.needsReview)) warnings.push('Check the "Why you" line: it comes from a public page; confirm it\'s current.');
  return { subject: t.subject(venture, update.period), body, master, personal, withheld, warnings, method: 'plantilla', wordCount: body.split(/\s+/).length };
}

export const UPDATE_SYSTEM = `You are a founder's fundraising advisor. Rewrite an update to an investor or connector so it sounds human, brief and specific.
Strict rules:
- Use ONLY the facts in the draft. Don't add figures, dates, clients, names or achievements.
- Keep every figure exactly as is.
- Keep the intent of the final ask (advice, permission for updates, intro or meeting).
- Max 180 words. No marketing adjectives ("revolutionary", "disruptive").
- Same language as the draft.`;
export const UPDATE_SCHEMA = { type: 'object', additionalProperties: false, required: ['subject', 'body'], properties: { subject: { type: 'string' }, body: { type: 'string' } } };

/** Pulido con la flota. Se acepta solo si no aparecen números nuevos. */
export async function polishUpdate(draft, { env = process.env, fetcher = fetch } = {}) {
  const target = advisorTarget(env);
  if (!target.ready) return { ...draft, note: 'No fleet: template.' };
  const input = `Subject: ${draft.subject}\n\n${draft.body}`;
  try {
    const { json, model } = await chatJSON({ system: UPDATE_SYSTEM, user: input, schema: UPDATE_SCHEMA, name: 'update', temperature: 0.3, role: target.role, model: target.model }, { env, fetcher });
    const bad = unsupportedNumbers(`${json.subject} ${json.body}`, input);
    if (bad.length) return { ...draft, note: `The model added figures not in your data (${bad.join(', ')}); using the template.`, rejected: json, input };
    return { ...draft, subject: json.subject, body: json.body, method: `fleet (${model})`, template: draft.body, wordCount: json.body.split(/\s+/).length, input };
  } catch (e) { return { ...draft, note: `The fleet failed (${e.message}); template.` }; }
}

/** Intro de doble opt-in: pedido al conector + texto reenviable. Nunca escribe en nombre del conector. */
export function composeIntro({ connector, target, brief = {}, update = null, language = 'en' }) {
  const venture = brief.venture || brief.company || 'my startup';
  const one = brief.oneLiner || brief.product || '';
  const facts = update ? [...update.metrics.filter((m) => m.public).slice(0, 2).map((m) => `${m.name}: ${m.value}${m.unit ? ` ${m.unit}` : ''}`), ...update.highlights.filter((h) => h.public).slice(0, 1).map((h) => h.text)] : [];
  const firstC = (connector.name || '').split(/\s+/)[0];
  const ev = relevantEvidence(target.evidence, brief);
  if (language === 'en') return {
    ask: `Hi ${firstC},\n\nQuick ask: I'm building ${venture}${one ? ` (${one})` : ''}. I think ${target.person} at ${target.org} could be a good person to know before we raise.\n\nWould you be comfortable asking them if they're open to an intro? Only if it feels natural; no problem at all if not. A short blurb you can forward is below.\n\nThanks!`,
    forwardable: `${venture}${one ? `: ${one}` : ''}.${facts.length ? `\n${facts.map((f) => `• ${f}`).join('\n')}` : ''}\nNot raising yet: looking for advice from people who know the space${ev ? ` (${target.org} came up because: "${ev.quote}")` : ''}.`,
    rules: ['Double opt-in: the connector asks the investor first.', 'Never write on behalf of the connector.'],
  };
  return {
    ask: `Hola ${firstC},\n\nUna petición corta: estoy construyendo ${venture}${one ? ` (${one})` : ''} y creo que ${target.person} de ${target.org} es alguien a quien conviene conocer antes de levantar.\n\n¿Te sentirías cómodo preguntándole si está abierto a una intro? Solo si te resulta natural; si no, no pasa nada. Abajo te dejo un texto corto para reenviar.\n\n¡Gracias!`,
    forwardable: `${venture}${one ? `: ${one}` : ''}.${facts.length ? `\n${facts.map((f) => `• ${f}`).join('\n')}` : ''}\nNo estamos levantando todavía: buscamos consejo de gente que conoce el sector${ev ? ` (${target.org} apareció porque: "${ev.quote}")` : ''}.`,
    rules: ['Doble opt-in: el conector le pregunta primero al inversionista.', 'Nunca se escribe en nombre del conector.'],
  };
}
