/* ────────────────────────────────────────────────────────────────────────
   Los registros (Grants.gov, radar oficial) son PUNTEROS, no veredictos.
   Antes, sus convocatorias entraban a la lista con una regla de palabras (grantMatch) y sin que ningún modelo leyera nada:
   así llegó «Cognitive Neuroscience (CogNeuro)» de la NSF a un proyecto de datos de Alzheimer aunque su propia página excluye
   a las poblaciones clínicas. Ahora cada convocatoria del registro entra al MISMO motor que las del buscador web:
     · se lee la página oficial de la agencia (enlace «información adicional» del aviso) o, si no se puede, el texto del registro;
     · el modelo extrae con cita literal y el código comprueba citas y fechas contra hoy (verifyFinding);
     · el resultado se anota en la convocatoria (verification) y grantGate lo respeta: descartada con la razón real.
   Sin modelo disponible no se toca nada (el comportamiento anterior sigue).
   ──────────────────────────────────────────────────────────────────────── */
import { runObjective } from './engine.mjs';
import { compactVerification } from './verify.mjs';

const first = (lead, field) => (lead.evidence || []).find((e) => e.field === field);
const all = (lead, field) => (lead.evidence || []).filter((e) => e.field === field).map((e) => e.quote).filter(Boolean);
const longDate = (iso) => { const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); return d ? new Date(Date.UTC(+d[1], +d[2] - 1, +d[3])).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : null; };

/** ¿Es una convocatoria de un registro que aún no leyó ningún modelo? */
export const isRegistryCall = (l) => l.fundingType === 'grant' && l.kind === 'opportunity' && !l.verification && !String(l.externalId || '').startsWith('engine:') && (l.evidence || []).some((e) => /grants\.gov|official radar|nih|nsf/i.test(e.source || ''));

/** Texto de lectura con lo que dice el registro: título, número, agencia, estado, fechas, elegibilidad y descripción. */
export function registryText(lead) {
  let meta = {}; try { meta = JSON.parse(first(lead, 'registry')?.quote || '{}'); } catch { /* sin metadatos */ }
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(meta.closeDate || ''));
  const close = m ? `${m[3]}-${m[1]}-${m[2]}` : lead.deadline;
  return [
    `Title: ${lead.title}`, `Opportunity number: ${meta.number || lead.externalId || ''}`, `Agency: ${meta.agency || lead.org || ''}`,
    meta.status ? `Status in the Grants.gov registry: ${meta.status}` : null,
    close ? `Close date in the registry: ${longDate(close) || close} (${close})` : 'Close date in the registry: not published',
    first(lead, 'program') ? `Assistance listing: ${first(lead, 'program').quote}` : null,
    all(lead, 'eligibility').length ? `Eligible applicants (registry): ${all(lead, 'eligibility').join(' | ')}` : null,
    first(lead, 'scope') ? `Description: ${first(lead, 'scope').quote}` : null,
  ].filter(Boolean).join('\n');
}

export function seedFor(lead) {
  const official = lead.facts?.officialUrl || null; const text = registryText(lead);
  const url = official || first(lead, 'opportunity')?.url || lead.evidence?.[0]?.url;
  if (!url) return null;
  // Con página oficial: se lee ella (el texto del registro queda de respaldo). Sin ella: se lee el texto del registro tal cual.
  return { url, title: lead.title, markdown: official ? '' : text, description: text, providers: ['grants.gov'], family: 'registry', fixed: !official, seed: 'registry' };
}

export async function verifyRegistryLeads(leads, brief, { env = process.env, fetcher = fetch, signal, today = new Date(), max = Number(env.REGISTRY_VERIFY_MAX) || 20, run = runObjective, engineRuns = null, onProgress } = {}) {
  const stats = { checked: 0, kept: 0, dropped: 0, unread: 0, withOfficialPage: 0 };
  if (env.REGISTRY_VERIFY === 'off') return { leads, stats: { ...stats, skipped: 'off' } };
  const pick = leads.filter(isRegistryCall).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, max);
  const seeds = []; const byUrl = new Map();
  for (const l of pick) { const s = seedFor(l); if (!s) continue; if (s.markdown === '') stats.withOfficialPage++; seeds.push(s); byUrl.set(s.url, [...(byUrl.get(s.url) || []), l]); }
  if (!seeds.length) return { leads, stats };
  const verdicts = new Map();
  const result = await run('grant', brief, { env, fetcher, signal, today, seedPages: seeds, seedOnly: true, rounds: 1, expand: false, maxPages: seeds.length + 5, onVerdict: (x) => verdicts.set(x.url, x) });
  engineRuns?.push({ ...result.audit, attempt: 'registry' });
  onProgress?.(seeds.length);
  const findings = new Map(result.findings.map((f) => [f.url, f]));
  const touched = new Map();
  for (const [url, group] of byUrl) {
    const x = verdicts.get(url);
    for (const l of group) {
      stats.checked++;
      if (!x) { stats.unread++; touched.set(l, { ...l, registryCheck: { unread: true } }); continue; }
      const f = findings.get(url); const v = x.v;
      const tier = v.keep ? (v.verdict === 'apply' ? 'main' : 'verify') : 'drop';
      const next = { ...l, verification: compactVerification({ ...v, tier }), registryCheck: { read: true, via: x.trace?.fetchedVia || null, model: x.model || null, tier }, ...(v.keep ? {} : { trace: x.trace }) };
      if (v.keep) {
        stats.kept++;
        if (v.deadline) next.deadline = v.deadline;
        if (v.status && v.status !== 'n/a') next.status = v.status;
        if (v.amount) next.amount = v.amount;
        if (f?.explain) next.explain = f.explain;
        next.trace = x.trace;
      } else stats.dropped++;
      touched.set(l, next);
    }
  }
  return { leads: leads.map((l) => touched.get(l) || l), stats, audit: result.audit };
}
