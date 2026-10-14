/* Ventana para aplicar: "noviembre y diciembre", "Nov–Dec 2026", "antes del 31 de diciembre", "próximos 3 meses",
   "2026-11-01 to 2026-12-31" → { from, to } en YYYY-MM-DD. Sin nombres de financiadores; la fecha de hoy la pasa quien llama. */
const MONTHS = {
  january: 1, jan: 1, enero: 1, ene: 1, february: 2, feb: 2, febrero: 2, march: 3, mar: 3, marzo: 3, april: 4, apr: 4, abril: 4, abr: 4,
  may: 5, mayo: 5, june: 6, jun: 6, junio: 6, july: 7, jul: 7, julio: 7, august: 8, aug: 8, agosto: 8, ago: 8,
  september: 9, sept: 9, sep: 9, septiembre: 9, setiembre: 9, october: 10, oct: 10, octubre: 10, november: 11, nov: 11, noviembre: 11,
  december: 12, dec: 12, diciembre: 12, dic: 12,
};
const MONTH_RX = /\b(january|february|march|april|june|july|august|september|october|november|december|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|sept|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|ene|abr|ago|dic)\b\.?/g;
const iso = (y, m, d) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const plain = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const addMonths = (todayIso, n) => { const d = new Date(`${todayIso}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
const validIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

export function parseWindow(text, today) {
  const t = plain(text).replace(/[–—]/g, '-'); const now = String(today || new Date().toISOString()).slice(0, 10);
  if (!t.trim()) return null;
  // 1) Dos fechas exactas.
  const isos = (t.match(/\b\d{4}-\d{2}-\d{2}\b/g) || []).filter(validIso);
  if (isos.length >= 2) { const [a, b] = [isos[0], isos[1]].sort(); return { from: a, to: b }; }
  // 2) Relativo: "próximos 3 meses", "in the next 8 weeks".
  const rel = t.match(/\b(?:proximos|siguientes|next|en|within|dentro de)\s+(?:los\s+)?(\d{1,2})\s+(meses|months|semanas|weeks)\b/);
  if (rel) { const n = Number(rel[1]); return { from: now, to: /mes|month/.test(rel[2]) ? addMonths(now, n) : new Date(Date.parse(`${now}T00:00:00Z`) + n * 7 * 86400000).toISOString().slice(0, 10) }; }
  // 3) Meses con nombre (opcional año).
  const found = [...t.matchAll(MONTH_RX)].map((m) => ({ month: MONTHS[m[1]], at: m.index })).filter((m) => m.month);
  if (!found.length) return null;
  const years = [...t.matchAll(/\b(20\d{2})\b/g)].map((m) => ({ year: Number(m[1]), at: m.index }));
  const [ny, nm] = [Number(now.slice(0, 4)), Number(now.slice(5, 7))];
  let prev = null; const spans = [];
  for (const f of found) {
    const near = years.find((y) => y.at >= f.at && y.at - f.at <= 14) || years.filter((y) => y.at < f.at).at(-1) || (years.length === 1 ? years[0] : null);
    let y = near ? near.year : (f.month < nm ? ny + 1 : ny);
    if (!near && prev && (y * 12 + f.month) < prev) y += 1;   // "noviembre a febrero": febrero es del año siguiente
    prev = y * 12 + f.month; spans.push({ y, m: f.month });
  }
  let from = iso(spans[0].y, spans[0].m, 1); const last = spans.at(-1);
  let to = iso(last.y, last.m, lastDay(last.y, last.m));
  if (from > to) [from, to] = [iso(last.y, last.m, 1), iso(spans[0].y, spans[0].m, lastDay(spans[0].y, spans[0].m))];
  // "antes de / hasta / before / by" + un solo mes: desde hoy hasta fin de ese mes.
  if (spans.length === 1 && /\b(antes de|hasta|before|by|until|a mas tardar|no later than)\b/.test(t)) from = now > to ? from : now;
  if (to < now) return null;   // ventana ya pasada: no sirve, se vuelve a preguntar
  return { from: from < now ? now : from, to };
}

/** Texto normalizado que se guarda en el perfil: "2026-11-01 to 2026-12-31" (o null si no se entiende). */
export function windowLabel(text, today) {
  const w = parseWindow(text, today); return w ? `${w.from} to ${w.to}` : null;
}
/** Del texto guardado a {from, to} (lo guardado ya es ISO; si no, se intenta interpretar). */
export function windowOf(text, today) { return parseWindow(text, today); }
