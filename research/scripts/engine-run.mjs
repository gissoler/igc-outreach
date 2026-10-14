// Corre el motor v2 contra internet real con un brief y escribe un reporte comparable.
// Uso: node --env-file-if-exists=.env scripts/engine-run.mjs [--brief eval/briefs/mentiva.json] [--objectives grant,investment]
//        [--label gpt-oss] [--out eval/runs/...] [--today 2026-09-29] [--cache eval/runs/search-cache.json] [--no-cache]
// Requiere ENGINE_V2 no; usa directamente runEngine. Modelo: rol "engine" (ENGINE_LLM_*) o, si falta, "chat" (Qwen3-30B).
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { takeCoverage } from 'node:v8';
import { runEngine } from '../server/research/engine.mjs';
import { searchProviders } from '../server/research/searchApis.mjs';
import { fleetConfig } from '../server/analysis/fleet.mjs';
import { hostOf } from '../server/research/verify.mjs';
import { createTrace } from '../server/research/trace.mjs';
import { COMPILER_PROMPT_VERSION, JUDGE_PROMPT_VERSION } from '../server/research/judge/prompts.v13.mjs';

const arg = (name, fallback = '') => { const at = process.argv.indexOf(name); return at >= 0 ? process.argv[at + 1] : fallback; };
const env = process.env;
const briefPath = resolve(arg('--brief', 'eval/briefs/mentiva.json'));
const briefBytes = readFileSync(briefPath);
const brief = JSON.parse(briefBytes.toString('utf8'));
const objectives = (arg('--objectives') || (brief.fundingTypes || ['grant']).join(',')).split(',').map((s) => s.trim()).filter(Boolean);
const today = arg('--today') || new Date().toISOString().slice(0, 10);
const engineRole = fleetConfig(env).roles.engine;
const label = arg('--label') || (engineRole.model || 'no-model').split('/').pop().replace(/[^a-z0-9.-]+/gi, '-').toLowerCase();
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const outDir = resolve(arg('--out') || join('eval/runs', `${stamp}-${label}`));
const cachePath = resolve(arg('--cache', 'eval/runs/search-cache.json'));
const useCache = !process.argv.includes('--no-cache');
const traceOn = process.argv.includes('--trace');
const dryRun = process.argv.includes('--dry-run');
const exaCapRaw = arg('--exa-usd-cap', '');
const exaUsdCap = exaCapRaw === '' ? Number.NaN : Number(exaCapRaw);

if (dryRun) {
  const planned = env.ENGINE_AGENT === '1' ? Number(env.ENGINE_AGENT_SEARCHES) || 20
    : (Number(env.ENGINE_MAX_QUERIES) || 10) * (Number(env.ENGINE_ROUNDS) || 2) + (Number(env.ENGINE_RESEARCH_SEARCHES) || 0);
  console.log(`Dry run: máximo ${planned} llamadas a Exa · ${(planned * 0.0089).toFixed(4)} USD a 0,0089 USD por llamada.`);
  process.exit(0);
}
mkdirSync(outDir, { recursive: true });

if (!engineRole.ready) { console.error('✖ No hay modelo: define ENGINE_LLM_URL + ENGINE_LLM_MODEL, o VLLM_CHAT_URL + VLLM_CHAT_MODEL.'); process.exit(2); }
if (!searchProviders(env).length) console.warn('⚠ Sin claves de APIs de búsqueda: se usará SearXNG o Firecrawl si están configurados.');

const cache = useCache && existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
const cachedBefore = Object.keys(cache).length;
console.log(`Motor v2 · ${objectives.join(', ')} · hoy=${today}\n  modelo: ${engineRole.model} @ ${engineRole.url}${engineRole.alias ? ' (rol chat)' : ''}\n  búsqueda: ${searchProviders(env).join(', ') || '(ninguna API)'}\n  caché de búsquedas: ${useCache ? `${cachedBefore} consultas guardadas` : 'no'}\n  salida: ${outDir}\n`);

const cfg = fleetConfig(env);
const safeFlags = Object.fromEntries(Object.entries(env).filter(([k]) => k.startsWith('ENGINE_') && !/(KEY|TOKEN|SECRET|PASSWORD)/i.test(k)));
const trace = traceOn ? createTrace({ dir: outDir, runId: `${label}-${Date.now()}`, objective: objectives.length === 1 ? objectives[0] : '-' }) : null;
const commit = (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } })();
const limits = { queries: Number(env.ENGINE_MAX_QUERIES) || 10, rounds: Number(env.ENGINE_ROUNDS) || 2, pages: Number(env.ENGINE_MAX_PAGES) || 40, research_searches: Number(env.ENGINE_RESEARCH_SEARCHES) || 0, exa_usd_cap: Number.isFinite(exaUsdCap) ? exaUsdCap : null };
trace?.event('run_start', { brief, brief_sha: createHash('sha256').update(briefBytes).digest('hex'), today, flags: safeFlags,
  models: Object.fromEntries(Object.entries(cfg.roles).filter(([, v]) => v?.ready).map(([k, v]) => [k, v.model])),
  prompts: { compiler: COMPILER_PROMPT_VERSION, judge: JUDGE_PROMPT_VERSION, planner: 'plan', reader: 'finding', followup: 'followup', researcher: 'research' }, git_commit: commit, limits });

const fixture = env.ENGINE_TEST_FIXTURE === '1';
const fixturePage = { url: 'https://fixture.example.org/call', title: 'Fixture call', markdown: 'Alzheimer research grant. Applications are open to US for-profit companies. Application deadline is December 15, 2026. Cash grant with no equity.' };
const fixtureSearch = async () => [fixturePage];
const fixtureChat = async ({ name }) => name === 'plan'
  ? { json: { queries: [{ query: 'fixture grants 2026', family: 'fixture' }, { query: 'fixture NIH 2026', family: 'fixture' }, { query: 'fixture Maryland 2026', family: 'fixture' }] }, model: 'fixture' }
  : { json: { relevant: true, kind: 'program', name: 'Fixture', official: true, status: 'open', deadline: '2026-12-15', eligible: 'yes', non_dilutive: 'yes', money: 'grant', page_type: 'call', applicants: { entity_types: ['for-profit companies'], for_profit_allowed: 'yes', students_or_academic_only: 'no', countries: ['US'], stage: null }, dates: [], scope_fit: { verdict: 'fits', reason: 'Alzheimer research', funds_quote: 'Alzheimer research grant.', excludes_quote: null, work_type: 'applied_research' }, summary: 'Fixture.', quotes: { identity: 'Alzheimer research grant.', deadline: 'Application deadline is December 15, 2026', eligible: 'open to US for-profit companies', status: 'Applications are open' } }, model: 'fixture' };
const t0 = Date.now();
const r = await runEngine(brief, { env, today, objectives, cache: useCache ? cache : undefined, trace: trace || undefined,
  ...(Number.isFinite(exaUsdCap) ? { exaUsdCap } : {}), ...(fixture ? { search: fixtureSearch, chat: fixtureChat, rounds: 1, maxPages: 2 } : {}) });
const seconds = Math.round((Date.now() - t0) / 1000);
trace?.event('run_end', { seconds, totals: { findings: r.findings.length, queries: r.queries.length, pages: r.audits.reduce((n, a) => n + (a.pages || 0), 0) } });
trace?.close();
if (useCache) { mkdirSync(resolve(cachePath, '..'), { recursive: true }); writeFileSync(cachePath, JSON.stringify(cache)); }

// Recall contra la lista de referencia (solo para Mentiva · grants)
function referenceRows() {
  const p = resolve('eval/search-quality-2026-09-29/reference-list.md');
  if (!existsSync(p)) return [];
  const md = readFileSync(p, 'utf8'); const part = md.split('## Cerradas')[0];
  return [...part.matchAll(/^\|\s*\d+\s*\|\s*([^|]+?)\s*\|\s*(https?:\/\/\S+?)\s*\|\s*([^|]*?)\s*\|/gm)].map((m) => ({ name: m[1], url: m[2], close: m[3] }));
}
const seg = (u) => { try { return new URL(u).pathname.split('/').filter(Boolean)[0] || ''; } catch { return ''; } };
const matches = (ref, url) => hostOf(ref.url) === hostOf(url) && (!seg(ref.url) || seg(ref.url) === seg(url));
const refs = objectives.includes('grant') && /mentiva/i.test(brief.company || '') ? referenceRows() : [];
const recall = refs.map((ref) => { const f = r.findings.find((x) => matches(ref, x.url)); return { ...ref, found: Boolean(f), verdict: f?.verdict || null, via: f?.providers || [] }; });

// Proveedores sumados sobre todos los objetivos
const prov = {};
for (const a of r.audits) for (const [p, s] of Object.entries(a.providers || {})) { const t = (prov[p] ||= { calls: 0, returned: 0, errors: 0, ms: 0, costUsd: 0, pagesRead: 0, kept: 0, keptOnlyHere: 0 }); for (const k of Object.keys(t)) t[k] += s[k] || 0; if (s.disabled) t.disabled = s.disabled; }

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const registry = [
  ['1', 'Eventos `page`: `found_by`.'], ['2', 'Eventos `page` con `read` y eventos `drop` con `read:false`.'],
  ['3', 'Eventos `drop`: `reason` y `decided_by`.'], ['4', 'Eventos `decision`: `dates` y `days_left`.'],
  ['5', 'Eventos `decision` agrupados por `page_ref` y `by`.'], ['6', '`summary.model_calls` y `summary.tools`.'],
  ['7', 'Eventos `lead`, `lead_followup` y `tool_call.from_lead`.'], ['8', 'Eventos `understand`, `ask_user` y `brief_patch`.'],
  ['9', 'Eventos `finish` y `budget`.'], ['10', 'Ruta `pages/<sha256>.txt` del evento `page`.'],
  ['11', 'Eventos `model_call` por `page_ref`.'], ['12', '`summary.coverage` desde `coverage/`.'],
];
const lines = [
  `# Motor v2 — ${brief.company || 'brief'} · ${objectives.join(', ')} · ${today}`, '',
  `- Modelo que planea y lee: \`${engineRole.model}\` (${engineRole.url})`,
  `- Búsqueda: ${searchProviders(env).join(', ') || 'sin APIs'} · rondas ${env.ENGINE_ROUNDS || 2} · duración ${seconds} s`,
  `- Caché de búsquedas: ${useCache ? `${cachedBefore} → ${Object.keys(cache).length} consultas` : 'desactivada'}`,
  '', '## Resumen por objetivo', '', '| Objetivo | Búsqueda | Consultas | Páginas | Leídas | Sin leer | Vía Jina Reader | Verificadas | Descartes |', '|---|---|---|---|---|---|---|---|---|',
  ...r.audits.map((a) => `| ${a.objective} | ${a.search} | ${a.queries} | ${a.pages} | ${a.read} | ${a.unread} | ${a.jinaRead || 0} | **${a.kept}** | ${esc(Object.entries(a.dropped || {}).map(([k, v]) => `${k} ${v}`).join(', '))} |`),
  '', '## Aporte de cada buscador', '', '| Proveedor | Llamadas | Resultados | Errores | Seg. medios | Coste US$ | Páginas leídas | Verificadas | Solo él las trajo | Nota |', '|---|---|---|---|---|---|---|---|---|---|',
  ...Object.entries(prov).map(([p, s]) => `| ${p} | ${s.calls} | ${s.returned} | ${s.errors} | ${s.calls ? (s.ms / s.calls / 1000).toFixed(1) : '-'} | ${s.costUsd ? s.costUsd.toFixed(3) : '-'} | ${s.pagesRead} | ${s.kept} | ${s.keptOnlyHere} | ${s.disabled ? `⚠ apagado: ${esc(s.disabled).slice(0, 90)}` : ''} |`),
  '', `## Oportunidades verificadas (${r.findings.length})`, '', '| # | Veredicto | Nombre | Estado | Cierre | Días | Elegible | Monto | Buscadores | URL |', '|---|---|---|---|---|---|---|---|---|---|',
  ...r.findings.map((f, i) => `| ${i + 1} | ${f.verdict} | ${esc(f.name || f.title)} | ${f.status} | ${f.deadline || '—'} | ${f.daysLeft ?? '—'} | ${f.eligible} | ${esc(f.amount) || '—'} | ${(f.providers || []).join(', ')} | ${f.url} |`),
  '', `## Pistas (${(r.leads || []).length})`, '', '| # | Tipo | Financiador | Receptor | Seguimientos | Produjo | URL |', '|---|---|---|---|---|---|---|',
  ...(r.leads || []).map((l, i) => `| ${i + 1} | ${esc(l.kind)} | ${esc(l.funder) || '—'} | ${esc(l.recipient) || '—'} | ${(l.followups || []).length} | ${(l.produced || []).length} | ${l.url || '—'} |`),
  ...(recall.length ? ['', `## Recall contra la lista de referencia: ${recall.filter((x) => x.found).length}/${recall.length}`, '', '| Programa | ¿Lo encontró? | Veredicto | Buscadores |', '|---|---|---|---|', ...recall.map((x) => `| ${esc(x.name)} | ${x.found ? '✔' : '✖'} | ${x.verdict || '—'} | ${x.via.join(', ') || '—'} |`)] : []),
  '', '## Citas de cada verificada', '',
  ...r.findings.flatMap((f, i) => [`**${i + 1}. ${esc(f.name || f.title)}** — ${f.url}`, ...Object.entries(f.quotes || {}).map(([k, v]) => `- ${k}: “${esc(v).slice(0, 300)}”`), ...(f.flags?.length ? [`- avisos: ${f.flags.join(', ')}`] : []), '']),
  '## Consultas ejecutadas', '', ...r.queries.map((q) => `- (${esc(q.family) || '—'}) ${esc(q.query)}`),
  ...(traceOn ? ['', '## Registro', '', ...registry.map(([n, q]) => `${n}. ${q}`)] : []),
  ...(r.audits.some((a) => a.errors?.length) ? ['', '## Errores de proveedores (muestra)', '', ...r.audits.flatMap((a) => (a.errors || []).map((e) => `- ${esc(e)}`))] : []),
  '', '> Todo lo listado pasó la verificación en código (cita literal en la página, fecha contra hoy, sin agregadores ni redes). Lo que no aparece aquí no se pudo verificar; no se inventa.',
];
writeFileSync(join(outDir, 'report.md'), lines.join('\n'));
writeFileSync(join(outDir, 'result.json'), JSON.stringify({ brief, objectives, today, model: engineRole.model, providers: searchProviders(env), seconds, audits: r.audits, recall, findings: r.findings, leads: r.leads || [], queries: r.queries }, null, 2));

function coverageSummary() {
  const dir = join(outDir, 'coverage'); if (!existsSync(dir)) return { files_executed: 0, functions_executed: 0, path: 'coverage/' };
  const files = new Set(); let functions = 0;
  for (const file of readdirSync(dir).filter((x) => x.endsWith('.json'))) try {
    const data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    for (const script of data.result || []) {
      const hit = (script.functions || []).filter((fn) => (fn.ranges || []).some((range) => range.count > 0));
      if (hit.length) { files.add(script.url); functions += hit.length; }
    }
  } catch { /* archivo parcial de cobertura */ }
  return { files_executed: files.size, functions_executed: functions, path: 'coverage/' };
}

function writeSummary() {
  if (!traceOn) return;
  const events = readFileSync(join(outDir, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const summary = { v: 'summary/1', run_id: events[0]?.run_id || '', case: objectives.join(','), fase: process.env.ENGINE_AGENT === '1' ? 'F2' : 'F1', git_commit: commit,
    flags: { ENGINE_JUDGE: env.ENGINE_JUDGE || '', ENGINE_AGENT: env.ENGINE_AGENT || '', ENGINE_JUDGE_BLIND: env.ENGINE_JUDGE_BLIND || '' }, today, seconds,
    pages: { seen: 0, read: 0, unread_by_reason: {} }, model_calls: {}, tools: {}, searches: { total: 0, repeated_normalized: 0 }, drops: {},
    findings: { main: r.findings.filter((f) => f.tier === 'main').length, verify: r.findings.filter((f) => f.tier !== 'main').length },
    leads: { total: 0, with_followup: 0, with_finalist: 0 }, agent: { steps: 0, invalid_steps: 0, rejected_ref: 0, stop_reason: '', questions: 0, assumptions: 0 },
    judge: { finalists: r.findings.length, calls: 0, second_blind_calls: 0, second_call_changed: 0 }, coverage: coverageSummary(), gold: null };
  const searches = []; const followups = new Set();
  for (const e of events) {
    if (e.type === 'page') { summary.pages.seen++; if (e.read) summary.pages.read++; }
    if (e.type === 'model_call') { const x = (summary.model_calls[e.role] ||= { calls: 0, invalid: 0, errors: 0, tokens_prompt: 0, tokens_completion: 0, ms: 0 }); x.calls++; x.invalid += e.invalid ? 1 : 0; x.errors += e.ok ? 0 : 1; x.tokens_prompt += e.tokens.prompt; x.tokens_completion += e.tokens.completion; x.ms += e.ms_call; if (e.role === 'judge') summary.judge.calls++; }
    if (e.type === 'tool_call') { const key = e.provider || e.tool; const x = (summary.tools[key] ||= { calls: 0, results: 0, ms: 0, cost_usd: 0, credits: 0, errors: 0 }); x.calls++; x.results += e.results_n; x.ms += e.ms_call; x.cost_usd += e.cost_usd || 0; x.credits += e.credits || 0; x.errors += e.error ? 1 : 0; if (e.tool === 'search') searches.push(`${e.provider || ''}|${String(e.args?.query || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`); }
    if (e.type === 'drop') { const x = (summary.drops[e.reason] ||= {}); x[e.decided_by] = (x[e.decided_by] || 0) + 1; if (!e.read) summary.pages.unread_by_reason[e.reason] = (summary.pages.unread_by_reason[e.reason] || 0) + 1; }
    if (e.type === 'lead') summary.leads.total++;
    if (e.type === 'lead_followup') followups.add(e.lead_id);
  }
  summary.leads.with_followup = followups.size; summary.searches.total = new Set(searches.map((x) => x.split('|').slice(1).join('|'))).size; summary.searches.repeated_normalized = searches.length - new Set(searches).size;   // total = consultas distintas; repetidas = misma consulta al mismo proveedor
  const agentAudits = r.audits.filter((a) => a.agent?.on);
  if (agentAudits.length) {
    summary.agent = agentAudits.reduce((x, a) => ({ steps: x.steps + (a.agent.steps || 0), invalid_steps: x.invalid_steps + (a.agent.invalid_steps || 0), rejected_ref: x.rejected_ref + (a.agent.rejected_ref || 0), stop_reason: [x.stop_reason, a.agent.stop_reason].filter(Boolean).join(','), questions: x.questions + (a.agent.questions || 0), assumptions: x.assumptions + (a.agent.assumptions || 0) }), { steps: 0, invalid_steps: 0, rejected_ref: 0, stop_reason: '', questions: 0, assumptions: 0 });
    summary.judge = agentAudits.reduce((x, a) => ({ finalists: x.finalists + (a.judge?.finalists || 0), calls: x.calls + (a.judge?.calls || 0), second_blind_calls: x.second_blind_calls + (a.judge?.second_blind_calls || 0), second_call_changed: x.second_call_changed + (a.judge?.second_call_changed || 0) }), { finalists: 0, calls: 0, second_blind_calls: 0, second_call_changed: 0 });
  }
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
}
if (traceOn && env.NODE_V8_COVERAGE) { try { takeCoverage(); } catch { /* Node sin cobertura activa */ } }
writeSummary();
console.log(`✔ ${r.findings.length} verificadas en ${seconds} s (${r.findings.filter((f) => f.verdict === 'apply').length} apply).${recall.length ? ` Recall referencia: ${recall.filter((x) => x.found).length}/${recall.length}.` : ''}`);
console.log(`  Reporte: ${join(outDir, 'report.md')}`);
