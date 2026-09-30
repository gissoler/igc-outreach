/* ─────────────────────────────────────────────────────────────────────────────
   Regresión de calidad de grants — brief Mentiva (eval/briefs/mentiva.json), hoy = 2026-09-30.
   Sin red y sin modelo real: el lector se SIMULA para probar que el CÓDIGO sostiene los criterios aunque
   el modelo se equivoque. Tres partes:
     A · Gold: 11 páginas reales del banco (eval/bench) + 3 casos reportados (tests/fixtures) con verdad
         conocida. Criterios medibles (deben ser 0 / 100 %):
           1. cerradas presentadas como abiertas en la lista principal
           2. elementos de la lista principal sin fecha verificable
           3. informes/blogs/eventos/cohortes tratados como convocatoria (retenidos)
           4. no elegibles con veredicto `apply`
           5. % de fechas retenidas con cita literal que contiene la fecha
         Se corre con dos lectores simulados: "adversario" (siempre dice abierta, elegible, oficial y propone
         una fecha) y "fiel" (lo que dice el gold).
     B · Replay de corridas reales del 30/09 (eval/runs/<corrida>/result.json + search-cache.json): cada grant que el
         código anterior retuvo se re-verifica con el código nuevo, con la misma lectura guardada del modelo y
         el texto de página guardado. Cuenta cambios de clase y motivos. (No es una corrida nueva: no hay red.)
     C · Estrés: un lector crédulo (dice sí a todo, pero cita literal) sobre TODAS las páginas guardadas de consultas de grants (caché real):
         invariantes de la lista principal (fecha futura con cita literal, elegibilidad con cita, tipo convocatoria).
   Uso: node eval/regression/mentiva-grants.mjs [--json]
   ───────────────────────────────────────────────────────────────────────────── */
import { readFileSync, existsSync } from 'node:fs';
import { runObjective, verifyFinding } from '../../server/research/engine.mjs';
import { literalIn } from '../../server/research/verify.mjs';
import { datesIn } from '../../server/research/dates.mjs';

const here = (p) => new URL(p, import.meta.url);
const TODAY = '2026-09-30';
const brief = JSON.parse(readFileSync(here('../briefs/mentiva.json'), 'utf8'));

/* Verdad conocida por página (gold del banco + casos reportados). null = sin verdad para ese campo. */
function goldPages() {
  const bench = JSON.parse(readFileSync(here('../bench/mentiva-pages.json'), 'utf8')).pages;
  const gold = JSON.parse(readFileSync(here('../bench/mentiva-gold.json'), 'utf8')).extract;
  const fx = JSON.parse(readFileSync(here('../../tests/fixtures/search-quality-cases.json'), 'utf8'));
  const truth = {
    ...Object.fromEntries(Object.entries(gold).map(([id, g]) => [id, { status: g.status, deadline: g.deadline, eligible: g.eligible, official: g.official }])),
    biohub: { status: 'not_a_call', nonCall: 'report', eligible: null }, uw: { status: 'closed', nonCall: 'event', eligible: 'no' }, addf: { status: 'closed', deadline: '2026-09-14', eligible: 'yes' },
  };
  truth.headstreaminnovation.nonCall = 'cohort';
  // Casos cerrados por fecha a 2026-09-30 aunque el gold (29/09) no puntúe el estado
  truth.startupgrantsindia.status = 'closed';
  return [...bench, ...fx.pages].map((p) => ({ ...p, truth: truth[p.id] || {} }));
}

const sentenceWith = (text, needle) => String(text).replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).find((s) => s.includes(needle)) || '';
/** Lector adversario: siempre abierta, elegible, oficial, programa; propone la última fecha futura de la página (o una inventada). */
function adversarialRead(page) {
  const text = String(page.text).replace(/\s+/g, ' ');
  const future = datesIn(text).filter((d) => d >= TODAY).sort();
  const deadline = future.at(-1) || '2026-12-31';
  const first = text.split(/(?<=[.!?])\s+/).find((s) => s.length > 30) || text.slice(0, 120);
  const raw = future.length ? sentenceWith(text, new Date(`${deadline}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })) : '';
  return { relevant: true, kind: 'program', page_type: 'call', name: page.title || page.id, official: true, status: 'open', deadline, eligible: 'yes', non_dilutive: 'yes', money: 'grant', summary: `Convocatoria abierta hasta ${deadline}; somos elegibles.`, quotes: { identity: first.slice(0, 200), deadline: raw || `Applications close ${deadline}`, eligible: first.slice(0, 200), status: 'Applications are open' } };
}
/** Lector crédulo: dice sí a todo (abierta, elegible, oficial, programa) pero solo cita frases literales. Sirve para ver qué
 *  deja pasar el CÓDIGO por sí solo sobre páginas reales. */
function lenientRead(page) {
  const text = String(page.text).replace(/\s+/g, ' ');
  const first = text.split(/(?<=[.!?])\s+/).find((s) => s.length > 30) || text.slice(0, 120);
  return { relevant: true, kind: 'program', page_type: 'call', name: page.title || page.id, official: true, status: 'open', deadline: null, eligible: 'yes', non_dilutive: 'yes', money: 'grant', quotes: { identity: first.slice(0, 200) } };
}
/** Lector fiel: lo que dice el gold (cuando lo hay). */
function faithfulRead(page) {
  const t = page.truth; const text = String(page.text).replace(/\s+/g, ' ');
  const dl = t.deadline && t.deadline !== '*' ? t.deadline : null;
  const q = dl ? text.split(/(?<=[.!?])\s+/).find((s) => datesIn(s).includes(dl)) : null;
  return { relevant: true, kind: t.nonCall ? (t.nonCall === 'cohort' ? 'news' : 'other') : 'program', name: page.title || page.id, official: t.official !== false, status: t.status && t.status !== '*' ? t.status : 'unknown', deadline: dl, eligible: t.eligible || 'unclear', non_dilutive: 'unknown', money: 'grant', quotes: { identity: text.split(/(?<=[.!?])\s+/)[0].slice(0, 200), ...(q ? { deadline: q } : {}) } };
}

function criteria(findings, pages, dropped = []) {
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  const main = findings.filter((f) => f.verdict === 'apply');
  const truthOf = (f) => byUrl.get(f.url)?.truth || {};
  const closedAsOpen = main.filter((f) => ['closed', 'not_a_call'].includes(truthOf(f).status) || (f.deadline && f.deadline < TODAY));
  const noDate = main.filter((f) => !f.deadline || !f.deadlineQuote || !literalIn(f.deadlineQuote, byUrl.get(f.url)?.text || f.pageText || '') || !datesIn(f.deadlineQuote).includes(f.deadline));
  const nonCallKept = findings.filter((f) => truthOf(f).nonCall || ['report', 'blog', 'news', 'event', 'cohort', 'directory'].includes(f.pageType?.type));
  const notEligibleApply = main.filter((f) => truthOf(f).eligible === 'no' || f.eligible !== 'yes');
  const dated = findings.filter((f) => f.deadline);
  const literal = dated.filter((f) => f.deadlineQuote && literalIn(f.deadlineQuote, byUrl.get(f.url)?.text || f.pageText || '') && datesIn(f.deadlineQuote).includes(f.deadline));
  return {
    kept: findings.length, main: main.length, dropped: dropped.length,
    closedAsOpen: closedAsOpen.length, mainWithoutVerifiableDate: noDate.length, nonCallsKeptAsCall: nonCallKept.length, notEligibleAsApply: notEligibleApply.length,
    datesWithLiteralQuotePct: dated.length ? Math.round((literal.length / dated.length) * 1000) / 10 : 100,
    detail: { closedAsOpen: closedAsOpen.map((f) => f.url), mainWithoutVerifiableDate: noDate.map((f) => f.url), nonCallsKeptAsCall: nonCallKept.map((f) => f.url), notEligibleAsApply: notEligibleApply.map((f) => f.url) },
  };
}
export const PASS = (c) => c.closedAsOpen === 0 && c.mainWithoutVerifiableDate === 0 && c.nonCallsKeptAsCall === 0 && c.notEligibleAsApply === 0 && c.datesWithLiteralQuotePct === 100;

/** A · Gold con lector simulado. */
export async function partA(mode = 'adversarial') {
  const pages = goldPages();
  const read = mode === 'adversarial' ? adversarialRead : faithfulRead;
  const chat = async ({ name, user }) => {
    if (name === 'plan') return { json: { queries: [{ query: 'mental health startup grant 2026', family: 'gold' }] } };
    const p = pages.find((x) => user.includes(`PAGE URL: ${x.url}`));
    return { json: p ? read(p) : {}, model: `sim-${mode}` };
  };
  const r = await runObjective('grant', brief, { chat, search: async () => pages.map((p) => ({ url: p.url, title: p.title, markdown: p.text, providers: ['bench'] })), today: TODAY, rounds: 1, maxPages: 50 });
  return { mode, ...criteria(r.findings, pages, r.audit.traces), dropReasons: r.audit.dropped, mainList: r.findings.filter((f) => f.verdict === 'apply').map((f) => ({ url: f.url, deadline: f.deadline })), verify: r.findings.filter((f) => f.verdict === 'watch').map((f) => ({ url: f.url, why: f.blockers?.[0] })) };
}

/* Páginas guardadas de corridas reales */
function cachedPages() {
  const file = here('../runs/search-cache.json');
  if (!existsSync(file)) return null;
  const cache = JSON.parse(readFileSync(file, 'utf8'));
  const pages = new Map();
  for (const [key, rows] of Object.entries(cache)) for (const r of rows) {
    if (!r.markdown) continue;
    const had = pages.get(r.url);
    if (!had || r.markdown.length > had.text.length) pages.set(r.url, { url: r.url, title: r.title, text: r.markdown, query: key.split('|').slice(1).join('|') });
  }
  return pages;
}
const GRANT_FAMILY = /grant|program|sbir|sttr|nih|nsf|prize|challenge|foundation|philanthrop|accelerator|eu\b|uk\b|federal|non-dilutive|government|innovation fund|horizon|eic|ukri|call/i;
const INVEST_FAMILY = /angel|venture|seed and pre-seed|pre-seed|corporate venture|rounds|investor|syndicate|vc\b/i;

/** B · Replay de lo que retuvo el código anterior en las corridas reales. */
export function partB() {
  const pages = cachedPages();
  if (!pages) return { skipped: 'eval/runs/search-cache.json no está' };
  const runs = ['2026-09-30-02-26-qwen3-30b', '2026-09-30-02-55-Qwen3.6-27B-FP8', '2026-09-30-02-58-qwen3-30b'].filter((d) => existsSync(here(`../runs/${d}/result.json`)));
  const rows = []; const changes = {}; const reasons = {};
  for (const d of runs) {
    const r = JSON.parse(readFileSync(here(`../runs/${d}/result.json`), 'utf8'));
    for (const f of r.findings.filter((x) => x.objective === 'grant')) {
      const page = pages.get(f.url);
      if (!page) { rows.push({ run: d, url: f.url, before: f.verdict, after: 'n/a (sin texto guardado)' }); continue; }
      // Lectura guardada del modelo (lo que el código anterior aceptó). `kind` no se guardó: se asume "program".
      const out = { relevant: true, kind: 'program', name: f.name, official: f.official, status: f.status, deadline: f.deadline, eligible: f.eligible, non_dilutive: 'unknown', money: f.money || 'grant', amount: f.amount, quotes: f.quotes };
      const v = verifyFinding(out, { url: f.url, title: f.title, text: page.text }, 'grant', { today: TODAY, brief });
      const before = f.verdict; const after = v.verdict;
      const key = `${before}→${after}`; changes[key] = (changes[key] || 0) + 1;
      const why = v.drop || (after === 'watch' ? v.blockers?.[0] : 'verified');
      if (before !== after || after !== 'apply') reasons[why] = (reasons[why] || 0) + 1;
      rows.push({ run: d, url: f.url, name: f.name, before, after, why, deadline: v.deadline, eligibility: v.eligibility?.reason });
    }
  }
  return { runs, total: rows.length, changes, reasons, rows };
}

/** C · Estrés con lector adversario sobre todas las páginas guardadas de consultas de grants. */
export async function partC() {
  const pages = cachedPages();
  if (!pages) return { skipped: 'eval/runs/search-cache.json no está' };
  const list = [...pages.values()].filter((p) => GRANT_FAMILY.test(p.query) && !INVEST_FAMILY.test(p.query));
  const chat = async ({ name, user }) => {
    if (name === 'plan') return { json: { queries: [{ query: 'cache', family: 'cache' }] } };
    const p = list.find((x) => user.includes(`PAGE URL: ${x.url}`));
    return { json: p ? lenientRead(p) : {}, model: 'sim-lenient' };
  };
  const r = await runObjective('grant', brief, { chat, search: async () => list.map((p) => ({ url: p.url, title: p.title, markdown: p.text, providers: ['cache'] })), today: TODAY, rounds: 1, maxPages: 2000, concurrency: 16 });
  const byUrl = new Map(list.map((p) => [p.url, p]));
  const main = r.findings.filter((f) => f.verdict === 'apply');
  const invariants = {
    futureDeadline: main.every((f) => f.deadline && f.deadline >= TODAY),
    literalDateQuote: main.every((f) => literalIn(f.deadlineQuote, byUrl.get(f.url).text) && datesIn(f.deadlineQuote).includes(f.deadline)),
    eligibleWithQuote: main.every((f) => f.eligible === 'yes' && literalIn(f.eligibility?.quote || '', byUrl.get(f.url).text)),
    callPage: main.every((f) => f.pageType?.isCall),
  };
  return { pages: list.length, read: r.audit.read, kept: r.findings.length, main: main.length, verify: r.findings.length - main.length, dropped: r.audit.dropped, skippedBeforeReading: r.audit.skipped, invariants, mainList: main.map((f) => ({ url: f.url, name: f.name, deadline: f.deadline, deadlineQuote: f.deadlineQuote.slice(0, 140), eligibility: f.eligibility?.quote?.slice(0, 140) })) };
}

export async function runRegression() {
  const A = { adversarial: await partA('adversarial'), faithful: await partA('faithful') };
  return { today: TODAY, brief: brief.company, A, pass: PASS(A.adversarial) && PASS(A.faithful), B: partB(), C: await partC() };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const out = await runRegression();
  if (process.argv.includes('--json')) { console.log(JSON.stringify(out, null, 1)); process.exit(out.pass ? 0 : 1); }
  const c = (x) => `cerradas como abiertas ${x.closedAsOpen} · sin fecha verificable en principal ${x.mainWithoutVerifiableDate} · no-convocatorias retenidas ${x.nonCallsKeptAsCall} · no elegibles como apply ${x.notEligibleAsApply} · fechas con cita literal ${x.datesWithLiteralQuotePct} % · principal ${x.main} / retenidas ${x.kept}`;
  console.log(`Regresión grants · ${out.brief} · hoy ${out.today}`);
  console.log(`A · gold, lector adversario: ${c(out.A.adversarial)}`);
  console.log(`A · gold, lector fiel:       ${c(out.A.faithful)}`);
  console.log(`A · criterios: ${out.pass ? 'PASAN' : 'NO PASAN'}`);
  if (out.B.skipped) console.log(`B · ${out.B.skipped}`); else { console.log(`B · replay de ${out.B.total} grants retenidos por el código anterior (${out.B.runs.length} corridas): ${JSON.stringify(out.B.changes)}`); console.log(`    motivos: ${JSON.stringify(out.B.reasons)}`); }
  if (out.C.skipped) console.log(`C · ${out.C.skipped}`); else console.log(`C · estrés: ${out.C.pages} páginas guardadas, ${out.C.main} en principal, ${out.C.verify} a verificar; invariantes ${JSON.stringify(out.C.invariants)}; descartes ${JSON.stringify(out.C.dropped)}`);
  process.exit(out.pass ? 0 : 1);
}
