/* ─────────────────────────────────────────────────────────────────────────────
   Explicación por resultado: qué es, quién la ofrece, cuándo cierra y por qué (no) somos elegibles.
   · El resumen de la IA (campo `summary` de la lectura) solo se muestra si pasa comprobaciones del código:
     toda fecha y cifra que menciona está en la página, no dice "abierta" si el código no lo verificó y no dice
     "elegible" si la elegibilidad no quedó confirmada. Si falla, se descarta y se dice por qué.
   · Siempre se añade la ficha verificada (plantilla con las citas literales) y lo que NO se pudo verificar.
   ───────────────────────────────────────────────────────────────────────────── */
import { datesIn } from './dates.mjs';
import { literalIn, hostOf } from './verify.mjs';

const clip = (s, n = 180) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const NUM_RX = /(?:[$€£]\s?\d[\d,.]*\s?(?:k|m|million|millones|mil|bn|billion)?|\b\d[\d,.]*\s?(?:k|m|million|millones|bn|billion)?\s?(?:usd|eur|gbp|chf|dólares|euros)\b)/gi;
const numKey = (s) => String(s).toLowerCase().replace(/[^0-9km]/g, '');

/** ¿El resumen del modelo se sostiene con la página y con lo verificado? Devuelve { ok, reason }. */
export function checkSummary(summary, page, v) {
  const s = String(summary || '').trim();
  if (!s) return { ok: false, reason: 'no summary' };
  if (s.length > 900) return { ok: false, reason: 'too long' };
  const text = String(page?.text || '');
  const pageDates = new Set(datesIn(text));
  for (const d of datesIn(s)) if (!pageDates.has(d)) return { ok: false, reason: `date ${d} is not on the page` };
  const pageNums = new Set([...text.matchAll(NUM_RX)].map((m) => numKey(m[0])));
  for (const m of s.matchAll(NUM_RX)) if (!pageNums.has(numKey(m[0]))) return { ok: false, reason: `amount "${m[0].trim()}" is not on the page` };
  if (v.status !== 'open' && /\b(is open|are open|currently open|now open|open now|accepting applications|está abierta|abierta hasta|abierta ahora|sigue abierta)\b/i.test(s)) return { ok: false, reason: 'says it is open but the deadline was not verified as open today' };
  if (v.eligible !== 'yes' && /\b(you are eligible|we are eligible|is eligible|eligible because|somos elegibles|es elegible|elegible porque|cumple(?:mos)? los requisitos)\b/i.test(s)) return { ok: false, reason: 'claims eligibility that the code did not confirm' };
  return { ok: true, reason: '' };
}

const STATUS_ES = { open: 'abierta', upcoming: 'aún no abre', closed: 'cerrada', unknown: 'sin fecha verificable', not_a_call: 'no es una convocatoria' };

/** Ficha verificada, en español, solo con datos comprobados (citas literales). */
export function verifiedFacts(v, { name = '', url = '', amount = null } = {}) {
  const org = hostOf(url);
  const parts = [];
  parts.push(`${name || org}${org && name ? ` (${org})` : ''}${amount ? ` · ${amount}` : ''}.`);
  if (v.deadline) parts.push(`${v.status === 'upcoming' ? `Abre ${v.dates?.opens || 'pronto'}; cierra` : 'Cierra'} el ${v.deadline} («${clip(v.deadlineQuote, 140)}»), ${v.daysLeft} días desde hoy (${v.today}).`);
  else if (v.flags?.includes('rolling')) parts.push(`Postulación continua (rolling) con señal de vigencia («${clip(v.dates?.quote, 140)}»), sin fecha de cierre.`);
  else if (v.status === 'closed') parts.push(`Cerrada: ${v.dates?.reason || 'plazo vencido'}${v.dates?.quote ? ` («${clip(v.dates.quote, 140)}»)` : ''}.`);
  else parts.push(`Sin fecha de cierre verificable en la página (hoy ${v.today}).`);
  const e = v.eligibility || {};
  if (v.eligible === 'yes') parts.push(`Elegible porque «${clip(e.quote, 160)}».`);
  else if (v.eligible === 'no') parts.push(`No elegible: ${e.reason}${e.quote ? ` («${clip(e.quote, 140)}»)` : ''}.`);
  else parts.push(`Elegibilidad sin confirmar: ${e.reason || 'la página no lo dice'}.`);
  if (v.pageType && !v.pageType.isCall) parts.push(`Tipo de página: ${v.pageType.reason}.`);
  return parts.join(' ');
}

/** Lo que no se pudo verificar, en frases cortas. */
export function unverifiedOf(v) {
  const out = [];
  if (!v.deadline) out.push('fecha de cierre');
  if (v.eligible !== 'yes') out.push('elegibilidad para una startup con fines de lucro');
  if (v.flags?.some((f) => f.startsWith('country_restricted'))) out.push('país de constitución exigido');
  if (v.flags?.includes('may_require_return')) out.push('si el dinero es realmente no dilutivo');
  if (!v.official) out.push('que la página sea la fuente oficial');
  if (v.flags?.some((f) => f.startsWith('fake_quote'))) out.push('parte de lo que leyó la IA (citó frases que no están en la página)');
  if (v.flags?.includes('model_date_not_in_page')) out.push('la fecha que propuso la IA (no aparece en la página)');
  return out;
}

/** Explicación completa para la UI. */
export function buildExplanation(v, { summary = '', name = '', url = '', amount = null, page = null } = {}) {
  const ai = page ? checkSummary(summary, page, v) : { ok: false, reason: 'no page' };
  const risks = (v.blockers || []).slice(0, 5);
  return {
    ai: ai.ok ? clip(summary, 700) : null,
    aiRejected: ai.ok || !summary ? null : ai.reason,
    facts: verifiedFacts(v, { name, url, amount }),
    risks,
    unverified: unverifiedOf(v),
    today: v.today,
  };
}
export { literalIn };
