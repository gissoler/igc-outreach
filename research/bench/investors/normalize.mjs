// FIX-06 — normalización determinista del juez v2 (tipos, etapas, geografía, lead).
// Tabla versionada: docs/contracts/investor/vocab/normalization.v1.json. Cambiarla exige v2 y config nueva.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '../../..');
export function loadNormalization(version = 'normalization.v1') {
  return JSON.parse(readFileSync(resolve(repo, `docs/contracts/investor/vocab/${version}.json`), 'utf8'));
}
const DEFAULT = loadNormalization();
const lc = v => String(v ?? '').trim().toLowerCase();
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordIn = (hay, needle) => new RegExp(`(?:^|[^a-z0-9])${escape(lc(needle))}(?:$|[^a-z0-9])`, 'i').test(lc(hay));

export function typeState(profileTypes, entityType, n = DEFAULT) {
  if (!profileTypes?.length || !entityType || entityType === 'unknown') return 'unknown';
  const map = Object.fromEntries(Object.entries(n.investor_type_map).map(([k, v]) => [lc(k), v]));
  let unmapped = false; const allowed = new Set();
  for (const t of profileTypes) { const m = map[lc(t)]; if (!m) unmapped = true; else m.forEach(x => allowed.add(x)); }
  if (allowed.has(entityType)) return 'met';
  return unmapped ? 'unknown' : 'not_met';
}

export function stageOrdinals(strings, n = DEFAULT) {
  const explicit = new Set(), vague = new Set();
  for (const s of strings ?? []) for (const [re, ords, kind] of n.stage_patterns) if (new RegExp(re, 'i').test(s)) ords.forEach(o => (kind === 'explicit' ? explicit : vague).add(o));
  return { explicit, vague };
}
export function stageState(profileStage, entityStages, n = DEFAULT) {
  const p = n.stage_ordinal[lc(profileStage)];
  if (!p || !entityStages?.length) return 'unknown';
  const { explicit, vague } = stageOrdinals(entityStages, n);
  if (p.some(o => explicit.has(o) || vague.has(o))) return 'met';
  if (explicit.size) return 'not_met';
  return 'unknown';
}
/** V4-DBG-2: ¿la etapa del perfil está cubierta por evidencia explícita (no solo "early-stage"/"growth")? */
export function stageExplicitMet(profileStage, entityStages, n = DEFAULT) {
  const p = n.stage_ordinal[lc(profileStage)];
  if (!p || !entityStages?.length) return false;
  const { explicit } = stageOrdinals(entityStages, n);
  return p.some(o => explicit.has(o));
}

/**
 * Geografía: cada cadena de la firma se expande a países por las regiones y países que nombra (palabra completa).
 * Una cadena que no nombra ninguna región ni país conocido, o que es vaga ("global"), no puede producir not_met.
 */
export function geoState(profileCountries, entityGeos, n = DEFAULT) {
  const profile = new Set((profileCountries ?? []).filter(Boolean).map(lc));
  if (!profile.size || !entityGeos?.length) return 'unknown';
  const regions = Object.entries(n.geo_regions);
  const known = new Set([...regions.flatMap(([, cs]) => cs), ...(n.countries ?? []), ...[...profile]].map(lc));
  const expanded = new Set(); let vague = false, unrecognized = 0;
  const aliases = Object.entries(n.geo_aliases ?? {}).sort((a, b) => b[0].length - a[0].length);
  const deaccent = v => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const raw of entityGeos) {
    let s = lc(raw);
    for (const [from, to] of aliases) if (s === from || wordIn(s, from) || deaccent(s) === deaccent(from) || wordIn(deaccent(s), deaccent(from))) s = `${s} ${lc(to)}`;
    s = deaccent(s);
    if (n.geo_unknown_terms.some(t => s.includes(lc(t)))) { vague = true; continue; }
    let recognized = false;
    for (const [name, countries] of regions) if (s === lc(name) || wordIn(s, name)) { countries.forEach(c => expanded.add(lc(c))); recognized = true; }
    for (const c of known) if (s === c || wordIn(s, c)) { expanded.add(c); recognized = true; }
    if (!recognized) unrecognized++;
  }
  // V4-DBG-4: una subdivisión no reconocida ("California") no vuelve vaga una lista que sí nombra países ("US").
  if (unrecognized && !expanded.size) vague = true;
  if ([...profile].some(c => expanded.has(c))) return 'met';
  if (expanded.size && !vague) return 'not_met';
  return 'unknown';
}

export function leadState(pref, entityLead, n = DEFAULT) {
  if (pref == null || !String(pref).trim()) return 'not_applicable';
  const want = n.lead_map[lc(pref)] ?? null;
  if (!entityLead || entityLead === 'unknown' || !want) return 'unknown';
  return entityLead === 'both' || entityLead === want ? 'met' : 'not_met';
}
