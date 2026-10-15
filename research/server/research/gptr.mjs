/* Motor GPT Researcher como fuente "Web research engine": lanza gptr-grants (Python) con un prompt hecho solo con los campos del brief,
   deja que lo verifique verify.py (cita literal en la página, fechas contra hoy) y convierte cada página verificada o a revisar en un hallazgo.
   Sin nombres de financiadores: el modelo decide los niveles. Apollo corre después, en código, igual que en el agente. */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { briefBlock } from './judge/prompts.v13.mjs';
import { createTools } from './agentic/tools.mjs';
import { contactStage } from './agentic/contacts.mjs';
import { runAgentObjective, understandBrief } from './agentic/loop.mjs';
import { fetchPage } from './localSearch.mjs';
import { hostKind } from './verify.mjs';
import { briefCountry, foreignHost } from './geo.mjs';
import { registrySeeds, registryQueries, noticeNumbers } from './registry/simplerGrants.mjs';
import { copyFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const GPTR_DIR = resolve(HERE, '../../../gptr-grants');
const stamp = () => new Date().toISOString().slice(11, 19);
let LOG_FILE = null;
export const glog = (msg) => { const line = `[gptr ${stamp()}] ${msg}`; console.log(line); if (LOG_FILE) { try { appendFileSync(LOG_FILE, line + '\n'); } catch { /* sin archivo de log */ } } };
const day = (t) => (t instanceof Date ? t : new Date(t || Date.now())).toISOString().slice(0, 10);

const short = (v, n) => String(v || '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter((w) => (w.length > 2 || /^[A-Z]{2}$/.test(w)) && !/^(the|and|for|that|with|from|this|tells|which|our|your|their|goal)$/i.test(w)).slice(0, n).join(' ');
const entityWords = (t) => ({ for_profit: 'small business', nonprofit: 'nonprofit', academic: 'university', individual: 'individual' }[String(t || '').toLowerCase()] || '');
const GEO_KEYS = ['country', 'state', 'region', 'city', 'geography', 'location'];
const geoOf = (brief) => GEO_KEYS.map((k) => String(brief?.[k] || '').trim()).filter((v) => v && !/^(global|worldwide|any)$/i.test(v));
/* Prompt de GPT Researcher hecho solo con el brief. Sin nombres de financiadores: se describen TIPOS de fuente (registros oficiales,
   agencias de desarrollo económico o tecnológico del estado, programas universidad-empresa) y el modelo deduce cuáles existen. */
export function gptrPrompt({ brief = {}, objective = 'grant', today = new Date(), queries = [] } = {}) {
  const geo = geoOf(brief); const geoOpen = !geo.length; const where = geo.join(', ');
  const yr = day(today).slice(0, 4);
  const geoLine = geoOpen
    ? "The brief does not restrict geography: include funders outside the applicant's country."
    : `The applicant is based in ${where}. Only include funders that accept applicants from there; skip programs restricted to other countries or regions.`;
  if (objective === 'investment' || objective === 'debt') {
    const what = objective === 'debt' ? 'lenders and non-dilutive debt programs (venture debt funds, revenue-based financing, public loan programs)' : 'investors (venture capital funds, angel groups, corporate venture arms, family offices, accelerators that invest)';
    const head = [`${brief.round || brief.stage || ''} investors`, short(brief.oneLiner || brief.product || brief.description, 8), brief.industry, geo.join(' '), yr].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    return `${head}

Today is ${day(today)}. Find ${what} that are actively deploying capital now and could realistically invest in this company at its current stage, sector and geography.

Company and context (from the brief):
${briefBlock(brief)}

${geoLine} Work out for yourself the kinds of investors that fit (by stage, cheque size, sector thesis and geography) and search each kind with several differently worded queries. Prefer each investor's own website (thesis, portfolio and team pages) and recent deal announcements from ${Number(yr) - 1}-${yr}; do not rely on lists or rankings alone. For every investor give: name, official URL of its own thesis or portfolio page, stage and typical cheque size as stated, evidence of a deal in the last 18 months (with date), how to pitch (form, email or warm intro), why it fits, red flags, and a short literal quote from its page that supports the thesis fit. Finish with the investors you excluded and why.
`;
  }
  const kind = objective === 'grant' ? 'grant opportunities (non-dilutive funding, not investors)' : `${objective} opportunities`;
  // GPT Researcher usa el comienzo del prompt como PRIMERA búsqueda web (log 14-10, línea 3: buscaba los 1.900 caracteres enteros):
  // la primera línea es una consulta corta hecha con el brief.
  const head = [objective === 'grant' ? 'open grant funding' : `${objective} funding`, short(brief.oneLiner || brief.product || brief.description, 8), brief.industry, entityWords(brief.entityType), geo.join(' '), yr].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const followup = queries.length ? `\nFollow-up search hypotheses from the evaluator (not verified facts):\n${queries.slice(0, 12).map((q) => `- ${String(q?.query ?? q).trim()}`).filter((q) => q.length > 2).join('\n')}\nUse them only as search directions. Independently verify that every named program exists, is current and fits; discard it otherwise.\n` : '';
  return `${head}

Today is ${day(today)}. Find CURRENTLY OPEN or upcoming ${kind} that this applicant could realistically apply to. Use only official, current sources (funder websites, government portals and registries, state and local programs, sector foundations). Ignore anything whose deadline has already passed.${brief.deadlineFrom || brief.deadlineTo ? `\nThe applicant can only apply ${brief.deadlineFrom ? `from ${brief.deadlineFrom} ` : ''}${brief.deadlineTo ? `until ${brief.deadlineTo}` : ''}: look first for calls whose application deadline falls inside that window, and for recurring calls with a cycle inside it. Report calls outside the window separately.` : ''}

Applicant and context (from the brief):
${briefBlock(brief)}

${geoLine}
${followup}
Work out for yourself every level of funder that could fund this applicant and search each one separately:
1. National government: the agencies whose mission matches the product, including their small-business innovation programs, and the national government grants registry where their calls are posted (search it for posted and forecasted opportunities and give the opportunity number).
2. The applicant's state, region and city: the state's economic development agency, technology development or innovation corporation, university-industry partnership programs and matching-fund programs for companies that already hold national awards.
3. Sector foundations, patient or industry associations and prizes in the applicant's field.
For each level, open the funder's own current program, solicitation, request-for-applications or call page (including its PDF), not only articles or aggregators about it. Use several differently worded queries per level (the product, the stage, the applicant type, the geography and the use of funds), and include the year ${yr} or ${Number(yr) + 1} in queries about deadlines. Plain search queries only: do not use operators such as site:.

For every opportunity give: name and funder, official URL of the call itself, application deadline (exact date, or "not found"), award size, whether this applicant is eligible, why it fits, red flags, and a short literal quote from the page that supports the deadline and eligibility. Finish with the opportunities you excluded and why.
`;
}

const CALLISH = new Set(['call', 'program_page']);
export function findingsFromVerified(rows, { objective = 'grant', today = new Date() } = {}) {
  const t = day(today); const out = [];
  for (const r of rows || []) {
    if (!['verificada', 'a_revisar'].includes(r.verdict)) continue;
    const d = r.data || {};
    const dated = (d.dates || []).filter((x) => x.quote_ok && x.date_ok && ['application_deadline', 'loi_deadline'].includes(x.role)).sort((a, b) => a.date.localeCompare(b.date));
    const future = dated.filter((x) => x.date >= t);
    if (r.verdict === 'a_revisar' && !(CALLISH.has(d.page_type) || (d.source_kind === 'funder_official' && future.length))) continue;
    const first = future[0]; const host = (() => { try { return new URL(r.url).hostname; } catch { return r.url; } })();
    const ok = r.verdict === 'verificada';
    out.push({ objective, url: r.url, title: d.name || host, name: d.name || host, query: 'gptr', family: 'gptr', providers: ['gptr'], model: 'gpt-researcher', keep: true, drop: null,
      status: first || d.rolling ? 'open' : 'unknown', deadline: first?.date || null, daysLeft: first ? Math.round((Date.parse(first.date) - Date.parse(t)) / 86400000) : null,
      eligible: d.eligibility?.for_profit_ok === 'yes' ? 'yes' : d.eligibility?.for_profit_ok === 'no' ? 'no' : 'unclear', nonDilutive: 'yes',
      amount: d.amount?.text || null, pageType: { type: d.page_type || 'call' },
      quotes: { identity: d.name || host, ...(first?.quote ? { deadline: first.quote } : {}), ...(d.eligibility?.quote ? { eligible: d.eligibility.quote } : {}) },
      tier: ok ? 'main' : 'verify', verdict: ok ? 'apply' : 'watch', flags: [], blockers: r.blockers || [], reasons: [], funder: d.funder || null, trace: { queries: [] } });
  }
  return out;
}

const IMG = /\.(png|jpe?g|gif|svg|webp|ico|css|js)(\?|$)/i;
const clean = (u) => String(u).replace(/[)\].,;>"']+$/, '').replace(/#.*$/, '').replace(/\/$/, '');
/* Ranking de las URLs que trajo GPT Researcher antes del juez (que solo puede leer GPTR_JUDGE_MAX).
   Diagnóstico 14-10 (log-engine-013838, 389 URLs): el ranking anterior daba 4.5 a casi todo (empate) y cortaba por orden de llegada;
   el aviso oficial vigente quedaba en la posición 70 y la RFA en PDF del programa estatal en la 264 con puntaje 0 («RFA%20…» no casaba).
   Ahora: términos de convocatoria con cualquier separador (%20, _, -), número de aviso con año fiscal (vigente sube, viejo baja),
   año en la ruta (actual sube), páginas de otro país bajan si el brief fija país, portadas y buscadores bajan, y tope por dominio. */
const decode = (u) => { try { return decodeURIComponent(u); } catch { return u; } };
const CALL_TERMS = /(^|[^a-z])(call|calls|apply|application|applications|challenge|prize|grants?|funding|rfa|rfp|rfi|baa|foa|nofo|opportunit\w*|accelerator|competition|awards?|solicitations?|fellowship|programme?|sbir|sttr|announcement|request for (?:applications|proposals))(?![a-z])/i;
// Inversores: páginas propias del fondo (tesis, portafolio, equipo, cómo presentar).
const INVESTOR_TERMS = /(^|[^a-z])(portfolio|investments?|thesis|focus|team|partners?|ventures?|capital|fund|funds|pitch|apply|contact|about|companies|startups?)(?![a-z])/i;
const NOTICE = /(?:^|[^a-z0-9])[a-z]{1,5}[- ](?:[a-z]{2,3}-)?(\d{2})-\d{3}(?![0-9])/gi;
const NOISE = /(^|[\/_-])news(_[a-z]+)?([\/_-]|$)|\/(blog|blogs|press|press-releases?|articles?|stories|insights?|webinars?|podcasts?|events?|bills?|testimony|legislation|budget|meeting_material)\/|\b(best \d+|top \d+|roundup|newsletter|webinar|podcast|impact report|annual report|success stories|testimony|appropriations|awardees)\b|facebook\.com|linkedin\.com|youtube\.com|twitter\.com|x\.com\//i;
const INSTITUTION = /\.(gov|edu|int|eu|mil)(\.[a-z]{2})?$|\.org$|\.gov\.[a-z]{2}$|\.(gob|gouv|gc|govt)\.[a-z]{2}$/i;
const LISTING = /\/(search|search-results|results)(\/|\?|$)|[?&](q|query|keyword|keywords|s)=/i;
const briefWords = (brief = {}) => [...new Set(['state', 'city', 'region', 'industry', 'product', 'oneLiner', 'sector'].flatMap((k) => String(brief?.[k] || '').toLowerCase().match(/[a-z]{5,}/g) || []))].filter((w) => !/^(about|their|which|there|these|those|other|tools?|patient|people|company|companies|product|service|services)$/.test(w));
export function rankScore(u, today = new Date(), ctx = {}) {
  const url = decode(u.url); let host = ''; let path = '';
  try { const p = new URL(u.url); host = p.hostname.toLowerCase(); path = p.pathname; } catch { /* URL rara */ }
  const thisYear = new Date(today).getUTCFullYear(); const yy = thisYear % 100;
  const years = [...url.matchAll(/(?:^|[^0-9])(20\d{2})(?![0-9])/g)].map((m) => +m[1]).filter((y) => y <= thisYear + 2);
  const notices = [...url.matchAll(NOTICE)].map((m) => +m[1]);
  const newest = notices.length ? Math.max(...notices) : null;
  const investor = ctx.objective && ctx.objective !== 'grant' && ctx.objective !== 'sponsorship';
  let s = (u.in_report ? 4 : 0) + ((investor ? INVESTOR_TERMS : CALL_TERMS).test(url) ? 3 : 0) + (!investor && INSTITUTION.test(host) ? 1.5 : 0) - (NOISE.test(url) ? (investor ? 1.5 : 4) : 0);
  if (years.length) s += Math.max(...years) >= thisYear ? 1 : -3;
  if (newest !== null) s += newest >= yy ? 2 : newest < yy - 1 ? -4 : 0;   // PA-27-100 sube; PA-16-091 baja
  if (!path || path === '/') s -= 2;                                     // portada del sitio
  if (/\/20\d{2}\/\d{2}\/(\d{2}\/)?[a-z]/i.test(path)) s -= 3;           // entrada de blog fechada (/2026/08/09/titulo)
  if (/\.pdf$/i.test(path) && CALL_TERMS.test(url) && years.some((y) => y >= thisYear)) s += 1.5;   // documento de convocatoria del año
  if (LISTING.test(url)) s -= 1.5;                                       // buscadores y listados
  if (ctx.country && foreignHost(host, ctx.country)) s -= 3;              // otro país cuando el brief fija país
  if (ctx.words?.length) s += Math.min(1.5, ctx.words.filter((w) => url.toLowerCase().includes(w)).length * 0.5);
  return s;
}
/** URLs que GPT Researcher leyó (log) y citó (informe), ordenadas por `rankScore`, con tope por dominio para que un solo sitio no llene el cupo del juez. */
export function urlsFromRun({ log = '', report = '', max = 30, today = new Date(), brief = null, objective = 'grant', perHost = Number(process.env.GPTR_PER_HOST) || 5 } = {}) {
  const inReport = [...report.matchAll(/https?:\/\/[^\s)>\]"']+/g)].map((m) => clean(m[0]));
  const read = [...log.matchAll(/Added source url to research: (\S+)/g)].map((m) => clean(m[1]));
  const seen = new Set(); const out = [];
  for (const u of [...inReport, ...read]) { if (!/^https?:\/\//.test(u) || IMG.test(u) || seen.has(u.toLowerCase())) continue; seen.add(u.toLowerCase()); out.push({ url: u, in_report: inReport.includes(u) }); }
  const ctx = { objective, ...(brief ? { country: briefCountry(brief), words: briefWords(brief) } : {}) };
  const ranked = out.map((u, i) => ({ ...u, i, score: rankScore(u, today, ctx) })).sort((x, y) => y.score - x.score || x.i - y.i);
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
  const picked = []; const per = new Map(); const rest = [];
  for (const u of ranked) { const h = hostOf(u.url); if ((per.get(h) || 0) < perHost) { per.set(h, (per.get(h) || 0) + 1); picked.push(u); } else rest.push(u); if (picked.length >= max) break; }
  for (const u of rest) { if (picked.length >= max) break; picked.push(u); }
  return picked.slice(0, max).map(({ url, in_report }) => ({ url, in_report }));
}

/** Lanza run-engine.sh. Resuelve siempre con lo que haya (también si se corta por tiempo); rechaza solo si se aborta o no arranca. */
export function runGptrProcess({ promptFile, mode, today, env, signal, spawnFn = spawn, seconds, logFile, verify = false }) {
  return new Promise((resolveP, rejectP) => {
    const args = [join(GPTR_DIR, 'run-engine.sh'), promptFile, mode, today, logFile, ...(verify ? ['verify'] : [])];
    const p = spawnFn('bash', args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let out = ''; let err = ''; let done = false; let timedOut = false;
    // La búsqueda ya terminó cuando GPT Researcher empieza a escribir el informe: se le da un margen corto y se corta (lo que falta es redacción, que el juez no usa).
    const grace = Number(env.GPTR_REPORT_GRACE_SECONDS ?? 30) * 1000; let writingSince = 0;
    const watch = setInterval(() => { if (done) return; let t = ''; try { t = readFileSync(logFile, 'utf8'); } catch { return; }
      if (!writingSince && /✍️ Writing report/.test(t)) { writingSince = Date.now(); glog(`la búsqueda terminó y empezó el informe: margen de ${grace / 1000}s y se corta`); }
      if (writingSince && Date.now() - writingSince >= grace) { timedOut = true; glog('cortando GPT Researcher: ya no hace falta el informe'); kill(); setTimeout(() => finish(resolveP, { timedOut: true, early: true, stderr: err, report: out.match(/REPORT=(\S+)/)?.[1] }), 300); } }, 2000);
    const kill = () => { try { process.kill(-p.pid, 'SIGTERM'); } catch { try { p.kill('SIGTERM'); } catch { /* ya terminó */ } } };
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); clearInterval(watch); signal?.removeEventListener?.('abort', onAbort); fn(v); };
    const timer = setTimeout(() => { timedOut = true; kill(); setTimeout(() => finish(resolveP, { timedOut: true, stderr: err, report: out.match(/REPORT=(\S+)/)?.[1], json: out.match(/VERIFIED_JSON=(\S+)/)?.[1] }), 300); }, seconds * 1000);
    const onAbort = () => { kill(); finish(rejectP, signal.reason || new Error('aborted')); };
    signal?.addEventListener?.('abort', onAbort, { once: true });
    p.stdout.on('data', (b) => { out += b; glog(`stdout: ${String(b).trim().slice(0, 200)}`); }); p.stderr.on('data', (b) => { err += b; glog(`stderr: ${String(b).trim().slice(0, 300)}`); });
    p.on('error', (e) => { glog(`no se pudo lanzar el proceso: ${e.message}`); finish(rejectP, e); });
    p.on('close', (code) => { glog(`el proceso terminó (código ${code}${timedOut ? ', cortado por tiempo' : ''})`); finish(resolveP, { timedOut, early: Boolean(writingSince), code, stderr: err, report: out.match(/REPORT=(\S+)/)?.[1], json: out.match(/VERIFIED_JSON=(\S+)/)?.[1] }); });
  });
}

const readSafe = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };

/* Descarga anticipada: mientras GPT Researcher busca, cada URL nueva de su log se baja con el lector directo (gratis, 6 s).
   Al terminar la búsqueda el juez ya tiene casi todas las páginas en memoria: antes se bajaban ~150 en fila después de esperar a GPTR. */
export function startPrefetch({ logFile, env = process.env, fetcher, signal, read = readSafe, fetchFn = fetchPage, everyMs = 3000 } = {}) {
  const pages = new Map(); const queued = new Set(); const queue = []; let active = 0; let stopped = false; let tried = 0;
  const max = Number(env.GPTR_PREFETCH_MAX) || 250; const conc = Number(env.GPTR_PREFETCH_CONCURRENCY) || 8; const timeoutMs = Number(env.GPTR_CHEAP_TIMEOUT_MS) || 6000;
  const pump = () => { while (!stopped && active < conc && queue.length) { const url = queue.shift(); active++; tried++;
    fetchFn(url, { fetcher, signal, timeoutMs }).then((p) => { if (p && !stopped) pages.set(url, p); }).catch(() => {}).finally(() => { active--; pump(); }); } };
  const scan = () => { if (stopped) return; for (const m of read(logFile).matchAll(/Added source url to research: (\S+)/g)) { const u = clean(m[1]);
    if (queued.size >= max || queued.has(u) || !/^https?:\/\//.test(u) || IMG.test(u) || hostKind(u) === 'social') continue; queued.add(u); queue.push(u); } pump(); };
  const timer = setInterval(scan, everyMs); timer.unref?.();
  return { pages, scan, stop: () => { scan(); stopped = true; clearInterval(timer); queue.length = 0; return { queued: queued.size, tried, ok: pages.size }; } };
}

export async function runGptr(objective, brief, opts = {}) {
  const env = opts.env || process.env; const today = day(opts.today); const started = Date.now(); const trace = opts.trace;
  const mode = env.GPTR_MODE === 'rapido' ? 'rapido' : 'deep';
  // Con plazo del pipeline, la búsqueda deja GPTR_RESERVE_SECONDS (210 s) para leer y juzgar. Antes eran 120 s y, como la comprensión
  // y las descargas iban después de GPTR, el bucle descartaba todas las páginas por tiempo antes del juez. Ahora esas dos van en paralelo.
  const reserve = Number(env.GPTR_RESERVE_SECONDS) || 210; const budget = opts.deadlineAt ? Math.floor((Number(opts.deadlineAt) - Date.now()) / 1000) - reserve : Infinity;
  const seconds = Math.max(60, Math.min(Number(env.GPTR_SECONDS) || 270, budget)); const verifyMode = env.GPTR_JUDGE === 'verify';
  if (budget < 60) glog(`AVISO: el plazo del pipeline deja ${Math.max(0, budget + reserve)}s para GPTR + juez; con menos de ${60 + reserve}s el juez puede quedarse sin páginas. Sube RESEARCH_RUN_TIMEOUT_MS.`);
  if (env.ENGINE_AGENT_TRACE_DIR) { try { mkdirSync(env.ENGINE_AGENT_TRACE_DIR, { recursive: true }); LOG_FILE = join(env.ENGINE_AGENT_TRACE_DIR, 'gptr.log'); } catch { LOG_FILE = null; } }
  glog(`INICIO objetivo=${objective} modo=${mode} tope=${seconds}s juez=${verifyMode ? 'verify.py' : 'node'} script=${existsSync(join(GPTR_DIR, 'run-engine.sh')) ? 'ok' : 'NO ENCONTRADO en ' + GPTR_DIR} venv=${existsSync(join(GPTR_DIR, '.venv')) ? 'ok' : 'se creará (tarda unos minutos la primera vez)'}`);
  const prompt = gptrPrompt({ brief, objective, today, queries: opts.queries || [] });
  const dir = mkdtempSync(join(tmpdir(), 'gptr-')); const promptFile = join(dir, 'prompt.txt'); const logFile = join(dir, 'gptr.log'); writeFileSync(promptFile, prompt);
  trace?.event?.('tool_call', { tool: 'gptr', args: { mode, seconds, judge: verifyMode ? 'verify.py' : 'node' }, results_n: 0, ms_call: 0 });
  glog(`prompt (${prompt.length} caracteres${opts.queries?.length ? `, ${opts.queries.length} hipótesis de seguimiento` : ''}): ${join(dir, 'prompt.txt')} · log de GPT Researcher: ${logFile}`);
  const ticker = setInterval(() => { const t = readSafe(logFile); const n = (t.match(/Added source url to research:/g) || []).length; const last = t.trim().split('\n').pop()?.replace(/\s+/g, ' ').slice(0, 140) || '(sin salida todavía)'; glog(`${Math.round((Date.now() - started) / 1000)}s · fuentes leídas ${n} · última línea: ${last}`); }, Number(env.GPTR_LOG_EVERY_MS) || 15000);
  ticker.unref?.();
  // Registro oficial (Simpler Grants / Grants.gov) en paralelo con GPT Researcher: búsquedas con el brief mientras GPTR navega.
  // Con el proceso de GPTR simulado (pruebas, --dry) el registro solo corre si también se inyecta su fetcher: nunca red real en pruebas.
  const registryOn = objective === 'grant' && env.REGISTRY_TOOL !== 'off' && !verifyMode && [null, 'US'].includes(briefCountry(brief)) && (!opts.gptrRunner || Boolean(opts.registryFetcher));
  const fetcher = opts.registryFetcher || opts.fetcher || fetch;
  const registryByBrief = registryOn ? registrySeeds({ brief, queries: registryQueries(brief, opts.plan), today, env, fetcher, signal: opts.signal, log: glog }).catch((e) => ({ seeds: [], stats: { errors: [String(e?.message || e)] } })) : Promise.resolve({ seeds: [], stats: null });
  // Con el proceso real de GPTR: la descarga de páginas y la comprensión del brief corren mientras GPTR busca, no después.
  const live = !opts.gptrRunner && !verifyMode;
  const prefetch = live && env.GPTR_PREFETCH !== 'off' ? startPrefetch({ logFile, env, fetcher: opts.fetcher || fetch, signal: opts.signal }) : null;
  const understood = live && !opts.understood ? understandBrief(objective, brief, { env, today, fetcher: opts.fetcher, signal: opts.signal, chat: opts.chat }).catch(() => null) : opts.understood;
  let res = {}; let error = null;
  try { res = await (opts.gptrRunner || runGptrProcess)({ promptFile, mode, today, env, signal: opts.signal, seconds, logFile, verify: verifyMode }); }
  catch (e) { if (opts.signal?.aborted) throw e; error = String(e?.message || e); }
  clearInterval(ticker);
  const pre = prefetch?.stop(); if (pre) glog(`descarga anticipada: ${pre.ok} páginas listas de ${pre.queued} URLs vistas (${pre.tried} intentadas) mientras GPTR buscaba`);
  // El log crudo de GPT Researcher vivía solo en /tmp: se copia junto a la traza para poder diagnosticar después.
  if (env.ENGINE_AGENT_TRACE_DIR) { try { copyFileSync(logFile, join(env.ENGINE_AGENT_TRACE_DIR, `gptr-raw-${objective}${opts.queries?.length ? '-followup' : ''}.log`)); } catch { /* no hubo log */ } }
  glog(`proceso terminó tras ${Math.round((Date.now() - started) / 1000)}s · timedOut=${Boolean(res.timedOut)} código=${res.code ?? 'n/d'} informe=${res.report || 'ninguno'}${error ? ' · error=' + error : ''}${res.stderr ? ' · stderr: ' + String(res.stderr).trim().slice(-300).replace(/\s+/g, ' ') : ''}`);
  if (res.timedOut && !res.early) error = `GPTR_TIMEOUT ${seconds}s (se usan las páginas que alcanzó a leer)`;
  const searchMs = Date.now() - started;
  glog(`búsqueda terminada en ${Math.round(searchMs / 1000)}s${error ? ` · ${error}` : ''}`);

  if (verifyMode) {
    let rows = []; try { rows = JSON.parse(readFileSync(resolve(GPTR_DIR, res.json), 'utf8')); } catch (e) { error ||= String(e?.message || e); }
    const findings = findingsFromVerified(rows, { objective, today });
    glog(`verify.py: ${rows.length} páginas · ${findings.length} hallazgos`);
    trace?.event?.('tool_call', { tool: 'gptr', args: { mode, done: true }, results_n: findings.length, ms_call: searchMs, ...(error ? { error } : {}) });
    const tools = opts.tools || createTools({ env, fetcher: opts.fetcher, signal: opts.signal, trace: trace || undefined, limits: { apolloCredits: Number(env.ENGINE_AGENT_APOLLO_CREDITS) || 25 }, apollo: opts.apollo });
    const contacts = await contactStage({ findings, objective, tools, trace, env, configured: Boolean(env.APOLLO_API_KEY || opts.apollo) });
    return { findings, leads: [], queries: [], audit: { objective, search: 'gptr', queries: 0, pages: rows.length, read: rows.length, unread: 0, dropped: {}, kept: findings.length, errors: error ? [error] : [], gptr: { on: true, mode, judge: 'verify.py', seconds: Math.round(searchMs / 1000), pages: rows.length, verified: rows.filter((r) => r.verdict === 'verificada').length, error }, contacts } };
  }

  const logText = opts.logText ?? readSafe(logFile); const reportText = opts.reportText ?? (res.report ? readSafe(resolve(GPTR_DIR, res.report)) : '');
  // Se abren hasta GPTR_OPEN_MAX páginas (barato) y el modelo evalúa hasta GPTR_JUDGE_MAX, elegidas por un triage de fechas en código.
  const judgeMax = Number(env.GPTR_JUDGE_MAX) || 40; const openMax = Math.max(judgeMax, Number(env.GPTR_OPEN_MAX) || 150);
  const urls = urlsFromRun({ log: logText, report: reportText, max: openMax, today, brief, objective });
  glog(`URLs para el juez: ${urls.length} (${urls.filter((u) => u.in_report).length} del informe) → ${urls.slice(0, 5).map((u) => u.url).join(' | ')}${urls.length > 5 ? ' …' : ''}`);
  // Números de aviso que GPT Researcher vio (en URLs leídas o en el informe) → la oportunidad oficial con su fecha exacta.
  const byBrief = await registryByBrief;
  const numbers = registryOn ? noticeNumbers([...logText.matchAll(/Added source url to research: (\S+)/g)].map((m) => m[1]).concat(reportText)) : [];
  const byNumber = numbers.length ? await registrySeeds({ brief, numbers, today, env, fetcher, signal: opts.signal, log: glog }).catch((e) => ({ seeds: [], stats: { errors: [String(e?.message || e)] } })) : { seeds: [], stats: null };
  const regSeeds = []; const regSeen = new Set();
  for (const sd of [...byNumber.seeds, ...byBrief.seeds]) { const k = sd.registry?.number || sd.url; if (regSeen.has(k)) continue; regSeen.add(k); regSeeds.push({ url: sd.url, title: sd.title, text: sd.text, registry: sd.registry }); }
  const notices = [...(byNumber.attachments || []), ...(byBrief.attachments || [])].filter((a, i, all) => all.findIndex((b) => b.url === a.url) === i).map((a) => ({ url: a.url, title: a.title }));
  const seeds = [...regSeeds, ...notices, ...urls.filter((u) => !regSeeds.some((r) => r.url === u.url) && !notices.some((n) => n.url === u.url))];
  if (env.ENGINE_AGENT_TRACE_DIR) { try { writeFileSync(join(env.ENGINE_AGENT_TRACE_DIR, `gptr-seeds-${objective}.json`), JSON.stringify({ today, numbers, registry: regSeeds.map((r) => ({ url: r.url, title: r.title, why: r.registry?.number })), gptr: urls }, null, 1)); } catch { /* sin traza */ } }
  trace?.event?.('tool_call', { tool: 'gptr', args: { mode, done: true, urls: urls.length, registry: regSeeds.length }, results_n: seeds.length, ms_call: searchMs, ...(error ? { error } : {}) });
  const registry = { on: registryOn, numbers: numbers.length, seeds: regSeeds.length, notices: notices.length, brief: byBrief.stats, byNumber: byNumber.stats };
  if (!seeds.length) return { findings: [], leads: [], queries: [], audit: { objective, search: 'gptr', queries: 0, pages: 0, read: 0, unread: 0, dropped: {}, kept: 0, errors: [error || 'GPTR_NO_URLS'], gptr: { on: true, mode, judge: 'node', seconds: Math.round(searchMs / 1000), urls: 0, error: error || 'GPTR_NO_URLS', registry } } };
  glog(`juez de Node: ${seeds.length} páginas (${regSeeds.length} del registro oficial + ${seeds.length - regSeeds.length} de GPT Researcher); se abren todas y el modelo lee hasta ${judgeMax + regSeeds.length} elegidas por fechas`);
  const judged = await (opts.judgeRunner || runAgentObjective)(objective, brief, { ...opts, env, today, seedUrls: seeds, assessMax: judgeMax + regSeeds.length, parallel: true, secondJudge: opts.secondJudge, ...(understood ? { understood } : {}), ...(prefetch ? { readers: { ...(opts.readers || {}), cached: prefetch.pages } } : {}) });
  glog(`juez listo: ${judged.findings?.length ?? 0} hallazgos (${(judged.findings || []).filter((f) => f.tier === 'main').length} verificados) · contactos Apollo: ${judged.audit?.contacts?.orgs ?? 0} organizaciones, ${judged.audit?.contacts?.credits ?? 0} créditos · total ${Math.round((Date.now() - started) / 1000)}s`);
  judged.audit = { ...judged.audit, gptr: { on: true, mode, judge: 'node', search_seconds: Math.round(searchMs / 1000), seconds: Math.round((Date.now() - started) / 1000), urls: urls.length, error, registry } };
  return judged;
}
