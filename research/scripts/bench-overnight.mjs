/* Banco nocturno: 3 briefs de grants y 3 de inversores, cada uno en su propio proceso (si uno falla, los demás siguen).
   Uso (lo llama scripts/bench-overnight.sh):
     node scripts/bench-overnight.mjs --list
     node scripts/bench-overnight.mjs --case <id> --out <dir> [--dry]
     node scripts/bench-overnight.mjs --summarize --out <dir>
   --dry: sin red ni modelos. GPT Researcher, el registro, las páginas y el modelo son simulaciones honestas (scripts/bench/fake.mjs):
   prueba que el banco, el motor y el resumen funcionan de punta a punta; NO mide calidad. */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const arg = (n, d = '') => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(n);
const ROOT = resolve(new URL('..', import.meta.url).pathname);
const GOLD = join(ROOT, 'eval/gold/mint-ad-gemini-2026-10-14.json');

/* Casos: 3 grants (EE. UU. con estado, ONG de EE. UU., ONG fuera de EE. UU.) y 3 inversores (mismo brief del jefe, empresa de EE. UU., UE). */
export const CASES = [
  { id: 'g1-mint-ad', kind: 'grant', brief: 'eval/briefs/jefe-igc-mint-ad-2026-10-12.json', objective: 'grant', gold: GOLD, why: 'brief del jefe: cobertura contra la lista de Gemini' },
  { id: 'g2-aha-nonprofit', kind: 'grant', brief: 'eval/briefs/aha-nonprofit.json', objective: 'grant', why: 'ONG de EE. UU.: elegibilidad por tipo de entidad y registro federal' },
  { id: 'g3-ngo-latam', kind: 'grant', brief: 'eval/briefs/ngo-latam-health.json', objective: 'grant', why: 'ONG en Colombia: no debe usar el registro de EE. UU. ni traer convocatorias solo-EE. UU.' },
  { id: 'i1-mint-ad', kind: 'investment', brief: 'eval/briefs/jefe-igc-mint-ad-2026-10-12.json', objective: 'investment', why: 'brief del jefe, objetivo inversión (seed, salud digital, Maryland)' },
  { id: 'i2-aha-commercial', kind: 'investment', brief: 'eval/briefs/aha-commercial.json', objective: 'investment', why: 'empresa de EE. UU., datos de salud / IA' },
  { id: 'i3-medtech-eu', kind: 'investment', brief: 'eval/briefs/medtech-eu-forprofit.json', objective: 'investment', why: 'startup en España: inversores europeos' },
];

/** Los briefs de eval/ son del motor (sin nombre ni rol, etapas libres): se completan con valores neutros para el formulario de la app.
    Solo se rellenan campos de formulario; nada de lo que decide la búsqueda (producto, sector, geografía, entidad) se inventa. */
const STAGES = ['idea', 'prototype', 'preclinical', 'clinical_phase_1', 'clinical_phase_2', 'clinical_phase_3', 'marketed', 'other'];
export function benchBrief(raw, objective) {
  const str = (v, n = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const stage = STAGES.includes(raw.stage) ? raw.stage : 'other';
  return { useTeam: false, useApify: false, minDays: 30, mode: 'strategic', ...raw,
    name: str(raw.name) || 'Benchmark', role: str(raw.role) || 'Founder', company: str(raw.company) || 'Applicant', product: str(raw.product) || str(raw.oneLiner) || str(raw.company) || 'Product',
    description: str(raw.description || raw.oneLiner || raw.product, 3000) || 'Not stated', industry: str(raw.industry) || 'Not stated', geography: str(raw.geography) || str(raw.country) || 'Global',
    stage, ...(stage !== raw.stage && raw.stage ? { criteria: str(`${raw.criteria || ''} Stage as stated: ${raw.stage}`, 1000) } : {}),
    dataMode: 'live', fundingTypes: [objective] };
}
const secs = (ms) => (ms == null ? null : Math.round(ms / 1000));
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** Tiempo por etapa a partir de los eventos en vivo de la corrida (inicio/fin por fuente). */
function stageTimes(job) {
  const ev = job.run?.events || []; const t0 = Date.parse(job.createdAt || ev[0]?.at || Date.now());
  const done = (p) => ev.filter((e) => e.provider === p && e.phase === 'source_completed').map((e) => e.durationMs).find((x) => x != null) ?? null;
  const evalMs = ev.find((e) => e.title === 'Candidates ranked')?.durationMs ?? null;
  const ea = (job.engineAudit || [])[0] || {};
  return {
    search_s: ea.gptr?.search_seconds ?? null,
    judge_s: ea.gptr?.seconds != null && ea.gptr?.search_seconds != null ? ea.gptr.seconds - ea.gptr.search_seconds : null,
    engine_s: secs(done('Web research engine')),
    contacts_s: secs(done('Hunter.io')) ?? null,   // «Contact Finder» en la interfaz
    evaluator_s: secs(evalMs),
    total_s: job.finishedAt ? secs(Date.parse(job.finishedAt) - t0) : null,
  };
}

/** Resultado compacto de una corrida (real o simulada), con la misma forma para el resumen. */
function caseResult(c, job, { started, error = null, dry = false } = {}) {
  const leads = job?.leads || []; const ea = (job?.engineAudit || [])[0] || {};
  const lists = { top: 0, radar: 0, discarded: 0 }; for (const l of leads) lists[l.bucket] = (lists[l.bucket] || 0) + 1;
  const engineLeadsOnly = leads.filter((l) => (l.foundBy || []).some((f) => ['Web research engine', 'Grants.gov'].includes(f.provider)));
  const out = {
    id: c.id, kind: c.kind, objective: c.objective, brief: c.brief, why: c.why, dry, ok: !error && Boolean(job) && job.status !== 'failed', status: job?.status || 'failed', error,
    started: new Date(started).toISOString(), seconds: secs(Date.now() - started), stages: job ? stageTimes(job) : {},
    urls: { gptr: ea.gptr?.urls ?? null, registry: ea.gptr?.registry?.seeds ?? null, opened: ea.triage?.opened ?? ea.opens ?? null, assessed: ea.triage?.assessed ?? null, by_status: ea.triage?.by_status || null },
    findings: { verified: engineLeadsOnly.filter((l) => l.verification?.tier === 'main').length, to_review: engineLeadsOnly.filter((l) => l.verification?.tier !== 'main').length },
    lists, apollo_credits: (ea.contacts?.credits || 0) + (job?.apollo?.creditsEstimated || 0), apollo_people: ea.contacts?.people || 0,
    errors: [...(ea.errors || []), ...((job?.events || []).filter((e) => ['warning', 'error'].includes(e.phase)).map((e) => e.message))].slice(0, 12),
    skipped_for_time: ea.skipped_for_time || 0, timed_out: Boolean(job?.timedOut),
    top: leads.filter((l) => l.bucket !== 'discarded').slice(0, 10).map((l) => ({ title: String(l.title || l.org || '').slice(0, 120), list: l.bucket, deadline: l.deadline || null, verified: l.verification?.tier === 'main', url: (l.evidence || [])[0]?.url || null, contacts: (l.contacts || []).length })),
  };
  if (c.gold && existsSync(c.gold)) out.coverage = coverageOf(c.gold, leads);
  return out;
}
function coverageOf(goldPath, leads) {
  const g = readJson(goldPath).gold.map((x) => ({ ...x, re: new RegExp(x.match, 'i') }));
  return g.map((x) => {
    const hit = leads.find((l) => x.re.test(`${l.title || ''} ${l.org || ''} ${l.externalId || ''} ${(l.evidence || []).map((e) => e.url).join(' ')} ${l.registry?.number || ''}`));
    return { id: x.id, label: x.label, found: Boolean(hit), list: hit?.bucket || null, deadline: hit?.deadline || null, expected: x.deadline || null, verified: hit?.verification?.tier === 'main', why_out: hit?.bucket === 'discarded' ? hit.discard : null };
  });
}

/* ── Una corrida real: el pipeline completo, como desde el frontend ── */
async function runReal(c, outDir) {
  const { validateBrief } = await import('../server/research/core.mjs');
  const { createStore } = await import('../server/research/store.mjs');
  const { runResearch } = await import('../server/research/pipeline.mjs');
  const raw = readJson(join(ROOT, c.brief));
  const brief = validateBrief(benchBrief(raw, c.objective));
  const job = { id: randomUUID(), brief, mode: 'live', events: [], leads: [], senderEvidence: [], createdAt: new Date().toISOString() };
  const store = createStore(':memory:');
  const env = { ...process.env, ENGINE_AGENT_TRACE_DIR: outDir };
  const keep = setInterval(() => {}, 5000);   // mantiene vivo el proceso mientras corren los temporizadores del pipeline
  try { await runResearch(job, store, { env }); } finally { clearInterval(keep); }
  writeFileSync(join(outDir, 'job.json'), JSON.stringify(job, null, 1));
  return job;
}

/* ── Una corrida simulada: mismo motor (runGptr → juez → engineLeads → evaluate), todo lo externo falso ── */
async function runDry(c, outDir) {
  if (process.env.BENCH_DRY_FAIL === c.id) throw new Error(`fallo simulado en ${c.id} (BENCH_DRY_FAIL): el banco debe seguir con los demás`);
  const { runGptr } = await import('../server/research/gptr.mjs');
  const { createTools } = await import('../server/research/agentic/tools.mjs');
  const { engineLeads } = await import('../server/research/engine.mjs');
  const { evaluate, validateBrief } = await import('../server/research/core.mjs');
  const fake = await import('./bench/fake.mjs');
  const raw = readJson(join(ROOT, c.brief)); const brief = validateBrief(benchBrief(raw, c.objective));
  const world = c.gold ? fake.loadWorld(c.gold) : { today: '2026-10-14', registry: [], pages: new Map(), extra_log_urls: [] };
  if (c.objective === 'investment') world.pages.set('https://example.test/fixture-fund', { title: 'Fixture Ventures', text: 'Fixture Ventures invests in seed-stage digital health and medical technology companies in the United States and Europe.\nWe led a seed round in Example Health in March 2026.\nPitch us through the contact form.' });
  const log = (c.gold ? readFileSync(join(ROOT, 'tests/fixtures/v14fix/gptr-log-mintad-20261014-013838.txt'), 'utf8') : '') + '\n' + [...world.extra_log_urls, ...world.pages.keys()].map((u) => `Added source url to research: ${u}`).join('\n');
  const tools = createTools({ env: {}, readers: { open: fake.mapReader(world.pages) }, limits: { opens: 400, apolloCredits: 0 }, apollo: { organizationSearch: async () => ({ data: {} }), peopleSearch: async () => ({ data: {} }), stats: {} } });
  const started = Date.now(); const t = world.today;
  const r = await runGptr(c.objective, brief, { env: { SIMPLER_GRANTS_API_KEY: 'fixture', ENGINE_AGENT_TRACE_DIR: outDir }, today: t, gptrRunner: async () => ({ early: true }), registryFetcher: fake.registryFetcher(world.registry), logText: log, reportText: '', chat: fake.honestChat({ today: t, objective: c.objective }), tools });
  const leads = evaluate(engineLeads(r.findings), brief, new Set(), new Date(`${t}T12:00:00Z`), []);
  const ms = Date.now() - started;
  return { id: 'dry', brief, status: 'done', createdAt: new Date(started).toISOString(), finishedAt: new Date().toISOString(), leads, events: [],
    engineAudit: [{ objective: c.objective, gptr: { ...r.audit.gptr, search_seconds: 0, seconds: Math.round(ms / 1000) }, triage: r.audit.triage, contacts: r.audit.contacts, errors: r.audit.errors || [] }], run: { events: [] } };
}

async function runCase(id, outRoot, dry) {
  const c = CASES.find((x) => x.id === id); if (!c) throw new Error(`caso desconocido: ${id}`);
  const dir = join(outRoot, c.id); mkdirSync(dir, { recursive: true });
  const started = Date.now(); let job = null; let error = null;
  const hard = Number(process.env.BENCH_CASE_MAX_MS) || 16 * 60_000;   // ningún caso puede colgar la noche
  try { job = await Promise.race([dry ? runDry(c, dir) : runReal(c, dir), new Promise((_, rej) => setTimeout(() => rej(new Error(`BENCH_CASE_TIMEOUT ${Math.round(hard / 60000)} min`)), hard).unref())]); }
  catch (e) { error = String(e?.stack || e?.message || e).split('\n').slice(0, 3).join(' | '); }
  const res = caseResult(c, job, { started, error, dry });
  writeFileSync(join(dir, 'result.json'), JSON.stringify(res, null, 1));
  console.log(`[bench] ${c.id}: ${res.ok ? 'ok' : 'FALLÓ'} en ${res.seconds}s · ${res.lists.top} act now · ${res.lists.radar} watch · verificados ${res.findings.verified}${error ? ` · ${error}` : ''}`);
  return res;
}

/* ── RESUMEN.md legible ── */
const cell = (v) => (v == null || v === '' ? '—' : String(v).replace(/\|/g, '/'));
export function summarize(outRoot, ids = null) {
  const rows = CASES.filter((c) => !ids || ids.includes(c.id)).map((c) => { const p = join(outRoot, c.id, 'result.json'); return existsSync(p) ? readJson(p) : { id: c.id, kind: c.kind, ok: false, status: 'no corrió', error: 'sin result.json (el proceso murió o no llegó a correr)', stages: {}, urls: {}, findings: {}, lists: {}, errors: [] }; });
  const dry = rows.some((r) => r.dry);
  const L = [];
  L.push(`# Banco nocturno ${outRoot.split('/').pop()}${dry ? ' (SIMULACIÓN --dry: no mide calidad)' : ''}`, '');
  L.push(`Casos: ${rows.length} · correctos: ${rows.filter((r) => r.ok).length} · fallidos: ${rows.filter((r) => !r.ok).length} · tiempo total: ${rows.reduce((n, r) => n + (r.seconds || 0), 0)} s`, '');
  L.push('## Tiempo por etapa (segundos)', '', '| Caso | Estado | Búsqueda GPTR | Juez | Motor total | Contact Finder | Evaluador | Corrida total |', '|---|---|---|---|---|---|---|---|');
  for (const r of rows) L.push(`| ${r.id} | ${r.ok ? 'ok' : `**${cell(r.status)}**`}${r.timed_out ? ' (parcial por tiempo)' : ''} | ${cell(r.stages.search_s)} | ${cell(r.stages.judge_s)} | ${cell(r.stages.engine_s)} | ${cell(r.stages.contacts_s)} | ${cell(r.stages.evaluator_s)} | ${cell(r.stages.total_s ?? r.seconds)} |`);
  L.push('', '## Qué leyó y qué encontró', '', '| Caso | URLs de GPTR | Del registro oficial | Abiertas | Leídas por el modelo | Verificados | A revisar | Act now | Watch | Ruled out | Créditos Apollo | Personas Apollo |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) L.push(`| ${r.id} | ${cell(r.urls.gptr)} | ${cell(r.urls.registry)} | ${cell(r.urls.opened)} | ${cell(r.urls.assessed)} | ${cell(r.findings.verified)} | ${cell(r.findings.to_review)} | ${cell(r.lists.top)} | ${cell(r.lists.radar)} | ${cell(r.lists.discarded)} | ${cell(r.apollo_credits)} | ${cell(r.apollo_people)} |`);
  const mint = rows.find((r) => r.coverage);
  if (mint) {
    L.push('', '## MINT AD: cobertura contra la lista de Gemini', '', '| Convocatoria | ¿Apareció? | Lista | Cierre hallado | Cierre esperado | Verificada |', '|---|---|---|---|---|---|');
    for (const g of mint.coverage) L.push(`| ${g.label} | ${g.found ? 'sí' : '**no**'} | ${cell(g.list)} | ${cell(g.deadline)} | ${cell(g.expected)} | ${g.verified ? 'sí' : 'no'} |`);
    L.push('', `Cobertura: ${mint.coverage.filter((g) => g.found).length}/${mint.coverage.length}.`);
  }
  L.push('', '## Lo mejor de cada caso');
  for (const r of rows) { L.push('', `### ${r.id}${r.why ? ` — ${r.why}` : ''}`); if (!r.top?.length) L.push('Sin candidatos.'); else for (const t of r.top.slice(0, 6)) L.push(`- ${t.verified ? '✔' : '·'} ${t.title}${t.deadline ? ` (cierre ${t.deadline})` : ''} — ${t.list}${t.contacts ? ` · ${t.contacts} contactos` : ''}${t.url ? ` — ${t.url}` : ''}`); }
  L.push('', '## Errores y avisos');
  for (const r of rows) if (r.error || r.errors?.length) L.push('', `**${r.id}**`, ...(r.error ? [`- ERROR: ${r.error}`] : []), ...(r.errors || []).slice(0, 6).map((e) => `- ${String(e).slice(0, 220)}`));
  L.push('', 'Trazas por caso: `<caso>/gptr.log`, `<caso>/gptr-raw-*.log` (log crudo de GPT Researcher), `<caso>/gptr-seeds-*.json` (qué fue al juez y por qué), `<caso>/*-gptr-*/events.jsonl`, `<caso>/job.json`, `<caso>/result.json`.');
  writeFileSync(join(outRoot, 'RESUMEN.md'), L.join('\n') + '\n');
  return L.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (has('--list')) { for (const c of CASES) console.log(c.id); process.exit(0); }
  const out = resolve(arg('--out', join(ROOT, 'eval/results', `bench-${new Date().toISOString().slice(0, 10)}`))); mkdirSync(out, { recursive: true });
  if (has('--summarize')) { summarize(out, arg('--cases') ? arg('--cases').split(/[\s,]+/).filter(Boolean) : null); console.log(`[bench] resumen: ${join(out, 'RESUMEN.md')}`); process.exit(0); }
  const id = arg('--case'); if (!id) { console.error('falta --case <id> (o --list / --summarize)'); process.exit(2); }
  runCase(id, out, has('--dry')).then((r) => process.exit(r.ok ? 0 : 1), (e) => { console.error(e); process.exit(1); });
}
