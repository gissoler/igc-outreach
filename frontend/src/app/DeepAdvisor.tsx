/* Análisis profundo con la flota: un analista IA por contacto (investiga con herramientas y juzga el warm path),
   un estratega que arma el roadmap y un crítico que lo ataca. Todo con evidencia citada (E…) y lo no sustentado descartado. */
import { Bot, ChevronDown, ExternalLink, Play, RefreshCw, Square, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { advisorApi, type DeepRun, type DossierResult, type EdgeJudgment, type EvidenceItem } from '../analysisApi';
import { ErrorState, Info } from './ui';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Unexpected error');
const ROLE: Record<string, string> = { decisor: 'Decides', influye: 'Influences', conector: 'Connector', no_relevante: 'Not relevant', incierto: 'Unclear role' };
const FIT: Record<string, string> = { alto: 'High fit', medio: 'Medium fit', bajo: 'Low fit', descartar: 'Discard', incierto: 'Unclear fit' };
const ROUTE: Record<string, string> = { intro_doble_opt_in: 'Double opt-in intro', pedido_de_consejo: 'Ask for advice', evento: 'Event', update_en_frio: 'Cold update', via_conector_interno: 'Via internal connector', no_contactar_aun: 'Don\'t contact yet', descartar: 'Discard' };
const REL: Record<string, string> = { trabajo_directo: 'worked together', coinversion: 'co-invested', consejo_o_evento: 'board or event', misma_organizacion: 'same organization', solo_mencion: 'only mentioned together', desconocida: 'unknown relationship' };

function Ev({ ids, evidence }: { ids: string[]; evidence: EvidenceItem[] }) {
  return <>{ids.map((id) => { const e = evidence.find((x) => x.id === id); if (!e) return null; return e.url ? <a key={id} className="an-cite" href={e.url} target="_blank" rel="noreferrer" title={`${e.source}: ${e.text}`}>{id} <ExternalLink size={10} /></a> : <span key={id} className="an-cite" title={`${e.source}: ${e.text}`}>{id}</span>; })}</>;
}

export function DeepAdvisor({ jobId }: { jobId: string }) {
  const [run, setRun] = useState<DeepRun | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState('');
  const [edges, setEdges] = useState<EdgeJudgment[]>([]);
  const timer = useRef<number | null>(null);
  const load = useCallback(async () => {
    try { const r = await advisorApi.deepLatest(jobId); setRun(r.run); setRole(r.role); setRunning(r.running || r.run?.status === 'running'); } catch (e) { setErr(errMsg(e)); }
  }, [jobId]);
  useEffect(() => { void load(); advisorApi.edges().then((r) => setEdges(r.edges)).catch(() => undefined); }, [load]);
  useEffect(() => {
    if (!running || !run) return;
    timer.current = window.setInterval(async () => {
      try { const r = await advisorApi.deepRun(run.id); setRun(r.run); if (!r.running && r.run.status !== 'running') { setRunning(false); advisorApi.edges().then((x) => setEdges(x.edges)).catch(() => undefined); } } catch { /* reintenta */ }
    }, 2000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [running, run?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = async (opts: { refresh?: boolean; samples?: number }) => {
    setErr('');
    try { const { runId } = await advisorApi.deepStart({ jobId, ...opts }); const r = await advisorApi.deepRun(runId); setRun(r.run); setRunning(true); } catch (e) { setErr(errMsg(e)); }
  };
  const byName = useMemo(() => new Map((run?.dossiers || []).map((d, i) => [`D${i + 1}`, d])), [run]);
  const refChips = (refs: string[]) => refs.map((r) => <span key={r} className="adv-ref" title={byName.get(r) ? `${byName.get(r)!.person} (${byName.get(r)!.org || ''})` : r}>{byName.get(r)?.person || r}</span>);
  const rm = run?.roadmap;
  return <section className="deep">
    <div className="deep-head">
      <div>
        <span className="adv-kicker">AI advisor · own fleet</span>
        <h2>Deep analysis: one analyst per contact, a strategist and a critic</h2>
        <p className="x-muted">An agent researches each contact; a strategist builds the roadmap and a critic attacks it. Unsourced claims are dropped.</p>
      </div>
      <div className="deep-actions">
        <span className={`x-chip ${role ? 'ok' : ''}`}>{role ? `Model: ${role}` : 'No fleet configured'}</span>
        {running ? <button className="x-btn" onClick={() => run && void advisorApi.deepCancel(run.id)}><Square size={14} /> Stop</button>
          : <>
            <button className="x-btn primary" disabled={!role} onClick={() => void start({})}><Play size={14} /> {run ? 'Refresh analysis' : 'Analyze with AI'}</button>
            <button className="x-btn" disabled={!role} title="Ignores cards under 7 days old; generates 3 versions per contact and keeps the best-sourced" onClick={() => void start({ refresh: true, samples: 3 })}><RefreshCw size={14} /> Redo all (high quality)</button>
          </>}
      </div>
    </div>
    {err && <ErrorState message={err} />}
    {!role && <div className="x-callout warn"><b>Connect the fleet first.</b>Ask your admin to connect the AI model in the server settings.</div>}
    {run && (running || run.status === 'running') && <div className="deep-log" aria-live="polite">{run.events.slice(-12).map((e, i) => <div key={i} className={`deep-ev ${e.type}`}><Bot size={12} /> {e.message || `${e.contact}: step ${e.step} · ${e.action}${e.thought ? ` — ${e.thought}` : ''}`}</div>)}</div>}
    {run?.errors?.length ? <p className="x-muted an-small">Errors: {run.errors.map((e) => `${e.contact}: ${e.error}`).join(' · ')}</p> : null}

    {rm && <div className="deep-roadmap">
      <div className="adv-memo">
        <div className="adv-memo-head"><span className="adv-kicker">Round roadmap · {run.finishedAt?.slice(0, 10)}</span><span className="x-chip">{run.strategistRole}{run.revised ? ' · revised after critique' : ''}</span></div>
        <h2>{rm.headline}</h2>
        <p className="deep-thesis">{rm.thesis}</p>
        <ol className="adv-paras">{rm.diagnosis.map((d, i) => <li key={i}>{d.text} {refChips(d.refs)}</li>)}</ol>
      </div>
      {rm.first_week.length > 0 && <><h3 className="x-h3">This week</h3><ol className="deep-actions-list">{rm.first_week.map((a, i) => <li key={i}><b>{a.who}</b>: {a.what}{a.via ? <> · via <b>{a.via}</b></> : null}<p className="x-muted">{a.why} {refChips(a.refs)}</p></li>)}</ol></>}
      <div className="deep-phases">{rm.phases.map((p, i) => <div key={i} className="deep-phase">
        <span className="adv-kicker">{p.window}</span><h4>{p.name}</h4><p>{p.goal}</p>
        <ul className="deep-actions-list">{p.actions.map((a, j) => <li key={j}><b>{a.who}</b>: {a.what}{a.via ? <> · via {a.via}</> : null}<p className="x-muted">{a.why} {refChips(a.refs)}</p></li>)}</ul>
        {p.exit_criteria.length > 0 && <p className="an-small"><b>To reach the next phase:</b> {p.exit_criteria.join(' · ')}</p>}
      </div>)}</div>
      <div className="an-grid">
        <div><h3 className="x-h3">Update plan (every {rm.update_plan.cadence_days} days)</h3><ul className="adv-targets">{rm.update_plan.themes.map((t, i) => <li key={i}>{t.text} {refChips(t.refs)}</li>)}</ul>
          <h3 className="x-h3">Don't</h3><ul className="adv-targets">{rm.do_not.map((t, i) => <li key={i}>{t.text} {refChips(t.refs)}</li>)}</ul></div>
        <div><h3 className="x-h3">Risks</h3><ul className="adv-targets">{rm.risks.map((t, i) => <li key={i}>{t.text} {refChips(t.refs)}</li>)}</ul>
          {run.critic && <details className="adv-details"><summary>Critic's notes ({run.critic.verdict}, {run.critic.issues.length} notes)</summary><ul>{run.critic.issues.map((c, i) => <li key={i}><b>[{c.severity}]</b> {c.issue} → {c.fix}</li>)}</ul></details>}
          {rm.verification.dropped > 0 && <details className="adv-details"><summary>{rm.verification.dropped} roadmap items dropped for lack of support</summary><ul>{rm.verification.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></details>}
        </div>
      </div>
    </div>}

    {run && run.dossiers.length > 0 && <>
      <h3 className="x-h3">Contact cards ({run.dossiers.length}) <Info wide>Each card was researched by an agent. E… ids open the source. Your feedback trains the model.</Info></h3>
      <div className="deep-dossiers">{run.dossiers.map((d, i) => <Dossier key={`${d.person}-${i}`} id={`D${i + 1}`} d={d} edges={edges} />)}</div>
    </>}
  </section>;
}

function Dossier({ id, d, edges }: { id: string; d: DossierResult; edges: EdgeJudgment[] }) {
  const [open, setOpen] = useState(false);
  const [fb, setFb] = useState('');
  const x = d.dossier;
  const key = d.key;
  const feedback = (verdict: 'util' | 'corregir' | 'equivocada') => { const note = verdict === 'util' ? '' : window.prompt('What\'s wrong or missing? (used for training)') || ''; void advisorApi.dossierFeedback(key, verdict, note).then(() => setFb(verdict)).catch(() => setFb('error')); };
  return <article className={`deep-card fit-${x.fit.verdict}`}>
    <header className="adv-row-head" onClick={() => setOpen(!open)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(!open)}>
      <div><span className="adv-id">{id}</span><b>{d.person}</b>{d.org && <span className="x-muted"> · {d.org}</span>}{d.cached && <span className="x-chip" title="Reused card under 7 days old">recent</span>}</div>
      <div className="deep-badges"><span className="x-chip">{ROLE[x.role.kind]}</span><span className={`x-chip ${x.fit.verdict === 'alto' ? 'ok' : ''}`}>{FIT[x.fit.verdict]}</span><span className="x-chip">{ROUTE[x.best_route.type]}</span><ChevronDown size={16} className={open ? 'rot' : ''} /></div>
    </header>
    <p className="deep-summary">{x.summary}</p>
    <p className="adv-move"><b>Do:</b> {ROUTE[x.best_route.type]}{x.best_route.via ? ` via ${x.best_route.via}` : ''}. {x.best_route.why}</p>
    {open && <div className="deep-body">
      {x.warm_paths.length > 0 && <><h5>Warm path (agent judgment)</h5><ul className="deep-paths">{x.warm_paths.map((p, i) => { const edge = edges.find((e) => e.from === p.via && e.to === d.person); return <li key={i}>
        <div><b>via {p.via}</b> · {REL[p.relationship]} · would introduce: <b>{p.would_introduce}</b></div>
        <div className="deep-bar"><span style={{ width: `${Math.round(p.strength * 100)}%` }} /></div><small>{Math.round(p.strength * 100)}% · {p.reasoning} <Ev ids={p.evidence} evidence={d.evidence} /></small>
        {edge && <EdgeLabel edge={edge} />}
      </li>; })}</ul></>}
      {x.current_focus.length > 0 && <><h5>What they fund today</h5><ul className="adv-targets">{x.current_focus.map((c, i) => <li key={i}>{c.text} <Ev ids={c.evidence} evidence={d.evidence} /></li>)}</ul></>}
      {x.fit.reasons.length > 0 && <><h5>Why it fits (or not)</h5><ul className="adv-targets">{x.fit.reasons.map((c, i) => <li key={i}>{c.text} <Ev ids={c.evidence} evidence={d.evidence} /></li>)}</ul></>}
      {x.common_ground.length > 0 && <><h5>Common ground</h5><ul className="adv-targets">{x.common_ground.map((c, i) => <li key={i}>{c.text} <Ev ids={c.evidence} evidence={d.evidence} /></li>)}</ul></>}
      <h5>What to ask and when</h5><p>{x.ask.text} <span className="x-muted">— {x.ask.why}</span></p><p><b>{x.timing.when}</b> <span className="x-muted">— {x.timing.why}</span></p>
      {x.risks.length > 0 && <><h5>Risks</h5><ul className="adv-targets">{x.risks.map((r, i) => <li key={i}>{r}</li>)}</ul></>}
      {x.open_questions.length > 0 && <><h5>Open questions</h5><ul className="adv-targets">{x.open_questions.map((r, i) => <li key={i}>{r}</li>)}</ul></>}
      <details className="adv-details"><summary>How it researched ({d.trace.length} steps, {d.evidence.length} sources, confidence {x.confidence}, {x.verification.dropped} claims dropped)</summary>
        <ol>{d.trace.map((t, i) => <li key={i}><b>{t.action}</b> {t.args && Object.keys(t.args).length ? JSON.stringify(t.args) : ''}{t.thought ? ` — ${t.thought}` : ''}</li>)}</ol>
        {x.verification.reasons.length > 0 && <p className="x-muted an-small">Dropped: {x.verification.reasons.join(' · ')}</p>}
      </details>
      <div className="an-row">{fb ? <span className="x-chip ok">Saved: {fb}</span> : <>
        <button className="x-btn" onClick={() => feedback('util')}><ThumbsUp size={14} /> Useful</button>
        <button className="x-btn" onClick={() => feedback('corregir')}>Needs fixing</button>
        <button className="x-btn" onClick={() => feedback('equivocada')}><ThumbsDown size={14} /> Wrong</button></>}</div>
    </div>}
  </article>;
}

function EdgeLabel({ edge }: { edge: EdgeJudgment }) {
  const [v, setV] = useState(edge.human?.strength ?? edge.judgment.strength);
  const [saved, setSaved] = useState(Boolean(edge.human));
  return <div className="deep-edge-label"><label>How strong is it really? <input type="range" min={0} max={1} step={0.1} value={v} onChange={(e) => { setV(Number(e.target.value)); setSaved(false); }} /> {Math.round(v * 100)}%</label>
    <button className="adv-link" onClick={() => void advisorApi.edgeLabel(edge.id, v).then(() => setSaved(true))}>{saved ? 'saved' : 'save my judgment'}</button></div>;
}
