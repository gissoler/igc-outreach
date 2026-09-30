/* ─────────────────────────────────────────────────────────────────────────────
   Fechas de una convocatoria, leídas por el CÓDIGO sobre el texto completo de la página.
   · parseDates: todas las fechas del texto con su posición y su etiqueta (LOI, cierre, evento…):
     ISO, dd/mm/aaaa y mm/dd/aaaa (ambiguas marcadas), "14 September 2026", "September 14th, 2026",
     inglés/español/portugués/francés/alemán/italiano, rangos ("Oct 1 – Nov 12, 2026"), mes y año,
     trimestres ("Q4 2026"), fechas sin año (marcadas, nunca verifican una apertura).
   · deadlineDecision: con la fecha de HOY (la pasa el código, nunca el modelo) decide qué fecha es la
     accionable, en qué fase está la convocatoria y si hoy se puede postular. Reglas:
       - fases de entrada (LOI, pre-propuesta, registro, expresión de interés) mandan: si todas pasaron,
         la convocatoria está cerrada para nosotros aunque la propuesta completa (por invitación) diga "TBD";
       - fechas de eventos, sesiones, resultados o publicación nunca son plazo;
       - varias fechas de cierre (cortes): la próxima futura; todas pasadas → cerrada;
       - "rolling" solo cuenta como vigente con una señal actual (applications open, año en curso);
       - una página cuyo año/edición es anterior y sin fechas vigentes es una edición anterior.
   Sin red y sin dependencias.
   ───────────────────────────────────────────────────────────────────────────── */

const strip = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/* Meses en seis idiomas (sin tildes para buscar; el patrón admite la forma con tilde). */
const MONTH_NAMES = [
  [1, ['january', 'jan', 'enero', 'ene', 'janeiro', 'janvier', 'janv', 'januar', 'janner', 'gennaio', 'gen']],
  [2, ['february', 'feb', 'febrero', 'fevereiro', 'fev', 'fevrier', 'fevr', 'februar', 'febbraio']],
  [3, ['march', 'mar', 'marzo', 'marco', 'mars', 'marz']],
  [4, ['april', 'apr', 'abril', 'abr', 'avril', 'avr', 'aprile']],
  [5, ['may', 'mayo', 'maio', 'mai', 'maggio', 'mag']],
  [6, ['june', 'jun', 'junio', 'junho', 'juin', 'juni', 'giugno', 'giu']],
  [7, ['july', 'jul', 'julio', 'julho', 'juillet', 'juil', 'juli', 'luglio', 'lug']],
  [8, ['august', 'aug', 'agosto', 'ago', 'aout', 'agosto']],
  [9, ['september', 'sept', 'sep', 'septiembre', 'setiembre', 'set', 'setembro', 'septembre', 'settembre', 'sett']],
  [10, ['october', 'oct', 'octubre', 'outubro', 'out', 'octobre', 'oktober', 'okt', 'ottobre', 'ott']],
  [11, ['november', 'nov', 'noviembre', 'novembro', 'novembre']],
  [12, ['december', 'dec', 'diciembre', 'dic', 'dezembro', 'dez', 'decembre', 'dezember', 'dicembre']],
];
const MONTH_OF = new Map(MONTH_NAMES.flatMap(([m, names]) => names.map((n) => [n, m])));
// Formas con tildes/umlauts que aparecen en el texto original (el regex trabaja sobre el texto con acentos).
const ACCENTED = { marco: 'mar[cç]o', fevrier: 'f[eé]vrier', fevr: 'f[eé]vr', fev: 'f[eé]v', aout: 'ao[uû]t', decembre: 'd[eé]cembre', marz: 'm[aä]rz', janner: 'j[aä]nner' };
const MONTH_RX = [...MONTH_OF.keys()].sort((a, b) => b.length - a.length).map((n) => ACCENTED[n] || n).join('|');
const RISKY = new Set(['out', 'set', 'ago', 'gen', 'mag', 'ott', 'lug', 'giu', 'sett', 'mai', 'mar', 'may', 'dez', 'jan', 'dec', 'ene']);
// Sin distinguir mayúsculas pero sin palabras comunes ("may", "set", "out", "ago"…): esas solo capitalizadas.
const cased = (n) => { const r = ACCENTED[n] || n; return `${r}|${r[0].toUpperCase()}${r.slice(1)}|${r.toUpperCase()}`; };
const MONTH_RX_SAFE = [...[...MONTH_OF.keys()].filter((n) => !RISKY.has(n)).sort((a, b) => b.length - a.length).map(cased), 'May', 'MAY', 'Mar', 'MAR', 'Dec', 'DEC', 'Jan', 'JAN', 'Ago', 'Dez', 'Ene', 'Dic'].join('|');
const monthOf = (token) => MONTH_OF.get(strip(token).replace(/\.$/, '')) || null;

const YEAR = '(20\\d{2})';
const ORD = '(?:st|nd|rd|th|er|ème|º|°|o|a)?';
const DAY = `(\\d{1,2})${ORD}`;
const OF = '(?:\\s+(?:de|del|of)\\s+|\\s*[.\\-/]?\\s*)';          // "14 de septiembre de 2026", "14. September 2026"
const SEP_Y = '(?:,?\\s*(?:de|del)?\\s*|[,\\-/]\\s*|\\s+)';

const iso = (y, m, d) => {
  if (!y || !m || !d) return null;
  const x = new Date(Date.UTC(y, m - 1, d));
  return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d ? x.toISOString().slice(0, 10) : null;
};
const endOfMonth = (y, m) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
export const todayIso = (today) => (today instanceof Date ? today : new Date(today || Date.now())).toISOString().slice(0, 10);
export const daysBetween = (fromIso, toIso) => Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);

/** Texto con espacios colapsados: las posiciones de parseDates se refieren a este texto. */
export const flat = (text) => String(text || '').replace(/[*_`#>|]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Todas las fechas del texto (sobre `flat(text)`), con posición, precisión y marcas. */
export function parseDates(text) {
  const s = flat(text);
  const out = [];
  const taken = [];   // intervalos ya usados: una fecha larga ("14 September 2026") no se vuelve a leer como corta
  const free = (a, b) => !taken.some(([x, y]) => a < y && b > x);
  const push = (item) => { if (!free(item.index, item.end)) return; taken.push([item.index, item.end]); out.push(item); };
  const run = (rx, fn) => { for (const m of s.matchAll(rx)) { const r = fn(m); if (r) push({ raw: m[0].trim(), index: m.index, end: m.index + m[0].length, precision: 'day', yearless: false, ...r }); } };

  // Rangos con año al final: "October 1 – November 12, 2026", "Oct 01-Nov 12, 2026", "1 March – 30 April 2026", "March 1-15, 2026", "1–15 March 2026"
  const RSEP = '\\s*(?:-|–|—|to|until|through|thru|al|hasta|au|bis|a)\\s*';
  run(new RegExp(`\\b(${MONTH_RX})\\.?\\s+${DAY}${RSEP}(${MONTH_RX})\\.?\\s+${DAY},?\\s+${YEAR}\\b`, 'giu'), (m) => {
    const y = +m[5]; const m1 = monthOf(m[1]); const m2 = monthOf(m[3]); const end = iso(y, m2, +m[4]); const start = iso(m1 > m2 ? y - 1 : y, m1, +m[2]);
    return end ? { iso: end, range: { start, end } } : null;
  });
  run(new RegExp(`\\b${DAY}${OF}(${MONTH_RX})\\.?${RSEP}${DAY}${OF}(${MONTH_RX})\\.?${SEP_Y}${YEAR}\\b`, 'giu'), (m) => {
    const y = +m[5]; const m1 = monthOf(m[2]); const m2 = monthOf(m[4]); const end = iso(y, m2, +m[3]); const start = iso(m1 > m2 ? y - 1 : y, m1, +m[1]);
    return end ? { iso: end, range: { start, end } } : null;
  });
  run(new RegExp(`\\b(${MONTH_RX})\\.?\\s+${DAY}\\s*(?:-|–|—)\\s*${DAY},?\\s+${YEAR}\\b`, 'giu'), (m) => {
    const mm = monthOf(m[1]); const y = +m[4]; const end = iso(y, mm, +m[3]);
    return end ? { iso: end, range: { start: iso(y, mm, +m[2]), end } } : null;
  });
  run(new RegExp(`\\b${DAY}\\s*(?:-|–|—)\\s*${DAY}${OF}(${MONTH_RX})\\.?${SEP_Y}${YEAR}\\b`, 'giu'), (m) => {
    const mm = monthOf(m[3]); const y = +m[4]; const end = iso(y, mm, +m[2]);
    return end ? { iso: end, range: { start: iso(y, mm, +m[1]), end } } : null;
  });
  // ISO y variantes con año delante
  run(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g, (m) => { const v = iso(+m[1], +m[2], +m[3]); return v ? { iso: v } : null; });
  // Día Mes Año (14 September 2026 · 14 de septiembre de 2026 · 14. September 2026 · 3rd of March 2027)
  run(new RegExp(`\\b${DAY}${OF}(${MONTH_RX})\\.?${SEP_Y}${YEAR}\\b`, 'giu'), (m) => { const v = iso(+m[3], monthOf(m[2]), +m[1]); return v ? { iso: v } : null; });
  // Mes Día, Año (September 14, 2026 · Sept. 9th 2026 · septiembre 14 de 2026)
  run(new RegExp(`\\b(${MONTH_RX})\\.?\\s+${DAY}${SEP_Y}${YEAR}\\b`, 'giu'), (m) => { const v = iso(+m[3], monthOf(m[1]), +m[2]); return v ? { iso: v } : null; });
  // Numéricas: dd/mm/aaaa o mm/dd/aaaa (también con . y -)
  run(/\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2})\b/g, (m) => {
    const a = +m[1]; const b = +m[2]; const y = +m[3];
    const dm = iso(y, b, a); const md = iso(y, a, b);
    if (dm && !md) return { iso: dm, format: 'dd/mm' };
    if (md && !dm) return { iso: md, format: 'mm/dd' };
    if (dm && md) return dm === md ? { iso: dm } : { iso: dm, alt: md, ambiguous: true };
    return null;
  });
  // Trimestres: Q4 2026 · fourth quarter of 2026 · cuarto trimestre de 2026
  const QN = { first: 1, '1st': 1, primer: 1, primero: 1, second: 2, '2nd': 2, segundo: 2, third: 3, '3rd': 3, tercer: 3, tercero: 3, fourth: 4, '4th': 4, cuarto: 4 };
  run(/\bQ([1-4])\s*(?:of\s+)?(20\d{2})\b/gi, (m) => ({ iso: endOfMonth(+m[2], +m[1] * 3), precision: 'quarter' }));
  run(/\b(first|second|third|fourth|1st|2nd|3rd|4th|primer|primero|segundo|tercer|tercero|cuarto)\s+(?:quarter|trimestre)\s+(?:of\s+|de\s+|del\s+)?(20\d{2})\b/gi, (m) => ({ iso: endOfMonth(+m[2], QN[m[1].toLowerCase()] * 3), precision: 'quarter' }));
  // Mes y año sin día: "October 2026", "octubre de 2026"
  run(new RegExp(`\\b(${MONTH_RX_SAFE})\\.?${SEP_Y}${YEAR}\\b`, 'gu'), (m) => { const mm = monthOf(m[1]); return mm ? { iso: endOfMonth(+m[2], mm), precision: 'month' } : null; });
  // Sin año: "September 14", "14 Sept", "Oct 01" (se marcan; nunca verifican una apertura)
  run(new RegExp(`\\b(${MONTH_RX_SAFE})\\.?\\s+${DAY}\\b(?!\\s*[:.]\\d)`, 'gu'), (m) => { const mm = monthOf(m[1]); const d = +m[2]; return mm && d >= 1 && d <= 31 ? { iso: null, month: mm, day: d, yearless: true, precision: 'day' } : null; });
  run(new RegExp(`\\b${DAY}${OF}(${MONTH_RX_SAFE})\\b\\.?`, 'gu'), (m) => { const mm = monthOf(m[2]); const d = +m[1]; return mm && d >= 1 && d <= 31 ? { iso: null, month: mm, day: d, yearless: true, precision: 'day' } : null; });

  out.sort((a, b) => a.index - b.index);
  // Un rango "Oct 01-Nov 12, 2026" ya cubierto; un "Oct 1 – " suelto seguido de fecha con año hereda el año.
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i]; const b = out[i + 1];
    if (a.yearless && b.iso && b.index - a.end <= 12 && /^\s*(?:-|–|—|to|until|through|al|hasta|au|bis)\s*$/i.test(s.slice(a.end, b.index))) {
      const y = +b.iso.slice(0, 4); a.iso = iso(a.month > +b.iso.slice(5, 7) ? y - 1 : y, a.month, a.day); a.yearless = false; a.inferredYear = true; a.rangeStartOf = b.iso;
    }
  }
  return out;
}

/** Fechas completas (con año) como YYYY-MM-DD. Compatibilidad con verify.datesIn. */
export function datesIn(text) {
  const out = new Set();
  for (const d of parseDates(text)) {
    if (!d.iso || d.yearless || d.precision !== 'day') continue;
    out.add(d.iso); if (d.ambiguous && d.alt) out.add(d.alt);
    if (d.range?.start) out.add(d.range.start);
  }
  return [...out];
}

/* ── Etiquetas de fase: lo que la página dice justo antes (o justo después) de la fecha ── */
const PHASES = [
  ['published', /\b(posted|published|updated|last (?:updated|modified)|publicado|actualizado|publi[eé]|ver[oö]ffentlicht)\b/gi],
  ['event', /\b(webinar|info(?:rmation(?:al)?)? session|workshop|session\s*\d*|orientation|conference|summit|pitch day|demo day|ceremony|kick-?off|bootcamp|meetup|office hours|taller|jornada|evento|seminar(?:io)?|course|catch up week|self-paced)\b/gi],
  ['result', /\b(notification|notified|announce(?:d|ment)?|results?|winners?|decisions?|award(?:s)? (?:start|date|announcement)|funding (?:start|begins)|start date|project start|program(?:me)? (?:starts|start|begins|launch)|cohort (?:starts|begins)|resultados|notificaci[oó]n|anuncio|inicio del programa)\b/gi],
  ['opens', /\b(opens?(?: for submissions)?(?: on)?|opening(?: date)?|launch(?:es|ed)?|applications? (?:will )?open|call opens|(?:accepted |open )?from|starting(?: on)?|beginning|start date for (?:applications|submissions)|apertura|abre|se abre|desde el|a partir del?|ouverture|er[oö]ffnung)\b/gi],
  ['loi', /\b(letters? of intent|LOIs?|pre-?propos(?:al|als)|preliminary (?:proposal|application)s?|concept (?:note|paper)s?|expressions? of interest|EOIs?|pre-?applications?|intent to (?:apply|submit)|white ?papers?|project pitch(?:es)?|carta(?:s)? de intenci[oó]n|manifestaci[oó]n de inter[eé]s|nota conceptual|preinscripci[oó]n|pre-?registro)\b/gi],
  ['registration', /\b(registration(?: deadline)?|register by|registrations? close|inscripci[oó]n(?:es)?|registro)\b/gi],
  ['invited', /\b(invited (?:full )?(?:proposals?|applications?)|by invitation(?: only)?|invitation only|full (?:proposals?|applications?)|stage 2|second (?:stage|round|phase)|phase (?:ii|2) (?:application|proposal)s?|propuestas? completas?|segunda (?:fase|etapa))\b/gi],
  ['deadline', /\b(deadlines?|due(?: date)?|apply by|apply before|applications? (?:close|closes|closing|due|deadline)|closing date|closes?|cut-?off(?: date)?|submission deadlines?|submissions? (?:due|close|closes)|submit by|until|through|no later than|fecha l[ií]mite|plazo|cierre|cierra|hasta el|cl[oô]ture|date limite|einsendeschluss|bewerbungsschluss|frist|scadenza|prazo|encerramento)\b/gi],
];
const OPTIONAL_NEAR = /\b(optional|recommended|encouraged|not required|opcional|recomendad[oa]|facultati(?:f|ve|vo))\b/i;

function labelFor(s, d, prevEnd) {
  const from = Math.max(prevEnd, d.index - 90);
  const before = s.slice(from, d.index);
  const cut = Math.max(before.lastIndexOf('. '), before.lastIndexOf('; '));
  const window = cut >= 0 && before.length - cut > 3 ? before.slice(cut + 2) : before;
  let best = null;
  for (const [phase, rx] of PHASES) for (const m of window.matchAll(rx)) { const at = m.index + m[0].length; if (!best || at > best.at || (at === best.at && m[0].length > best.word.length)) best = { phase, at, start: m.index, word: m[0] }; }
  // Etiqueta detrás de la fecha: "September 14 (Letter of Intent)"
  if (!best) {
    const after = s.slice(d.end, d.end + 45);
    for (const [phase, rx] of PHASES) { rx.lastIndex = 0; const m = rx.exec(after.split(/[.;]/)[0]); if (m && (!best || m.index < best.at)) best = { phase, at: m.index, word: m[0] }; }
  }
  const offset = from + (cut >= 0 && before.length - cut > 3 ? cut + 2 : 0);
  const labelStart = best && best.start != null ? offset + best.start : d.index;
  return { phase: best?.phase || 'none', label: best?.word || '', labelStart: Math.min(labelStart, d.index), optional: OPTIONAL_NEAR.test(window) };
}

const TBD_RX = /\b(TBD|TBA|TBC|to be (?:announced|determined|confirmed)|por (?:definir|confirmar|anunciar)|[aà] (?:d[eé]finir|confirmer)|a definir)\b/gi;
const TABLE_HEAD_RX = /\b(application due dates?|due dates?|submission (?:due )?dates?|deadlines?|closing dates?|cut-?off dates?|fechas? de cierre|fechas? l[ií]mite)\b/gi;
export const ROLLING_RX = /\b(rolling(?: basis| deadlines?| admissions?| applications?| intake| submissions?| review)?|(?:accepted|reviewed|considered) (?:on a rolling basis|year[- ]round|continuously|at any time)|open until (?:filled|further notice)|no (?:fixed )?deadline|ongoing (?:call|basis|intake)|convocatoria (?:abierta )?permanente|ventanilla abierta|de forma continua|en continu|laufend)\b/i;
export const CLOSED_RX = /\b(applications? (?:are |is )?(?:now )?closed|registration (?:is )?(?:now )?closed|call (?:is )?(?:now )?closed|(?:this|the) (?:call|competition|program|opportunity) (?:is|has) (?:now )?closed|now closed|submissions? (?:are |is )?(?:now )?closed|no longer accepting|deadline has passed|(?:currently )?not (?:currently )?(?:open|accepting) (?:for )?(?:new )?(?:applications|submissions|proposals)|(?:is|are) no longer open|closed for applications|convocatoria cerrada|inscripciones cerradas|postulaciones cerradas|cerrad[oa] (?:para|a) (?:postulaciones|inscripciones)|candidatures? (?:sont )?closes?|bewerbung(?:sphase)? (?:ist )?geschlossen)\b/i;
export const OPEN_RX = /\b(applications? (?:are |is )?(?:now )?open|now accepting|accepting (?:applications|proposals|submissions)|open for (?:applications|submissions)|call (?:is )?(?:now )?open|apply now|open call|convocatoria abierta|postulaciones abiertas|inscripciones abiertas|candidatures? ouvertes?)\b/i;

/** Hitos de la página: fechas etiquetadas + hitos "TBD". Posiciones sobre flat(text). */
export function milestones(text) {
  const s = flat(text);
  const dates = parseDates(s);
  const items = [];
  let prevEnd = 0;
  for (const d of dates) {
    const prev = items.at(-1);
    // "December 1, 2026 to January 15, 2027": la segunda fecha es el cierre de la ventana que abre la primera.
    if (prev && !prev.tbd && d.index - prev.end <= 14 && /^\s*(?:-|–|—|to|until|through|thru|al|hasta|au|bis|a)\s*$/i.test(s.slice(prev.end, d.index))) {
      const phase = ['loi', 'registration', 'invited', 'event', 'result'].includes(prev.phase) ? prev.phase : 'deadline';
      if (!['event', 'result', 'published'].includes(prev.phase)) { prev.phase = 'opens'; prev.rangeStart = true; }
      items.push({ ...d, phase, label: `${prev.label || 'window'} (end)`, labelStart: prev.labelStart, optional: prev.optional, quote: s.slice(prev.labelStart, d.end).trim() });
      prevEnd = d.end;
      continue;
    }
    // Lista de fechas ("Cut-off dates: 7 January 2026, 4 March 2026 and 4 November 2026"): heredan la etiqueta.
    if (prev && !prev.tbd && prev.phase !== 'none' && d.index - prev.end <= 8 && /^\s*(?:,|;|and|y|e|et|und|or|o|&)\s*(?:and\s+)?$/i.test(s.slice(prev.end, d.index))) {
      items.push({ ...d, phase: prev.phase, label: prev.label, labelStart: prev.labelStart, optional: prev.optional, quote: d.end - prev.labelStart <= 240 ? s.slice(prev.labelStart, d.end).trim() : d.raw });
      prevEnd = d.end;
      continue;
    }
    const l = labelFor(s, d, prevEnd);
    prevEnd = d.end;
    items.push({ ...d, ...l, quote: s.slice(l.labelStart, d.end).trim() });
  }
  // Tablas aplanadas (NIH "Key Dates": "Application Due Dates | Review | Council | Start" → "October 05, 2026 March 2027 …"):
  // tras un encabezado de plazos, las fechas exactas sin etiqueta que siguen en cadena son plazos (las de mes/año son
  // otras columnas: revisión, consejo, inicio).
  for (const h of s.matchAll(TABLE_HEAD_RX)) {
    const start = h.index + h[0].length; let last = start; let first = true;
    for (const it of items) {
      if (it.index < start) continue;
      if (it.index - last > (first ? 400 : 300)) break;
      // La primera fecha puede heredar una palabra de la fila de encabezados ("Earliest Start Date"): se ignora.
      const headerWord = first && it.labelStart < it.index && it.labelStart >= start;
      if (it.precision === 'day' && it.iso && (it.phase === 'none' || (headerWord && ['result', 'event'].includes(it.phase)))) { it.phase = 'deadline'; it.label = h[0]; it.fromTable = true; }
      else if (it.phase !== 'none' && it.precision === 'day' && !it.fromTable) break;
      last = it.end; first = false;
    }
  }
  for (const m of s.matchAll(TBD_RX)) {
    const l = labelFor(s, { index: m.index, end: m.index + m[0].length }, Math.max(0, ...items.filter((x) => x.end <= m.index).map((x) => x.end)));
    if (l.phase !== 'none') items.push({ iso: null, tbd: true, raw: m[0], index: m.index, end: m.index + m[0].length, precision: 'none', yearless: false, ...l, quote: s.slice(l.labelStart, m.index + m[0].length).trim() });
  }
  return items.sort((a, b) => a.index - b.index);
}

const quoteAt = (s, index, radius = 110) => { const a = Math.max(0, s.lastIndexOf('. ', index) + 1, index - radius); const b = Math.min(s.length, index + radius); return s.slice(a, b).trim(); };
const YEAR_IN_TITLE = /\b(20\d{2})\b/g;

/**
 * Decide la fecha accionable y el estado HOY. El modelo no participa: `claimed` (fecha del modelo) solo se
 * contrasta. Devuelve { status, deadline, precision, phase, quote, flags, reason, milestones, rolling, ... }.
 * status: open | upcoming | closed | rolling | unknown
 */
export function deadlineDecision(text, { today, claimed = null, title = '', url = '' } = {}) {
  const now = todayIso(today);
  const s = flat(text);
  const all = milestones(s);
  const flags = [];
  const dated = all.filter((m) => m.iso && !m.yearless);
  const full = dated.filter((m) => m.precision === 'day' && !m.inferredYear);
  const isFuture = (m) => daysBetween(now, m.iso) >= 0 && (!m.ambiguous || daysBetween(now, m.alt) >= 0);
  const isPast = (m) => daysBetween(now, m.iso) < 0 && (!m.ambiguous || daysBetween(now, m.alt) < 0);
  const nonEvent = (m) => !['event', 'result', 'published'].includes(m.phase);
  const res = (o) => ({ milestones: all.map(({ iso: i, phase, label, quote, tbd, yearless, precision, ambiguous, alt, optional }) => ({ iso: i, phase, label, quote: quote.slice(0, 220), ...(tbd ? { tbd } : {}), ...(yearless ? { yearless } : {}), ...(precision !== 'day' ? { precision } : {}), ...(ambiguous ? { ambiguous, alt } : {}), ...(optional ? { optional } : {}) })), rolling: false, flags, ...o });

  const closedMark = CLOSED_RX.exec(s); const openMark = OPEN_RX.exec(s); const rollingMark = ROLLING_RX.exec(s);
  const years = full.map((m) => +m.iso.slice(0, 4));
  const thisYear = +now.slice(0, 4);

  // 0) El modelo dio una fecha que no está en la página → inventada (se registra; nunca se usa)
  if (claimed && !datesIn(s).includes(claimed)) flags.push('model_date_not_in_page');
  if (all.some((m) => m.ambiguous)) flags.push('ambiguous_numeric_date');

  // 1) Fases de entrada (LOI, pre-propuesta, registro): mandan sobre la propuesta completa
  const entry = all.filter((m) => ['loi', 'registration'].includes(m.phase) && !m.optional);
  const entryDated = entry.filter((m) => m.iso && m.precision === 'day' && !m.yearless);
  const invited = all.filter((m) => m.phase === 'invited');
  if (entryDated.length) {
    const next = entryDated.filter(isFuture).sort((a, b) => a.iso.localeCompare(b.iso))[0];
    if (next) {
      const opening = full.filter((m) => m.phase === 'opens' && isFuture(m) && m.iso < next.iso).sort((a, b) => a.iso.localeCompare(b.iso))[0];
      return res({ status: opening ? 'upcoming' : 'open', deadline: next.iso, precision: 'day', phase: next.phase, quote: next.quote, reason: `Next entry step (${next.label || next.phase}) on ${next.iso}${opening ? ` (opens ${opening.iso})` : ''}`, ...(opening ? { opens: opening.iso } : {}), ...(next.inferredYear ? { inferredYear: true } : {}) });
    }
    if (entryDated.every(isPast)) {
      const last = entryDated.sort((a, b) => b.iso.localeCompare(a.iso))[0];
      flags.push('entry_phase_closed'); if (invited.length) flags.push('next_phase_by_invitation');
      return res({ status: 'closed', deadline: last.iso, precision: 'day', phase: last.phase, quote: last.quote, reason: `Entry step (${last.label || last.phase}) closed on ${last.iso}${invited.length ? '; the next stage is by invitation only' : ''}` });
    }
  }

  // 2) Plazos (cortes): la próxima futura; todas pasadas → cerrada. Eventos, resultados y publicación no cuentan.
  const deadlines = full.filter((m) => m.phase === 'deadline' || (m.phase === 'invited' && !entryDated.length));
  const opensAt = full.filter((m) => m.phase === 'opens');
  if (deadlines.length) {
    const next = deadlines.filter(isFuture).sort((a, b) => a.iso.localeCompare(b.iso))[0];
    if (next) {
      if (closedMark && !openMark) flags.push('closed_marker_conflict');
      if (next.ambiguous) flags.push('ambiguous_deadline');
      const opening = opensAt.filter(isFuture).sort((a, b) => a.iso.localeCompare(b.iso))[0];
      const status = opening && opening.iso < next.iso ? 'upcoming' : 'open';
      return res({ status, deadline: next.iso, precision: 'day', phase: 'deadline', quote: next.quote, reason: `${deadlines.length > 1 ? 'Next of several deadlines' : 'Deadline'} on ${next.iso}${status === 'upcoming' ? ` (opens ${opening.iso})` : ''}`, ...(opening ? { opens: opening.iso } : {}) });
    }
    const last = deadlines.sort((a, b) => b.iso.localeCompare(a.iso))[0];
    const future = full.filter((m) => nonEvent(m) && isFuture(m));
    if (future.length) flags.push('future_date_without_deadline_label');
    if (+last.iso.slice(0, 4) < thisYear) flags.push('previous_edition');
    return res({ status: 'closed', deadline: last.iso, precision: 'day', phase: 'deadline', quote: last.quote, reason: `Deadline passed on ${last.iso}` });
  }

  // 3) Marca explícita de cerrada sin plazo futuro
  if (closedMark && !openMark) return res({ status: 'closed', deadline: null, phase: 'closed_marker', quote: quoteAt(s, closedMark.index), reason: `Page says "${closedMark[0]}"` });

  // 4) Plazo con precisión de mes o trimestre ("closes in Q4 2026"): no verifica la apertura, pero sí el cierre pasado
  const coarse = dated.filter((m) => m.precision !== 'day' && m.phase === 'deadline');
  if (coarse.length) {
    const next = coarse.filter(isFuture).sort((a, b) => a.iso.localeCompare(b.iso))[0];
    if (next) { flags.push('deadline_not_exact'); return res({ status: 'unknown', deadline: null, approx: next.iso, precision: next.precision, phase: 'deadline', quote: next.quote, reason: `Only an approximate deadline (${next.raw})` }); }
    const last = coarse.sort((a, b) => b.iso.localeCompare(a.iso))[0];
    return res({ status: 'closed', deadline: null, approx: last.iso, precision: last.precision, phase: 'deadline', quote: last.quote, reason: `Approximate deadline passed (${last.raw})` });
  }

  // 5) Solo apertura futura: próxima
  const nextOpen = opensAt.filter(isFuture).sort((a, b) => a.iso.localeCompare(b.iso))[0];
  if (nextOpen) return res({ status: 'upcoming', deadline: null, opens: nextOpen.iso, phase: 'opens', quote: nextOpen.quote, reason: `Opens on ${nextOpen.iso}` });

  // 6) Rolling: vigente solo con señal actual (dice "open/accepting" o hay una fecha no-evento del año en curso o posterior)
  const staleYears = years.length && Math.max(...years) < thisYear;
  if (rollingMark) {
    const current = Boolean(openMark) || full.some((m) => +m.iso.slice(0, 4) >= thisYear && nonEvent(m));
    if (current && !staleYears) return res({ status: 'rolling', rolling: true, deadline: null, phase: 'rolling', quote: quoteAt(s, rollingMark.index), vigencyQuote: openMark ? quoteAt(s, openMark.index) : null, reason: 'Rolling applications with a current signal on the page' });
    flags.push('rolling_without_current_signal');
    return res({ status: 'unknown', rolling: true, deadline: null, phase: 'rolling', quote: quoteAt(s, rollingMark.index), reason: 'Says "rolling" but nothing on the page shows it is current' });
  }

  // 7) Edición anterior: el título/URL o todas las fechas de la página son de años pasados
  const titleYears = [...`${title} ${url}`.matchAll(YEAR_IN_TITLE)].map((m) => +m[1]).filter((y) => y >= 2000 && y <= thisYear + 2);
  const futureAny = full.filter((m) => nonEvent(m) && isFuture(m));
  if (!futureAny.length && ((titleYears.length && Math.max(...titleYears) < thisYear) || (staleYears && years.length >= 1))) {
    flags.push('previous_edition');
    return res({ status: 'closed', deadline: null, phase: 'previous_edition', quote: full.length ? full.sort((a, b) => b.iso.localeCompare(a.iso))[0].quote : '', reason: `Only dates from ${Math.max(...years, ...titleYears)} or earlier: previous edition` });
  }

  if (entry.some((m) => m.tbd) || invited.some((m) => m.tbd)) flags.push('dates_tbd');
  if (all.some((m) => m.yearless && m.phase === 'deadline')) flags.push('deadline_without_year');
  if (openMark) return res({ status: 'unknown', deadline: null, phase: 'open_marker', quote: quoteAt(s, openMark.index), openMarker: true, reason: `Says "${openMark[0]}" but no dated deadline` });
  return res({ status: 'unknown', deadline: null, phase: 'none', quote: '', reason: 'No verifiable deadline on the page' });
}
