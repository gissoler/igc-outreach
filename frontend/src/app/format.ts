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
/** Cuts at a word boundary (never mid-word) and adds "…" only when something was removed. */
export const clipWords = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n - 1);
  const at = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('. ') + 1);
  return `${(at > n * 0.5 ? cut.slice(0, at) : cut).replace(/[\s,;:.\-–—(]+$/, '')}…`;
};
/** Model text without leaked citations such as "(evidence_id: e56fb11a…)" or "[evidence_id=…]". */
export const cleanText = (s: string) => String(s || '')
  .replace(/\s*[([]\s*evidence[_ ]?ids?\s*[:=]\s*[^)\]]*[)\]]/gi, '')
  .replace(/\s*\bevidence[_ ]?id\s*[:=]\s*\S+/gi, '')
  .replace(/\s+([.,;:])/g, '$1').replace(/\s{2,}/g, ' ').trim();
/** Some sources store the quote as JSON, others as scraped markdown: shown as plain readable text. */
export const readableQuote = (q: string) => {
  const t = q.trim();
  if (t.startsWith('{')) {
    try { const o = JSON.parse(t) as Record<string, unknown>; return Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${String(v)}`).join(' · '); } catch { /* falls through */ }
  }
  return t
    .replace(/!\[[^\]]*\]\([^)]*\)?/g, ' ')                 // markdown images
    .replace(/\[([^\]]*)\]\((?:https?:[^)]*|[^)]*)\)?/g, '$1') // [text](url) → text
    .replace(/^[^\n]{0,80}?\.(?:png|jpe?g|gif|webp|svg)\)?/i, ' ') // leftover file name at the start
    .replace(/\]?\(https?:[^)\s]*\)?/g, '')                    // dangling (url)
    .replace(/%20/g, ' ').replace(/\\+/g, ' · ').replace(/[\[\]]/g, '')
    .replace(/(?:\s*·\s*){2,}/g, ' · ').replace(/^[\s·]+|[\s·]+$/g, '').replace(/\s{2,}/g, ' ');
};
