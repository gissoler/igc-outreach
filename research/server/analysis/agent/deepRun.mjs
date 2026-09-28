// Orquestador del análisis profundo: un analista por contacto (en paralelo), luego estratega + crítico.
// Reutiliza fichas frescas (< maxAgeDays) y guarda todo: fichas, juicios de relación y datos de entrenamiento.
import { randomUUID } from 'node:crypto';
import { analyzeContact, agentRole } from './analyst.mjs';
import { buildRoadmap } from './strategist.mjs';
import { analyzeJob, leadKeyOf, PLAYBOOK } from '../advisor.mjs';
import { personKey } from '../entities.mjs';

/** Contactos a analizar: todas las personas de la evaluación + conectores que abren camino (aunque no sean leads). */
export function contactsFor(job, rules, { max = 20 } = {}) {
  const out = [], seen = new Set();
  const add = (c) => { const k = personKey(c.person); if (!k || seen.has(k)) return; seen.add(k); out.push(c); };
  const conn = new Map(rules.connectors.map((c) => [personKey(c.name), c]));
  const listed = new Set(rules.list.map((r) => r.leadKey));
  const people = (job.leads || []).filter((l) => l.person && l.kind !== 'opportunity');
  people.sort((a, b) => (listed.has(leadKeyOf(b)) - listed.has(leadKeyOf(a))) || (b.score || 0) - (a.score || 0));
  for (const l of people) {
    const c = conn.get(personKey(l.person));
    add({ leadKey: leadKeyOf(l), person: l.person, org: l.org, role: l.role, evidence: l.evidence || [], paths: l.paths || [], mode: c && !listed.has(leadKeyOf(l)) ? 'connector' : 'target', connectorTargets: c?.targets || [] });
  }
  for (const c of rules.connectors) add({ leadKey: null, person: c.name, org: c.org || null, role: c.role || null, evidence: [], paths: [], mode: 'connector', connectorTargets: c.targets });
  return out.slice(0, max);
}

async function pool(items, n, fn) {
  const results = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; results[k] = await fn(items[k], k); } }));
  return results;
}

/**
 * Corre el análisis profundo. `save(run)` se llama tras cada evento para que la UI vea el progreso.
 * Opciones: refresh (ignora fichas frescas), samples (best-of-n por ficha), maxContacts, maxSteps, concurrency.
 */
export async function runDeep({ job, store, userId, network, update, env = process.env, fetcher = fetch, signal, save = () => {}, refresh = false, samples = 1, maxContacts = 20, maxSteps = 6, concurrency = 3, maxAgeDays = 7 }) {
  const A = store.analysis;
  const role = agentRole(env);
  const run = { id: randomUUID(), userId, jobId: job.id, status: 'running', startedAt: new Date().toISOString(), role, events: [], dossiers: [], roadmap: null, critic: null, errors: [] };
  const emit = (e) => { run.events.push({ at: new Date().toISOString(), ...e }); if (run.events.length > 400) run.events.shift(); save(run); };
  if (!role) { run.status = 'failed'; emit({ type: 'error', message: 'No fleet model configured (VLLM_* or INTAKE_LLM_*).' }); return run; }
  const rules = analyzeJob(job, { events: A.outreachFor(userId), network, updates: update ? [update] : [] });
  const contacts = contactsFor(job, rules, { max: maxContacts });
  emit({ type: 'phase', message: `Analyzing ${contacts.length} contacts with ${role} (max ${maxSteps} steps each, ${concurrency} in parallel).` });
  const ctx = { brief: job.brief, update, store, userId, network, role, webBudget: 8 };
  const fresh = (c) => { if (refresh) return null; const d = A.latestDossier(userId, c.leadKey || `person:${personKey(c.person)}`); return d && (Date.now() - Date.parse(d.createdAt)) / 86400000 < maxAgeDays ? d : null; };
  const results = await pool(contacts, concurrency, async (c) => {
    const cached = fresh(c);
    if (cached) { emit({ type: 'cached', contact: c.person, message: `Card for ${c.person} reused (${cached.createdAt.slice(0, 10)}).` }); return { ...cached, cached: true }; }
    emit({ type: 'start', contact: c.person, message: `Researching ${c.person}${c.org ? ` (${c.org})` : ''} as ${c.mode === 'connector' ? 'conector' : 'objetivo'}…` });
    try {
      const r = await analyzeContact(c, ctx, { env, fetcher, signal, maxSteps, samples, onEvent: emit });
      const key = c.leadKey || `person:${personKey(c.person)}`;
      r.key = key;
      A.saveDossier({ key, userId, jobId: job.id, body: r });
      for (const p of r.dossier.warm_paths) A.saveEdgeJudgment({ id: randomUUID(), userId, jobId: job.id, from: p.via, to: c.person, judgment: p, evidence: p.evidence.map((id) => r.evidence.find((e) => e.id === id)).filter(Boolean), model: r.model, createdAt: r.createdAt });
      A.saveGeneration({ id: randomUUID(), userId, kind: 'dossier', model: r.model, system: r.training.system, input: r.training.input, output: r.training.output, createdAt: r.createdAt });
      emit({ type: 'done', contact: c.person, message: `${c.person}: ${r.dossier.role.kind}, fit ${r.dossier.fit.verdict}, route ${r.dossier.best_route.type} (${r.dossier.verification.dropped} claims dropped).` });
      return r;
    } catch (e) { run.errors.push({ contact: c.person, error: e.message }); emit({ type: 'error', contact: c.person, message: `${c.person}: ${e.message}` }); return null; }
  });
  run.dossiers = results.filter(Boolean);
  save(run);
  if (!run.dossiers.length) { run.status = 'failed'; emit({ type: 'error', message: 'No card could be completed.' }); return run; }
  try {
    const rm = await buildRoadmap({ dossiers: run.dossiers, brief: job.brief, update, playbook: PLAYBOOK, outreach: A.outreachFor(userId) }, { env, fetcher, signal, onEvent: emit });
    run.roadmap = rm.roadmap; run.critic = rm.critic; run.revised = rm.revised; run.strategistRole = rm.role;
    A.saveGeneration({ id: randomUUID(), userId, kind: 'roadmap', model: rm.model, system: rm.training.system, input: rm.training.input, output: rm.training.output, createdAt: new Date().toISOString() });
    run.status = run.errors.length ? 'partial' : 'done';
    emit({ type: 'phase', message: `Roadmap ready${rm.revised ? ' (revised after critique)' : ''}.` });
  } catch (e) { run.status = 'partial'; run.errors.push({ contact: 'estratega', error: e.message }); emit({ type: 'error', message: `Strategist: ${e.message}` }); }
  run.finishedAt = new Date().toISOString();
  save(run);
  return run;
}
