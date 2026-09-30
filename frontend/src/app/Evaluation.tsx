import { Activity, AlertTriangle, ArrowRight, ArrowUpRight, BarChart3, Bot, CheckCircle2, ChevronRight, CircleDashed, CircleSlash, Clock, Coins, Eye, Play, Route, SlidersHorizontal, Target, TrendingUp, Users, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { NetworkGraphData } from '../accountApi';
import type { Evidence, History, Job } from '../researchApi';
import { SOURCE_META } from '../sources';
import { CandidatePanel, EvidenceDrawer, RelationshipDrawer } from './Detail';
import { clip, fmtDateTime, fmtDuration, fmtInt, fmtPct, fmtShare, plural } from './format';
import {
  apifyStatus, bestPath, BUCKET_PLURAL, buildGraph, CONF_LABEL, headline, isDemoJob, jevStatus, SOURCE_STATE_LABEL, sourceHealth, summarize,
  type ApifyStatus, type GEdge, type GNode, type JevStatus, type NormHop, type NormPath, type SourceHealthItem, type SourceState, type Summary,
  warmPlanOf, warmShort,
} from './model';
import { ContactsTable, HowWeGotHere, ResultsIntro } from './Contacts';
import { DemoRibbon, Drawer, EmptyState, Info, LinkBadge, Meter } from './ui';
import { advisorApi } from '../analysisApi';

export function useMedia(q: string) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => { const mq = window.matchMedia(q); const f = () => setM(mq.matches); mq.addEventListener('change', f); f(); return () => mq.removeEventListener('change', f); }, [q]);
  return m;
}

const STATE_ICON: Record<SourceState, ReactNode> = { ok: <CheckCircle2 size={14} />, empty: <CircleDashed size={14} />, error: <XCircle size={14} />, not_configured: <CircleSlash size={14} />, skipped: <CircleSlash size={14} />, running: <Activity size={14} /> };
export function SourceStateBadge({ state }: { state: SourceState }) { return <span className={`x-state ${state}`}>{STATE_ICON[state]}{SOURCE_STATE_LABEL[state]}</span>; }

/* ───────── Apify / Jev: estado explicado ───────── */
export function ApifyCard({ s }: { s: ApifyStatus }) {
  const tone = s.state === 'ran' ? 'ok' : s.state === 'error' ? 'error' : s.state === 'ran_empty' || s.state === 'no_eligible' ? 'empty' : 'not_configured';
  return <article className={`svc ${tone}`}>
    <header><Coins size={16} aria-hidden="true" /><b>People search <small className="x-muted">(Firecrawl + ScrapeGraph)</small></b><SourceStateBadge state={tone as SourceState} /></header>
    <p className="svc-head">{s.headline}</p>
    <p>{s.explanation}</p>
    <dl className="svc-nums"><div><dt>Searches</dt><dd>{fmtInt(s.runs)}</dd></div><div><dt>Records</dt><dd>{fmtInt(s.items)}</dd></div><div><dt>With a named person</dt><dd>{fmtInt(s.people)}</dd></div><div><dt>Duration</dt><dd>{fmtDuration(s.durationMs)}</dd></div><div><dt>Credit</dt><dd>{s.creditUsed ? 'Used' : 'Not used'}</dd></div></dl>
    <p className="svc-cov"><b>Adds:</b> {s.coverage}</p>
    {s.action && <p className="svc-act"><ArrowRight size={13} /> {s.action}</p>}
    {s.tech && <details className="x-tech"><summary>Technical detail</summary>{s.tech}</details>}
  </article>;
}
export function JevCard({ s }: { s: JevStatus }) {
  const tone = s.state === 'ran' ? 'ok' : s.state === 'error' ? 'error' : 'not_configured';
  return <article className={`svc ${tone}`}>
    <header><Bot size={16} aria-hidden="true" /><b>AI second opinion <small className="x-muted">(Jev)</small></b><SourceStateBadge state={tone as SourceState} /></header>
    <p className="svc-head">{s.headline}</p><p>{s.explanation}</p>
    <dl className="svc-nums"><div><dt>Reviewed</dt><dd>{fmtInt(s.decisions)}</dd></div><div><dt>Moved to radar</dt><dd>{fmtInt(s.routedToRadar)}</dd></div><div><dt>Model</dt><dd>{s.model || '—'}</dd></div><div><dt>Duration</dt><dd>{fmtDuration(s.durationMs)}</dd></div></dl>
    {s.action && <p className="svc-act"><ArrowRight size={13} /> {s.action}</p>}
    {s.tech && <details className="x-tech"><summary>Technical detail</summary>{s.tech}</details>}
  </article>;
}

/* ───────── Salud de fuentes con línea de tiempo ───────── */
export function SourceHealth({ job, items }: { job: Job; items: SourceHealthItem[] }) {
  const t0 = Date.parse(job.createdAt);
  const spans = new Map<string, { a: number; b: number }>();
  for (const e of job.run?.events || []) {
    if (!e.provider) continue;
    const t = Date.parse(e.at) - t0;
    const s = spans.get(e.provider) || { a: t, b: t };
    s.a = Math.min(s.a, t); s.b = Math.max(s.b, t); spans.set(e.provider, s);
  }
  const total = Math.max(1, ...[...spans.values()].map((s) => s.b));
  const ok = items.filter((i) => i.state === 'ok').length;
  return <div className="srh">
    <p className="srh-sum"><b>{ok} of {items.length}</b> sources returned results · {items.filter((i) => i.state === 'error').length} failed · {items.filter((i) => i.state === 'not_configured').length} off · {items.filter((i) => i.state === 'empty').length} empty.</p>
    <table className="x-table">
      <thead><tr><th scope="col">Source</th><th scope="col">Status</th><th scope="col" className="num">Results</th><th scope="col" className="num">Calls</th><th scope="col">Timing</th><th scope="col">Reason / fix</th></tr></thead>
      <tbody>{items.map((i) => { const s = spans.get(i.name); return <tr key={i.name}>
        <th scope="row">{i.name}{i.consumesCredit && <span className="x-credit" title="May use credit">paid</span>}</th>
        <td><SourceStateBadge state={i.state} /></td>
        <td className="num">{i.results == null ? '—' : fmtInt(i.results)}</td>
        <td className="num">{i.calls ? `${i.calls}${i.failedCalls ? ` · ${i.failedCalls} failed` : ''}` : '—'}</td>
        <td><span className="srh-gantt" aria-label={s ? `From ${fmtDuration(s.a)} a ${fmtDuration(s.b)}` : 'Not run'}>{s && <i className={i.state} style={{ left: `${(s.a / total) * 100}%`, width: `${Math.max(1.5, ((s.b - s.a) / total) * 100)}%` }} />}</span><small>{fmtDuration(i.durationMs)}</small></td>
        <td className="srh-reason">{i.reason}{i.fix && <em>{i.fix}</em>}{i.tech && <details className="x-tech"><summary>Technical detail</summary>{i.tech}</details>}</td>
      </tr>; })}</tbody>
    </table>
    {!items.length && <p className="x-muted">No sources recorded.</p>}
  </div>;
}

/* ───────── Cobertura de evidencia ───────── */
export function EvidenceCoverage({ s }: { s: Summary }) {
  const max = Math.max(1, ...s.evidence.byFamily.map((f) => f.total));
  return <div className="cov">
    <div className="cov-fam"><h4>Evidence by source <small>{fmtInt(s.evidence.total)} unique · {fmtInt(s.evidence.urls)} URLs</small></h4>
      <ul>{s.evidence.byFamily.map((f) => <li key={f.key}><span className="cov-l"><i style={{ background: SOURCE_META[f.key].color }} aria-hidden="true" />{SOURCE_META[f.key].label}</span><span className="cov-bar" aria-hidden="true"><b style={{ width: `${(f.verified / max) * 100}%`, background: SOURCE_META[f.key].color }} /><s style={{ width: `${((f.total - f.verified) / max) * 100}%` }} /></span><span className="cov-n">{f.total} <small>· {fmtPct(f.total ? f.verified / f.total : 0)} verif.</small></span></li>)}</ul>
      <p className="x-muted">Solid = verified · hatched = unverified.</p></div>
    <div className="cov-cov"><h4>Coverage per active candidate <small>out of {s.active} active</small></h4>
      <ul>{s.coverage.map((c) => <li key={c.key}><span className="cov-l">{c.label}<Info label={c.label}>{c.help}</Info></span><Meter value={c.count} max={c.of || 1} tone={c.of && c.count / c.of >= 0.6 ? 'green' : c.of && c.count / c.of >= 0.3 ? 'amber' : 'red'} label={fmtShare(c.count, c.of)} /><span className="cov-n">{fmtShare(c.count, c.of)}</span></li>)}</ul></div>
  </div>;
}

/* ───────── Evaluación con pestañas · sistema visual «Plan CRM» (Dstudio, Dribbble) ───────── */
type MetricKey = 'candidates' | 'actionable' | 'paths' | 'evidence' | 'confidence' | 'risks' | 'sources' | 'apify' | 'jev' | 'time';
type Tab = 'contactos' | 'resumen' | 'fuentes';
const pctOf = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
const initialsOf = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const TINTS = ['lav', 'mint', 'sun', 'sky'];
const CHIP: Record<string, { cls: string; label: string }> = { verified: { cls: 'mint', label: 'Verified' }, documented: { cls: 'sun', label: 'Documented' }, hypothesis: { cls: 'lav', label: 'Hypothesis' }, none: { cls: 'sky', label: 'To build' } };
const FUND: Record<string, string> = { investment: 'Investment', partnering: 'Partnering', grant: 'Grants', sponsorship: 'Sponsorship', debt: 'Debt' };

/* Gráfico de área / barras con capa de referencia (clara) y valor (oscura), rejilla vertical y tooltip negro. */
type Pt = { label: string; value: number; ref: number; tip: string };
function PlChart({ points, mode, unit = '' }: { points: Pt[]; mode: 'area' | 'bar'; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = points.length;
  const max = Math.max(1, ...points.map((p) => Math.max(p.value, p.ref)));
  const top = unit === '%' ? 100 : Math.ceil(max / 4) * 4 || 4;
  const ticks = [4, 3, 2, 1, 0].map((i) => (top / 4) * i);
  const x = (i: number) => ((i + 0.5) / n) * 100;
  const y = (v: number) => 100 - (v / top) * 100;
  const curve = (key: 'value' | 'ref') => points.map((p, i) => {
    const X = x(i), Y = y(p[key]);
    if (!i) return `M0 ${Y} L${X} ${Y}`;
    const pX = x(i - 1), pY = y(points[i - 1][key]), m = (pX + X) / 2;
    return `C${m} ${pY} ${m} ${Y} ${X} ${Y}`;
  }).join(' ') + ` L100 ${y(points[n - 1][key])}`;
  const h = hover ?? n - 1;
  const hp = points[h];
  return <div className="pc">
    <div className="pc-y">{ticks.map((t) => <span key={t}>{unit === '%' ? `${t}%` : fmtInt(t)}</span>)}</div>
    <div className="pc-plot" onMouseLeave={() => setHover(null)}>
      {points.map((_, i) => <i key={i} className="pc-grid" style={{ left: `${x(i)}%` }} />)}
      {mode === 'area' ? <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="pcRef" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#c7c6fb" /><stop offset="1" stopColor="#c7c6fb" stopOpacity=".15" /></linearGradient>
          <linearGradient id="pcVal" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#7b79f0" /><stop offset=".65" stopColor="#9a98f5" stopOpacity=".55" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
        </defs>
        <path d={`${curve('ref')} L100 100 L0 100 Z`} fill="url(#pcRef)" />
        <path d={`${curve('value')} L100 100 L0 100 Z`} fill="url(#pcVal)" />
        <path d={curve('value')} fill="none" stroke="#111" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <line x1="0" x2="100" y1={y(hp.value)} y2={y(hp.value)} stroke="#111" strokeDasharray="4 4" strokeWidth="1" vectorEffect="non-scaling-stroke" opacity=".55" />
      </svg> : <div className="pc-bars">{points.map((p, i) => <div key={i} className="pc-bar" style={{ left: `${x(i)}%` }}><s style={{ height: `${100 - y(p.ref)}%` }} /><b style={{ height: `${100 - y(p.value)}%` }} /></div>)}</div>}
      <i className="pc-cursor" style={{ left: `${x(h)}%` }} />
      <span className="pc-tip" style={{ left: `${x(h)}%`, top: `${Math.max(2, y(hp.value) - 16)}%` }}>{hp.tip}</span>
      {points.map((_, i) => <button key={i} className="pc-hit" style={{ left: `${(i / n) * 100}%`, width: `${100 / n}%` }} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} aria-label={`${points[i].label}: ${points[i].tip}`} />)}
    </div>
    <div className="pc-x">{points.map((p, i) => <span key={i} style={{ left: `${x(i)}%` }} className={i === h ? 'on' : ''}>{p.label}</span>)}</div>
  </div>;
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, ReactNode][]; onChange: (v: T) => void }) {
  return <div className="pl-seg" role="group">{options.map(([k, l]) => <button key={k} className={value === k ? 'on' : ''} aria-pressed={value === k} onClick={() => onChange(k)}>{l}</button>)}</div>;
}

export function ExecutiveSummary({ job, s, apify, jev, onMetric, onSelectLead, onGo, onOpenAdvisor, history, onSelectJob }: { job: Job; s: Summary; apify: ApifyStatus; jev: JevStatus; onMetric: (k: MetricKey) => void; onSelectLead: (id: string) => void; onGo: (t: 'network' | 'setup' | 'sources') => void; onOpenAdvisor?: () => void; history: History | null; onSelectJob?: (id: string) => void }) {
  const h = headline(job, s, apify, jev);
  const [view, setView] = useState<'funnel' | 'coverage' | 'evidence' | 'confidence'>('funnel');
  const [mode, setMode] = useState<'area' | 'bar'>('area');
  const [list, setList] = useState<'top' | 'radar'>('top');
  const demo = isDemoJob(job);
  const person = s.coverage.find((c) => c.key === 'person')?.count ?? 0;
  const role = s.coverage.find((c) => c.key === 'role')?.count ?? 0;
  const channel = s.coverage.find((c) => c.key === 'channel')?.count ?? 0;
  const evPct = s.evidence.total ? (s.evidence.verified / s.evidence.total) * 100 : 0;
  const share = (a: number, b: number) => `${a} of ${b} · ${pctOf(a, b)}%`;
  const funnelSteps: [string, number][] = [['Researched', s.total], ['Active', s.active], ['Named person', person], ['Role', role], ['Channel', channel], ['Warm path', s.withPath], ['Priority', s.buckets.top]];
  const points: Pt[] = view === 'funnel' ? funnelSteps.map(([label, v], i) => ({ label, value: v, ref: i ? funnelSteps[i - 1][1] : v, tip: `${v} · ${pctOf(v, s.total)}%` }))
    : view === 'coverage' ? s.coverage.map((c) => ({ label: c.label.replace(/^Con /, '').replace('≥ 1 verified evidence', 'Verified evidence').replace('≥ 2 source types', '2+ sources'), value: pctOf(c.count, c.of), ref: 100, tip: share(c.count, c.of) }))
    : view === 'evidence' ? s.evidence.byFamily.map((f) => ({ label: SOURCE_META[f.key].label, value: f.verified, ref: f.total, tip: `${f.verified} verified of ${f.total}` }))
    : (['alta', 'media', 'baja'] as const).map((c) => ({ label: `${CONF_LABEL[c]} confidence`, value: s.confidence[c], ref: s.active, tip: share(s.confidence[c], s.active) }));
  const leads = job.leads.filter((l) => l.bucket === list).sort((a, b) => a.rank - b.rank);
  const segs = [{ k: 'verified', n: s.pathStatus.verified, l: 'Verified' }, { k: 'documented', n: s.pathStatus.documented, l: 'Documented' }, { k: 'hypothesis', n: s.pathStatus.hypothesis, l: 'Hypothesis' }, { k: 'none', n: s.active - s.withPath, l: 'To build' }].filter((x) => x.n > 0);
  const critical = s.risks.filter((r) => r.critical);
  const interMap = new Map<string, string[]>();
  for (const l of job.leads) { if (l.bucket === 'discarded') continue; const p = bestPath(l); if (p?.introducer) interMap.set(p.introducer, [...(interMap.get(p.introducer) || []), l.id]); }
  const inter = [...interMap.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 4);
  return <div className="pl-tabpanel">
    <div className="pl-sec-head"><h2>Evaluation results</h2>
      {history && history.length > 1 && onSelectJob ? <label className="pl-select"><select value={job.id} onChange={(e) => onSelectJob(e.target.value)} aria-label="Switch evaluation">{history.map((x) => <option key={x.id} value={x.id}>{fmtDateTime(x.createdAt)}{x.mode === 'demo' ? ' · demo' : ''}{x.status === 'failed' ? ' · stopped' : ''}</option>)}</select></label>
        : <span className="pl-select static">{fmtDateTime(job.createdAt)}</span>}
    </div>
    <section className="pl-card pl-perf">
      <div className="pl-perf-top">
        <div className="pl-stats">
          <button onClick={() => onMetric('candidates')}><span>Candidates</span><b>{s.total}</b></button>
          <button onClick={() => onMetric('actionable')}><span>Priority</span><b>{s.buckets.top}</b></button>
          <button onClick={() => onMetric('paths')}><span>Network paths</span><b>{s.withPath}<small>/{s.active}</small></b></button>
          <button onClick={() => onMetric('evidence')}><span>Verified evidence</span><b>{Math.floor(evPct)}<small>.{String(Math.round((evPct % 1) * 10))}%</small></b></button>
        </div>
        <Seg value={mode} onChange={setMode} options={[['area', <><TrendingUp size={14} /> Area</>], ['bar', <><BarChart3 size={14} /> Bars</>]]} />
      </div>
      <div className="pl-legend" role="tablist" aria-label="Chart view">
        <span className="pl-legend-l">View</span>
        {([['funnel', 'Funnel', null], ['coverage', 'Coverage', 'lav'], ['evidence', 'Evidence by source', 'mint'], ['confidence', 'Confidence', 'sun']] as const).map(([k, l, dot]) => <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{dot && <i className={`dot ${dot}`} />}{l}</button>)}
      </div>
      <PlChart points={points} mode={mode} unit={view === 'coverage' ? '%' : ''} />
    </section>

    <div className="pl-row">
      <section className="pl-card pl-list">
        <header><h3>Candidates <span className="pl-badge dark">{leads.length}</span></h3><Seg value={list} onChange={setList} options={[['top', 'Priority'], ['radar', 'Radar']]} /></header>
        <table className="pl-table">
          <thead><tr><th>Name</th><th>Warm path</th><th>Status</th><th className="num">Score</th><th /></tr></thead>
          <tbody>{leads.slice(0, 6).map((l, i) => { const p = bestPath(l); const c = CHIP[p ? p.status : 'none']; return <tr key={l.id}>
            <td><span className="pl-who"><i className={`pl-av ${TINTS[i % 4]}`}>{initialsOf(l.person || l.org)}</i><span><b>{l.person || l.org}</b><small>{l.person ? `${l.role || 'Role not confirmed'} · ${l.org}` : clip(l.title, 48)}</small></span></span></td>
            <td>{p ? <span className="pl-two"><b>{p.hopCount} {p.hopCount === 1 ? 'hop' : 'hops'} · {fmtPct(p.strength)}</b><small><Route size={12} /> {p.introducer ? `via ${p.introducer}` : 'direct'}</small></span> : (() => { const w = warmPlanOf(l); return w ? <span className="pl-two"><b>{warmShort(w)}</b><small>{w.steps[0]?.what.slice(0, 44)}…</small></span> : <small className="pl-mut">—</small>; })()}</td>
            <td><span className={`pl-chip ${c.cls}`}>{c.label}</span></td>
            <td className="num"><b>{l.score}</b></td>
            <td className="num"><button className="pl-view" onClick={() => onSelectLead(l.id)}><Eye size={14} /> View</button></td>
          </tr>; })}</tbody>
        </table>
        {!leads.length && <p className="pl-empty">No candidates here.</p>}
        {leads.length > 6 && <button className="pl-more" onClick={() => onSelectLead(leads[6].id)}>See all {leads.length} in Candidates</button>}
      </section>
      <section className="pl-card pl-paths">
        <header><h3>Warm paths</h3><button className="pl-btn sm" onClick={() => onMetric('paths')}>View all</button></header>
        <p className="pl-big">{s.withPath}<small> via network · {s.active - s.withPath} to build with updates</small></p>
        {segs.length ? <div className="pl-split">{segs.map((x) => <div key={x.k} className={`pl-split-c ${x.k}`} style={{ flexGrow: x.n }}><i /><b>{x.n}</b><small>{x.l}</small></div>)}</div> : <p className="pl-empty">No data.</p>}
        {inter.length > 0 && <><p className="pl-inter-h">Key connectors</p><ul className="pl-inter">{inter.map(([name, ids], i) => <li key={name}><i className={`pl-av ${TINTS[(i + 1) % 4]}`}>{initialsOf(name)}</i><span>{name}</span><button className="pl-view" onClick={() => onSelectLead(ids[0])}>{plural(ids.length, 'candidate', 'candidates')} <ChevronRight size={13} /></button></li>)}</ul></>}
        {!s.withPath && !demo && <button className="pl-link" onClick={() => onGo('network')}>Grow your network <ArrowUpRight size={13} /></button>}
      </section>
    </div>

    <div className="pl-row even">
      <section className="pl-card pl-acts">
        <header><h3>Next actions <span className="pl-badge sun">{h.actions.length}</span></h3>{onOpenAdvisor ? <button className="pl-link" onClick={onOpenAdvisor}><Bot size={14} /> Ask the advisor</button> : null}</header>
        <ol className="pl-timeline">
          <li className="lead"><i className="pl-tl-ico"><Target size={14} /></i><div><p><b>{h.title}</b></p><small>{h.detail}</small>{h.lead && <div className="pl-tl-chips"><span className="pl-chip lav">Priority</span><ArrowRight size={13} /><span className="pl-chip mint">Ask for intro</span><button className="pl-btn dark sm" onClick={() => onSelectLead(h.lead!.id)}>View path</button></div>}</div></li>
          {h.actions.slice(h.lead ? 1 : 0, 6).map((a, i) => <li key={i}><i className="pl-tl-ico">{a.leadId ? <Route size={14} /> : <SlidersHorizontal size={14} />}</i><div><button className="pl-tl-t" onClick={() => (a.leadId ? onSelectLead(a.leadId) : a.target === 'sources' ? onMetric('sources') : onGo(a.target || 'network'))}>{a.label}</button><small>{a.detail}</small></div></li>)}
        </ol>
      </section>
      <section className="pl-card pl-risk">
        <header><h3>Risks <span className={`pl-badge ${critical.length ? 'rose' : 'mint'}`}>{s.risks.length}</span></h3><button className="pl-btn sm" onClick={() => onMetric('risks')}>Details</button></header>
        {s.risks.length ? <ul className="pl-rows">{s.risks.slice(0, 6).map((r) => <li key={r.label}><span>{r.critical && <AlertTriangle size={13} />}{r.label}</span><span className={`pl-chip ${r.critical ? 'rose' : 'gray'}`}>{plural(r.count, 'candidate', 'candidates')}</span></li>)}</ul> : <p className="pl-empty">No risks found.</p>}
        <div className="pl-conf"><div className="pl-conf-h"><span>Data confidence</span><button className="pl-link" onClick={() => onMetric('confidence')}>{s.confidenceMedian ? `Median: ${CONF_LABEL[s.confidenceMedian]}` : '—'}</button></div>
          <div className="pl-stack">{(['alta', 'media', 'baja'] as const).map((c) => s.confidence[c] > 0 && <i key={c} className={c} style={{ flexGrow: s.confidence[c] }} title={`${CONF_LABEL[c]}: ${s.confidence[c]}`} />)}</div>
          <div className="pl-stack-l">{(['alta', 'media', 'baja'] as const).map((c) => <span key={c}><i className={`dot ${c}`} />{CONF_LABEL[c]} {s.confidence[c]}</span>)}</div></div>
      </section>
    </div>
    {(job.grants?.evaluations.length || job.activeInvestors?.funds.length) ? <div className="pl-row even">
      {job.grants?.evaluations.length ? <RunGrants g={job.grants} onSelectLead={onSelectLead} /> : null}
      {job.activeInvestors?.funds.length ? <ActiveInvestors a={job.activeInvestors} /> : null}
    </div> : null}
  </div>;
}

function SourcesTab({ job, s, apify, jev, health, onMetric }: { job: Job; s: Summary; apify: ApifyStatus; jev: JevStatus; health: SourceHealthItem[]; onMetric: (k: MetricKey) => void }) {
  const ok = health.filter((i) => i.state === 'ok').length;
  const grantsOnly = job.brief.fundingTypes.length === 1 && job.brief.fundingTypes[0] === 'grant';
  return <div className="pl-tabpanel">
    <div className="pl-sec-head"><h2>Source health <span className="pl-count">{ok} of {health.length} responded</span></h2><button className="pl-btn" onClick={() => onMetric('time')}><Clock size={14} /> Date and duration</button></div>
    <section className="pl-card flush"><SourceHealth job={job} items={health} /></section>
    {job.searchAudit?.length ? <section className="pl-card flush">
      <header><h3>Search log <span className="pl-badge dark">{job.searchAudit.length}</span></h3><span className="pl-mut">Exact queries and what survived ranking</span></header>
      <table className="x-table"><thead><tr><th>Source</th><th>Query</th><th className="num">Returned</th><th className="num">New</th><th className="num">Priority</th><th className="num">Watch</th></tr></thead><tbody>{job.searchAudit.map((row, i) => <tr key={`${row.provider}-${row.query}-${i}`}><td>{row.provider}<small className="pl-mut"> · {row.dimension}</small></td><td>{row.query}</td><td className="num">{row.returned ?? '—'}</td><td className="num">{row.discovered}</td><td className="num">{row.priority}</td><td className="num">{row.watch}</td></tr>)}</tbody></table>
    </section> : null}
    <div className="pl-row even">
      <ApifyCard s={apify} />
      <JevCard s={jev} />
    </div>
    <div className="pl-sec-head"><h2>Evidence coverage <span className="pl-count">{fmtInt(s.evidence.total)} pieces</span></h2><span className="pl-mut">Verified = read at the original source</span></div>
    <section className="pl-card"><EvidenceCoverage s={s} /></section>
    <p className="pl-note">{grantsOnly ? "Score ranks review priority; it isn't a probability of winning. Nothing is submitted from the app." : "Score ranks priority; it isn't a probability of investment. Nothing is sent from the app."}</p>
  </div>;
}

function MetricBody({ k, job, s, apify, jev, health, onSelectLead }: { k: MetricKey; job: Job; s: Summary; apify: ApifyStatus; jev: JevStatus; health: SourceHealthItem[]; onSelectLead: (id: string) => void }) {
  const demo = isDemoJob(job);
  const LeadList = ({ ids }: { ids: string[] }) => <ul className="x-linklist">{ids.map((id) => job.leads.find((l) => l.id === id)).filter(Boolean).slice(0, 25).map((l) => <li key={l!.id}><button onClick={() => onSelectLead(l!.id)}>#{l!.rank} {l!.person || l!.org}<small>{l!.score}/100 · {CONF_LABEL[l!.confidence]}</small></button></li>)}</ul>;
  switch (k) {
    case 'candidates': {
      const byProvider = new Map<string, number>();
      for (const l of job.leads) { const src = l.evidence[0]?.source.replace(/ ·.*/, '') || '—'; byProvider.set(src, (byProvider.get(src) || 0) + 1); }
      return <><p>Unique candidates after de-duplication.</p>
        <table className="x-table"><tbody>{(['top', 'radar', 'discarded'] as const).map((b) => <tr key={b}><th scope="row">{BUCKET_PLURAL[b]}</th><td className="num">{s.buckets[b]}</td><td className="num">{fmtPct(s.total ? s.buckets[b] / s.total : 0)}</td></tr>)}<tr><th scope="row">Total</th><td className="num"><b>{s.total}</b></td><td /></tr></tbody></table>
        <h3 className="x-h3">Origin source</h3><table className="x-table"><tbody>{[...byProvider.entries()].sort((a, b) => b[1] - a[1]).map(([p, n]) => <tr key={p}><th scope="row">{p}</th><td className="num">{n}</td></tr>)}</tbody></table>
        <p className="x-muted">Discarded: no verified evidence, excluded, rejected before, or competitor. Radar: closed, upcoming or too-short deadline.</p></>;
    }
    case 'actionable': return <><p><b>Actionable</b> = on the priority list. With a named person: {s.actionableWithPerson} of {s.actionable}.</p><LeadList ids={job.leads.filter((l) => l.bucket === 'top').sort((a, b) => a.rank - b.rank).map((l) => l.id)} /></>;
    case 'paths': return <><p>A chain of evidenced relationships from you to the candidate. Strength = product of each hop.</p>
      <table className="x-table"><tbody>{(['verified', 'documented', 'hypothesis'] as const).map((t) => <tr key={t}><th scope="row"><LinkBadge status={t} /></th><td className="num">{s.pathStatus[t]}</td></tr>)}<tr><th scope="row">To build (advice + updates)</th><td className="num">{s.active - s.withPath}</td></tr></tbody></table>
      {!s.withPath && <div className="x-callout"><b>Why 0?</b><span>No overlap between your network and the candidates{demo ? '' : '. Try Setup → Network → Analyze my LinkedIn'}.</span></div>}
      <LeadList ids={job.leads.filter((l) => l.paths.length && l.bucket !== 'discarded').map((l) => l.id)} /></>;
    case 'evidence': return <EvidenceCoverage s={s} />;
    case 'confidence': return <><p>Confidence describes the quality of the <b>data</b>, not the odds of success.</p><ul className="x-bullets"><li><b>High:</b> verified evidence + role + public email + open opportunity.</li><li><b>Medium:</b> at least one verified piece.</li><li><b>Low:</b> no verified evidence.</li></ul>
      <table className="x-table"><tbody>{(['alta', 'media', 'baja'] as const).map((c) => <tr key={c}><th scope="row">{CONF_LABEL[c]}</th><td className="num">{s.confidence[c]}</td><td className="num">{fmtPct(s.active ? s.confidence[c] / s.active : 0)}</td></tr>)}</tbody></table><p className="x-muted">Out of {s.active} active candidates.</p></>;
    case 'risks': return s.risks.length ? <ul className="x-risklist">{s.risks.map((r) => <li key={r.label} className={r.critical ? 'crit' : ''}><span>{r.critical ? <AlertTriangle size={13} /> : null}{r.label}</span><b>{r.count}</b><LeadList ids={r.leadIds.slice(0, 5)} /></li>)}</ul> : <EmptyState title="No risks" />;
    case 'sources': return <><ApifyCard s={apify} /><JevCard s={jev} /><SourceHealth job={job} items={health} /></>;
    case 'apify': return <ApifyCard s={apify} />;
    case 'jev': return <JevCard s={jev} />;
    case 'time': return <><dl className="x-dl"><dt>Start</dt><dd>{fmtDateTime(job.createdAt)}</dd><dt>End</dt><dd>{fmtDateTime(job.finishedAt || job.run?.events.at(-1)?.at)}</dd><dt>Duration</dt><dd>{fmtDuration(s.durationMs)}</dd><dt>Status</dt><dd>{job.status}</dd><dt>Mode</dt><dd>{job.mode === 'demo' ? 'Demo' : 'Live research'}</dd></dl><SourceHealth job={job} items={health} /></>;
  }
}
const METRIC_TITLE: Record<MetricKey, string> = { candidates: 'Researched candidates', actionable: 'Actionable candidates', paths: 'Warm paths', evidence: 'Evidence quality', confidence: 'Data confidence', risks: 'Risks', sources: 'Source health', apify: 'People search', jev: 'AI second opinion (Jev)', time: 'Date and duration' };


/* Advisor state for this run: the server starts it by itself when the research ends; here we only show where it is. */
type AdvisorPill = { tone: 'lav' | 'mint' | 'gray' | 'rose'; label: string; title: string; live?: boolean };
function useAdvisorPill(job: Job, enabled: boolean): AdvisorPill | null {
  const [pill, setPill] = useState<AdvisorPill | null>(null);
  const finished = ['done', 'partial'].includes(job.status);
  useEffect(() => {
    if (!enabled || !finished || !job.leads.length) { setPill(null); return; }
    let stop = false; let t: number | undefined;
    const tick = async () => {
      try {
        const r = await advisorApi.deepLatest(job.id);
        if (stop) return;
        const running = r.running || r.run?.status === 'running';
        if (running) { setPill({ tone: 'lav', label: 'analyzing', title: 'The advisor is researching each contact and building your plan.', live: true }); t = window.setTimeout(tick, 4000); }
        else if (r.run?.status === 'failed') setPill({ tone: 'rose', label: 'failed', title: 'The analysis stopped. Open the Advisor to retry.' });
        else if (r.run?.roadmap) setPill({ tone: 'mint', label: 'plan ready', title: 'The advisor finished: open it to see the action plan.' });
        else if (!r.role) setPill({ tone: 'gray', label: 'no model', title: 'No model configured: set VLLM_BASE and VLLM_CHAT_MODEL (or INTAKE_LLM_*) in research/.env so it can start on its own.' });
        else { setPill({ tone: 'gray', label: 'waiting', title: 'The advisor starts right after the research finishes.' }); t = window.setTimeout(tick, 5000); }
      } catch { /* the pill just stays hidden */ }
    };
    void tick();
    return () => { stop = true; if (t) window.clearTimeout(t); };
  }, [job.id, finished, job.leads.length, enabled]);
  return pill;
}

/* ───────── Dashboard completo ───────── */
export function EvaluationDashboard({ job, history, account, onSelectJob, onFeedback, onGo, onNewEvaluation, onOpenRun, onOpenAdvisor, selectedLeadId, onSelectLead }: {
  job: Job; history: History | null; account: NetworkGraphData | null; onSelectJob?: (id: string) => void;
  onFeedback: ((id: string, d: 'approve' | 'reject', reason: string, note: string) => Promise<unknown>) | null;
  onGo: (t: 'network' | 'setup' | 'sources') => void; onNewEvaluation?: () => void; onOpenRun?: () => void; onOpenAdvisor?: () => void;
  selectedLeadId: string | null; onSelectLead: (id: string | null) => void;
}) {
  const demo = isDemoJob(job);
  const s = useMemo(() => summarize(job), [job]);
  const apify = useMemo(() => apifyStatus(job), [job]);
  const jev = useMemo(() => jevStatus(job), [job]);
  const health = useMemo(() => sourceHealth(job), [job]);
  const [tab, setTab] = useState<Tab>('contactos');
  const advisorPill = useAdvisorPill(job, !demo && Boolean(onOpenAdvisor));
  useEffect(() => { if (!selectedLeadId) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.x-drawer-layer')) onSelectLead(null); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [selectedLeadId, onSelectLead]);
  /* Changing tab starts at the tab bar, never mid-page (feedback 28/09: the page stayed scrolled and hid the header). */
  useEffect(() => { window.scrollTo({ top: 0 }); }, [tab]);
  const [metric, setMetric] = useState<MetricKey | null>(null);
  const [evidence, setEvidence] = useState<{ title: string; list: Evidence[] } | null>(null);
  const [inspect, setInspect] = useState<{ edge: GEdge | null; node: GNode | null } | null>(null);
  const lead = job.leads.find((l) => l.id === selectedLeadId) || null;
  const graph = useMemo(() => buildGraph(job, account, { limit: 1000, includeDiscarded: true }), [job, account]);
  const select = (id: string | null) => onSelectLead(id);
  const onHop = (hop: NormHop, path: NormPath) => {
    if (!lead) return;
    const idOf = (name: string, i: number) => i === 0 ? 'you' : graph.nodes.find((n) => !n.leadId && n.label === name)?.id || graph.nodes.find((n) => n.label === name)?.id || `p:${name}`;
    const from = idOf(hop.from, hop.index);
    const to = hop.index === path.hops.length - 1 ? `lead:${lead.id}` : idOf(hop.to, 1);
    const e = graph.edges.find((x) => x.id === `${from}>${to}`);
    setInspect({ edge: e || { id: `${from}>${to}`, from, to, type: hop.status, rel: hop.kind, label: hop.relation, strength: hop.strength, source: hop.evidence[0]?.source || '—', date: hop.latest, evidence: hop.evidence, url: hop.url, why: '', leadIds: [lead.id] }, node: null });
  };
  const panel = lead && <CandidatePanel lead={lead} job={job} onFeedback={onFeedback} onEvidence={(title, list) => setEvidence({ title, list })} onHop={onHop} onClose={() => onSelectLead(null)} />;
  const running = ['queued', 'running'].includes(job.status);
  const statusChip = job.status === 'partial' ? ['sun', 'Done with warnings'] : job.status === 'done' ? ['mint', 'Done'] : job.status === 'failed' ? ['rose', 'Stopped'] : ['lav', 'Running'];
  const failed = health.filter((x) => x.state === 'error' || x.state === 'not_configured').length;
  const grantsOnly = job.brief.fundingTypes.length === 1 && job.brief.fundingTypes[0] === 'grant';
  const tabs: [Tab, string, ReactNode][] = [['contactos', grantsOnly ? 'Grant pipeline' : 'Who to contact', <span key="c" className="pl-tab-n">{s.buckets.top}</span>], ['resumen', 'Analytics', null], ['fuentes', 'Sources', failed ? <span key="f" className="pl-tab-n warn">{failed}</span> : null]];

  return <div className={`ev pl${lead ? ' has-sheet' : ''}`}>
    {demo && <DemoRibbon />}
    <header className="pl-head">
      <span className="pl-crumb">Evaluations <ChevronRight size={12} /> {job.brief.venture || job.brief.company}{job.mode === 'demo' ? ' · Demo' : ''}</span>
      <div className="pl-title-row">
        <div className="pl-title"><h1>{tab === 'contactos' && job.leads.length ? (grantsOnly ? 'Grant matches' : 'Who to contact') : tab === 'resumen' && job.leads.length ? 'Analytics' : tab === 'fuentes' && job.leads.length ? 'Sources' : (job.brief.venture || job.brief.company)}</h1><span className="pl-count">{tab === 'contactos' ? `${s.buckets.top + s.buckets.radar} ${grantsOnly ? 'in pipeline' : 'shortlisted'}` : `${s.total} ${grantsOnly ? 'opportunities' : 'candidates'}`}</span><span className={`pl-chip ${statusChip[0]}`}>{statusChip[1]}</span></div>
        <div className="pl-actions">
          {job.leads.length > 0 && <div className="pl-seg" role="tablist" aria-label="Evaluation sections">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{k === 'contactos' ? 'List' : l}</button>)}</div>}
          {onOpenRun && <button className="pl-btn" onClick={onOpenRun}><Activity size={14} /> Run</button>}
          {onOpenAdvisor && job.leads.length > 0 && <button className="pl-btn" onClick={onOpenAdvisor} title={advisorPill?.title}><Bot size={14} /> Advisor{advisorPill && <span className={`pl-chip ${advisorPill.tone} ld-pill`}>{advisorPill.live && <span className="sh-live" />}{advisorPill.label}</span>}</button>}
          {onNewEvaluation && <button className="pl-btn dark" onClick={onNewEvaluation} disabled={running}><Play size={14} /> New evaluation</button>}
        </div>
      </div>
    </header>
    {!job.leads.length ? <EmptyState icon={<Users size={22} />} title={running ? 'Still running' : 'No candidates found'} action={onOpenRun && <button className="pl-btn" onClick={onOpenRun}>See what happened</button>}>
      {running ? 'Results appear when it ends.' : 'No source returned candidates. Check source health or widen sector or geography.'}
      {!running && <><div className="pl-row even"><ApifyCard s={apify} /><JevCard s={jev} /></div><SourceHealth job={job} items={health} /></>}
    </EmptyState> : <>
      {tab === 'contactos' && <div className="pl-tabpanel ct"><ResultsIntro job={job} /><ContactsTable job={job} selectedId={selectedLeadId} onOpen={(id) => select(id)} /><HowWeGotHere job={job} s={s} health={health} onSources={() => setTab('fuentes')} /></div>}
      {tab === 'resumen' && <ExecutiveSummary job={job} s={s} apify={apify} jev={jev} onMetric={setMetric} onSelectLead={select} onGo={onGo} onOpenAdvisor={onOpenAdvisor} history={history} onSelectJob={onSelectJob} />}
      {tab === 'fuentes' && <SourcesTab job={job} s={s} apify={apify} jev={jev} health={health} onMetric={setMetric} />}
    </>}
    {lead && <aside className="sheet" aria-label="Candidate detail">{panel}</aside>}
    {metric && <Drawer open onClose={() => setMetric(null)} title={METRIC_TITLE[metric]} width={metric === 'sources' || metric === 'time' ? 900 : 600} tone={demo ? 'demo' : undefined}><MetricBody k={metric} job={job} s={s} apify={apify} jev={jev} health={health} onSelectLead={(id) => { setMetric(null); select(id); }} /></Drawer>}
    {evidence && <EvidenceDrawer open onClose={() => setEvidence(null)} title={evidence.title} evidence={evidence.list} demo={demo} />}
    {inspect && <RelationshipDrawer edge={inspect.edge} node={inspect.node} graph={graph} job={job} onClose={() => setInspect(null)} onEvidence={(title, list) => setEvidence({ title, list })} onSelectLead={(id) => select(id)} />}
  </div>;
}

const VERDICT: Record<string, [string, string]> = { '✔': ['mint', 'Eligible'], '✖': ['rose', 'Not eligible'], '?': ['sun', 'Needs data'] };
function RunGrants({ g, onSelectLead }: { g: NonNullable<Job['grants']>; onSelectLead: (id: string) => void }) {
  const count = (v: string) => g.evaluations.filter((x) => x.verdict === v).length;
  return <section className="pl-card">
    <header><h3>Grant eligibility <span className="pl-badge dark">{g.evaluations.length}</span></h3><span className="pl-mut">Checked rule by rule in this run</span></header>
    <div className="pl-split">{(['✔', '?', '✖'] as const).filter((v) => count(v)).map((v) => <div key={v} className={`pl-split-c ${v === '✔' ? 'verified' : v === '?' ? 'hypothesis' : 'none'}`} style={{ flexGrow: count(v) }}><i /><b>{count(v)}</b><small>{VERDICT[v][1]}</small></div>)}</div>
    <ul className="pl-rows">{g.evaluations.slice(0, 5).map((x) => { const a = g.alerts.find((y) => y.id === x.id); return <li key={x.id}><button className="pl-tl-t" onClick={() => onSelectLead(x.leadId)}>{clip(x.title, 56)}</button><span>{a && <span className={`pl-chip ${a.days <= 30 ? 'rose' : 'gray'}`}>{a.days} days</span>} <span className={`pl-chip ${VERDICT[x.verdict][0]}`}>{VERDICT[x.verdict][1]}</span></span></li>; })}</ul>
  </section>;
}
function ActiveInvestors({ a }: { a: NonNullable<Job['activeInvestors']> }) {
  const max = Math.max(1, ...a.funds.map((f) => f.dealsInWindow));
  return <section className="pl-card">
    <header><h3>Investing now <span className="pl-badge dark">{a.funds.length}</span></h3><span className="pl-mut">Similar deals, last 24 months</span></header>
    <ul className="ev-funds">{a.funds.slice(0, 6).map((f) => <li key={f.fundId} className={f.inactive ? 'dim' : ''} title={f.why?.text || ''}><span>{f.rank}. {f.name}</span><i><em style={{ width: `${(100 * f.dealsInWindow) / max}%` }} /></i><b>{f.dealsInWindow}</b>{f.why?.url && <a href={f.why.url} target="_blank" rel="noreferrer" aria-label="Source"><ArrowUpRight size={12} /></a>}</li>)}</ul>
  </section>;
}
