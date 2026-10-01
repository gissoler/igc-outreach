/* Regresión de inversión (Mentiva). Rehace la verificación por código sobre los inversores que retuvo el motor en corridas reales,
   con el texto guardado (eval/runs/search-cache.json) y la lectura guardada del modelo.
   Invariantes de la lista principal: tesis (sector del brief), vía de contacto y año reciente con cita literal en la página;
   host que no sea prensa, plataforma ni agregador.
   Uso: node eval/regression/mentiva-investment.mjs [--json] */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { verifyFinding } from '../../server/research/engine.mjs';
import { literalIn, hostKind } from '../../server/research/verify.mjs';

const here = (p) => new URL(p, import.meta.url);
const TODAY = '2026-09-30';
const brief = JSON.parse(readFileSync(here('../briefs/mentiva.json'), 'utf8'));
const cacheFile = here('../runs/search-cache.json');
if (!existsSync(cacheFile)) { console.log('eval/runs/search-cache.json no está'); process.exit(0); }
const cache = JSON.parse(readFileSync(cacheFile, 'utf8'));
const pages = new Map();
for (const rows of Object.values(cache)) for (const r of rows) if (r.markdown && (!pages.get(r.url) || r.markdown.length > pages.get(r.url).text.length)) pages.set(r.url, { url: r.url, title: r.title, text: r.markdown });

const runs = readdirSync(here('../runs/')).filter((d) => existsSync(here(`../runs/${d}/result.json`)));
const rows = []; const seen = new Set();
for (const d of runs) {
  const r = JSON.parse(readFileSync(here(`../runs/${d}/result.json`), 'utf8'));
  for (const f of (r.findings || []).filter((x) => x.objective === 'investment' && x.keep)) {
    const page = pages.get(f.url); if (!page || seen.has(`${d}|${f.url}`)) continue; seen.add(`${d}|${f.url}`);
    const out = { relevant: true, kind: 'investor', name: f.name, official: f.official, eligible: f.eligible, money: f.money || 'equity', quotes: f.quotes };
    const v = verifyFinding(out, { url: f.url, title: f.title, text: page.text }, 'investment', { today: TODAY, brief });
    rows.push({ run: d, url: f.url, name: f.name, before: `${f.verdict}/${f.tier}`, after: `${v.verdict}/${v.tier}`, why: v.drop || v.blockers?.[0] || 'verified', v, text: page.text });
  }
}
const changes = {}; for (const x of rows) changes[`${x.before}→${x.after}`] = (changes[`${x.before}→${x.after}`] || 0) + 1;
const main = rows.filter((x) => x.v.tier === 'main');
const invariants = {
  thesisQuote: main.every((x) => literalIn(x.v.quotes.eligible || '', x.text)),
  contactQuote: main.every((x) => literalIn(x.v.quotes.how_to_apply || '', x.text)),
  recentYear: main.every((x) => /\b20(25|26)\b/.test(x.v.quotes.recent || '')),
  ownHost: main.every((x) => hostKind(x.url) === 'other'),
};
const out = { today: TODAY, replayed: rows.length, changes, main: main.map((x) => ({ name: x.name, url: x.url })), invariants, reasons: rows.reduce((a, x) => (a[x.why] = (a[x.why] || 0) + 1, a), {}) };
if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 1));
else { console.log(`Regresión inversión · ${brief.company} · hoy ${TODAY}\nreplay de ${rows.length} inversores retenidos por corridas reales: ${JSON.stringify(changes)}\nen principal ahora: ${main.length} ${JSON.stringify(out.main.map((m) => m.name))}\nmotivos: ${JSON.stringify(out.reasons)}\ninvariantes: ${JSON.stringify(invariants)}`); }
process.exit(Object.values(invariants).every(Boolean) ? 0 : 1);
