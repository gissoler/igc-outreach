// Señales del momento (pilar A): ¿puede invertir AHORA? Cada señal lleva fecha y enlace.
//  - Vehículo nuevo: Form D de un fondo VC (no enmienda) en los 12 meses previos al corte.
//  - Ritmo: deals de los últimos 6 meses en la base propia.
//  - Último deal en el sector del perfil.
//  - Inactividad: sin deals ni vehículo en 18 meses → baja en la lista con el motivo visible.
import { readFileSync, existsSync } from 'node:fs';
import { fundKey, matchFunds, normOrg } from './entities.mjs';

const DAY = 86400000;
const monthsBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / (30.44 * DAY);
const usd = (n) => n == null ? 'not reported' : n >= 1e6 ? `US$${(n / 1e6).toFixed(1)}M` : `US$${Math.round(n).toLocaleString('en-US')}`;

/** Clave del patrocinador de un vehículo. 'X a Series of Y LLC' es un SPV de la plataforma Y: el patrocinador es X. */
export function vehicleSponsor(entityName) {
  const name = String(entityName || '');
  const spv = name.match(/^(.*?)\s+(?:-\s+)?a\s+series\s+of\s+(.+)$/i);
  if (spv) return { kind: 'spv', sponsor: spv[1].replace(/\b(spv|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b.*$/i, '').trim(), platform: spv[2] };
  return { kind: /\bspv\b|co-?invest/i.test(name) ? 'spv' : 'fund', sponsor: name, platform: null };
}

/** Carga el JSON generado por `python -m warmpath.ingest.formd_vehicles` e indexa por clave de fondo. */
export function loadVehicles(path) {
  if (!path || !existsSync(path)) return { byKey: new Map(), count: 0, source: null };
  const data = JSON.parse(readFileSync(path, 'utf8'));
  return indexVehicles(data.vehicles || [], path);
}
export function indexVehicles(vehicles, source = null) {
  const byKey = new Map();
  for (const v of vehicles) {
    const s = vehicleSponsor(v.entityName);
    const key = fundKey(s.sponsor);
    if (!key || normOrg(s.sponsor).length < 3) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push({ ...v, kind: s.kind, sponsor: s.sponsor });
  }
  return { byKey, count: vehicles.length, source };
}

/** Señales de momento de un fondo al corte `asOf` (ISO). `deals` = deals del fondo (cualquier fecha). */
export function momentumSignals({ fundName, deals, vehicles, asOf, sector = null, paceMonths = 6, vehicleMonths = 12, inactiveMonths = 18 }) {
  const before = deals.filter((d) => d.date && d.date < asOf).sort((a, b) => b.date.localeCompare(a.date));
  const recent = before.filter((d) => monthsBetween(d.date, asOf) <= paceMonths);
  const signals = [];
  if (recent.length) signals.push({ type: 'ritmo', label: `${recent.length} deal${recent.length > 1 ? 's' : ''} in the last ${paceMonths} months`, date: recent[0].date, evidence: recent.slice(0, 3).map((d) => ({ url: d.url, quote: d.quote, date: d.date })) });
  const inSector = sector ? before.find((d) => (d.sectors || [d.sector]).includes(sector)) : null;
  if (inSector) signals.push({ type: 'sector', label: `Last deal in ${sector}: ${inSector.startup} (${String(inSector.date).slice(0, 7)})`, date: inSector.date, evidence: [{ url: inSector.url, quote: inSector.quote, date: inSector.date }] });
  const key = fundKey(fundName);
  // Misma clave no basta: 'True Ventures' y 'True Equity III' comparten raíz pero no son el mismo fondo.
  const vs = (vehicles?.byKey.get(key) || []).filter((v) => matchFunds(v.sponsor, fundName).decision === 'auto' && v.filingDate && v.filingDate < asOf && monthsBetween(v.filingDate, asOf) <= vehicleMonths && !v.isAmendment);
  const fundVehicle = vs.find((v) => v.kind === 'fund');
  if (fundVehicle) signals.push({ type: 'vehiculo', label: `New Form D vehicle: ${fundVehicle.entityName} (${fundVehicle.filingDate}); offered ${usd(fundVehicle.totalOffering)}, sold ${usd(fundVehicle.totalSold)}`, date: fundVehicle.filingDate, evidence: fundVehicle.url ? [{ url: fundVehicle.url, quote: `Form D · ${fundVehicle.entityName} · Venture Capital Fund · filed ${fundVehicle.filingDate}`, date: fundVehicle.filingDate }] : [] });
  const spvs = vs.filter((v) => v.kind === 'spv');
  if (spvs.length) signals.push({ type: 'spv', label: `${spvs.length} new SPV${spvs.length > 1 ? 's' : ''} in Form D (12 months)`, date: spvs[0].filingDate, evidence: spvs.slice(0, 2).filter((v) => v.url).map((v) => ({ url: v.url, quote: `Form D · ${v.entityName} · filed ${v.filingDate}`, date: v.filingDate })) });
  const lastActivity = [before[0]?.date, ...vs.map((v) => v.filingDate)].filter(Boolean).sort().at(-1) || null;
  const inactive = !lastActivity || monthsBetween(lastActivity, asOf) > inactiveMonths;
  if (inactive) signals.push({ type: 'inactivo', label: lastActivity ? `No verifiable activity since ${String(lastActivity).slice(0, 7)}` : 'No verifiable activity in the base', date: lastActivity, evidence: [] });
  return { signals, pace: recent.length, lastActivity, inactive, newVehicle: Boolean(fundVehicle) };
}

/** Ajuste del ranking por momento. Parámetros a calibrar con el backtest (no son verdades). */
export const MOMENTUM_WEIGHTS = { pace: 0.04, paceCap: 3, vehicle: 0.06, spv: 0.02, inactive: -0.12 };
export function momentumAdjust(m, w = MOMENTUM_WEIGHTS) {
  return Math.min(m.pace, w.paceCap) * w.pace + (m.newVehicle ? w.vehicle : 0) + (m.signals.some((s) => s.type === 'spv') ? w.spv : 0) + (m.inactive ? w.inactive : 0);
}
