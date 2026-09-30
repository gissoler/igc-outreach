/* Analysis: the AI advisor's view of the round, drawn instead of written.
   KPIs, a phase roadmap, a fit × path-strength matrix, key findings and contact cards.
   Full reasoning stays one click away (drawer); every claim keeps its source ids. */
import { AlertTriangle, ArrowRight, Ban, Bot, CheckCircle2, ChevronRight, Circle, ExternalLink, Play, RefreshCw, Square, ThumbsDown, ThumbsUp, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { advisorApi, type AdvisorState, type DeepRun, type DossierResult, type EdgeJudgment, type EvidenceItem, type RoadAction } from '../analysisApi';
import type { Job } from '../researchApi';
import { PageHeader } from './Shell';
import { Drawer, EmptyState, ErrorState, SkeletonState } from './ui';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Unexpected error');
export const ROLE: Record<string, string> = { decisor: 'Decides', influye: 'Influences', conector: 'Connector', no_relevante: 'Not relevant', incierto: 'Unclear role' };
const ROLE_TINT: Record<string, string> = { decisor: 'ink', conector: 'lav', influye: 'mint', no_relevante: 'gray', incierto: 'gray' };
const FIT: Record<string, string> = { alto: 'High fit', medio: 'Medium fit', bajo: 'Low fit', descartar: 'Discard', incierto: 'Unclear fit' };
const FIT_X: Record<string, number> = { descartar: 0, bajo: 1, incierto: 1.5, medio: 2, alto: 3 };
export const ROUTE: Record<string, string> = { intro_doble_opt_in: 'Double opt-in intro', pedido_de_consejo: 'Ask for advice', evento: 'Event', update_en_frio: 'Warm up with updates', via_conector_interno: 'Via internal connector', no_contactar_aun: 'Don\'t contact yet', descartar: 'Discard' };
const REL: Record<string, string> = { trabajo_directo: 'worked together', coinversion: 'co-invested', consejo_o_evento: 'board or event', misma_organizacion: 'same organization', solo_mencion: 'mentioned together', desconocida: 'unknown relationship' };
const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
const TINTS = ['lav', 'mint', 'sun', 'gray'];

/** Renders **bold** from model text and drops stray markdown. */
export function Md({ text }: { text: string }) {
  const parts = String(text || '').split(/\*\*(.+?)\*\*/g);
  return <>{parts.map((p, i) => (i % 2 ? <b key={i}>{p}</b> : p.replace(/\*\*/g, '')))}</>;
}
const plain = (s: string) => String(s || '').replace(/\*\*/g, '');
const strength = (d: DossierResult) => Math.max(0, ...d.dossier.warm_paths.map((p) => p.strength));

export function AnalysisView({ job, onOpenOutreach, onOpenLead, embedded = false }: { job: Job | null; onOpenOutreach: () => void; onOpenLead: (id: string) => void; embedded?: boolean }) {
  const jobId = job?.id || null;
  const [run, setRun] = useState<DeepRun | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [adv, setAdv] = useState<AdvisorState | null>(null);
  const [edges, setEdges] = useState<EdgeJudgment[]>([]);
  const [err, setErr] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!jobId) { setLoaded(true); return; }
    try { const r = await advisorApi.deepLatest(jobId); setRun(r.run); setRole(r.role); setRunning(r.running || r.run?.status === 'running'); } catch (e) { setErr(errMsg(e)); }
    advisorApi.state(jobId, 120).then(setAdv).catch(() => undefined);
    advisorApi.edges().then((r) => setEdges(r.edges)).catch(() => undefined);
    setLoaded(true);
  }, [jobId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!running || !run) return;
    timer.current = window.setInterval(async () => {
      try { const r = await advisorApi.deepRun(run.id); setRun(r.run); if (!r.running && r.run.status !== 'running') setRunning(false); } catch { /* retry */ }
    }, 2000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [running, run?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = async (opts: { refresh?: boolean; samples?: number }) => {
    if (!jobId) return;
    setErr('');
    try { const { runId } = await advisorApi.deepStart({ jobId, ...opts }); const r = await advisorApi.deepRun(runId); setRun(r.run); setRunning(true); } catch (e) { setErr(errMsg(e)); }
  };

  const dossiers = run?.dossiers || [];
  const byRef = useMemo(() => new Map(dossiers.map((d, i) => [`D${i + 1}`, i])), [dossiers]);
  const refChips = (refs: string[]) => refs.filter((r) => byRef.has(r)).slice(0, 3).map((r) => <button key={r} className="an2-ref" onClick={() => setOpen(byRef.get(r)!)}>{dossiers[byRef.get(r)!].person}</button>);
  const rm = run?.roadmap || null;
  const high = dossiers.filter((d) => d.dossier.fit.verdict === 'alto').length;
  const deciders = dossiers.filter((d) => d.dossier.role.kind === 'decisor').length;
  const warm = dossiers.filter((d) => strength(d) >= 0.5).length;
  const ready = adv ? adv.readiness.checks.filter((c) => c.ok).length : 0;

  const actions = <>
    <span className={`pl-chip ${role ? 'mint' : 'gray'}`}>{role ? `Model: ${role}` : 'No model'}</span>
    {running ? <button className="x-btn sm" onClick={() => run && void advisorApi.deepCancel(run.id)}><Square size={13} /> Stop</button>
      : <>
        <button className="x-btn primary sm" disabled={!role || !jobId} onClick={() => void start({})}><Play size={13} /> {run ? 'Refresh' : 'Analyze'}</button>
        <button className="x-btn sm" disabled={!role || !jobId} title="Re-research every contact, 3 samples each" onClick={() => void start({ refresh: true, samples: 3 })}><RefreshCw size={13} /> Redo all</button>
      </>}
  </>;

  let body: ReactNode;
  if (!jobId) body = <EmptyState title="Run an evaluation first">The advisor analyzes the contacts found by your latest run.</EmptyState>;
  else if (!loaded) body = <SkeletonState variant="dashboard" rows={4} label="Loading analysis…" />;
  else if (!run && !running) body = <EmptyState icon={<Bot size={22} />} title="No analysis yet" action={<button className="x-btn primary" disabled={!role} onClick={() => void start({})}><Play size={14} /> Analyze with AI</button>}>{role ? 'One agent per contact, a strategist and a critic.' : 'Connect the AI model first (ask your admin).'}</EmptyState>;
  else body = <>
    {running && run && <div className="an2-live" aria-live="polite"><span className="sh-live" /><b>Analyzing</b><span>{run.events.at(-1)?.message || `${run.events.at(-1)?.contact || ''} ${run.events.at(-1)?.action || ''}`}</span><i style={{ width: `${Math.min(96, 8 + dossiers.length * 9)}%` }} /></div>}

    <section className="pl-card an2-kpis">
      <div className="pl-stats">
        <div><span>Contacts analyzed</span><b>{dossiers.length}</b></div>
        <div><span>High fit</span><b>{high}<small>/{dossiers.length}</small></b></div>
        <div><span>Decision-makers</span><b>{deciders}</b></div>
        <div><span>Strong paths</span><b>{warm}</b></div>
        {adv && <div><span>Roadshow ready</span><b>{ready}<small>/{adv.readiness.checks.length}</small></b></div>}
      </div>
      {run?.errors?.length ? <span className="pl-chip sun" title={run.errors.map((e) => `${e.contact}: ${e.error}`).join('\n')}><AlertTriangle size={12} /> {run.errors.length} contact{run.errors.length === 1 ? '' : 's'} timed out</span> : null}
    </section>

    {rm && <section className="pl-card an2-road">
      <header><div><span className="an2-kick">Round roadmap · {run?.finishedAt?.slice(0, 10)}{run?.revised ? ' · revised after critique' : ''}</span><h3 className="an2-headline"><Md text={rm.headline} /></h3></div>
        <button className="pl-btn sm" onClick={onOpenOutreach}>{embedded ? 'Open pipeline' : 'Open outreach'} <ArrowRight size={13} /></button></header>
      <Clamp className="an2-thesis"><Md text={rm.thesis} /></Clamp>
      <div className="an2-lanes">
        {rm.first_week.length > 0 && <Lane kick="This week" title="First moves" actions={rm.first_week} refChips={refChips} now />}
        {rm.phases.map((p, i) => <Lane key={i} kick={p.window} title={p.name} goal={p.goal} actions={p.actions} exit={p.exit_criteria} refChips={refChips} />)}
      </div>
    </section>}

    <div className="pl-row even">
      <section className="pl-card an2-matrix-card">
        <header><h3>Who to approach</h3><div className="an2-legend">{['decisor', 'conector', 'influye'].map((k) => <span key={k}><i className={`dot ${ROLE_TINT[k]}`} />{ROLE[k]}</span>)}</div></header>
        {dossiers.length ? <Matrix dossiers={dossiers} onOpen={setOpen} /> : <p className="pl-empty">No contacts analyzed yet.</p>}
      </section>
      <section className="pl-card an2-find">
        <header><h3>Key findings <span className="pl-badge dark">{rm?.diagnosis.length || 0}</span></h3></header>
        {rm?.diagnosis.length ? <ol className="an2-findings">{rm.diagnosis.map((d, i) => <li key={i}><i>{i + 1}</i><div><Clamp lines={2}><Md text={d.text} /></Clamp><div className="an2-refs">{refChips(d.refs)}</div></div></li>)}</ol> : <p className="pl-empty">Findings appear when the roadmap is ready.</p>}
      </section>
    </div>

    {rm && <div className="pl-row three">
      <ListCard title="Risks" tone="rose" icon={<AlertTriangle size={13} />} items={rm.risks.map((r) => r.text)} />
      <ListCard title="Don't" tone="sun" icon={<Ban size={13} />} items={rm.do_not.map((r) => r.text)} />
      {adv ? <section className="pl-card an2-list">
        <header><h3>Roadshow readiness <span className={`pl-badge ${adv.readiness.ready ? 'mint' : 'sun'}`}>{ready}/{adv.readiness.checks.length}</span></h3></header>
        <div className="an2-meter"><i style={{ width: `${adv.readiness.checks.length ? (100 * ready) / adv.readiness.checks.length : 0}%` }} /></div>
        <ul className="an2-checks">{adv.readiness.checks.map((c, i) => <li key={i} className={c.ok ? 'ok' : ''} title={c.rule}>{c.ok ? <CheckCircle2 size={14} /> : <Circle size={14} />}{c.label}</li>)}</ul>
      </section> : <ListCard title="Update themes" tone="lav" icon={<Circle size={13} />} items={rm.update_plan.themes.map((t) => t.text)} />}
    </div>}

    {dossiers.length > 0 && <>
      <div className="pl-sec-head"><h2>Contacts <span className="pl-count">{dossiers.length}</span></h2>{run?.critic && <span className="pl-mut">Critic: {run.critic.verdict} · {run.critic.issues.length} notes</span>}</div>
      <div className="an2-cards">{dossiers.map((d, i) => { const x = d.dossier; const s = strength(d); return <button key={`${d.person}-${i}`} className="an2-contact" onClick={() => setOpen(i)}>
        <span className="pl-who"><i className={`pl-av ${TINTS[i % 4]}`}>{initials(d.person)}</i><span><b>{d.person}</b><small>{d.org || '—'}</small></span></span>
        <span className="an2-chips"><span className={`pl-chip ${ROLE_TINT[x.role.kind] === 'ink' ? 'dark' : ROLE_TINT[x.role.kind]}`}>{ROLE[x.role.kind]}</span><span className={`pl-chip ${x.fit.verdict === 'alto' ? 'mint' : x.fit.verdict === 'medio' ? 'sun' : 'gray'}`}>{FIT[x.fit.verdict]}</span></span>
        <span className="an2-path"><span>Path</span><i><em style={{ width: `${Math.round(s * 100)}%` }} /></i><b>{Math.round(s * 100)}%</b></span>
        <span className="an2-next">{ROUTE[x.best_route.type]}{x.best_route.via ? ` via ${x.best_route.via}` : ''} <ChevronRight size={13} /></span>
      </button>; })}</div>
    </>}
  </>;

  return <div className={embedded ? 'an2 an2-embedded' : 'pl-page an2'}>
    {embedded ? <div className="an2-bar">{dossiers.length > 0 && <span className="pl-count">{dossiers.length} contacts</span>}<span className="an2-bar-a">{actions}</span></div>
      : <PageHeader crumb="Workspace" title="Analysis" badge={dossiers.length ? <span className="pl-count">{dossiers.length} contacts</span> : undefined} actions={actions} />}
    {err && <ErrorState message={err} onRetry={() => { setErr(''); void load(); }} />}
    {body}
    {open !== null && dossiers[open] && <ContactDrawer d={dossiers[open]} id={`D${open + 1}`} edges={edges} job={job} onClose={() => setOpen(null)} onOpenLead={onOpenLead} />}
  </div>;
}

function Clamp({ children, lines = 2, className = '' }: { children: ReactNode; lines?: number; className?: string }) {
  const [more, setMore] = useState(false);
  return <p className={`an2-clamp ${className} ${more ? 'open' : ''}`} style={{ WebkitLineClamp: more ? 'unset' : lines }} onClick={() => setMore(!more)} title={more ? '' : 'Show more'}>{children}</p>;
}

function Lane({ kick, title, goal, actions, exit = [], refChips, now = false }: { kick: string; title: string; goal?: string; actions: RoadAction[]; exit?: string[]; refChips: (r: string[]) => ReactNode; now?: boolean }) {
  return <div className={`an2-lane ${now ? 'now' : ''}`}>
    <div className="an2-lane-h"><span>{kick}</span><b>{plain(title)}</b>{goal && <small title={plain(goal)}>{plain(goal)}</small>}</div>
    <ul>{actions.slice(0, 5).map((a, i) => <li key={i} title={plain(a.why)}>
      <span className="an2-who"><i className="pl-av lav">{initials(a.who)}</i>{a.who}</span>
      <p><Md text={a.what} /></p>
      {(a.via || a.refs.length > 0) && <div className="an2-refs">{a.via && <span className="pl-chip gray">via {a.via}</span>}{refChips(a.refs)}</div>}
    </li>)}{actions.length > 5 && <li className="an2-more">+{actions.length - 5} more</li>}</ul>
    {exit.length > 0 && <div className="an2-exit"><span>Done when</span>{exit.slice(0, 3).map((e, i) => <p key={i}><CheckCircle2 size={12} /> {plain(e)}</p>)}</div>}
  </div>;
}

function ListCard({ title, tone, icon, items }: { title: string; tone: string; icon: ReactNode; items: string[] }) {
  return <section className="pl-card an2-list">
    <header><h3>{title} <span className={`pl-badge ${tone}`}>{items.length}</span></h3></header>
    {items.length ? <ul className="an2-bul">{items.slice(0, 5).map((t, i) => <li key={i}><span className={`an2-ico ${tone}`}>{icon}</span><Clamp lines={2}><Md text={t} /></Clamp></li>)}</ul> : <p className="pl-empty">None.</p>}
  </section>;
}

/** Fit (x) × strongest warm path (y). Top-right = approach now. */
function Matrix({ dossiers, onOpen }: { dossiers: DossierResult[]; onOpen: (i: number) => void }) {
  const W = 560, H = 330, P = { l: 44, r: 70, t: 18, b: 34 };
  const x = (v: number) => P.l + (v / 3) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - v) * (H - P.t - P.b);
  const seen = new Map<string, number>();
  const pts = dossiers.map((d, i) => {
    const fx = FIT_X[d.dossier.fit.verdict] ?? 1.5; const s = strength(d);
    const k = `${fx}:${Math.round(s * 10)}`; const n = seen.get(k) || 0; seen.set(k, n + 1);
    return { i, d, cx: x(fx) + (n % 2) * 26, cy: y(s) - Math.floor(n / 2) * 26, tint: ROLE_TINT[d.dossier.role.kind] || 'gray' };
  });
  return <svg className="an2-matrix" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Contacts by fit and warm path strength">
    <rect x={x(2) - 14} y={y(1) - 8} width={x(3) - x(2) + 70} height={y(0.5) - y(1) + 8} className="an2-zone" />
    <text x={x(3) + 52} y={y(1) + 8} textAnchor="end" className="an2-zone-t">Approach now</text>
    {[0, 0.25, 0.5, 0.75, 1].map((v) => <g key={v}><line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} className="an2-grid" /><text x={P.l - 8} y={y(v) + 4} textAnchor="end" className="an2-ax">{Math.round(v * 100)}%</text></g>)}
    {[['Discard', 0], ['Low', 1], ['Medium', 2], ['High', 3]].map(([l, v]) => <text key={l} x={x(v as number)} y={H - 10} textAnchor="middle" className="an2-ax">{l}</text>)}
    <text x={12} y={P.t + 6} className="an2-ax b" transform={`rotate(-90 12 ${P.t + 6})`} textAnchor="end">Path strength</text>
    {pts.map((p) => <g key={p.i} className={`an2-pt ${p.tint}`} onClick={() => onOpen(p.i)} tabIndex={0} role="button" aria-label={p.d.person} onKeyDown={(e) => e.key === 'Enter' && onOpen(p.i)}>
      <circle cx={p.cx} cy={p.cy} r={12} /><text x={p.cx} y={p.cy + 3.5} textAnchor="middle">{initials(p.d.person)}</text>
      <text x={p.cx + 17} y={p.cy + 4} className="an2-pt-l">{p.d.person.split(' ')[0]}</text>
      <title>{`${p.d.person} · ${ROLE[p.d.dossier.role.kind]} · ${FIT[p.d.dossier.fit.verdict]} · path ${Math.round(strength(p.d) * 100)}%`}</title>
    </g>)}
  </svg>;
}

function Ev({ ids, evidence }: { ids: string[]; evidence: EvidenceItem[] }) {
  return <>{ids.map((id) => { const e = evidence.find((x) => x.id === id); if (!e) return null; return e.url ? <a key={id} className="an-cite" href={e.url} target="_blank" rel="noreferrer" title={`${e.source}: ${e.text}`}>{id} <ExternalLink size={10} /></a> : <span key={id} className="an-cite" title={`${e.source}: ${e.text}`}>{id}</span>; })}</>;
}

function ContactDrawer({ d, id, edges, job, onClose, onOpenLead }: { d: DossierResult; id: string; edges: EdgeJudgment[]; job: Job | null; onClose: () => void; onOpenLead: (id: string) => void }) {
  const x = d.dossier;
  const [fb, setFb] = useState('');
  const lead = job?.leads.find((l) => (l.person || l.org) === d.person);
  const feedback = (verdict: 'util' | 'corregir' | 'equivocada') => { const note = verdict === 'util' ? '' : window.prompt('What\'s wrong or missing?') || ''; void advisorApi.dossierFeedback(d.key, verdict, note).then(() => setFb(verdict)).catch(() => setFb('error')); };
  return <Drawer open onClose={onClose} title={d.person} subtitle={`${id} · ${d.org || ''}`} width={560}
    footer={<div className="an-row">{fb ? <span className="pl-chip mint">Saved</span> : <><button className="x-btn sm" onClick={() => feedback('util')}><ThumbsUp size={13} /> Useful</button><button className="x-btn sm" onClick={() => feedback('corregir')}>Needs fixing</button><button className="x-btn sm" onClick={() => feedback('equivocada')}><ThumbsDown size={13} /> Wrong</button></>}{lead && <button className="x-btn sm primary" onClick={() => onOpenLead(lead.id)}><Users size={13} /> Open candidate</button>}</div>}>
    <div className="an2-dr">
      <div className="an2-dr-grid">
        <div><span>Role</span><b>{ROLE[x.role.kind]}</b></div>
        <div><span>Fit</span><b>{FIT[x.fit.verdict]}</b></div>
        <div><span>Path</span><b>{Math.round(strength(d) * 100)}%</b></div>
        <div><span>Confidence</span><b>{x.confidence}</b></div>
      </div>
      <p className="an2-dr-sum"><Md text={x.summary} /></p>
      <div className="an2-dr-next"><span>Next move</span><b>{ROUTE[x.best_route.type]}{x.best_route.via ? ` via ${x.best_route.via}` : ''}</b><p><Md text={x.best_route.why} /></p></div>
      {x.warm_paths.length > 0 && <><h5>Warm paths</h5><ul className="an2-dr-paths">{x.warm_paths.map((p, i) => { const edge = edges.find((e) => e.from === p.via && e.to === d.person); return <li key={i}>
        <div><b>via {p.via}</b> · {REL[p.relationship]}</div>
        <div className="an2-path"><i><em style={{ width: `${Math.round(p.strength * 100)}%` }} /></i><b>{Math.round(p.strength * 100)}%</b></div>
        <small><Md text={p.reasoning} /> <Ev ids={p.evidence} evidence={d.evidence} /></small>
        {edge && <EdgeLabel edge={edge} />}
      </li>; })}</ul></>}
      {x.current_focus.length > 0 && <><h5>What they fund today</h5><ul className="an2-dr-ul">{x.current_focus.map((c, i) => <li key={i}><Md text={c.text} /> <Ev ids={c.evidence} evidence={d.evidence} /></li>)}</ul></>}
      {x.fit.reasons.length > 0 && <><h5>Why it fits</h5><ul className="an2-dr-ul">{x.fit.reasons.map((c, i) => <li key={i}><Md text={c.text} /> <Ev ids={c.evidence} evidence={d.evidence} /></li>)}</ul></>}
      <h5>Ask and timing</h5><p><Md text={x.ask.text} /> <span className="pl-mut">· {x.timing.when}</span></p>
      {x.risks.length > 0 && <><h5>Risks</h5><ul className="an2-dr-ul">{x.risks.map((r, i) => <li key={i}><Md text={r} /></li>)}</ul></>}
      <details className="adv-details"><summary>How it researched ({d.trace.length} steps · {d.evidence.length} sources · {x.verification.dropped} claims dropped)</summary>
        <ol>{d.trace.map((t, i) => <li key={i}><b>{t.action}</b>{t.thought ? ` — ${t.thought}` : ''}</li>)}</ol></details>
    </div>
  </Drawer>;
}

function EdgeLabel({ edge }: { edge: EdgeJudgment }) {
  const [v, setV] = useState(edge.human?.strength ?? edge.judgment.strength);
  const [saved, setSaved] = useState(Boolean(edge.human));
  return <div className="deep-edge-label"><label>Your judgment <input type="range" min={0} max={1} step={0.1} value={v} onChange={(e) => { setV(Number(e.target.value)); setSaved(false); }} /> {Math.round(v * 100)}%</label>
    <button className="adv-link" onClick={() => void advisorApi.edgeLabel(edge.id, v).then(() => setSaved(true))}>{saved ? 'saved' : 'save'}</button></div>;
}
