// Evaluación del Módulo 1: precisión por campo (revisión humana) y precisión/recall contra un oro.
import { createHash } from 'node:crypto';
import { normText } from './entities.mjs';

export const EVAL_FIELDS = ['startup', 'sector', 'country', 'stage', 'amount', 'date', 'lead_investors', 'co_investors', 'partners'];

const setOf = (arr) => new Set((arr || []).filter(Boolean));
/** Valor comparable de cada campo de un deal verificado. Listas → conjuntos. */
export function fieldValue(deal, field) {
  switch (field) {
    case 'startup': return deal.startupKey || normText(deal.startup);
    case 'sector': return deal.sector || null;
    case 'country': return deal.country || null;
    case 'stage': return deal.stage || null;
    case 'amount': return deal.amountValue ?? deal.amountUsd ?? null;
    case 'date': return deal.date ? String(deal.date).slice(0, 7) : null; // mes: las fechas de publicación varían ±días
    case 'lead_investors': return setOf(deal.investors?.filter((i) => i.role === 'lead').map((i) => i.fundId));
    case 'co_investors': return setOf(deal.investors?.filter((i) => i.role === 'co').map((i) => i.fundId));
    case 'partners': return setOf(deal.partners?.map((p) => p.personKey));
    default: return null;
  }
}
const eq = (a, b, field) => field === 'amount' ? Math.abs(a - b) <= 0.01 * Math.max(a, b) : a === b;

/**
 * Precisión y recall por campo. pred y gold: listas de deals por página ({url, deals}).
 * Deals se emparejan por (url, startup). Para listas se cuentan elementos (micro).
 */
export function comparePerField(predPages, goldPages) {
  const stats = Object.fromEntries(EVAL_FIELDS.map((f) => [f, { tp: 0, fp: 0, fn: 0 }]));
  const goldBy = new Map(goldPages.map((p) => [p.url, p.deals]));
  for (const page of predPages) {
    const gold = goldBy.get(page.url) || [];
    const used = new Set();
    for (const d of page.deals) {
      const g = gold.find((x, i) => !used.has(i) && fieldValue(x, 'startup') === fieldValue(d, 'startup'));
      if (g) used.add(gold.indexOf(g));
      for (const f of EVAL_FIELDS) {
        const pv = fieldValue(d, f), gv = g ? fieldValue(g, f) : (f.endsWith('s') ? new Set() : null);
        if (pv instanceof Set) {
          for (const x of pv) (gv.has(x) ? stats[f].tp++ : stats[f].fp++);
          for (const x of gv) if (!pv.has(x)) stats[f].fn++;
        } else if (pv != null && gv != null) { if (eq(pv, gv, f)) stats[f].tp++; else { stats[f].fp++; stats[f].fn++; } }
        else if (pv != null) stats[f].fp++;
        else if (gv != null) stats[f].fn++;
      }
    }
    gold.forEach((g, i) => { if (used.has(i)) return; for (const f of EVAL_FIELDS) { const gv = fieldValue(g, f); if (gv instanceof Set) stats[f].fn += gv.size; else if (gv != null) stats[f].fn++; } });
  }
  for (const f of EVAL_FIELDS) {
    const s = stats[f];
    s.precision = s.tp + s.fp ? s.tp / (s.tp + s.fp) : null;
    s.recall = s.tp + s.fn ? s.tp / (s.tp + s.fn) : null;
    s.f1 = s.precision != null && s.recall != null && s.precision + s.recall ? 2 * s.precision * s.recall / (s.precision + s.recall) : null;
  }
  return stats;
}

/** Regla del Módulo 1: el modelo pequeño pasa a ser el predeterminado si iguala dentro de `margin` puntos en todos los campos con datos. */
export function smallModelWins(big, small, margin = 0.03, metric = 'f1') {
  const gaps = EVAL_FIELDS.filter((f) => big[f][metric] != null && small[f][metric] != null).map((f) => ({ field: f, gap: big[f][metric] - small[f][metric] }));
  return { wins: gaps.length > 0 && gaps.every((g) => g.gap <= margin), gaps };
}

/** Intervalo de Wilson al 95 % para una proporción (para reportar precisión con muestras de ~100). */
export function wilson(k, n, z = 1.96) {
  if (!n) return [null, null];
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}

/** Precisión por campo desde la revisión manual (CSV con columnas ok_<campo> = si|no|vacío). */
export function precisionFromReview(rows) {
  const out = {};
  for (const f of EVAL_FIELDS) {
    const judged = rows.filter((r) => ['si', 'sí', 'no'].includes(String(r[`ok_${f}`] || '').trim().toLowerCase()));
    const ok = judged.filter((r) => String(r[`ok_${f}`]).trim().toLowerCase() !== 'no').length;
    const [lo, hi] = wilson(ok, judged.length);
    out[f] = { n: judged.length, ok, precision: judged.length ? ok / judged.length : null, ci95: [lo, hi] };
  }
  return out;
}

/** División estable train/test por URL (el test nunca se usa para entrenar). */
export const splitOf = (url, testShare = 0.2) => parseInt(createHash('sha256').update(url).digest('hex').slice(0, 8), 16) / 0xffffffff < testShare ? 'test' : 'train';

/** CSV mínimo (RFC 4180) para exportar e importar la revisión. */
export function toCsv(rows, columns) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\n');
}
export function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.length > 1 || r[0]);
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}
