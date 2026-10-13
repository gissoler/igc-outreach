import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Check, ExternalLink, LoaderCircle, LogOut, Pencil, Plus, RotateCw, Search } from 'lucide-react';
import { api, ApiError, blank, presets, fundingLabels, subscribeRun, type Brief, type Feedback, type History, type Job } from './researchApi';
import { ResearchResults } from './ResearchResults';
import { LiveAgentRun, type RunConnection } from './LiveAgentRun';
import { mergeEvents, type LiveRunEvent } from './liveRunModel';
import './research.css';

const stageLabels: Record<string, string> = { idea: 'Idea', prototype: 'Prototipo', preclinical: 'Preclínica', clinical_phase_1: 'Fase clínica 1', clinical_phase_2: 'Fase clínica 2', clinical_phase_3: 'Fase clínica 3', marketed: 'En mercado', other: 'Otra' };
const errorMessage = (e: unknown) => e instanceof Error ? e.message : 'No se pudo completar la solicitud.';
const requestErrorMessage = (e: unknown, action: string) => e instanceof ApiError
  ? `${action} (HTTP ${e.status}): ${e.message}${e.detail ? ` ${e.detail}` : ''}`
  : `${action}: ${errorMessage(e)}`;
const savedBrief = (): Brief => {
  try {
    const value = JSON.parse(localStorage.getItem('igc-research-brief') || 'null');
    return value && typeof value === 'object' ? {...blank, ...value, dataMode: 'live'} : {...blank};
  } catch { return {...blank}; }
};

/** autoStart: el perfil ya está confirmado (cuenta real), así que no se muestra el formulario de revisión: se investiga directamente. */
export function ResearchPage({initialBrief, autoStart = false, onEdit, onLogout}: {initialBrief?: Brief; autoStart?: boolean; onEdit?: () => void; onLogout?: () => void} = {}) {
  const [brief, setBrief] = useState<Brief>(() => initialBrief ? {...initialBrief} : savedBrief());
  const [job, setJob] = useState<Job | null>(null);
  const [jobId, setJobId] = useState<string | null>(() => sessionStorage.getItem('igc-research-job'));
  const [history, setHistory] = useState<History>([]);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState('');
  const [pollAttempt, setPollAttempt] = useState(0);
  const [run, setRun] = useState<{ jobId: string | null; events: LiveRunEvent[] }>({ jobId: null, events: [] });
  const [connection, setConnection] = useState<RunConnection>('idle');
  // Ejecución iniciada en esta pantalla: se anima desde el principio aunque termine muy rápido.
  const [watching, setWatching] = useState<string | null>(null);
  // Dos módulos separados: el Live Agent Run y los resultados.
  const [screen, setScreen] = useState<'run' | 'results'>('run');
  const pollGeneration = useRef(0);
  const autoStarted = useRef(false);
  const startInFlight = useRef(false);
  const running = !!jobId && (!job || ['queued', 'running'].includes(job.status));
  const update = <K extends keyof Brief>(key: K, value: Brief[K]) => setBrief(b => ({...b, [key]: value}));
  useEffect(() => { try { localStorage.setItem('igc-research-brief', JSON.stringify(brief)); } catch { /* local storage unavailable */ } }, [brief]);
  useEffect(() => { void api<History>('/jobs').then(setHistory).catch(() => {}); }, [job?.status]);
  // Fuente de verdad del Live Agent Run: SSE (EventSource nativo) con sondeo como respaldo.
  useEffect(() => {
    if (!jobId) return;
    const generation = ++pollGeneration.current;
    let timer: ReturnType<typeof setTimeout>;
    let closeStream: (() => void) | null = null;
    const alive = () => generation === pollGeneration.current;
    const addEvents = (incoming: LiveRunEvent[]) => setRun((r) => r.jobId === jobId ? { jobId, events: mergeEvents(r.events, incoming) } : { jobId, events: mergeEvents([], incoming) });
    const openStream = () => {
      setConnection('connecting');
      closeStream = subscribeRun(jobId, {
        onSnapshot: (snapshot) => { if (!alive()) return; addEvents(snapshot.events); setConnection('live'); },
        onEvent: (event) => { if (alive()) addEvents([event]); },
        onReconnecting: () => { if (alive()) setConnection('reconnecting'); },
        // Fin del trabajo: se lee una vez el resultado completo (leads, borradores).
        onEnd: () => { closeStream = null; if (alive()) void poll(true); },
        onFailure: () => { closeStream = null; if (alive()) { setConnection('polling'); void poll(true); } },
      });
    };
    const poll = async (fallback: boolean) => {
      try {
        const result = await api<Job>(`/jobs/${jobId}`);
        if (!alive()) return;
        setJob(result); setError('');
        addEvents(result.run?.events || []);
        if (!['running','queued'].includes(result.status)) { setConnection('closed'); return; }
        setWatching((w) => w ?? jobId);
        if (!fallback && typeof EventSource !== 'undefined') openStream();
        else { setConnection('polling'); timer = setTimeout(() => void poll(true), 1500); }
      } catch (e) {
        if (!alive()) return;
        // 404: el id guardado ya no existe (servidor reiniciado u otra cuenta). Recuperación silenciosa:
        // se descarta el id y, si el perfil está confirmado, el autoarranque crea una investigación nueva.
        if (e instanceof ApiError && e.status === 404) {
          autoStarted.current = false;
          sessionStorage.removeItem('igc-research-job');
          setJobId(null);
          setJob(null);
          setError('');
          setConnection('idle');
          return;
        }
        setError(requestErrorMessage(e, 'No pudimos consultar el estado de la investigación'));
        timer = setTimeout(() => void poll(fallback), 5000);
      }
    };
    void poll(false);
    return () => { ++pollGeneration.current; clearTimeout(timer); closeStream?.(); };
  }, [jobId, pollAttempt]);
  async function start(e?: FormEvent) {
    e?.preventDefault();
    if (startInFlight.current) return;
    startInFlight.current = true;
    setBusy(true); setError('');
    try {
      const result = await api<{jobId: string}>('/jobs', brief);
      setJob(null); setScreen('run'); setRun({ jobId: result.jobId, events: [] }); setWatching(result.jobId);
      sessionStorage.setItem('igc-research-job', result.jobId); setJobId(result.jobId);
    } catch(e) {
      setError(requestErrorMessage(e, 'No pudimos iniciar la investigación'));
    } finally {
      startInFlight.current = false;
      setBusy(false);
    }
  }
  useEffect(() => { if (autoStart && !jobId && !autoStarted.current) { autoStarted.current = true; void start(); } }, [autoStart, jobId]);
  function reset() { setJobId(null); setJob(null); setError(''); setConnection('idle'); sessionStorage.removeItem('igc-research-job'); }
  function retry() {
    setError('');
    if (jobId) setPollAttempt((attempt) => attempt + 1);
    else void start();
  }
  async function stop() {
    if (!jobId || stopping) return;
    setStopping(true); setError('');
    try {
      await api(`/jobs/${jobId}/cancel`, {}, 'POST');
      setConnection('polling');
      setPollAttempt((attempt) => attempt + 1);
    } catch (e) {
      setError(requestErrorMessage(e, 'No pudimos detener la investigación'));
    } finally {
      setStopping(false);
    }
  }
  function openHistory(id: string) { if (id === jobId) { setScreen('run'); return; } setJob(null); setScreen('run'); setRun({ jobId: id, events: [] }); setJobId(id); sessionStorage.setItem('igc-research-job', id); }
  const runEvents = run.jobId === jobId ? run.events : [];
  const liveRun = (variant: 'live' | 'archive') => <LiveAgentRun
    jobId={jobId}
    events={runEvents}
    jobStatus={job?.status || null}
    brief={job?.brief || brief}
    connection={connection}
    structured={!job || !!job.run || runEvents.length > 0}
    legacy={job?.events}
    error={variant === 'live' ? error : undefined}
    onRetry={autoStart || jobId ? retry : undefined}
    onShowResults={job && !running ? () => { setWatching(null); setScreen('results'); } : undefined}
    onBack={onEdit}
    onStop={running ? () => void stop() : undefined}
    stopping={stopping}
    startAtEnd={!!jobId && watching !== jobId}
    actions={[
      ...(!running && !busy ? [{ label: 'Repetir búsqueda', icon: <RotateCw size={14}/>, onClick: () => void start() }] : []),
      ...(!autoStart && !running ? [{ label: 'Nueva búsqueda', icon: <Plus size={14}/>, onClick: reset }] : []),
      ...(onEdit && !running ? [{ label: 'Editar perfil', icon: <Pencil size={14}/>, onClick: onEdit }] : []),
      ...(onLogout ? [{ label: 'Cerrar sesión', icon: <LogOut size={14}/>, onClick: onLogout }] : []),
    ]}
    busy={busy}
    demo={(job?.mode || brief.dataMode) === 'demo'}
    variant={variant}
  />;
  function feedback(id: string, value: Feedback) { setJob(j => j && ({...j, leads: j.leads.map(l => l.id === id ? {...l, feedback: value} : l)})); }
  // Resultados: módulo propio, solo cuando la ejecución terminó.
  if (jobId && screen === 'results' && job && !running) return <ResearchResults job={job} history={history} onBack={() => setScreen('run')} onOpenHistory={openHistory} onFeedbackSaved={feedback}/>;
  // Con una investigación en curso o terminada, la pantalla muestra solamente el Live Agent Run.
  if (jobId || (autoStart && !jobId)) return <div className="rs-running">{liveRun('live')}</div>;
  const field = (key: 'name'|'role'|'company'|'product'|'industry'|'geography'|'criteria'|'exclusions', label: string, required = true) => <label className="rl-field">{label}<input className="rl-input" required={required} maxLength={required ? 200 : 1000} value={brief[key]} onChange={e => update(key,e.target.value)} /></label>;
  return <div className="rs-page">
    <header className="rs-heading"><div><span className="rs-eyebrow">INTELIGENCIA PARA TU PRÓXIMA CONVERSACIÓN</span><h1>Encontrar oportunidades</h1><p>Personas, financiación y motivos concretos para conectar.</p></div></header>
    {error && <div className="rs-notice error" role="alert"><span><b>Error de investigación.</b> {error}</span></div>}
    {<div className="rs-setup">
      <aside className="rs-intro"><span className="rs-orbit"><Search size={28}/></span><h2>El próximo contacto<br/>empieza aquí.</h2><p>Cuéntanos qué estás construyendo. Buscaremos señales públicas y te mostraremos qué sabemos y qué falta confirmar.</p><ol><li><b>01</b> Describe tu proyecto</li><li><b>02</b> Investigamos las fuentes</li><li><b>03</b> Elige con evidencia</li></ol><div className="rs-intro-note">Sin correos inventados.<br/>Tú decides a quién contactar.</div></aside>
      <form className="rs-form" onSubmit={start}>
        <div className="rs-form-top"><h2>Crea una búsqueda</h2><div className="rs-pills" aria-label="Perfiles de ejemplo"><button type="button" className={!brief.name ? 'on' : ''} onClick={() => setBrief({...blank})}>Usuario nuevo</button>{Object.entries(presets).map(([key,p]) => <button type="button" key={key} className={brief.name === p.name ? 'on' : ''} onClick={() => setBrief({...p})}>Ejemplo: {p.name}</button>)}</div></div>
        <p className="rs-help">Completa un perfil nuevo o carga uno de los dos ejemplos verificados. Los objetivos de búsqueda siempre se pueden editar.</p>
        <h3>01 · Sobre ti</h3><div className="rl-form">{field('name','Nombre')}{field('role','Cargo o perfil')}{field('company','Empresa')}{field('product','Producto o proyecto')}</div>
        <label className="rl-field">Descripción del producto<textarea className="rl-input" required maxLength={3000} rows={3} value={brief.description} onChange={e => update('description',e.target.value)}/></label>
        <h3>02 · Lo que estás buscando</h3><div className="rl-form">{field('industry','Industria o área temática')}<label className="rl-field">Etapa<select className="rl-input" value={brief.stage} onChange={e => update('stage',e.target.value)}>{Object.entries(stageLabels).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>{field('geography','Geografía')}<label className="rl-field">Monto buscado (USD, opcional)<input className="rl-input" type="number" min="1" max="1000000000000" value={brief.amount || ''} onChange={e => update('amount',e.target.value)}/></label></div>
        <fieldset className="rs-fieldset"><legend>Tipo de financiación · elige al menos uno</legend><div className="rs-pills">{Object.entries(fundingLabels).map(([value,label]) => <label className={brief.fundingTypes.includes(value) ? 'on' : ''} key={value}><input type="checkbox" checked={brief.fundingTypes.includes(value)} onChange={e => update('fundingTypes',e.target.checked ? [...brief.fundingTypes,value] : brief.fundingTypes.filter(v=>v!==value))}/>{label}</label>)}</div></fieldset>
        <div className="rl-form">{field('criteria','Criterios adicionales', false)}{field('exclusions','Organizaciones a excluir (separadas por coma)', false)}<label className="rl-field">Plazo mínimo para postular (días)<input className="rl-input" type="number" min="0" max="730" value={brief.minDays} onChange={e => update('minDays',Number(e.target.value))}/></label><label className="rl-field">Cierre desde (opcional)<input className="rl-input" type="date" value={brief.deadlineFrom || ''} onChange={e => update('deadlineFrom', e.target.value || undefined)}/></label><label className="rl-field">Cierre hasta (opcional)<input className="rl-input" type="date" value={brief.deadlineTo || ''} onChange={e => update('deadlineTo', e.target.value || undefined)}/></label><label className="rl-field">Prioridad<select className="rl-input" value={brief.mode} onChange={e => update('mode',e.target.value as Brief['mode'])}><option value="strategic">Relaciones y colaboración</option><option value="financial">Financiación y plazos</option></select></label></div>
        <div className="rs-checks"><label><input type="checkbox" checked={brief.excludeCompetitors} onChange={e=>update('excludeCompetitors',e.target.checked)}/> Excluir posibles competidores identificados</label>{/\bigc\b/i.test(brief.company) && <label><input type="checkbox" checked={brief.useTeam} onChange={e => update('useTeam',e.target.checked)}/> Usar relaciones públicas del equipo de IGC</label>}<label><input type="checkbox" checked={brief.strictTypes} onChange={e=>update('strictTypes',e.target.checked)}/> Mostrar solo el tipo de financiación solicitado</label></div>
        <h3>03 · Tu perfil profesional</h3>
        <section className={`rs-network-card ${brief.linkedinUrl ? 'connected' : ''}`}>
          <div className="rs-network-icon">{brief.linkedinUrl ? <Check size={23}/> : <ExternalLink size={23}/>}</div>
          <div className="rs-network-copy"><b>{brief.linkedinUrl ? 'LinkedIn conectado' : 'LinkedIn no conectado'}</b><p>{brief.linkedinUrl ? 'Usaremos la información pública de tu perfil como contexto para personalizar la investigación.' : 'La investigación puede continuar con tus datos de cuenta y las fuentes públicas disponibles.'}</p></div>
          {brief.linkedinUrl&&<div className="rs-network-actions"><a className="rs-button" href={brief.linkedinUrl} target="_blank" rel="noreferrer">Ver mi perfil <ExternalLink size={14}/></a></div>}
        </section>
        <h3>04 · Fuente de los resultados</h3><div className="rs-mode"><label className={brief.dataMode === 'live' ? 'on' : ''}><input type="radio" name="dataMode" value="live" checked={brief.dataMode === 'live'} onChange={()=>update('dataMode','live')}/><span><b>Investigación real</b><small>Fuentes públicas y perfil profesional · puede dar resultados parciales</small></span></label><label className={brief.dataMode === 'demo' ? 'on' : ''}><input type="radio" name="dataMode" value="demo" checked={brief.dataMode === 'demo'} onChange={()=>update('dataMode','demo')}/><span><b>Demostración</b><small>Ejemplos ficticios · sin consultas externas</small></span></label></div>
        <p className="rs-help">En modo real se consultan APIs públicas y páginas oficiales. La cobertura de inversión y deuda es limitada. Ningún fallo se reemplaza silenciosamente con ejemplos.</p>
        <button className="rl-primary rs-start" disabled={busy || !brief.fundingTypes.length}>{busy ? <LoaderCircle className="spin" size={18}/> : <Search size={18}/>} {brief.dataMode === 'demo' ? 'Ver demostración' : brief.linkedinUrl ? 'Buscar con mi perfil' : 'Buscar con fuentes públicas'} <ArrowRight size={18}/></button>
      </form>
    </div>}
  </div>;
}
