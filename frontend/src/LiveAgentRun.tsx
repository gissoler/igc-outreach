import { AlertTriangle, ArrowLeft, Check, Crosshair, FileText, Globe, ImageOff, LoaderCircle, Lock, Mail, Pause, Play, RotateCcw, Search, ShieldCheck, Sparkles, Square, TriangleAlert } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { fundingLabels, frameUrl, type Brief } from './researchApi';
import {
  buildScenes, buildSteps, outcomeLabel, progress as stepProgress, runOutcome, sceneDuration, sceneHold,
  type ApiDetail, type DraftDetail, type LiveRunEvent, type NetworkDetail, type PlanDetail, type RankingDetail, type RunStep, type Scene,
} from './liveRunModel';

/* ─────────────────────────────────────────────────────────────────────────────
   Live Agent Run — visualización al estilo del demo (navegador, cursor, pestañas,
   páginas que se leen) alimentada por los eventos reales del servidor.
   · Cada escena corresponde a una operación que ocurrió: el plan, cada petición API,
     cada página abierta con Chromium, el cruce con tu red, la evaluación y el borrador.
   · Consultas, títulos de resultados, conteos, estados HTTP, capturas y candidatos
     vienen de la ejecución. El cursor y el tecleo son ilustrativos: muestran qué
     está haciendo el agente, no clics reales.
   · Si el servidor va más rápido que la animación, las escenas se encolan y se
     aceleran; nunca se muestran operaciones que no ocurrieron.
   ───────────────────────────────────────────────────────────────────────────── */

export type RunConnection = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'polling' | 'closed';
type Props = {
  jobId: string | null;
  events: LiveRunEvent[];
  jobStatus: string | null;
  brief: Brief;
  connection: RunConnection;
  structured?: boolean;
  legacy?: { phase: string; message: string; at: string }[];
  error?: string;
  onRetry?: () => void;
  busy?: boolean;
  demo?: boolean;
  variant?: 'live' | 'archive';
  /** Vista en vivo: la animación alcanzó el final (o el usuario la saltó) y ya se pueden mostrar resultados. */
  onPlaybackEnd?: () => void;
  /** Vista de registro: desplazarse a los resultados. */
  onShowResults?: () => void;
  /** Abrir una ejecución ya terminada directamente en su resumen. */
  startAtEnd?: boolean;
  /** Regresar al espacio anterior sin cancelar automáticamente la ejecución. */
  onBack?: () => void;
  /** Cancelar en el servidor una investigación que sigue en curso. */
  onStop?: () => void;
  stopping?: boolean;
  /** Acciones de la cuenta (repetir, editar perfil, cerrar sesión) dentro del panel del agente. */
  actions?: { label: string; icon: ReactNode; onClick: () => void }[];
};

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const clock = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const secs = (ms?: number | null) => (ms == null ? '' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1).replace('.', ',')} s`);
const reveal = (p: number, n: number, start = 0, end = 1) => Math.max(0, Math.min(n, Math.floor(((p - start) / (end - start)) * n)));
const typed = (text: string, p: number, start: number, end: number) => text.slice(0, reveal(p, text.length, start, end));
const hostOf = (url?: string | null) => { try { return url ? new URL(url).hostname.replace(/^www\./, '') : ''; } catch { return ''; } };

/** Identidad visual de cada fuente (solo estilo; el contenido es el de la respuesta real). */
const SITE: [RegExp, { name: string; color: string; kind: string }][] = [
  [/grants\.gov/i, { name: 'Grants.gov', color: '#1b4a8a', kind: 'Grant' }],
  [/reporter|nih/i, { name: 'NIH RePORTER', color: '#20558a', kind: 'Project' }],
  [/openalex/i, { name: 'OpenAlex', color: '#c2410c', kind: 'Paper' }],
  [/clinicaltrials/i, { name: 'ClinicalTrials.gov', color: '#1f6f8b', kind: 'Trial' }],
  [/exa/i, { name: 'Exa', color: '#1d4ed8', kind: 'Web' }],
  [/serper|google/i, { name: 'Web search', color: '#0f766e', kind: 'Web' }],
  [/firecrawl|scrapegraph/i, { name: 'Firecrawl + ScrapeGraph', color: '#d08a1e', kind: 'Page' }],
  [/apify|linkedin/i, { name: 'LinkedIn', color: '#0a66c2', kind: 'Profile' }],
];
const siteOf = (text: string) => SITE.find(([rx]) => rx.test(text))?.[1] || { name: text || 'Public source', color: '#2150f5', kind: 'Record' };

type CursorStep = { at: number; target: string; click?: boolean };
const CURSOR: Record<Scene['kind'], CursorStep[]> = {
  profile: [{ at: 0, target: 'title' }, { at: 0.2, target: 'signals' }, { at: 0.45, target: 'plan-0', click: true }, { at: 0.66, target: 'plan-1' }, { at: 0.86, target: 'plan-last', click: true }],
  search: [{ at: 0, target: 'query' }, { at: 0.06, target: 'query', click: true }, { at: 0.28, target: 'go', click: true }, { at: 0.46, target: 'row-0' }, { at: 0.6, target: 'row-1', click: true }, { at: 0.74, target: 'row-2' }, { at: 0.9, target: 'count' }],
  page: [{ at: 0, target: 'shot-top' }, { at: 0.35, target: 'shot-mid', click: true }, { at: 0.6, target: 'shot-low' }, { at: 0.85, target: 'checks' }],
  network: [{ at: 0, target: 'you' }, { at: 0.35, target: 'path-0', click: true }, { at: 0.7, target: 'path-1' }],
  evaluate: [{ at: 0, target: 'head' }, { at: 0.3, target: 'row-0' }, { at: 0.5, target: 'row-1' }, { at: 0.7, target: 'row-2', click: true }, { at: 0.88, target: 'row-3' }],
  rank: [{ at: 0, target: 'head' }, { at: 0.65, target: 'row-0', click: true }],
  draft: [{ at: 0, target: 'to' }, { at: 0.12, target: 'subject', click: true }, { at: 0.4, target: 'body' }, { at: 0.9, target: 'note' }],
  done: [],
};

/* ───────── Reproductor de escenas ───────── */
type Player = { index: number; progress: number; follow: boolean; paused: boolean; speed: number };
function usePlayer(scenes: Scene[], startAtEnd: boolean, jobId: string | null) {
  const [player, setPlayer] = useState<Player>({ index: 0, progress: 0, follow: true, paused: false, speed: 1 });
  const scenesRef = useRef(scenes);
  scenesRef.current = scenes;
  // Ejecución ya terminada al abrirla: se muestra el resumen final; el usuario puede reproducir.
  const initialized = useRef<string | null>(null);
  useEffect(() => {
    if (!jobId || initialized.current === jobId || !scenes.length) return;
    initialized.current = jobId;
    if (startAtEnd) setPlayer({ index: scenes.length - 1, progress: 1, follow: false, paused: false, speed: 1 });
    else setPlayer({ index: 0, progress: 0, follow: true, paused: false, speed: 1 });
  }, [jobId, startAtEnd, scenes.length]);
  useEffect(() => {
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      setPlayer((pl) => {
        const list = scenesRef.current;
        const scene = list[pl.index];
        if (!scene || pl.paused) return pl;
        const backlog = list.length - 1 - pl.index;
        // Si hay operaciones en cola, la animación se acelera para alcanzar al servidor.
        const boost = pl.follow ? Math.min(2.5, 1 + Math.max(0, backlog - 2) * 0.35) : 1;
        let next = pl.progress + (dt * pl.speed * boost) / sceneDuration(scene);
        if (!scene.complete) next = Math.min(next, sceneHold[scene.kind]);
        if (next >= 1) {
          if (pl.follow && pl.index < list.length - 1) return { ...pl, index: pl.index + 1, progress: 0 };
          return pl.progress === 1 ? pl : { ...pl, progress: 1 };
        }
        return { ...pl, progress: next };
      });
    }, 50);
    return () => window.clearInterval(id);
  }, []);
  return [player, setPlayer] as const;
}

export function LiveAgentRun({ jobId, events, jobStatus, brief, connection, structured = true, legacy = [], error, onRetry, busy = false, demo = false, variant = 'live', onPlaybackEnd, onShowResults, startAtEnd = false, onBack, onStop, stopping = false, actions = [] }: Props) {
  const outcome = runOutcome(events, jobStatus);
  const finished = outcome === 'done' || outcome === 'partial' || outcome === 'failed';
  const scenes = useMemo(() => buildScenes(events), [events]);
  const [player, setPlayer] = usePlayer(scenes, (variant === 'archive' || startAtEnd) && finished, jobId);
  const [replaying, setReplaying] = useState(false);
  const index = Math.min(player.index, Math.max(0, scenes.length - 1));
  const scene: Scene | undefined = scenes[index];
  const atEnd = !scene || (index === scenes.length - 1 && player.progress >= 1);
  useEffect(() => { if (replaying && atEnd && finished) setReplaying(false); }, [replaying, atEnd, finished]);

  // En reproducción, el panel izquierdo avanza con la escena; en vivo refleja al servidor.
  const visible = useMemo(() => replaying && scene ? events.filter((e) => e.sequence <= scene.lastSequence) : events, [events, replaying, scene]);
  const visibleOutcome = replaying ? runOutcome(visible, null) : outcome;
  const visibleDone = visibleOutcome === 'done' || visibleOutcome === 'partial' || visibleOutcome === 'failed';
  const steps = useMemo(() => buildSteps(visible), [visible]);
  const sources = steps.filter((s) => s.kind === 'source');
  const running = sources.filter((s) => s.state === 'running');
  const records = sources.reduce((n, s) => n + (s.resultCount || 0), 0);
  const issues = visible.filter((e) => e.phase === 'warning' || e.phase === 'error' || (e.phase === 'api_response' && e.status === 'error'));
  const pct = stepProgress(steps, visibleOutcome);
  const backlog = Math.max(0, scenes.length - 1 - index);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (finished) return; const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, [finished]);
  const firstAt = events[0] ? Date.parse(events[0].at) : null;
  const lastAt = events.at(-1) ? Date.parse(events.at(-1)!.at) : null;
  const elapsed = firstAt ? (finished ? (lastAt || firstAt) - firstAt : now - firstAt) : 0;

  const jumpTo = (stepId: string) => {
    const target = scenes.findIndex((s) => s.stepId === stepId);
    if (target >= 0) { setReplaying(false); setPlayer((pl) => ({ ...pl, index: target, progress: 0, follow: false, paused: false })); }
  };
  const startReplay = () => { setReplaying(true); setPlayer({ index: 0, progress: 0, follow: true, paused: false, speed: 1 }); };
  const currentStepId = scene?.stepId;

  const badge = replaying ? { cls: 'replay', text: 'Replay' }
    : finished && variant === 'archive' ? { cls: 'archive', text: 'Record' }
    : finished ? { cls: 'archive', text: 'Done' }
    : connection === 'live' ? { cls: 'live', text: 'Live' }
    : connection === 'polling' ? { cls: 'poll', text: 'Live · polling' }
    : { cls: 'wait', text: 'Connecting' };
  const statusLine = error ? 'Stopped · check the error'
    : replaying ? `Replaying · step ${index + 1} of ${scenes.length}`
    : finished ? `${outcomeLabel[outcome]} · ${clock(elapsed)}${variant === 'live' && scene?.kind !== 'done' ? ' · finishing' : ''}`
    : !jobId ? (busy ? 'Sending your profile…' : 'Waiting to start')
    : !events.length ? 'Queued · waiting for the first event'
    : `Working · ${clock(elapsed)}`;
  const via = brief.organization && brief.venture && brief.organization !== brief.venture ? ` (via ${brief.organization})` : '';

  return (
    <div className={`rs-live lv ${variant === 'live' ? 'full' : 'archive'}`}>
      <div className="ag" role="region" aria-label="Live Agent Run">
        <aside className="ag-side">
          {(onBack || (!finished && onStop)) && <nav className="lv-run-nav" aria-label="Run controls">
            {onBack && <button type="button" onClick={onBack}><ArrowLeft size={15} /> Back</button>}
            {!finished && onStop && <button type="button" className="danger" onClick={onStop} disabled={stopping}>
              {stopping ? <LoaderCircle className="spin" size={14} /> : <Square size={13} fill="currentColor" />} {stopping ? 'Stopping…' : 'Stop run'}
            </button>}
          </nav>}
          <header className="ag-head">
            <span className={`ag-orb ${visibleDone ? 'done' : ''} ${error ? 'err' : ''}`}>{visibleDone ? <Check size={16} /> : error ? <TriangleAlert size={15} /> : <Sparkles size={16} />}</span>
            <div><strong>IGC Outreach agent</strong><small role="status" aria-live="polite">{statusLine}</small></div>
            <span className={`lv-badge ${badge.cls}`}>{badge.text}</span>
          </header>
          <p className="ag-task">Search {brief.fundingTypes.map((t) => (fundingLabels[t] || t).toLowerCase()).join(', ')} for {brief.venture || brief.company || 'your project'}{via}</p>
          {error && <div className="lv-alert error" role="alert"><TriangleAlert size={15} /><span>{error}</span>{onRetry && <button onClick={onRetry} disabled={busy}>{busy && <LoaderCircle className="spin" size={13} />} Retry</button>}</div>}
          {demo && <div className="lv-alert demo"><AlertTriangle size={15} /><span>DEMO · All contacts are fictional.</span></div>}
          <div className="ag-counters">
            <div><b>{fmt(sources.filter((s) => s.state !== 'pending').length)}</b><span>Sources queried</span></div>
            <div><b>{fmt(records)}</b><span>Records with provenance</span></div>
            <div><b className={issues.length ? 'lv-warn' : ''}>{fmt(issues.length)}</b><span>Warnings and errors</span></div>
          </div>
          {!structured ? <div className="lv-legacy"><p>This run predates the live view. Text log:</p><ol>{legacy.map((e, i) => <li key={i}>{e.message}</li>)}</ol></div> : (
            <ol className="ag-steps">
              {steps.map((s, i) => <StepItem key={s.id} step={s} n={i + 1} current={s.id === currentStepId} parallel={running.length > 1 && s.state === 'running'} onPick={() => jumpTo(s.id)} />)}
            </ol>
          )}
          <footer className="ag-foot">
            <div className="ag-bar"><i style={{ width: `${pct * 100}%` }} /></div>
            <div className="ag-controls">
              {!finished && !player.follow && <button className="lv-ctl" onClick={() => setPlayer((pl) => ({ ...pl, follow: true, index: Math.max(0, scenes.length - 1), progress: 0 }))}><Crosshair size={14} /> Follow the agent</button>}
              {finished && !replaying && (onShowResults || onPlaybackEnd) && <button className="lv-ctl primary" onClick={onShowResults || onPlaybackEnd}><Check size={14} /> View results</button>}
              {finished && structured && scenes.length > 0 && !replaying && <button className="lv-ctl" onClick={startReplay}><RotateCcw size={14} /> Replay</button>}
              {replaying && <>
                <button className="ag-icon" onClick={() => setPlayer((pl) => ({ ...pl, paused: !pl.paused }))} aria-label={player.paused ? 'Resume' : 'Pause'}>{player.paused ? <Play size={16} /> : <Pause size={16} />}</button>
                <button className="ag-chip on" onClick={() => setPlayer((pl) => ({ ...pl, speed: pl.speed === 1 ? 2 : pl.speed === 2 ? 4 : 1 }))}>{player.speed}×</button>
                <button className="ag-link" onClick={() => { setReplaying(false); setPlayer((pl) => ({ ...pl, index: scenes.length - 1, progress: 1, follow: false })); }}>Skip to end</button>
              </>}
            </div>
            {actions.length > 0 && <nav className="lv-actions" aria-label="Actions">{actions.map((a) => <button key={a.label} onClick={a.onClick}>{a.icon}{a.label}</button>)}</nav>}
            <p className="lv-note">{connection === 'polling' && !finished ? 'Live stream unavailable: polling. ' : ''}Queries, results, captures and counts are from the real run. Nothing is sent.</p>
          </footer>
        </aside>

        <section className="ag-stage">
          <div className="ag-browser">
            <Tabs sources={sources} current={scene?.provider} />
            <Chrome scene={scene} p={player.progress} finished={finished} replaying={replaying} />
            <SceneView key={scene?.id || 'empty'} scene={scene} p={player.progress} brief={brief} jobId={jobId} busy={busy} started={events.length > 0} outcome={outcome} steps={steps} elapsed={elapsed} onReplay={finished && !replaying ? startReplay : undefined} onResults={finished ? onShowResults || onPlaybackEnd : undefined} />
          </div>
          <p className="ag-caption"><Globe size={13} /> {scene ? `${sceneTitle(scene)} · step ${index + 1} of ${scenes.length}` : 'Preparing'}{!replaying && !finished && backlog > 0 && ` · ${backlog} queued (speeding up)`}{running.length > 1 && !replaying && ` · ${running.length} sources in parallel`}<kbd>{replaying ? 'replay' : finished ? 'log' : 'live'}</kbd></p>
        </section>
      </div>
    </div>
  );
}

function sceneTitle(scene: Scene) {
  switch (scene.kind) {
    case 'profile': return 'Read your profile and plan';
    case 'search': return `Query ${siteOf(`${scene.provider} ${(scene.events[0]?.detail as ApiDetail | undefined)?.host || ''}`).name}`;
    case 'page': return `Read ${(scene.events[0]?.detail as { host?: string } | undefined)?.host || 'official page'}`;
    case 'network': return 'Match with your network';
    case 'evaluate': return 'Evaluate candidates';
    case 'rank': return 'Rank and explain';
    case 'draft': return 'Draft the first message';
    default: return 'Run summary';
  }
}

function StepItem({ step, n, current, parallel, onPick }: { step: RunStep; n: number; current: boolean; parallel: boolean; onPick: () => void }) {
  const state = step.state === 'pending' ? 'next' : step.state === 'running' ? 'now' : 'done';
  const logs = step.events.filter((e) => e.message && !['api_request', 'browser_opened', 'page_loaded', 'screenshot'].includes(e.phase)).slice(-(current || state === 'now' ? 4 : 2));
  return <li className={`${state} ${step.state === 'warning' || step.state === 'error' ? 'warn' : ''} ${current ? 'focus' : ''}`}>
    <span className="ag-dot">{state === 'done' ? (step.state === 'success' ? <Check size={12} strokeWidth={3} /> : <AlertTriangle size={11} />) : state === 'now' ? <LoaderCircle className="spin" size={13} /> : n}</span>
    <div>
      <button className="lv-step" onClick={onPick} disabled={state === 'next'}>
        <strong>{step.title}{step.resultCount != null && <em className="ag-found">{fmt(step.resultCount)}</em>}{parallel && <em className="lv-par">in parallel</em>}</strong>
      </button>
      {state !== 'next' && logs.length > 0 && <ul>{logs.map((e, j) => <li key={e.sequence} className={`${e.phase === 'warning' || e.status === 'error' ? 'lv-warn' : ''} ${state === 'now' && j === logs.length - 1 ? 'typing' : ''}`}>{e.message}</li>)}</ul>}
      {state === 'next' && <ul><li className="lv-muted">{step.kind === 'source' ? 'Planned' : 'Pending'}</li></ul>}
    </div>
  </li>;
}

function Tabs({ sources, current }: { sources: RunStep[]; current?: string }) {
  const started = sources.filter((s) => s.state !== 'pending');
  if (!started.length) return null;
  return <div className="lv-tabs" role="tablist" aria-label="Open sources">
    {started.map((s) => <span key={s.id} role="tab" aria-selected={s.provider === current} className={`lv-tab ${s.provider === current ? 'on' : ''} ${s.state}`}>
      {s.state === 'running' ? <LoaderCircle className="spin" size={11} /> : s.state === 'success' ? <Check size={11} /> : <AlertTriangle size={11} />}
      <span>{s.title}</span>
    </span>)}
  </div>;
}

function sceneUrl(scene: Scene | undefined): string {
  if (!scene) return 'igc-outreach://agent';
  if (scene.kind === 'search' || scene.kind === 'page') return [...scene.events].reverse().find((e) => e.publicUrl)?.publicUrl || '';
  return { profile: 'igc-outreach://profile/plan', network: 'igc-outreach://red/warm-paths', evaluate: 'igc-outreach://evaluator', rank: 'igc-outreach://ranking', draft: 'igc-outreach://drafts', done: 'igc-outreach://summary' }[scene.kind] || '';
}
function Chrome({ scene, p, finished, replaying }: { scene?: Scene; p: number; finished: boolean; replaying: boolean }) {
  const url = sceneUrl(scene).replace(/^https?:\/\//, '');
  const shown = url.slice(0, Math.max(8, Math.ceil(Math.min(1, p * 6) * url.length)));
  const failed = scene?.events.some((e) => e.phase === 'error' || (e.phase === 'api_response' && e.status === 'error'));
  const external = scene?.kind === 'search' || scene?.kind === 'page';
  const label = !scene ? 'Waiting' : !scene.complete ? (scene.kind === 'search' ? 'Querying' : scene.kind === 'page' ? 'Loading' : 'Processing') : failed ? 'Error' : scene.kind === 'done' ? (finished ? 'Done' : 'Processing') : external ? (p < 1 ? 'Reading' : 'Read') : p < 1 ? 'Processing' : 'Done';
  return <div className="ag-chrome">
    <span className="ag-lights"><i /><i /><i /></span>
    <div className="ag-url"><Lock size={12} /><span title={url}>{shown}</span>{p < 0.16 && <em className="ag-caret" />}</div>
    <span className={`lv-state ${failed ? 'err' : scene?.complete ? 'ok' : 'busy'}`}>{label}</span>
    {replaying && <span className="lv-badge replay small">Replay</span>}
  </div>;
}

/* ───────── Cursor: se mueve hacia elementos reales de la escena ───────── */
function Cursor({ view, scene, p }: { view: RefObject<HTMLDivElement | null>; scene: Scene; p: number }) {
  const script = CURSOR[scene.kind];
  const step = [...script].reverse().find((c) => c.at <= p) || script[0];
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const root = view.current;
    if (!root || !step) return;
    let el = root.querySelector<HTMLElement>(`[data-cursor="${step.target}"]`);
    if (!el && step.target === 'plan-last') el = [...root.querySelectorAll<HTMLElement>('[data-cursor^="plan-"]')].at(-1) || null;
    if (!el) return;
    const a = root.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    setPos({ x: b.left - a.left + Math.min(b.width * 0.35, 90), y: b.top - a.top + Math.min(b.height / 2, 40) });
  }, [view, step, p > 0.5]);
  if (!step || !pos) return null;
  return <span className="ag-cursor" style={{ left: pos.x, top: pos.y } as CSSProperties} aria-hidden="true">
    <svg width="22" height="24" viewBox="0 0 22 24"><path d="M2 2 L2 19 L7 14.5 L10.5 22 L13.5 20.6 L10 13.4 L17 13.4 Z" /></svg>
    {step.click && <i key={`${scene.id}-${step.at}`} className="ag-click" />}
  </span>;
}

function SceneView({ scene, p, brief, jobId, busy, started, outcome, steps, elapsed, onReplay, onResults }: { scene?: Scene; p: number; brief: Brief; jobId: string | null; busy: boolean; started: boolean; outcome: string; steps: RunStep[]; elapsed: number; onReplay?: () => void; onResults?: () => void }) {
  const view = useRef<HTMLDivElement>(null);
  return <div className="ag-view lv-view" ref={view}>
    {!scene ? <div className="lv-wait"><LoaderCircle className="spin" size={26} /><p>{busy ? 'Sending your profile…' : started ? 'Preparing the first step…' : 'Waiting for the first server event…'}</p><small>Watch the agent read your profile, query each source and rank candidates.</small></div>
      : scene.kind === 'profile' ? <ProfileScene scene={scene} p={p} brief={brief} />
      : scene.kind === 'search' ? <SearchScene scene={scene} p={p} />
      : scene.kind === 'page' ? <PageScene scene={scene} p={p} jobId={jobId} />
      : scene.kind === 'network' ? <NetworkScene scene={scene} p={p} />
      : scene.kind === 'evaluate' ? <EvaluateScene scene={scene} p={p} />
      : scene.kind === 'rank' ? <RankScene scene={scene} p={p} />
      : scene.kind === 'draft' ? <DraftScene scene={scene} p={p} />
      : <DoneScene scene={scene} steps={steps} outcome={outcome} elapsed={elapsed} onReplay={onReplay} onResults={onResults} />}
    {scene && scene.kind !== 'done' && <Cursor view={view} scene={scene} p={p} />}
  </div>;
}

/* ───────── Escenas ───────── */
function ProfileScene({ scene, p, brief }: { scene: Scene; p: number; brief: Brief }) {
  const plan = scene.events.find((e) => e.detail?.kind === 'plan')?.detail as PlanDetail | undefined;
  const omitted = scene.events.filter((e) => e.phase === 'planning' && e.status === 'pending');
  const signals = [...brief.industry.split(/\s+/).filter((w) => w.length > 2).slice(0, 4), brief.stage, brief.round, ...brief.fundingTypes.map((t) => fundingLabels[t] || t), brief.geography].filter(Boolean) as string[];
  const rows = plan?.items.length ? plan.items.map((i) => ({ name: i.provider, detail: i.query })) : (plan?.sources || []).map((s) => ({ name: s, detail: 'Planned source' }));
  return <div className="agv-doc lv-profile">
    <span className="agv-eyebrow">Confirmed profile{brief.organization && brief.venture && brief.organization !== brief.venture ? ` · ${brief.organization} → ${brief.venture}` : ''}</span>
    <h2 data-cursor="title">{brief.venture || brief.company} · {brief.product}</h2>
    <p className={p > 0.12 ? 'hl' : ''}>{brief.oneLiner || brief.description.slice(0, 220)}</p>
    <div className="agv-extract" data-cursor="signals"><small>Signals sent with each query</small><div>{signals.slice(0, reveal(p, signals.length, 0.1, 0.4)).map((w) => <em key={w} className="pop">{w}</em>)}</div></div>
    <div className="lv-plan">
      <small>Search plan · {rows.length} sources{omitted.length ? ` · ${omitted.length} skipped` : ''}</small>
      <ul>{rows.slice(0, reveal(p, rows.length, 0.4, 0.9)).map((r, i, arr) => <li key={`${r.name}-${i}`} className="fade" data-cursor={i === arr.length - 1 && i > 1 ? 'plan-last' : `plan-${i}`}><b>{r.name}</b><span>{r.detail}</span><Check size={14} /></li>)}</ul>
      {p > 0.9 && omitted.map((e) => <p key={e.sequence} className="lv-omit fade">{e.message}</p>)}
    </div>
  </div>;
}

function SearchScene({ scene, p }: { scene: Scene; p: number }) {
  const calls = new Map<string, { request?: LiveRunEvent; response?: LiveRunEvent }>();
  for (const e of scene.events) if (e.detail?.kind === 'api') {
    const c = calls.get(e.detail.callId) || {};
    if (e.phase === 'api_request') c.request = e; else c.response = e;
    calls.set(e.detail.callId, c);
  }
  const list = [...calls.values()];
  const first = list[0]?.request?.detail as ApiDetail | undefined;
  const site = siteOf(`${scene.provider || ''} ${first?.host || ''}`);
  const responses = list.map((c) => c.response).filter(Boolean) as LiveRunEvent[];
  const errors = responses.filter((r) => r.status === 'error');
  const multi = list.length > 1;
  const rows = multi
    ? responses.flatMap((r) => ((r.detail as ApiDetail).preview || []).slice(0, 1))
    : ((responses[0]?.detail as ApiDetail | undefined)?.preview || []);
  const total = multi ? responses.length : responses[0]?.resultCount ?? rows.length;
  const query = first?.query || (first?.endpoint ? new URL(first.endpoint).pathname : '');
  const ms = responses.reduce((n, r) => n + (r.durationMs || 0), 0);
  const status = (responses.at(-1)?.detail as ApiDetail | undefined)?.httpStatus;
  const waiting = !scene.complete;
  const others = scene.events.filter((e) => !e.detail && e.message && (e.phase === 'reading' || e.phase === 'warning')).slice(-2);
  return <div className="agv-web lv-search">
    <div className="lv-site" style={{ '--site': site.color } as CSSProperties}><b>{site.name}</b><span>{first?.method} {first?.endpoint ? new URL(first.endpoint).pathname : ''}</span><em>Public API</em></div>
    <div className="agv-search" data-cursor="query"><Search size={15} /><span>{typed(query, p, 0.04, 0.24)}{p < 0.28 && <em className="ag-caret" />}</span><button data-cursor="go" className={p > 0.28 ? 'pressed' : ''}>{multi ? `Open ${list.length} records` : 'Search'}</button></div>
    {waiting && p >= sceneHold.search - 0.01
      ? <div className="lv-loading"><LoaderCircle className="spin" size={15} /> Waiting for {first?.host}{list.length > 1 ? ` · ${responses.length}/${list.length} records` : ''}…<ul className="agv-skel">{[0, 1, 2].map((i) => <li key={i}><em className="kind" /><div><small /><strong /><p /></div></li>)}</ul></div>
      : errors.length && !rows.length
        ? <div className="lv-error fade"><TriangleAlert size={18} /><div><b>The source returned an error</b><p>{errors[0].message}</p></div></div>
        : <ul>{rows.slice(0, reveal(p, Math.min(rows.length, 5), 0.36, 0.78)).map((r, i) => <li key={i} className={`fade ${p > 0.8 + i * 0.03 ? 'saved' : ''}`} data-cursor={`row-${i}`}>
          <em className="kind" style={{ background: `color-mix(in srgb, ${site.color} 14%, transparent)`, color: site.color }}>{site.kind}</em>
          <div><small>{r.subtitle || first?.host}</small><strong>{r.title}</strong></div>
          {p > 0.8 + i * 0.03 && <b className="pop">Saved</b>}
        </li>)}</ul>}
    {!waiting && p > 0.35 && <div className="lv-meta fade" data-cursor="count">
      <span>HTTP <b>{status ?? '—'}</b></span><span>{multi ? `${responses.length} requests` : 'Time'} <b>{secs(ms)}</b></span><span>Records <b>{fmt(total || 0)}</b></span>
      {!rows.length && !errors.length && <span>No readable titles in the response</span>}
      {others.map((e) => <span key={e.sequence} className={e.phase === 'warning' ? 'warn' : ''}>{e.message}</span>)}
    </div>}
  </div>;
}

function PageScene({ scene, p, jobId }: { scene: Scene; p: number; jobId: string | null }) {
  const host = (scene.events[0]?.detail as { host?: string } | undefined)?.host || hostOf(scene.events[0]?.publicUrl);
  const frame = scene.events.find((e) => e.frameId);
  const error = scene.events.find((e) => e.phase === 'error');
  const loaded = scene.events.find((e) => e.phase === 'page_loaded');
  const text = scene.events.find((e) => e.phase === 'reading' && /Texto extraído|Documento leído|Text extracted|Document read/.test(e.title));
  const robots = scene.events.find((e) => e.title === 'robots.txt comprobado');
  const httpOnly = scene.events.some((e) => (e.detail as { via?: string } | undefined)?.via === 'http' && e.phase !== 'error');
  const noBrowser = scene.events.find((e) => e.phase === 'warning' && /Navegador no disponible/.test(e.title));
  const checks = [
    { ok: !!robots, label: 'robots.txt' },
    { ok: !!loaded, label: loaded ? `DOM loaded · ${secs(loaded.durationMs)}` : noBrowser ? 'No browser' : 'Loading DOM' },
    { ok: !!frame, label: frame ? 'Real capture' : 'Capture' },
    { ok: !!text, label: text ? text.message.replace(/^[^:]+:\s*/, '') : 'Extract text' },
  ];
  return <div className="lv-pagescene">
    <div className="lv-shot" data-cursor="shot-top">
      {frame && jobId ? <FrameImage src={frameUrl(jobId, frame.frameId!)} alt={`Real capture of ${host}`} scanning={p < 0.95} p={p} />
        : error && !httpOnly ? <div className="lv-error big"><TriangleAlert size={22} /><div><b>The browser couldn't load the page</b><p>{error.message}</p></div></div>
        : httpOnly || noBrowser ? <div className="lv-skelpage"><header><b>{host}</b></header><div className="lv-scan" style={{ top: `${10 + p * 80}%` }} /><p><FileText size={16} /> Read over HTTP{noBrowser ? ' (Chromium unavailable)' : ''}: no capture.</p><i /><i /><i className="s" /><i /></div>
        : <div className="lv-skelpage loading"><header><b>{host}</b><LoaderCircle className="spin" size={14} /></header><i /><i /><i className="s" /><i /><i className="s" /></div>}
      <span className="lv-anchor mid" data-cursor="shot-mid" /><span className="lv-anchor low" data-cursor="shot-low" />
    </div>
    <ul className="lv-checks" data-cursor="checks">{checks.map((c) => <li key={c.label} className={c.ok ? 'ok' : ''}>{c.ok ? <Check size={12} /> : <LoaderCircle className="spin" size={12} />} {c.label}</li>)}</ul>
    {error && httpOnly && <p className="lv-note warn">{error.message} · read over HTTP.</p>}
  </div>;
}

function FrameImage({ src, alt, scanning, p }: { src: string; alt: string; scanning: boolean; p: number }) {
  const [state, setState] = useState<'loading' | 'ok' | 'gone'>('loading');
  useEffect(() => { setState('loading'); const img = new Image(); img.onload = () => setState('ok'); img.onerror = () => setState('gone'); img.src = src; }, [src]);
  if (state === 'gone') return <div className="lv-error big"><ImageOff size={22} /><div><b>Capture expired</b><p>Captures are temporary; the event log remains.</p></div></div>;
  return <figure className={`lv-frame ${state}`}>
    {state === 'ok' && <img src={src} alt={alt} style={{ transform: `translateY(${-Math.min(1, p) * 6}%)` }} />}
    {state === 'loading' && <span className="lv-loading-img"><LoaderCircle className="spin" size={16} /> Loading capture…</span>}
    {scanning && state === 'ok' && <span className="lv-scan" style={{ top: `${8 + (p * 1.4 % 1) * 84}%` }} />}
  </figure>;
}

function NetworkScene({ scene, p }: { scene: Scene; p: number }) {
  const d = scene.events.find((e) => e.detail?.kind === 'network')?.detail as NetworkDetail | undefined;
  if (!d) return null;
  if (!d.contacts) return <div className="agv-net"><div className="agv-files"><div className="agv-file"><FileText size={20} /><strong>No imported contacts</strong><small>LinkedIn, email, calendar or CRM</small><em>Warm paths can't be computed yet.</em></div><div className={`agv-file ${p > 0.3 ? 'ok' : 'busy'}`}><ShieldCheck size={20} /><strong>{fmt(d.candidates)} candidates</strong><small>Kept as cold outreach</small><em>Nothing is made up.</em></div></div></div>;
  const W = 860, H = 360;
  const paths = d.paths.slice(0, 4);
  return <div className="lv-network">
    <div className="agv-meta"><span>Imported contacts <b>{fmt(d.contacts)}</b></span><span>Candidates <b>{fmt(d.candidates)}</b></span><span>With path <b>{fmt(scene.events.find((e) => e.phase === 'source_completed')?.resultCount || 0)}</b></span></div>
    {paths.length ? <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Warm paths found">
      {paths.map((path, i) => {
        const y = 50 + ((i + 0.5) * (H - 90)) / paths.length;
        const nodes = path.nodes.length ? path.nodes : [d.you, path.target];
        const xs = nodes.map((_, j) => 70 + (j * (W - 180)) / Math.max(1, nodes.length - 1));
        const show = reveal(p, nodes.length, 0.1 + i * 0.12, 0.5 + i * 0.12);
        return <g key={i} data-cursor={`path-${i}`}>
          {nodes.slice(0, show).map((n, j) => j > 0 && <path key={`e${j}`} className={`agv-edge ${p > 0.75 && i === 0 ? 'hot' : ''}`} d={`M${xs[j - 1]},${j === 1 ? H / 2 : y} C${(xs[j - 1] + xs[j]) / 2},${j === 1 ? H / 2 : y} ${(xs[j - 1] + xs[j]) / 2},${y} ${xs[j]},${y}`} />)}
          {nodes.slice(1, show).map((n, j) => <g key={`n${j}`} className={`agv-node ${j === nodes.length - 2 ? 'fund' : 'person'} ${p > 0.75 && i === 0 ? 'hot' : ''}`} transform={`translate(${xs[j + 1]},${y})`}><circle r={j === nodes.length - 2 ? 10 : 7} /><text y={-14} textAnchor="middle">{n.length > 24 ? `${n.slice(0, 23)}…` : n}</text></g>)}
          {show >= nodes.length && <text className="lv-strength" x={W - 20} y={y + 4} textAnchor="end">{path.strength}%</text>}
        </g>;
      })}
      <g className="agv-node me" transform={`translate(70,${H / 2})`} data-cursor="you"><circle r={16} /><text y={32} textAnchor="middle">{d.you}</text></g>
    </svg> : <p className="lv-muted big" data-cursor="you">No candidate matches your contacts.</p>}
  </div>;
}

function EvaluateScene({ scene, p }: { scene: Scene; p: number }) {
  const start = scene.events.find((e) => e.phase === 'evaluating');
  const d = scene.events.find((e) => e.detail?.kind === 'ranking')?.detail as RankingDetail | undefined;
  const rows = d ? interleave(d.top.slice(0, 3).map((c) => ({ c, ok: 'ok', label: 'Priority' })), [...d.radar.map((c) => ({ c, ok: 'radar', label: 'Radar' })), ...d.discarded.map((c) => ({ c, ok: 'no', label: 'Discarded' }))]) : [];
  const checks = ['Evidence confirmed at source', 'Cross-source duplicates', 'Timing and deadlines', 'Exclusions and competitors', 'Your past feedback'];
  return <div className="agv-eval">
    <h3 data-cursor="head">Evaluator <small>{start?.message}</small></h3>
    {!d ? <ul>{checks.map((c, i) => <li key={c} className="fade ok" data-cursor={`row-${i}`}><strong>{c}</strong><span>Reviewing…</span><em><LoaderCircle className="spin" size={12} /></em></li>)}</ul>
      : <>
        <ul>{rows.slice(0, reveal(p, rows.length, 0.05, 0.8)).map((r, i) => <li key={i} className={`fade ${r.ok === 'no' ? 'no' : r.ok === 'radar' ? 'lv-radar' : 'ok'}`} data-cursor={`row-${i}`}><strong>{r.c.name}</strong><span>{r.c.why || r.c.title}</span><em>{r.label}</em></li>)}</ul>
        {p > 0.82 && <div className="agv-meta fade"><span>Priority <b>{d.counts.top}</b></span><span>Radar <b>{d.counts.radar}</b></span><span>Discarded <b>{d.counts.discarded}</b></span></div>}
      </>}
  </div>;
}
function interleave<T>(a: T[], b: T[]): T[] { const out: T[] = []; for (let i = 0; i < Math.max(a.length, b.length); i++) { if (a[i]) out.push(a[i]); if (b[i]) out.push(b[i]); } return out; }

function RankScene({ scene, p }: { scene: Scene; p: number }) {
  const d = scene.events.find((e) => e.detail?.kind === 'ranking')?.detail as RankingDetail | undefined;
  const top = (d?.top || []).slice(0, 8);
  const max = Math.max(1, ...top.map((t) => t.score));
  const settle = Math.min(1, p * 1.5);
  const order = settle < 0.6 ? [...top].sort((a, b) => a.name.localeCompare(b.name)) : top;
  return <div className="agv-rank">
    <h3 data-cursor="head">Top {d?.counts.top ?? top.length} · explainable score out of 100</h3>
    <ol>{top.map((r, k) => {
      const i = order.indexOf(r);
      return <li key={`${r.name}-${k}`} style={{ transform: `translateY(${i * 46}px)` }} data-cursor={k === 0 ? 'row-0' : undefined}><b>{k + 1}</b><span title={r.org}>{r.name}</span><div><i style={{ width: `${(r.score / max) * 100 * settle}%` }} /></div><small>{Math.round(r.score * settle)}</small></li>;
    })}</ol>
  </div>;
}

function DraftScene({ scene, p }: { scene: Scene; p: number }) {
  const d = scene.events.find((e) => e.detail?.kind === 'draft')?.detail as DraftDetail | undefined;
  const done = scene.events.find((e) => e.phase === 'drafting' && e.status === 'success');
  if (!d) return <div className="lv-wait"><Mail size={24} /><p>{done?.message || 'Drafting messages…'}</p></div>;
  return <div className="lv-mail">
    <div className="lv-mail-row" data-cursor="to"><small>To</small><b>{d.to}</b>{d.org && d.org !== d.to && <span>· {d.org}</span>}<em>No guessed email</em></div>
    <div className="lv-mail-row" data-cursor="subject"><small>Subject</small><b>{typed(d.subject, p, 0.1, 0.3)}{p > 0.1 && p < 0.3 && <em className="ag-caret" />}</b></div>
    <pre data-cursor="body">{typed(d.excerpt, p, 0.32, 0.92)}{p >= 0.32 && p < 0.92 && <em className="ag-caret" />}</pre>
    <p className="lv-note" data-cursor="note"><ShieldCheck size={13} /> {done?.message}</p>
  </div>;
}

const plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;
function DoneScene({ scene, steps, outcome, elapsed, onReplay, onResults }: { scene: Scene; steps: RunStep[]; outcome: string; elapsed: number; onReplay?: () => void; onResults?: () => void }) {
  const ranking = steps.find((s) => s.kind === 'evaluate')?.events.find((e) => e.detail?.kind === 'ranking')?.detail as RankingDetail | undefined;
  const sources = steps.filter((s) => s.kind === 'source');
  const final = scene.events.find((e) => e.phase === 'completed');
  const records = sources.reduce((n, s) => n + (s.resultCount || 0), 0);
  const maxRecords = Math.max(1, ...sources.map((s) => s.resultCount || 0));
  const top = (ranking?.top || []).slice(0, 5);
  const maxScore = Math.max(1, ...top.map((t) => t.score));
  const kpis = [
    { label: 'Priority', value: ranking?.counts.top, tone: 'blue' },
    { label: 'Radar', value: ranking?.counts.radar, tone: '' },
    { label: 'Discarded', value: ranking?.counts.discarded, tone: '' },
    { label: 'Records read', value: records, tone: '' },
    { label: 'Duration', value: null, text: clock(elapsed), tone: '' },
  ];
  return <div className="lv-done">
    <header className="lv-done-head fade">
      <span className={`lv-done-icon ${outcome}`}>{outcome === 'done' ? <Check size={24} /> : <AlertTriangle size={22} />}</span>
      <div><h2>{final?.title || 'Run complete'}</h2><p>{final?.message}</p></div>
    </header>
    <div className="lv-kpis fade">{kpis.map((k) => <div key={k.label} className={k.tone}><b>{k.text ?? (k.value == null ? '—' : fmt(k.value))}</b><span>{k.label}</span></div>)}</div>
    <div className="lv-done-cols fade">
      <section>
        <h4>Sources queried · {sources.filter((s) => s.state === 'success').length}/{sources.length} no errors</h4>
        <ul className="lv-src-bars">{sources.map((s) => <li key={s.id} className={s.state}>
          <span className="lv-src-name">{s.state === 'success' ? <Check size={13} /> : <AlertTriangle size={13} />}{s.title}</span>
          <span className="lv-src-bar"><i style={{ width: `${((s.resultCount || 0) / maxRecords) * 100}%` }} /></span>
          <span className="lv-src-val">{s.resultCount != null ? plural(s.resultCount, 'record', 'records') : '—'}<small>{secs(s.durationMs)}</small></span>
        </li>)}</ul>
      </section>
      <section>
        <h4>Top candidates</h4>
        {top.length ? <ol className="lv-top">{top.map((t, i) => <li key={`${t.name}-${i}`}><b>{i + 1}</b><div><strong>{t.name}</strong><small>{t.org && t.org !== t.name ? t.org : t.title}</small></div><span className="lv-src-bar"><i style={{ width: `${(t.score / maxScore) * 100}%` }} /></span><em>{t.score}</em></li>)}</ol>
          : <p className="lv-muted">No candidate had enough evidence for the top list.</p>}
      </section>
    </div>
    <footer className="lv-done-actions">
      {onResults && <button className="lv-ctl primary" onClick={onResults}><Check size={14} /> View results</button>}
      {onReplay && <button className="lv-ctl" onClick={onReplay}><Play size={14} /> Replay the run</button>}
    </footer>
  </div>;
}
