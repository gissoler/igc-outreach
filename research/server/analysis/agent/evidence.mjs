// Libreta de evidencia del agente: todo lo que el agente ve recibe un id (E1, E2…) y solo puede citar esos ids.
// La verificación vive aquí: una afirmación sin id válido, o con cifras que no están en lo citado, se descarta.

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, t.lastIndexOf(' ', n) > n * 0.6 ? t.lastIndexOf(' ', n) : n)}…` : t; };
const numbersIn = (s) => (String(s).match(/\d+(?:[.,]\d+)*/g) || []).map((n) => n.replace(/[.,]/g, ''));

export class Notebook {
  constructor(prefix = 'E') { this.prefix = prefix; this.items = new Map(); this.byKey = new Map(); }
  /** Agrega evidencia (deduplica por url+texto). Devuelve el id. */
  add({ source, url = null, title = '', text, date = null, kind = 'web' }) {
    const body = clip(text, 1400);
    if (!body) return null;
    const key = `${url || ''}|${body.slice(0, 160)}`;
    if (this.byKey.has(key)) return this.byKey.get(key);
    const id = `${this.prefix}${this.items.size + 1}`;
    this.items.set(id, { id, source, url, title: clip(title, 160), text: body, date, kind });
    this.byKey.set(key, id);
    return id;
  }
  get(id) { return this.items.get(id) || null; }
  has(id) { return this.items.has(id); }
  list() { return [...this.items.values()]; }
  /** Texto compacto para el prompt. */
  render(ids = null, max = 60) {
    const rows = (ids ? ids.map((i) => this.get(i)).filter(Boolean) : this.list()).slice(-max);
    return rows.map((e) => `[${e.id}] (${e.source}${e.date ? `, ${e.date}` : ''}${e.url ? `, ${e.url}` : ''}) ${e.title ? `${e.title}: ` : ''}${e.text}`).join('\n');
  }
  toJSON() { return this.list(); }
}

/**
 * Verifica una afirmación {text, evidence:[ids]}: ids existentes y cifras presentes en lo citado (o en `extra`).
 * Devuelve la afirmación limpia o null, y el motivo en `reasons`.
 */
export function checkClaim(claim, nb, { extra = '', reasons = [] } = {}) {
  if (!claim || typeof claim.text !== 'string' || !claim.text.trim()) { reasons.push('empty'); return null; }
  const ids = [...new Set((Array.isArray(claim.evidence) ? claim.evidence : []).map(String))];
  const valid = ids.filter((i) => nb.has(i));
  if (!valid.length) { reasons.push(`no valid evidence: "${clip(claim.text, 80)}"`); return null; }
  const cited = valid.map((i) => nb.get(i).text).join(' ') + ' ' + extra;
  const allowed = new Set(numbersIn(cited));
  const invented = numbersIn(claim.text).filter((n) => !allowed.has(n));
  if (invented.length) { reasons.push(`unsupported figures (${invented.join(', ')}): "${clip(claim.text, 80)}"`); return null; }
  return { ...claim, text: claim.text.trim(), evidence: valid };
}

/** Aplica checkClaim a una lista; devuelve {kept, dropped}. */
export function checkClaims(list, nb, opts = {}) {
  const reasons = opts.reasons || [];
  const kept = [];
  for (const c of Array.isArray(list) ? list : []) { const ok = checkClaim(c, nb, { ...opts, reasons }); if (ok) kept.push(ok); }
  return kept;
}
export { clip, numbersIn };
