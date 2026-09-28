// Pilar B (resultados propios) y C (resultados de la red) + Módulo 6 (aprender del uso).
// Cada acercamiento es un evento: a quién, por dónde, con qué argumento, con qué mensaje, y su resultado.
// Nada se envía desde la app: el fundador registra lo que ya hizo (o lo importa de su hoja de outreach).
import { randomUUID } from 'node:crypto';
import { fundId } from './entities.mjs';
import { betaSample, rateInterval, seeded } from './stats.mjs';

export const CHANNELS = { cold_email: 'Cold email', intro_portafolio: 'Portfolio founder intro', intro_coinversor: 'Co-investor intro', intro_advisor: 'Advisor intro', evento: 'Event', convocatoria: 'Call response', update: 'Periodic update', pedido_consejo: 'Advice ask (no money)', otro: 'Other' };
export const ARGUMENTS = { traccion: 'Traction', equipo: 'Team', dato_clinico: 'Clinical data', grant_previo: 'Prior grant', mercado: 'Market size', tesis_fondo: 'Fit with the fund\'s thesis', otro: 'Other' };
export const OUTCOMES = ['enviado', 'sin_respuesta', 'negativa', 'pide_info', 'reunion', 'segunda_reunion', 'term_sheet'];
export const OUTCOME_LABEL = { enviado: 'Sent', sin_respuesta: 'No reply', negativa: 'Declined', pide_info: 'Asked for info', reunion: 'Meeting', segunda_reunion: 'Second meeting', term_sheet: 'Term sheet or grant' };
export const PERSON_TYPES = ['partner', 'principal', 'bd', 'program_officer', 'otro'];
const REPLIED = new Set(['negativa', 'pide_info', 'reunion', 'segunda_reunion', 'term_sheet']);
const MEETING = new Set(['reunion', 'segunda_reunion', 'term_sheet']);
const NO_REPLY_DAYS = 14;

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
/** Valida y normaliza un evento de acercamiento. Lanza Error con mensaje en español. */
export function validateOutreach(input, { userId = null, now = new Date().toISOString(), existing = null } = {}) {
  if (!input || typeof input !== 'object') throw new Error('Outreach must be an object.');
  const fundName = str(input.fundName ?? existing?.fundName);
  if (!fundName) throw new Error('Missing fund or organization.');
  const channel = input.channel ?? existing?.channel;
  if (!CHANNELS[channel]) throw new Error('Invalid channel.');
  const args = Array.isArray(input.arguments ?? existing?.arguments) ? [...new Set(input.arguments ?? existing.arguments)] : [];
  if (args.some((a) => !ARGUMENTS[a])) throw new Error('Invalid argument.');
  const outcome = input.outcome ?? existing?.outcome ?? 'enviado';
  if (!OUTCOMES.includes(outcome)) throw new Error('Invalid result.');
  const personType = input.personType ?? existing?.personType ?? null;
  if (personType && !PERSON_TYPES.includes(personType)) throw new Error('Invalid person type.');
  const sentAt = str(input.sentAt ?? existing?.sentAt, 30) || now.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}/.test(sentAt)) throw new Error('Invalid send date (YYYY-MM-DD).');
  return {
    id: existing?.id || randomUUID(),
    userId,
    fundName,
    fundId: fundId(fundName),
    fundType: str(input.fundType ?? existing?.fundType, 40) || null,
    person: str(input.person ?? existing?.person) || null,
    personType,
    channel,
    arguments: args,
    variant: str(input.variant ?? existing?.variant, 60) || null,
    subjectLength: Number.isFinite(input.subjectLength) ? input.subjectLength : existing?.subjectLength ?? null,
    sector: str(input.sector ?? existing?.sector, 60) || null,
    stage: str(input.stage ?? existing?.stage, 30) || null,
    sentAt,
    outcome,
    outcomeAt: outcome !== (existing?.outcome ?? 'enviado') ? now : existing?.outcomeAt ?? null,
    shared: Boolean(input.shared ?? existing?.shared ?? false),
    note: str(input.note ?? existing?.note, 1000),
    leadKey: str(input.leadKey ?? existing?.leadKey, 200) || null,
    jobId: str(input.jobId ?? existing?.jobId, 80) || null,
    updatedAt: now,
  };
}

/** 'enviado' sin cambio tras 14 días cuenta como sin respuesta. */
export const effectiveOutcome = (e, now = new Date()) => e.outcome === 'enviado' && (now - Date.parse(e.sentAt)) / 86400000 >= NO_REPLY_DAYS ? 'sin_respuesta' : e.outcome;

/** Tablero descriptivo del pilar B: respuestas y reuniones por dimensión, con tamaño de muestra y rango. */
export function summarizeOutreach(events, { by = 'channel', now = new Date() } = {}) {
  const groups = new Map();
  const keyOf = (e) => by === 'argument' ? (e.arguments.length ? e.arguments : ['sin_etiqueta']) : [e[by] || 'sin_dato'];
  const closed = events.map((e) => ({ ...e, eff: effectiveOutcome(e, now) })).filter((e) => e.eff !== 'enviado');
  for (const e of closed) for (const k of keyOf(e)) {
    if (!groups.has(k)) groups.set(k, { key: k, n: 0, replies: 0, meetings: 0 });
    const g = groups.get(k); g.n++; if (REPLIED.has(e.eff)) g.replies++; if (MEETING.has(e.eff)) g.meetings++;
  }
  const label = by === 'channel' ? CHANNELS : by === 'argument' ? ARGUMENTS : {};
  const rows = [...groups.values()].map((g) => ({ ...g, label: label[g.key] || g.key, replyRate: rateInterval(g.replies, g.n), meetingRate: rateInterval(g.meetings, g.n) })).sort((a, b) => b.meetingRate.mean - a.meetingRate.mean || b.n - a.n);
  const total = closed.length;
  const stage = total < 50 ? 'descriptivo' : 'modelo';
  return { by, total, pending: events.length - total, stage, note: stage === 'descriptivo' ? `With ${total} closed outreach rows we show counts and ranges; a P(meeting) model needs ~50+.` : 'Enough data to fit a model (hierarchical regression); see backend/ml.', rows };
}

/**
 * Pilar C: agregados de la red por fondo, solo con eventos compartidos (opt-in) y con al menos
 * `minFounders` fundadores distintos por celda. Nunca revela quién contactó a quién, textos ni fechas exactas.
 */
export function networkAggregate(sharedEvents, { fund = null, sector = null, stage = null, minFounders = 3, now = new Date() } = {}) {
  const rows = sharedEvents.filter((e) => e.shared && (!fund || e.fundId === fundId(fund)) && (!sector || e.sector === sector) && (!stage || e.stage === stage));
  const cells = new Map();
  for (const e of rows) {
    const key = `${e.fundId}|${e.sector || '—'}|${e.stage || '—'}`;
    if (!cells.has(key)) cells.set(key, { fundId: e.fundId, fundName: e.fundName, sector: e.sector, stage: e.stage, founders: new Set(), n: 0, replies: 0, meetings: 0, meetingChannels: {}, meetingArguments: {}, replyDays: [] });
    const c = cells.get(key);
    const eff = effectiveOutcome(e, now);
    if (eff === 'enviado') continue;
    c.founders.add(e.userId || 'anon'); c.n++;
    if (REPLIED.has(eff)) { c.replies++; if (e.outcomeAt) c.replyDays.push((Date.parse(e.outcomeAt) - Date.parse(e.sentAt)) / 86400000); }
    if (MEETING.has(eff)) { c.meetings++; c.meetingChannels[e.channel] = (c.meetingChannels[e.channel] || 0) + 1; for (const a of e.arguments) c.meetingArguments[a] = (c.meetingArguments[a] || 0) + 1; }
  }
  const out = [];
  let hidden = 0;
  for (const c of cells.values()) {
    if (c.founders.size < minFounders) { hidden++; continue; }
    const med = c.replyDays.sort((a, b) => a - b)[Math.floor(c.replyDays.length / 2)];
    out.push({
      fundName: c.fundName, sector: c.sector, stage: c.stage, founders: c.founders.size,
      replyRate: rateInterval(c.replies, c.n), meetingRate: rateInterval(c.meetings, c.n),
      text: `Replied to ${c.replies} of ${c.n} outreach rows from ${c.founders.size} founders${c.sector ? ` in ${c.sector}` : ''}.`,
      meetingRoutes: Object.entries(c.meetingChannels).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ channel: CHANNELS[k] || k, meetings: v })),
      meetingArguments: Object.entries(c.meetingArguments).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ argument: ARGUMENTS[k] || k, meetings: v })),
      typicalReply: med == null ? null : med <= 3 ? 'within days' : med <= 10 ? 'in one or two weeks' : 'after two weeks',
    });
  }
  return { minFounders, cells: out, hiddenCells: hidden, note: `Only cells with at least ${minFounders} distinct founders who chose to share. "Replied to" describes the past; no promise.` };
}

/**
 * Thompson sampling (Beta-Bernoulli) para elegir variante de mensaje o jugada.
 * Con menos de `minTotal` resultados no se optimiza: se recomienda la variante menos probada (explorar).
 */
export function chooseArm(arms, { minTotal = 50, rng = Math.random } = {}) {
  const total = arms.reduce((n, a) => n + a.n, 0);
  if (!arms.length) return null;
  if (total < minTotal) {
    const pick = [...arms].sort((a, b) => a.n - b.n || a.key.localeCompare(b.key))[0];
    return { key: pick.key, mode: 'explorar', reason: `Only ${total} results: testing the least-sent variant (${pick.n}). Optimizes from ${minTotal}.`, arms: arms.map((a) => ({ ...a, rate: rateInterval(a.k, a.n) })) };
  }
  const draws = arms.map((a) => ({ key: a.key, draw: betaSample(1 + a.k, 1 + a.n - a.k, rng) }));
  const best = draws.sort((a, b) => b.draw - a.draw)[0];
  return { key: best.key, mode: 'thompson', reason: 'Chosen by Thompson sampling on real results (meetings).', arms: arms.map((a) => ({ ...a, rate: rateInterval(a.k, a.n) })) };
}
export const armsFromEvents = (events, now = new Date()) => {
  const m = new Map();
  for (const e of events) { if (!e.variant) continue; const eff = effectiveOutcome(e, now); if (eff === 'enviado') continue; const a = m.get(e.variant) || { key: e.variant, n: 0, k: 0 }; a.n++; if (MEETING.has(eff)) a.k++; m.set(e.variant, a); }
  return [...m.values()];
};
export { seeded };

/** Importa una hoja de outreach histórica (CSV ya parseado). Columnas: fondo, persona, canal, argumentos, variante, fecha, resultado. */
export function importOutreachRows(rows, { userId = null, shared = false, now = new Date().toISOString() } = {}) {
  const canal = (v) => { const t = String(v || '').toLowerCase(); return /portaf|portfolio/.test(t) ? 'intro_portafolio' : /co-?inv/.test(t) ? 'intro_coinversor' : /advis|asesor|mentor/.test(t) ? 'intro_advisor' : /event/.test(t) ? 'evento' : /convoc|grant|rfa|nofo/.test(t) ? 'convocatoria' : /cold|fr[ií]o|email|correo/.test(t) ? 'cold_email' : 'otro'; };
  const res = (v) => { const t = String(v || '').toLowerCase(); return /term|grant otorg|awarded/.test(t) ? 'term_sheet' : /segunda|second/.test(t) ? 'segunda_reunion' : /reuni|meeting|call|llamada/.test(t) ? 'reunion' : /info|deck|data ?room/.test(t) ? 'pide_info' : /no interes|pass|rechaz|negativ|declin/.test(t) ? 'negativa' : /sin resp|no resp|ghost|none/.test(t) ? 'sin_respuesta' : 'enviado'; };
  const ok = [], errors = [];
  rows.forEach((r, i) => {
    try {
      ok.push(validateOutreach({ fundName: r.fondo || r.fund || r.investor, person: r.persona || r.person, channel: canal(r.canal || r.channel), arguments: String(r.argumentos || r.arguments || '').split(/[;|,]/).map((a) => a.trim().toLowerCase()).filter((a) => ARGUMENTS[a]), variant: r.variante || r.variant, sentAt: (r.fecha || r.date || '').slice(0, 10), outcome: res(r.resultado || r.outcome), sector: r.sector, stage: r.etapa || r.stage, shared }, { userId, now }));
    } catch (e) { errors.push(`row ${i + 2}: ${e.message}`); }
  });
  return { events: ok, errors };
}
