// Cuenta página por página los descartes de una corrida (result.json) y quién decidió. Uso: node drops.mjs <result.json>
import { readFileSync } from 'node:fs';
const r = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const a of r.audits) {
  const t = a.traces; const rows = [];
  const out = { objective: a.objective, seconds: r.seconds, model: r.model, traces: t.length, pagesSummary: a.pages, read: a.read, unread: a.unread, kept: a.kept, dropped: a.dropped, skipped: a.skipped, verdicts: a.verdicts, judge: a.judge ? { calls: a.judge.calls, invalid: a.judge.invalid, errors: a.judge.errors, ms: a.judge.ms, states: a.judge.states, disagreed: a.judge.disagreed, failClosed: a.judge.failClosed, patternDisagrees: a.judge.patternDisagrees } : null, expand: a.expand, research: a.research ? { steps: a.research.steps, searches: a.research.searches, opens: a.research.opens, stopped: a.research.stopped } : null };
  const C = (o, k) => { o[k] = (o[k] || 0) + 1; };
  const byDecider = {}; const byReason = {}; const fetched = {}; const pt = {}; const modelVsCode = {}; const elig = {}; const judgeDrop = {};
  for (const x of t) {
    const m = x.read?.out; const j = x.judge; const v = x.verify;
    if (x.fetchedVia) C(fetched, x.fetchedVia);
    let reason = x.drop || (x.verdict === 'unread' ? 'unread' : x.verdict); let who;
    if (x.drop === 'aggregator' && !m) who = 'código: lista de hosts/ruta (verify.mjs hostKind)';
    else if (x.drop === 'social_host') who = 'código: lista de redes';
    else if (x.drop === 'over_page_budget') who = 'código: tope de páginas';
    else if (x.verdict === 'unread' && j?.failure?.compiler) { who = 'lectura inválida: compilador'; reason = 'compiler_invalid'; }
    else if (x.verdict === 'unread' && j?.failure?.judge) { who = 'lectura inválida: juez'; reason = 'judge_invalid'; }
    else if (x.verdict === 'unread') who = 'sin leer (otro)';
    else if (x.drop === 'closed') who = j?.dropReason === 'closed' ? 'juez (fechas con rol) + auditor por código (resta)' : 'código: dates.mjs';
    else if (x.drop?.startsWith('not_a_call:')) { who = 'código: pageType.mjs classifyPage'; C(pt, `${x.drop} | modelo page_type=${m?.page_type} kind=${m?.kind} | juez pageType=${j?.pageType?.judge} | regla="${v?.pageType?.reason}"`); }
    else if (x.drop?.startsWith('wrong_kind:')) who = 'modelo lector (kind) + regla de objetivo en engine.mjs';
    else if (x.drop?.startsWith('wrong_money:')) who = 'modelo lector (money) + regla de objetivo en engine.mjs';
    else if (x.drop === 'not_relevant') who = 'modelo lector (relevant=false)';
    else if (x.drop === 'not_eligible') { const src = j?.dropReason === 'not_eligible' ? 'juez' : (m?.eligible === 'no' ? 'modelo lector' : 'código: applicant.mjs'); who = `elegibilidad: ${src}`; const crit = j ? Object.entries(j.criteria || {}).filter(([, c]) => c.verdict === 'no' && c.quote).map(([k]) => k).join('+') : ''; C(elig, `${src} | juez no-con-cita=${crit || '-'} | lector eligible=${m?.eligible} | código=${v?.eligibility?.decision ?? '-'}`); }
    else if (x.drop === 'scope_mismatch') who = j?.dropReason === 'scope_mismatch' ? 'juez (topic_fit no con cita)' : (v?.scopeFit?.source === 'code' ? 'código: regla de vocabulario en verify.mjs' : 'modelo lector (scope_fit)');
    else who = 'otro';
    if (j) C(judgeDrop, `juez.dropReason=${j.dropReason ?? 'null'} → final=${x.drop ?? x.verdict}`);
    C(byDecider, who); C(byReason, reason);
    rows.push({ url: x.url, reason, who });
  }
  Object.assign(out, { byReason, byDecider, fetched, notACall: pt, eligibility: elig, judgeDrop });
  console.log(JSON.stringify(out, null, 1));
}
