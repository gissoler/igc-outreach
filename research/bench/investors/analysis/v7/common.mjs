// Utilidades de solo lectura para los análisis v7 (eventos, último intento por corrida, cachés de carpetas anteriores).
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { openReadOnlyCache } from '../../cache-layers.v7.mjs';
export const INV = resolve(import.meta.dirname, '../..');
export const OUT = resolve(INV, 'out');
export const DIRS = { pairs: resolve(OUT, 'investors-internal-2026-10-09-v5-pairs'), v5: resolve(OUT, 'investors-internal-2026-10-09-v5'), quick: resolve(OUT, 'quick-v5-2026-10-09'), v6: resolve(OUT, 'investors-internal-2026-10-09-v6') };
export const V5NS = 'investors-investors-internal-2026-10-09-v5', V6NS = 'investors-investors-internal-2026-10-09-v6';
export const READ_LAYERS = [{ path: resolve(DIRS.pairs, 'cache.sqlite'), namespace: V5NS }, { path: resolve(DIRS.quick, 'cache.sqlite'), namespace: V5NS }, { path: resolve(DIRS.v5, 'cache.sqlite'), namespace: V5NS }, { path: resolve(DIRS.v6, 'cache.sqlite'), namespace: V6NS }];
export const host = u => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } };
export const parseRid = rid => { const m = rid.match(/__inv-case-syn-(p\d\d|n\d\d|r\d\d)(-ib)?__(B\w+)__s(\d+)$/); return m ? { case: m[1], variant: m[2] ? 'B' : 'A', cond: m[3], seed: Number(m[4]) } : null; };
export function readEvents(dir) {
  const f = resolve(dir, 'events.jsonl'); if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
}
/** Eventos del último intento (desde el último run_start) de cada run_id que terminó con run_end. */
export function lastAttempts(events) {
  const by = new Map();
  for (const e of events) if (e.run_id) { if (!by.has(e.run_id)) by.set(e.run_id, []); by.get(e.run_id).push(e); }
  const out = new Map();
  for (const [rid, evs] of by) {
    let i = -1; evs.forEach((e, k) => { if (e.event === 'run_start') i = k; });
    const la = i < 0 ? evs : evs.slice(i).filter(e => e.timestamp >= evs[i].timestamp);
    if (la.some(e => e.event === 'run_end' && e.status === 'valid')) out.set(rid, la);
  }
  return out;
}
/** Corridas con result.json en una carpeta y sus eventos (buscados en todas las carpetas, primera que tenga run_end válido). */
export function loadRuns(dir, evDirs = Object.values(DIRS)) {
  const evs = evDirs.map(d => lastAttempts(readEvents(d)));
  const runsDir = resolve(dir, 'runs'); if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir).flatMap(name => {
    const f = resolve(runsDir, name, 'result.json'); if (!existsSync(f)) return [];
    const r = JSON.parse(readFileSync(f, 'utf8')), rid = r.run_id;
    const ev = evs.map(m => m.get(rid)).find(Boolean) ?? [];
    return [{ rid, ...parseRid(rid), r, ev }];
  });
}
export const openLayers = () => READ_LAYERS.filter(l => existsSync(l.path)).map(openReadOnlyCache);
export const median = xs => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export function loadLabels() {
  const L = new Map();
  for (const l of readFileSync(resolve(INV, 'gold/v3/labels/adjudicator.jsonl'), 'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x))) L.set(`${l.case_id}|${l.stable_id}`, l);
  return L;
}
/** Misma regla que load.py (diagnóstico v8) para la ganancia de una etiqueta. */
export function investorGain(l) {
  if (l.identity_correct === false || (l.entity_kind && l.entity_kind !== 'institutional_investor') || l.active_status === 'inactive' || l.sector_fit === 'off' || l.hard_eligibility === 'ineligible' || l.overall_relevance === 'irrelevant') return 0;
  const hard = (l.criteria ?? []).some(c => ['INV-ACTIVE', 'INV-TYPE', 'INV-STAGE', 'INV-GEO', 'INV-CHECK', 'INV-BUSINESS-MODEL', 'INV-REGULATORY'].includes(c.criterion_id) && c.state === 'not_met');
  if (l.active_status === 'active' && l.overall_relevance === 'strong' && l.sector_fit === 'on' && l.hard_eligibility === 'eligible' && l.stage_fit === 'met' && l.geography_fit === 'met' && !hard) return 3;
  if (['active', 'possibly_active'].includes(l.active_status) && l.overall_relevance === 'plausible' && ['on', 'partial'].includes(l.sector_fit) && ['eligible', 'undetermined'].includes(l.hard_eligibility) && !hard) return 2;
  return 1;
}
