/* Consistent formatting (en-US) for numbers, percentages, dates and durations. */
const LOCALE = 'en-US';

export const fmtInt = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString(LOCALE);
export const fmtNum = (n: number | null | undefined, digits = 1) => n == null || !Number.isFinite(n) ? '—' : n.toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });
/** 0–1 → "45%". */
export const fmtPct = (ratio: number | null | undefined, digits = 0) => ratio == null || !Number.isFinite(ratio) ? '—' : `${(ratio * 100).toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
/** "7 of 22 (32%)". */
export const fmtShare = (part: number, total: number) => total ? `${fmtInt(part)} of ${fmtInt(total)} (${fmtPct(part / total)})` : `${fmtInt(part)} of 0`;
export const fmtUsd = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? '—' : `US$${n.toLocaleString(LOCALE, { maximumFractionDigits: 0 })}`;
export const fmtUsdCompact = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1e9) return `US$${fmtNum(n / 1e9, 1)} B`;
  if (n >= 1e6) return `US$${fmtNum(n / 1e6, 1)} M`;
  if (n >= 1e3) return `US$${fmtNum(n / 1e3, 0)} k`;
  return fmtUsd(n);
};

const valid = (s?: string | null) => { if (!s) return null; const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d; };
export const fmtDate = (s?: string | null) => { const d = valid(s); return d ? d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; };
export const fmtDateTime = (s?: string | null) => { const d = valid(s); return d ? d.toLocaleString(LOCALE, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; };
export const fmtTime = (s?: string | null) => { const d = valid(s); return d ? d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' }) : '—'; };
export const fmtDuration = (ms: number | null | undefined) => {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${fmtNum(s, s < 10 ? 1 : 0)} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${Math.round(s - m * 60)} s`;
};
/** Relative age: "3 days ago". */
export const fmtAge = (s?: string | null, now = Date.now()) => {
  const d = valid(s);
  if (!d) return 'no date';
  const days = Math.floor((now - d.getTime()) / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 60) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months < 24 ? `${months} months ago` : `${Math.round(months / 12)} years ago`;
};
export const plural = (n: number, one: string, many: string) => `${fmtInt(n)} ${n === 1 ? one : many}`;
export const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '·';
export const clip = (s: string, n: number) => s.length > n ? `${s.slice(0, n - 1)}…` : s;
/** Some sources store the quote as JSON: shown as "field: value · …". */
export const readableQuote = (q: string) => {
  const t = q.trim();
  if (!t.startsWith('{')) return q;
  try { const o = JSON.parse(t) as Record<string, unknown>; return Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${String(v)}`).join(' · '); } catch { return q; }
};
