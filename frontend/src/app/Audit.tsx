/* ─────────────────────────────────────────────────────────────────────────────
   Explicación y recorrido de cada resultado + auditoría de la corrida.
   Solo muestra lo que el servidor guardó (explain, trace, verification/codeCheck, gate, runAudit); no calcula nada.
   Sirve para responder: ¿falló la interpretación de mi mensaje, la búsqueda, la lectura o la verificación?
   ───────────────────────────────────────────────────────────────────────────── */
import { Check, ChevronRight, CircleSlash, Search, TriangleAlert } from 'lucide-react';
import { Fragment } from 'react';
import type { BriefInterpretation, Job, JudgeAudit, JudgeTrace, Lead, ResultTrace, RunAudit, VerifyCheck } from '../researchApi';
import { clip } from './format';
import './audit.css';

const TIER_LABEL = { main: 'Main list · open and eligible, verified', verify: 'To verify', drop: 'Discarded' } as const;
const TIER_CHIP = { main: 'mint', verify: 'sun', drop: 'rose' } as const;
const CHECK_LABEL: Record<string, string> = { host: 'Source', page_type: 'Is it a call?', deadline: 'Deadline vs today', eligibility: 'Who can apply', non_dilutive: 'Non-dilutive', official: 'Official page' };
const REASON_LABEL: Record<string, string> = {
  closed: 'Closed (deadline passed)', not_eligible: 'Not eligible', scope_mismatch: 'Doesn\'t fund this kind of project', aggregator: 'Aggregator / directory', social_host: 'Social network', not_official: 'Not the official source',
  'not_a_call:report': 'Report, not a call', 'not_a_call:blog': 'Blog post', 'not_a_call:news': 'News', 'not_a_call:event': 'Event / workshop', 'not_a_call:cohort': 'Cohort announcement',
  'not_a_call:directory': 'Directory', 'not_a_call:program_page': 'No way to apply on the page', not_a_call: 'Not a call', unreliable_read: 'AI read unreliable (invented quotes)',
  no_identity_quote: 'No quote for what it is', not_relevant: 'Not relevant', equity_or_loan: 'Equity or loan', off_topic: 'Off-topic', no_confirmed_evidence: 'No confirmed evidence',
  too_short: 'Page unreadable', over_page_budget: 'Over page budget', historical_record: 'Historical record', excluded_by_user: 'Excluded by you', unread: 'Not read',
};
export const reasonLabel = (r: string) => REASON_LABEL[r] || (r.startsWith('wrong_kind:') ? `Wrong type (${r.slice(11)})` : r.startsWith('wrong_money:') ? `Wrong money (${r.slice(12)})` : r.replace(/_/g, ' '));
const str = (v: unknown) => (v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v));

function CheckRow({ c }: { c: VerifyCheck }) {
  return <li className={c.ok ? 'ok' : 'no'}>{c.ok ? <Check size={13} /> : <TriangleAlert size={13} />}<div><b>{CHECK_LABEL[c.check] || c.check}</b> <span>{c.detail}</span>{c.quote ? <q>{clip(c.quote, 220)}</q> : null}</div></li>;
}

/** Lo que el modelo extrajo (campos útiles de la lectura). */
function ModelRead({ out }: { out: Record<string, unknown> }) {
  const q = (out.quotes || {}) as Record<string, unknown>;
  const a = (out.applicants || {}) as Record<string, unknown>;
  const rows: [string, string][] = [
    ['Page type', str(out.page_type || out.kind)], ['Name', str(out.name)], ['Status (model)', str(out.status)], ['Deadline (model)', str(out.deadline)],
    ['Eligible (model)', str(out.eligible)], ['Who can apply', [str(a.entity_types), a.for_profit_allowed ? `for-profit: ${str(a.for_profit_allowed)}` : '', str(a.countries)].filter((x) => x && x !== '[]').join(' · ')],
    ['Quote · deadline', str(q.deadline)], ['Quote · eligibility', str(q.eligible)], ['Quote · how to apply', str(q.how_to_apply)],
  ].filter(([, v]) => v && v !== 'null' && v !== '""') as [string, string][];
  return <dl className="x-dl au-dl">{rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{clip(v, 240)}</dd></Fragment>)}</dl>;
}

function Interpretation({ it }: { it: BriefInterpretation }) {
  const ap = it.applicant;
  return <dl className="x-dl au-dl">
    <dt>Looking for</dt><dd>{it.looking_for}{it.nonDilutiveOnly ? ' · non-dilutive only' : ''}</dd>
    <dt>Topic</dt><dd>{it.focus || '—'}{it.product ? ` · ${clip(it.product, 80)}` : ''}</dd>
    <dt>Geography · stage</dt><dd>{it.geography || '—'} · {it.stage}</dd>
    {ap && <><dt>Applicant</dt><dd>{ap.entity.replace(/_/g, ' ')} <small className="pl-mut">({ap.entitySource})</small> · country: {ap.country || (ap.outside.length ? `outside ${ap.outside.join('/')}` : 'unknown')} <small className="pl-mut">({ap.countrySource})</small></dd></>}
    <dt>Today used</dt><dd>{it.today} · year {it.year} · recency {it.recency}</dd>
    <dt>Queries planned by</dt><dd>{it.planner}{it.providers?.length ? ` · search: ${it.providers.join(', ')}` : ''}</dd>
  </dl>;
}

/** Recorrido completo de una página (sirve para resultados y descartados). */
export function TraceBody({ t, interpretation }: { t: ResultTrace; interpretation?: BriefInterpretation }) {
  const v = t.verify;
  return <ol className="au-steps">
    <li><span className="au-n">1</span><div><h4>How your brief was read</h4>{interpretation ? <Interpretation it={interpretation} /> : <p className="ld-empty">Not recorded for this source.</p>}</div></li>
    <li><span className="au-n">2</span><div><h4>Search</h4>
      <ul className="au-list">{(t.queries?.length ? t.queries : t.query ? [{ query: t.query, family: t.family }] : []).map((q) => <li key={q.query}><Search size={12} /> <q>{q.query}</q>{q.family ? <small className="pl-mut"> · {q.family}</small> : null}</li>)}</ul>
      <p className="au-meta">Returned by: {t.providers?.length ? t.providers.join(', ') : '—'}{t.round ? ` · round ${t.round}` : ''}</p></div></li>
    <li><span className="au-n">3</span><div><h4>Page read</h4><p className="au-meta">{t.url ? <a href={t.url} target="_blank" rel="noreferrer">{clip(t.url, 90)}</a> : '—'} · via {t.fetchedVia || 'search'}{t.textChars ? ` · ${t.textChars.toLocaleString()} characters` : ''}</p>{t.note ? <p className="au-meta">{t.note}</p> : null}</div></li>
    <li><span className="au-n">4</span><div><h4>What the AI extracted</h4>{t.read?.out ? <><ModelRead out={t.read.out} /><p className="au-meta">Model: {t.read.model || '—'}. The page is untrusted data; the code decides below.</p></> : <p className="ld-empty">No AI read (code-only checks or not read).</p>}</div></li>
    {t.judge ? <li><span className="au-n">J</span><div><h4>What the compiler and judge agents decided</h4><JudgeStep j={t.judge} /></div></li> : null}
    <li><span className="au-n">5</span><div><h4>What the code verified {t.today ? <small className="pl-mut">· today = {t.today}</small> : null}</h4>
      {v?.checks?.length ? <ul className="au-checks">{v.checks.map((c) => <CheckRow key={c.check} c={c} />)}</ul> : <p className="ld-empty">No checks recorded.</p>}
      {v?.dates?.milestones?.length ? <details className="au-more"><summary>Dates found on the page ({v.dates.milestones.length})</summary><ul className="au-list">{v.dates.milestones.map((m, i) => <li key={i}><b>{m.iso || (m.tbd ? 'TBD' : 'no year')}</b> <small className="pl-mut">{m.phase}{m.optional ? ' (optional)' : ''}</small> <q>{clip(m.quote, 120)}</q></li>)}</ul></details> : null}
      {v?.flags?.length ? <p className="au-meta">Flags: {v.flags.join(' · ')}</p> : null}</div></li>
    <li><span className="au-n">6</span><div><h4>Decision</h4>
      {v?.tier ? <p><span className={`pl-chip ${TIER_CHIP[v.tier as keyof typeof TIER_CHIP] || 'gray'}`}>{TIER_LABEL[v.tier as keyof typeof TIER_LABEL] || v.tier}</span>{' '}{(v.reasons?.length ? v.reasons : t.reasons || []).map((r) => <span key={r} className="pl-chip gray">{reasonLabel(r)}</span>)}</p> : t.drop ? <p><span className="pl-chip rose">{reasonLabel(String(t.drop))}</span></p> : null}
      {v?.blockers?.length ? <ul className="ld-risks">{v.blockers.slice(0, 5).map((b) => <li key={b}><TriangleAlert size={13} /> {b}</li>)}</ul> : null}</div></li>
  </ol>;
}

const STATE_LABEL: Record<string, string> = { open: 'Open', upcoming: 'Not open yet', closed: 'Closed', forecast: 'Forecast notice (not open yet)', unknown: 'No deadline verified', unverified: 'Judge unavailable', 'n/a': 'No deadline for this type' };
const secs = (ms?: number) => (ms ? `${(ms / 1000).toFixed(1)} s` : '—');
/** V13 · lo que decidieron el agente de compilación y el agente juez para una página, y lo que auditó el código. */
export function JudgeStep({ j }: { j: JudgeTrace }) {
  return <div className="au-judge">
    <p className="au-meta">Compiler: {j.models.compiler || '—'} ({secs(j.ms?.compiler)}) · Judge: {j.models.judge || '—'} ({secs(j.ms?.judge)}) · {j.blind ? 'judge did not see the compiler\'s conclusions' : j.judgeSawClaims ? 'judge checked the compiler\'s claims' : 'judge read the page alone'} · calls: compiler {j.calls?.compiler ?? 0}, judge {j.calls?.judge ?? 0}</p>
    {j.failure?.compiler || j.failure?.judge ? <p className="au-warn"><TriangleAlert size={13} /> {j.failure.judge ? `Judge: ${j.failure.judge}` : ''} {j.failure.compiler ? `Compiler: ${j.failure.compiler}` : ''}</p> : null}
    <p><span className={`pl-chip ${j.state === 'open' ? 'mint' : j.state === 'closed' ? 'rose' : 'sun'}`}>{STATE_LABEL[j.state] || j.state}</span> {j.deadline ? <>deadline <b>{j.deadline}</b>{j.daysLeft != null ? ` · ${j.daysLeft} days left` : ''}</> : j.estimatedDeadline ? <>estimated <b>{j.estimatedDeadline}</b> (not a deadline yet)</> : null}</p>
    {Object.keys(j.criteria || {}).length ? <table className="x-table"><thead><tr><th>Criterion</th><th>Verdict</th><th>Quote from the page</th><th>vs compiler</th></tr></thead><tbody>{Object.entries(j.criteria).map(([k, c]) => <tr key={k}><th scope="row">{k.replace(/_/g, ' ')}</th><td>{c.verdict}{c.claimed && c.claimed !== c.verdict ? <small className="pl-mut"> (judge said {c.claimed}, no quote on the page)</small> : null}</td><td>{c.quote ? <q>{clip(c.quote, 140)}</q> : <span className="pl-mut">{c.reason ? clip(c.reason, 120) : '—'}</span>}</td><td>{c.compiler}</td></tr>)}</tbody></table> : null}
    {(j.dates?.judge?.length || j.dates?.compiler?.length) ? <details className="au-more"><summary>Dates: compiler {j.dates.compiler.length} · judge {j.dates.judge.length}</summary>
      {(['compiler', 'judge'] as const).map((who) => <ul key={who} className="au-list">{j.dates[who].map((d, i) => <li key={`${who}-${i}`}><b>{who}</b> · {d.role}: {d.date || 'no date'}{d.estimated ? ' (estimated)' : ''} · {d.verified ? 'quote found on the page' : `not verified (${(d.why || '').replace(/_/g, ' ')})`}{d.quote ? <> · <q>{clip(d.quote, 100)}</q></> : null}</li>)}</ul>)}
    </details> : null}
    {j.disagreements?.length ? <ul className="ld-risks">{j.disagreements.map((d) => <li key={d}><TriangleAlert size={13} /> {d}</li>)}</ul> : null}
  </div>;
}

function JudgePanel({ j }: { j: JudgeAudit }) {
  const states = Object.entries(j.states || {}).sort((a, b) => b[1] - a[1]);
  return <details className="au-more" open><summary>Compiler + judge agents · {j.pages} pages{j.failClosed ? ` · ${j.failClosed} without judge` : ''}</summary>
    {j.notices.map((n) => <p key={n} className="au-warn"><TriangleAlert size={13} /> {n}</p>)}
    <table className="x-table"><thead><tr><th>Agent</th><th>Model</th><th className="num">Calls</th><th className="num">Seconds</th><th className="num">Invalid JSON</th><th className="num">Errors</th></tr></thead><tbody>
      {(['compiler', 'judge'] as const).map((r) => <tr key={r}><th scope="row">{r}</th><td>{j.models[r] || '—'}</td><td className="num">{j.calls[r]}</td><td className="num">{(j.ms[r] / 1000).toFixed(1)}</td><td className="num">{j.invalid[r]}</td><td className="num">{j.errors[r]}</td></tr>)}
    </tbody></table>
    <p className="au-meta">{states.map(([k, n]) => `${STATE_LABEL[k] || k} ${n}`).join(' · ') || '—'} · compiler and judge disagreed on {j.disagreed} · the pattern date reader disagreed on {j.patternDisagrees} (alarm only){j.blind ? ' · blind judge' : ''}{j.sameModel ? ' · same model for both agents (no independence)' : ''}</p>
    {j.perPage.length ? <details className="au-more"><summary>Page by page ({j.perPage.length})</summary>
      <ul className="au-disc">{j.perPage.map((p) => <li key={p.url}><details><summary><span className={`pl-chip ${p.bucket === 'top' ? 'mint' : p.bucket === 'discarded' || p.bucket === 'unread' ? 'rose' : 'sun'}`}>{p.bucket || p.state}</span> {clip(p.title || p.url, 90)}</summary><JudgeStep j={p} /></details></li>)}</ul>
    </details> : null}
  </details>;
}

/** Sección del detalle: explicación verificada + recorrido. */
export function ResultTracePanel({ lead, job }: { lead: Lead; job: Job }) {
  const ver = lead.verification || lead.codeCheck;
  const interp = job.runAudit?.interpretations?.find((i) => i.objective === lead.fundingType) || job.runAudit?.interpretations?.[0];
  const t: ResultTrace | null = lead.trace || null;
  return <>
    <section className="ld-sec">
      <header className="ld-h"><h3>Why it is here</h3>{lead.gate ? <span className={`pl-chip ${TIER_CHIP[lead.gate.tier]}`}>{TIER_LABEL[lead.gate.tier]}</span> : ver?.tier ? <span className={`pl-chip ${TIER_CHIP[ver.tier]}`}>{TIER_LABEL[ver.tier]}</span> : null}</header>
      {lead.explain?.ai ? <div className="ld-src found"><span className="pl-chip lav">AI summary</span><div><p className="au-p">{lead.explain.ai}</p><small>Checked against the page: dates and amounts appear on it; it does not claim what the code could not verify.</small></div></div> : null}
      {lead.explain?.aiRejected ? <p className="au-meta"><CircleSlash size={12} /> AI summary hidden: {lead.explain.aiRejected}.</p> : null}
      {lead.explain?.facts ? <div className="ld-src read"><span className="pl-chip mint">Verified</span><div><p className="au-p">{lead.explain.facts}</p></div></div> : null}
      {lead.gate?.reason ? <p className="au-meta"><ChevronRight size={12} /> {lead.gate.reason}{lead.gate.pending ? ` (pending: ${lead.gate.pending})` : ''}</p> : null}
      {lead.explain?.unverified?.length ? <p className="au-meta">Not verified: {lead.explain.unverified.join(' · ')}.</p> : null}
      {!lead.explain && !lead.gate && <p className="ld-empty">This source does not record a verification.</p>}
    </section>
    <section className="ld-sec">
      <header className="ld-h"><h3>How we got it</h3><span className="ld-hint">Query → search → page → AI read → code checks → decision</span></header>
      {t ? <TraceBody t={{ ...t, url: t.url || lead.contact?.value }} interpretation={interp} /> : <>
        <ul className="au-list">{(lead.foundBy || []).map((f, i) => <li key={i}><Search size={12} /> {f.provider}{f.query ? <> · <q>{f.query}</q></> : null}{f.term ? <small className="pl-mut"> · {f.term}</small> : null}</li>)}</ul>
        {ver?.checks?.length ? <ul className="au-checks">{ver.checks.map((c) => <CheckRow key={c.check} c={c} />)}</ul> : null}
        {interp ? <details className="au-more"><summary>How your brief was read</summary><Interpretation it={interp} /></details> : null}
      </>}
    </section>
  </>;
}

/** Panel de auditoría de la corrida (pestaña de fuentes). */
export function RunAuditPanel({ audit }: { audit: RunAudit }) {
  if (audit.error) return <section className="pl-card"><p className="pl-mut">Run audit unavailable: {audit.error}</p></section>;
  const c = audit.counters;
  const sorted = (o: Record<string, number>) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]);
  return <section className="pl-card au-card">
    <header><h3>Run audit <span className="pl-badge dark">today {audit.today}</span></h3><span className="pl-mut">What the engine understood, searched, read and discarded</span></header>
    <div className="au-kpis">
      <div><b>{c.queries || audit.queries.length}</b><span>queries{c.queriesYearFixed ? ` · ${c.queriesYearFixed} year-fixed` : ''}</span></div>
      <div><b>{c.pagesSeen}</b><span>pages found</span></div>
      <div><b>{c.pagesRead}</b><span>read by the AI{c.rereadForDates ? ` · ${c.rereadForDates} re-read for dates` : ''}{c.extracted ? ` · ${c.extracted} second reads (${c.extractConflicts || 0} disagreed)` : ''}</span></div>
      <div><b>{c.buckets.top}</b><span>main list</span></div>
      <div><b>{c.buckets.radar}</b><span>to verify</span></div>
      <div><b>{c.buckets.discarded}</b><span>discarded</span></div>
      {c.research?.steps ? <div><b>{c.research.searches}</b><span>investigator searches · {c.research.opens} pages opened · {c.research.newPages} new pages ({c.research.steps} steps)</span></div> : null}
      {c.readVia && (c.readVia.crawl4ai || c.readVia.jina || c.readVia.firecrawl) ? <div><b>{c.readVia.crawl4ai}</b><span>pages read by Crawl4AI{c.readVia.jina ? ` · ${c.readVia.jina} by Jina` : ''}{c.readVia.firecrawl ? ` · ${c.readVia.firecrawl} by Firecrawl` : ''}</span></div> : null}
      {c.firecrawl ? <div className={c.firecrawl.capReached ? 'au-warn' : undefined}><b>{c.firecrawl.credits}</b><span>Firecrawl credits{c.firecrawl.possiblyCharged ? ` · +${c.firecrawl.possiblyCharged} possibly charged (failed/timed out)` : ''} · {c.firecrawl.cacheHits} from cache{c.extractCacheHits || c.scrapeCacheHits ? ` (${c.extractCacheHits || 0} second reads, ${c.scrapeCacheHits || 0} page reads)` : ''}{c.firecrawl.daily ? ` · today ${c.firecrawl.daily.used}${c.firecrawl.daily.cap != null ? ` / ${c.firecrawl.daily.cap}` : ''}` : ''}{c.firecrawl.capReached ? ` · daily cap reached: second reads switched off${c.firecrawl.capSkipped ? ` (${c.firecrawl.capSkipped} calls skipped)` : ''}` : ''}</span></div> : null}
    </div>
    <div className="au-cols">
      <div><h4>Discarded by reason</h4><ul className="au-bars">{sorted({ ...c.droppedByEngine, ...Object.fromEntries(sorted(c.discardReasons).filter(([k]) => !(k in c.droppedByEngine))) }).map(([k, n]) => <li key={k}><span>{reasonLabel(k)}</span><b>{n}</b></li>)}</ul>
        {sorted(c.skippedBeforeReading).length ? <p className="au-meta">Not read: {sorted(c.skippedBeforeReading).map(([k, n]) => `${reasonLabel(k)} ${n}`).join(' · ')}</p> : null}</div>
      <div><h4>To verify, why</h4><ul className="au-bars">{sorted(c.radarReasons).slice(0, 8).map(([k, n]) => <li key={k}><span>{k}</span><b>{n}</b></li>)}</ul></div>
    </div>
    {audit.comparePrompts && Object.keys(audit.comparePrompts).length ? <details className="au-more"><summary>Prompt to compare with another AI</summary>
      {Object.entries(audit.comparePrompts).map(([k, text]) => <div key={k}><p className="au-meta">{k === 'grant' ? 'Grants' : k === 'investment' ? 'Investors' : k} · same brief and rules as this run. Paste it into an AI with web search turned on.</p>
        <textarea readOnly value={text} rows={8} style={{ width: '100%', font: 'inherit', fontSize: 12 }} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="pl-btn" onClick={() => { navigator.clipboard?.writeText(text).catch(() => {}); }}>Copy prompt</button></div>)}
    </details> : null}
    {audit.judge ? <JudgePanel j={audit.judge} /> : null}
    {audit.orchestrator?.attempts?.length ? <details className="au-more" open><summary>Search orchestrator · decided by {audit.orchestrator.by || 'rules'}</summary>
      <ul className="au-disc">{audit.orchestrator.attempts.map((a) => <li key={a.attempt}><p><b>Attempt {a.attempt}</b> · {a.stopped === 'sufficient' ? 'results were enough, no extra search' : a.stopped === 'time' ? 'no time left for another attempt' : `${(a.strategy || '').replace(/_/g, ' ')} · ${a.added ?? 0} new results · main list ${a.topBefore ?? '—'} → ${a.topAfter ?? '—'}`}{a.by ? ` · ${a.by}` : ''}{a.error ? ` · ${a.error}` : ''}</p>
        {a.diagnosis ? <p className="au-meta">{a.diagnosis}</p> : null}{a.queries.length ? <p className="au-meta">Searched: {a.queries.join(' · ')}</p> : null}</li>)}</ul>
    </details> : null}
    {audit.providers?.length ? <details className="au-more" open><summary>Which search source was worth it ({audit.providers.length})</summary>
      <table className="x-table"><thead><tr><th>Source</th><th className="num">URLs</th><th className="num">Only here</th><th className="num">Main</th><th className="num">To verify</th><th className="num">Useful %</th><th className="num">Noise %</th><th className="num">Calls</th><th className="num">Cost</th></tr></thead>
        <tbody>{audit.providers.map((p) => <tr key={p.provider} title={Object.entries(p.outcomes).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${reasonLabel(k)} ${n}`).join(' · ')}><th scope="row">{p.provider}{p.disabled ? ' (off: failed)' : ''}{p.errors ? ` · ${p.errors} errors` : ''}</th><td className="num">{p.urls}</td><td className="num">{p.uniqueUseful ? `${p.uniqueUseful} useful` : p.onlyUrls}</td><td className="num">{p.apply}</td><td className="num">{p.watch}</td><td className="num">{p.usefulPct ?? '—'}</td><td className="num">{p.noisePct ?? '—'}</td><td className="num">{p.calls}</td><td className="num">{p.costUsd ? `${p.costUsd.toFixed(3)}` : 'not measured'}</td></tr>)}</tbody></table>
      <p className="au-meta">A URL counts for every source that returned it. «Only here» = returned by that source alone. Useful = kept by the code check (main list + to verify). Hover a row for its discard reasons. Cost is only what the source reports; blank = not measured.</p>
    </details> : null}
    {audit.grantSources ? <details className="au-more"><summary>Grant sources: jurisdiction, funded projects, portals</summary>
      <ul className="au-disc">
        <li><p><b>Jurisdiction</b> · {audit.grantSources.jurisdiction || 'not set (state and regional programs were not targeted)'}</p>
          {audit.grantSources.portals.length ? <p className="au-meta">Portals read: {audit.grantSources.portals.map((p) => p.name).join(' · ')}{audit.grantSources.portalPages.length ? ` → ${audit.grantSources.portalPages.map((x) => x.pages).join('/')} linked pages` : ''}</p> : null}</li>
        {audit.grantSources.reporter ? <li><p><b>NIH RePORTER</b> · {audit.grantSources.reporter.projects} similar funded projects{audit.grantSources.reporter.medianAward ? ` · median award $${Math.round(audit.grantSources.reporter.medianAward).toLocaleString('en-US')}` : ''}</p>
          <p className="au-meta">Notices behind them: {audit.grantSources.reporter.notices.map((n) => `${n.id} (${n.projects})`).join(' · ') || 'none identified'}{audit.grantSources.reporter.orgTypes.length ? ` · organization types: ${audit.grantSources.reporter.orgTypes.map((x) => `${x.name} ${x.count}`).join(', ')}` : ''}</p></li> : null}
        {audit.grantSources.nsf ? <li><p><b>NSF Awards</b> · {audit.grantSources.nsf.awards} similar awards{audit.grantSources.nsf.medianAward ? ` · median $${Math.round(audit.grantSources.nsf.medianAward).toLocaleString('en-US')}` : ''}</p>
          <p className="au-meta">Programs: {audit.grantSources.nsf.programs.map((x) => `${x.name} (${x.count})`).join(' · ') || 'none'}</p></li> : null}
        {audit.grantSources.errors.length ? <li><p className="au-meta">Skipped: {audit.grantSources.errors.join(' · ')}</p></li> : null}
      </ul>
      <p className="au-meta">The notices and programs found here were searched in Grants.gov and read by the AI like any other call.</p></details> : null}
    {audit.expansion?.length ? <details className="au-more"><summary>Expansion from verified pages</summary>
      <ul className="au-disc">{audit.expansion.map((x) => <li key={x.objective}><p><b>{x.objective}</b> · {x.seeds} verified pages used as seeds → {x.pages} new candidate pages</p>
        <p className="au-meta">Links followed: {x.snowball} · similar pages (Exa): {x.similar} · site pages: {x.siteDive}{x.siteDiveVia ? ` (${x.siteDiveVia.replace(/_/g, ' ')})` : ''} · lateral queries: OpenAlex funders {x.lateral.openalex}, SEC rounds {x.lateral.edgar}, AI angles {x.lateral.ai}</p>
        {x.errors.length ? <p className="au-meta">Skipped: {x.errors.join(' · ')}</p> : null}</li>)}</ul>
      <p className="au-meta">Each candidate went through the same reading and code checks. Their share shows in the source table above as snowball, exa-similar and site-dive.</p>
    </details> : null}
    {audit.interpretations.map((it) => <details key={it.objective} className="au-more"><summary>How your brief was read · {it.objective}</summary><Interpretation it={it} /></details>)}
    {audit.queries.length ? <details className="au-more"><summary>Queries ({audit.queries.length})</summary>
      <table className="x-table"><thead><tr><th>Query</th><th>Family</th><th className="num">Returned</th><th className="num">New pages</th></tr></thead><tbody>{audit.queries.map((q, i) => <tr key={`${q.query}-${i}`}><td>{q.query}{q.researcher ? <small className="pl-mut"> · investigator</small> : null}{q.original ? <small className="pl-mut"> (was: {q.original})</small> : null}{q.error ? <small className="pl-mut"> · error: {q.error}</small> : null}</td><td>{q.family || '—'}</td><td className="num">{q.returned ?? '—'}</td><td className="num">{q.newPages ?? '—'}</td></tr>)}</tbody></table>
    </details> : null}
    {audit.discarded.length ? <details className="au-more"><summary>Discarded pages, one by one ({audit.discarded.length})</summary>
      <ul className="au-disc">{audit.discarded.map((t, i) => <li key={`${t.url}-${i}`}><details><summary><span className="pl-chip rose">{reasonLabel(String(t.drop || t.verdict || 'discarded'))}</span> {clip(t.name || t.title || t.url || '', 80)} <small className="pl-mut">{clip(t.url || '', 60)}</small></summary>
        <TraceBody t={t} interpretation={audit.interpretations.find((x) => x.objective === t.objective)} /></details></li>)}</ul>
    </details> : null}
  </section>;
}
