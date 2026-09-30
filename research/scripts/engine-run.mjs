// Corre el motor v2 contra internet real con un brief y escribe un reporte comparable.
// Uso: node --env-file-if-exists=.env scripts/engine-run.mjs [--brief eval/briefs/mentiva.json] [--objectives grant,investment]
//        [--label gpt-oss] [--out eval/runs/...] [--today 2026-09-29] [--cache eval/runs/search-cache.json] [--no-cache]
// Requiere ENGINE_V2 no; usa directamente runEngine. Modelo: rol "engine" (ENGINE_LLM_*) o, si falta, "chat" (Qwen3-30B).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { runEngine } from '../server/research/engine.mjs';
import { searchProviders } from '../server/research/searchApis.mjs';
import { fleetConfig } from '../server/analysis/fleet.mjs';
import { hostOf } from '../server/research/verify.mjs';

const arg = (name, fallback = '') => { const at = process.argv.indexOf(name); return at >= 0 ? process.argv[at + 1] : fallback; };
const env = process.env;
const brief = JSON.parse(readFileSync(resolve(arg('--brief', 'eval/briefs/mentiva.json')), 'utf8'));
const objectives = (arg('--objectives') || (brief.fundingTypes || ['grant']).join(',')).split(',').map((s) => s.trim()).filter(Boolean);
const today = arg('--today') || new Date().toISOString().slice(0, 10);
const engineRole = fleetConfig(env).roles.engine;
const label = arg('--label') || (engineRole.model || 'no-model').split('/').pop().replace(/[^a-z0-9.-]+/gi, '-').toLowerCase();
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const outDir = resolve(arg('--out') || join('eval/runs', `${stamp}-${label}`));
const cachePath = resolve(arg('--cache', 'eval/runs/search-cache.json'));
const useCache = !process.argv.includes('--no-cache');
mkdirSync(outDir, { recursive: true });

if (!engineRole.ready) { console.error('✖ No hay modelo: define ENGINE_LLM_URL + ENGINE_LLM_MODEL, o VLLM_CHAT_URL + VLLM_CHAT_MODEL.'); process.exit(2); }
if (!searchProviders(env).length) console.warn('⚠ Sin claves de APIs de búsqueda: se usará SearXNG o Firecrawl si están configurados.');

const cache = useCache && existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
const cachedBefore = Object.keys(cache).length;
console.log(`Motor v2 · ${objectives.join(', ')} · hoy=${today}\n  modelo: ${engineRole.model} @ ${engineRole.url}${engineRole.alias ? ' (rol chat)' : ''}\n  búsqueda: ${searchProviders(env).join(', ') || '(ninguna API)'}\n  caché de búsquedas: ${useCache ? `${cachedBefore} consultas guardadas` : 'no'}\n  salida: ${outDir}\n`);

const t0 = Date.now();
const r = await runEngine(brief, { env, today, objectives, cache: useCache ? cache : undefined });
const seconds = Math.round((Date.now() - t0) / 1000);
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
const lines = [
  `# Motor v2 — ${brief.company || 'brief'} · ${objectives.join(', ')} · ${today}`, '',
  `- Modelo que planea y lee: \`${engineRole.model}\` (${engineRole.url})`,
  `- Búsqueda: ${searchProviders(env).join(', ') || 'sin APIs'} · rondas ${env.ENGINE_ROUNDS || 2} · duración ${seconds} s`,
  `- Caché de búsquedas: ${useCache ? `${cachedBefore} → ${Object.keys(cache).length} consultas` : 'desactivada'}`,
  '', '## Resumen por objetivo', '', '| Objetivo | Búsqueda | Consultas | Páginas | Leídas | Sin leer | Vía Jina Reader | Verificadas | Descartes |', '|---|---|---|---|---|---|---|---|---|',
  ...r.audits.map((a) => `| ${a.objective} | ${a.search} | ${a.queries} | ${a.pages} | ${a.read} | ${a.unread} | ${a.jinaRead || 0} | **${a.kept}** | ${esc(Object.entries(a.dropped).map(([k, v]) => `${k} ${v}`).join(', '))} |`),
  '', '## Aporte de cada buscador', '', '| Proveedor | Llamadas | Resultados | Errores | Seg. medios | Coste US$ | Páginas leídas | Verificadas | Solo él las trajo | Nota |', '|---|---|---|---|---|---|---|---|---|---|',
  ...Object.entries(prov).map(([p, s]) => `| ${p} | ${s.calls} | ${s.returned} | ${s.errors} | ${s.calls ? (s.ms / s.calls / 1000).toFixed(1) : '-'} | ${s.costUsd ? s.costUsd.toFixed(3) : '-'} | ${s.pagesRead} | ${s.kept} | ${s.keptOnlyHere} | ${s.disabled ? `⚠ apagado: ${esc(s.disabled).slice(0, 90)}` : ''} |`),
  '', `## Oportunidades verificadas (${r.findings.length})`, '', '| # | Veredicto | Nombre | Estado | Cierre | Días | Elegible | Monto | Buscadores | URL |', '|---|---|---|---|---|---|---|---|---|---|',
  ...r.findings.map((f, i) => `| ${i + 1} | ${f.verdict} | ${esc(f.name || f.title)} | ${f.status} | ${f.deadline || '—'} | ${f.daysLeft ?? '—'} | ${f.eligible} | ${esc(f.amount) || '—'} | ${(f.providers || []).join(', ')} | ${f.url} |`),
  ...(recall.length ? ['', `## Recall contra la lista de referencia: ${recall.filter((x) => x.found).length}/${recall.length}`, '', '| Programa | ¿Lo encontró? | Veredicto | Buscadores |', '|---|---|---|---|', ...recall.map((x) => `| ${esc(x.name)} | ${x.found ? '✔' : '✖'} | ${x.verdict || '—'} | ${x.via.join(', ') || '—'} |`)] : []),
  '', '## Citas de cada verificada', '',
  ...r.findings.flatMap((f, i) => [`**${i + 1}. ${esc(f.name || f.title)}** — ${f.url}`, ...Object.entries(f.quotes || {}).map(([k, v]) => `- ${k}: “${esc(v).slice(0, 300)}”`), ...(f.flags?.length ? [`- avisos: ${f.flags.join(', ')}`] : []), '']),
  '## Consultas ejecutadas', '', ...r.queries.map((q) => `- (${esc(q.family) || '—'}) ${esc(q.query)}`),
  ...(r.audits.some((a) => a.errors?.length) ? ['', '## Errores de proveedores (muestra)', '', ...r.audits.flatMap((a) => (a.errors || []).map((e) => `- ${esc(e)}`))] : []),
  '', '> Todo lo listado pasó la verificación en código (cita literal en la página, fecha contra hoy, sin agregadores ni redes). Lo que no aparece aquí no se pudo verificar; no se inventa.',
];
writeFileSync(join(outDir, 'report.md'), lines.join('\n'));
writeFileSync(join(outDir, 'result.json'), JSON.stringify({ brief, objectives, today, model: engineRole.model, providers: searchProviders(env), seconds, audits: r.audits, recall, findings: r.findings, queries: r.queries }, null, 2));
console.log(`✔ ${r.findings.length} verificadas en ${seconds} s (${r.findings.filter((f) => f.verdict === 'apply').length} apply).${recall.length ? ` Recall referencia: ${recall.filter((x) => x.found).length}/${recall.length}.` : ''}`);
console.log(`  Reporte: ${join(outDir, 'report.md')}`);
