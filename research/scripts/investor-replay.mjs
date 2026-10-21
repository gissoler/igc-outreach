// V15 · Reproduce la etapa de inversionistas SIN RED sobre las páginas guardadas de una corrida (events.jsonl + pages/).
// No abre nada nuevo: agrupa por organización lo que la corrida ya leyó y aplica la evidencia y la clasificación por código.
// Uso: node scripts/investor-replay.mjs --run "<carpeta del caso>" --brief "<perfil.json>" [--today 2026-10-19] [--json]
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { extractLinks } from '../server/research/discovery.mjs';
import { applicantFacts } from '../server/research/dossier/pipeline.mjs';
import { sectorOf } from '../server/research/investors/sector.mjs';
import { orgEvidence } from '../server/research/investors/evidence.mjs';
import { classifyOrg } from '../server/research/investors/pipeline.mjs';
import { isThirdParty, orgKey, roleOf } from '../server/research/investors/orgs.mjs';

const arg = (k, d = null) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const run = arg('run'); const brief = JSON.parse(readFileSync(arg('brief'), 'utf8')); const today = arg('today', '2026-10-19');
const events = readFileSync(join(run, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const pages = events.filter((e) => e.type === 'page' && e.path && existsSync(join(run, e.path))).map((e) => { const text = readFileSync(join(run, e.path), 'utf8'); return { url: e.url, title: e.title, text, links: extractLinks(text, e.url) }; });
const byOrg = new Map(); const sources = [];
for (const p of pages) { if (isThirdParty(p.url) || roleOf(p) === 'list') { sources.push({ url: p.url, role: roleOf(p) }); continue; } const k = orgKey(p.url); if (!byOrg.has(k)) byOrg.set(k, []); byOrg.get(k).push(p); }
const sector = sectorOf(brief); const facts = applicantFacts(brief); const out = [];
for (const [key, ps] of byOrg) {
  const cand = { key, names: [ps[0].title], urls: ps.map((p) => p.url), refs: [], sources: new Set(['replay']), via: new Set(['replay']), snippets: [] };
  const ev = orgEvidence({ pages: ps, sector, brief, facts, today, org: { key, names: cand.names } }); const cls = classifyOrg({ cand, ev, facts, brief });
  out.push({ org: key, decision: cls.drop || cls.tier, score: cls.score, investor: ev.investor.value, thesis: ev.thesis.value, terms: ev.thesis.all_terms, stage: ev.stage.value, geography: ev.geography.value, contact: ev.contact.value, recent: ev.recent.ok, thesis_quote: ev.thesis.quote, investor_quote: ev.investor.quote, stage_quote: ev.stage.quote, geo_quote: ev.geography.quote, contact_quote: ev.contact.quote, blockers: cls.blockers, conditions: cls.conditions.map((c) => c.text), pages: ps.map((p) => p.url) });
}
out.sort((a, b) => b.score - a.score);
if (process.argv.includes('--json')) console.log(JSON.stringify({ run, sources, orgs: out }, null, 2));
else { console.log(`# ${run}\nsources (third-party/lists, not candidates): ${sources.length}`); for (const o of out) console.log(`- ${o.org}: ${o.decision} (score ${o.score}) investor=${o.investor} thesis=${o.thesis}[${o.terms.join(',')}] stage=${o.stage} geo=${o.geography} contact=${o.contact} recent=${o.recent}${o.investor_quote ? `\n    investor: “${o.investor_quote.slice(0, 160)}”` : ''}${o.thesis_quote ? `\n    thesis: “${o.thesis_quote.slice(0, 160)}”` : ''}${o.stage_quote ? `\n    stage: “${o.stage_quote.slice(0, 120)}”` : ''}${o.geo_quote ? `\n    geo: “${o.geo_quote.slice(0, 120)}”` : ''}${o.contact_quote ? `\n    contact: “${o.contact_quote.slice(0, 100)}”` : ''}`); }
