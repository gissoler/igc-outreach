import {
  Activity, ArrowRight, ArrowUpRight, Bell, CalendarDays, Check, ChevronDown, Grip, House, ListChecks, LoaderCircle, Moon,
  RefreshCw, RotateCcw, Search, Settings, Share2, SquareKanban, Sun, Target, XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, Dashboard, FactorKey, Recommendation } from './api';
import { InvestorFlow, type ViewMode } from './InvestorFlow';
import { FundDossier, InvestorsModule } from './Investors';
import { PipelineBoard } from './Pipeline';
import { ProjectManagement, type PmTab } from './ProjectManagement';
import { SettingsPage } from './Settings';
import { AgentRun } from './AgentRun';
import { Onboarding } from './Onboarding';
import { ResearchPage } from './Research';
import { currentAccount, demoConfig, demoOrgName, resetDemo, switchAccount, type AccountId } from './demo';
import { STEP_LABEL, buildSteps, readDone, weekLabel, writeDone } from './steps';
import { Avatar, CardHead, PageHead, initials, investorImage, outcomeLabels } from './ui';

const FIT_DIRTY_KEY = 'warmpath-fit-dirty';
type View = 'research' | 'overview' | 'investors' | 'fund' | 'pipeline' | 'project' | 'settings';
type Theme = 'light' | 'dark';
type RouteState = { view: View; selectedId: string | null; dossierId: string | null; investorView: ViewMode; pmTab: PmTab };

const VIEW_MODES: ViewMode[] = ['map', 'chord', 'tree', 'table'];
const PATHS: Record<Exclude<View, 'fund'>, string> = {
  research: '/buscar', overview: '/', investors: '/inversionistas', pipeline: '/pipeline', project: '/proyecto', settings: '/configuracion',
};

const readRoute = (): RouteState => {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  const params = new URLSearchParams(window.location.search);
  const rawMode = params.get('vista') as ViewMode | null;
  const investorView = rawMode && VIEW_MODES.includes(rawMode) ? rawMode : 'map';
  const base = { selectedId: null, dossierId: null, investorView, pmTab: 'overview' as PmTab };
  if (path.startsWith('/inversionistas/')) {
    const rawId = path.slice('/inversionistas/'.length);
    try { return { ...base, view: 'fund', selectedId: decodeURIComponent(rawId), dossierId: decodeURIComponent(rawId) }; }
    catch { return { ...base, view: 'investors' }; }
  }
  if (path === '/buscar') return { ...base, view: 'research' };
  if (path === '/inversionistas') return { ...base, view: 'investors', selectedId: params.get('fondo') };
  if (path === '/pipeline') return { ...base, view: 'pipeline' };
  if (path === '/configuracion' || (path === '/proyecto' && params.get('editar') === '1')) return { ...base, view: 'settings' };
  if (path === '/proyecto') return { ...base, view: 'project', pmTab: params.get('panel') === 'notificaciones' ? 'notifications' : 'overview' };
  return { ...base, view: 'overview' };
};

const investorsUrl = (mode: ViewMode = 'map', selectedId?: string | null) => {
  const params = new URLSearchParams();
  if (mode !== 'map') params.set('vista', mode);
  if (selectedId) params.set('fondo', selectedId);
  const query = params.toString();
  return `/inversionistas${query ? `?${query}` : ''}`;
};

const num = (value?: number) => (value || 0).toLocaleString('es-CO');
const pts = (value: number) => (Math.round(value * 1000) / 10).toLocaleString('es-CO');
/** Nombre que se muestra en el saludo y el header. */
const ORG_NAME = 'IGC Pharma';

const readTheme = (): Theme => {
  try { return localStorage.getItem('warmpath-theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
};

/** Cierra un popover al hacer clic fuera o con Escape. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return ref;
}

export default function App() {
  const initialRoute = useMemo(readRoute, []);
  const [view, setView] = useState<View>(initialRoute.view);
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  /* "Actualizar búsqueda" solo se habilita cuando el fit de la empresa cambió desde la última corrida. */
  const [fitDirty, setFitDirty] = useState(() => { try { return localStorage.getItem(FIT_DIRTY_KEY) === '1'; } catch { return false; } });
  const markFit = (dirty: boolean) => { setFitDirty(dirty); try { if (dirty) localStorage.setItem(FIT_DIRTY_KEY, '1'); else localStorage.removeItem(FIT_DIRTY_KEY); } catch { /* sin almacenamiento */ } };
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(initialRoute.selectedId);
  const [dossierId, setDossierId] = useState<string | null>(initialRoute.dossierId);
  const [investorView, setInvestorView] = useState<ViewMode>(initialRoute.investorView);
  const [pmTab, setPmTab] = useState<PmTab>(initialRoute.pmTab);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [menu, setMenu] = useState<'search' | 'apps' | 'account' | null>(null);
  const account = useMemo(currentAccount, []);
  const demo = account === 'demo';
  /* La cuenta demo arranca en ceros: primero el onboarding, luego el agente. */
  const [needsSetup, setNeedsSetup] = useState(() => demo && !demoConfig());
  const [agentOpen, setAgentOpen] = useState(false);
  const [query, setQuery] = useState('');
  const menuRef = useDismiss(menu !== null, () => setMenu(null));

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('warmpath-theme', theme); } catch { /* almacenamiento no disponible */ }
  }, [theme]);

  const applyRoute = (route: RouteState) => {
    setView(route.view);
    setSelectedId(route.selectedId);
    setDossierId(route.dossierId);
    setInvestorView(route.investorView);
    setPmTab(route.pmTab);
    setMenu(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const go = (url: string, replace = false) => {
    window.history[replace ? 'replaceState' : 'pushState']({}, '', url);
    applyRoute(readRoute());
  };
  useEffect(() => {
    const onPopState = () => applyRoute(readRoute());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const load = async () => {
    setError('');
    try { setData(await api.dashboard()); }
    catch (err) { setError(err instanceof Error ? err.message : 'No fue posible conectar con el backend'); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (!needsSetup) void load(); }, [needsSetup]);

  const changeAccount = (id: AccountId, reset = false) => {
    if (reset) resetDemo();
    switchAccount(id);
    window.location.assign('/');
  };

  const run = async () => {
    if (demo && !agentOpen) { setAgentOpen(true); return; }
    setAgentOpen(false);
    setRunning(true); setError('');
    try { await api.run(); markFit(false); await load(); go(PATHS.investors); }
    catch (err) { setError(err instanceof Error ? err.message : 'La corrida no pudo completarse'); }
    finally { setRunning(false); }
  };

  if (view === 'research' && (needsSetup || (!loading && !data))) return <div className="rs-standalone"><a href="/">← IGC Outreach</a><ResearchPage /></div>;
  if (needsSetup) return <Onboarding onFinished={() => { setLoading(true); setNeedsSetup(false); window.history.replaceState({}, '', '/'); applyRoute(readRoute()); }} />;
  if (loading) return <Splash />;
  if (!data) return <ConnectionError message={error} onRetry={load} />;

  const navigate = (next: View) => {
    if (next === 'fund' && dossierId) go(`/inversionistas/${encodeURIComponent(dossierId)}`);
    else if (next !== 'fund') go(PATHS[next]);
  };
  /** Clic en un fondo desde cualquier parte: módulo Inversionistas con su ficha en el panel lateral. */
  const openInvestor = (id: string) => go(investorsUrl(investorView, id));
  const selectInvestor = (id: string | null) => go(investorsUrl(investorView, id), true);
  const changeInvestorView = (next: ViewMode) => go(investorsUrl(next, selectedId));
  const openDossier = (id: string) => go(`/inversionistas/${encodeURIComponent(id)}`);
  const openProject = (tab: PmTab = 'overview') => go(tab === 'notifications' ? '/proyecto?panel=notificaciones' : '/proyecto');
  const founderName = demo ? demoOrgName() : ORG_NAME;
  const demoCfg = demo ? demoConfig() : null;
  const canRun = fitDirty || !data.latest_run_id;
  const runTitle = canRun ? 'Actualizar búsqueda: vuelve a rankear fondos con el fit actualizado' : 'Actualiza el fit en Configuración para habilitar una nueva búsqueda';

  /* Rail izquierdo: un ícono por página de la app. */
  const rail: { key: View; icon: typeof Activity; label: string; active: boolean }[] = [
    { key: 'overview', icon: House, label: 'Overview', active: view === 'overview' },
    { key: 'research', icon: Search, label: 'Encontrar oportunidades', active: view === 'research' },
    { key: 'investors', icon: Share2, label: 'Inversionistas', active: view === 'investors' || view === 'fund' },
    { key: 'pipeline', icon: SquareKanban, label: 'Pipeline', active: view === 'pipeline' },
    { key: 'project', icon: ListChecks, label: 'Project Management', active: view === 'project' },
  ];

  /* Pill de la ronda (equivalente al "On Meet" de la referencia). */
  const top = data.recommendations.slice(0, 3);
  const readyCount = data.readiness.filter((r) => r.ready).length;
  const progress = data.readiness.length ? 8 + (readyCount / data.readiness.length) * 84 : 8;
  const runId = data.latest_run_id || '';
  const runTime = /^\d{8}-\d{6}$/.test(runId) ? `${runId.slice(9, 11)}:${runId.slice(11, 13)}` : '--:--';
  const today = new Date().toLocaleDateString('es-CO', { month: 'long', day: 'numeric' });
  const todayLabel = today.replace(/^(\d+) de (\S+)/, (_m, d, m) => `${m[0].toUpperCase()}${m.slice(1)}, ${d}`);
  const q = query.trim().toLowerCase();
  const results = (q ? data.recommendations.filter((r) => r.name.toLowerCase().includes(q) || (r.people || []).some((p) => p.name.toLowerCase().includes(q))) : data.recommendations).slice(0, 7);

  return (
    <div className="app shell">
      <header className="shell-top">
        <button className="shell-logo" onClick={() => navigate('overview')} aria-label="IGC Outreach, ir al overview">
          <img src="/igc-outreach-logo.png" alt="IGC Outreach" width={181} height={60} />
        </button>
        <div className="round-pill">
          <span className="round-name" title={data.project.one_liner}>IGC</span>
          <span className="round-date"><CalendarDays size={17} strokeWidth={1.6} />{todayLabel}</span>
          <span className="round-sep" aria-hidden="true" />
          <div className="round-avatars" aria-label="Top 3 fondos">
            {top.map((rec, i) => <button key={rec.fund_id} onClick={() => openInvestor(rec.fund_id)} title={rec.name}><Avatar className={`tone-${i}`} name={rec.name} src={investorImage(rec)} /></button>)}
          </div>
          <div className="round-track" title={`Preparación de la ronda: ${readyCount}/${data.readiness.length} fuentes · última corrida ${runTime}`}>
            <span className="round-marker" style={{ left: `${progress}%` }}><b>{runTime}</b><i /></span>
          </div>
          <button className={`round-run ${running ? 'busy' : ''}`} onClick={run} disabled={running || !canRun} title={runTitle} aria-label="Actualizar búsqueda">
            {running ? <LoaderCircle className="spin" size={19} /> : <RefreshCw size={18} strokeWidth={2} />}
          </button>
          <button className="round-go" onClick={() => go(investorsUrl(investorView))} title="Explorar inversionistas" aria-label="Explorar inversionistas"><ArrowUpRight size={20} strokeWidth={1.6} /></button>
        </div>
        <div className="shell-actions" ref={menuRef}>
          <button className="ghost-circle" onClick={() => openProject('notifications')} title="Notificaciones" aria-label={`${data.stats.review_queue || 0} entidades por revisar`}>
            <Bell size={20} strokeWidth={1.5} />{data.stats.review_queue ? <i className="dot" /> : null}
          </button>
          <button className={`ghost-circle ${menu === 'search' ? 'on' : ''}`} onClick={() => setMenu(menu === 'search' ? null : 'search')} title="Buscar fondo" aria-label="Buscar fondo" aria-expanded={menu === 'search'}><Search size={20} strokeWidth={1.5} /></button>
          <button className={`ghost-circle ${menu === 'apps' ? 'on' : ''}`} onClick={() => setMenu(menu === 'apps' ? null : 'apps')} title="Módulos y tema" aria-label="Módulos y tema" aria-expanded={menu === 'apps'}><Grip size={20} strokeWidth={1.5} /></button>
          <span className="shell-divider" aria-hidden="true" />
          <button className={`user-pill ${menu === 'account' ? 'on' : ''}`} onClick={() => setMenu(menu === 'account' ? null : 'account')} aria-expanded={menu === 'account'} aria-label="Cambiar de cuenta">
            {demo && <em className="demo-tag">Demo</em>}<strong>{founderName}</strong><span className={`avatar ${demo ? 'demo' : ''}`}>{initials(founderName)}</span>
          </button>
          {menu === 'account' && (
            <div className="shell-pop account-pop" role="dialog" aria-label="Cuentas">
              <small>Cuentas</small>
              <button className={!demo ? 'on' : ''} onClick={() => !demo ? setMenu(null) : changeAccount('igc')}>
                <span className="avatar">{initials(ORG_NAME)}</span><span><strong>{ORG_NAME}</strong><small>Datos reales del motor</small></span>{!demo && <Check size={16} />}
              </button>
              <button className={demo ? 'on' : ''} onClick={() => demo ? setMenu(null) : changeAccount('demo')}>
                <span className="avatar demo">{demo ? initials(founderName) : 'CN'}</span><span><strong>{demo ? founderName : 'Cuenta nueva (demo)'}</strong><small>Todo simulado · empieza en ceros</small></span>{demo && <Check size={16} />}
              </button>
              {demo && <button className="account-reset" onClick={() => changeAccount('demo', true)}><RotateCcw size={15} /> Reiniciar demo desde cero</button>}
            </div>
          )}
          {menu === 'search' && (
            <div className="shell-pop search-pop" role="dialog" aria-label="Buscar fondo">
              <label><Search size={17} /><input autoFocus placeholder="Busca un fondo o socio…" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
              <ul>
                {results.map((rec) => <li key={rec.fund_id}><button onClick={() => openInvestor(rec.fund_id)}><Avatar name={rec.name} src={investorImage(rec)} /><span>{rec.name}</span><small>{pts(rec.score)} pts</small></button></li>)}
                {!results.length && <li className="empty">Sin coincidencias</li>}
              </ul>
            </div>
          )}
          {menu === 'apps' && (
            <div className="shell-pop apps-pop" role="dialog" aria-label="Módulos y tema">
              <div className="apps-grid">
                {[...rail.map(({ key, icon, label }) => ({ id: key, icon, label })), { id: 'settings' as View, icon: Settings, label: 'Configuración' }].map(({ id, icon: Icon, label }) => (
                  <button key={id} className={view === id || (id === 'investors' && view === 'fund') ? 'on' : ''} onClick={() => navigate(id)}><Icon size={20} strokeWidth={1.6} /><span>{label}</span></button>
                ))}
              </div>
              <div className="apps-theme">
                <span>Tema</span>
                <div className="theme-switch" role="group" aria-label="Tema">
                  <button className={theme === 'dark' ? 'on' : ''} onClick={() => setTheme('dark')} aria-label="Tema oscuro" aria-pressed={theme === 'dark'}><Moon size={17} strokeWidth={1.7} /></button>
                  <button className={theme === 'light' ? 'on' : ''} onClick={() => setTheme('light')} aria-label="Tema claro" aria-pressed={theme === 'light'}><Sun size={17} strokeWidth={1.7} /></button>
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      <aside className="rail" aria-label="Secciones">
        <nav className="rail-nav">
          {rail.map(({ key, icon: Icon, label, active }) => (
            <button key={key} className={`rail-btn ${active ? 'active' : ''}`} onClick={() => navigate(key)} data-label={label} aria-label={label} aria-current={active ? 'page' : undefined}>
              <Icon size={active ? 22 : 20} strokeWidth={active ? 2 : 1.5} fill={active && key === 'overview' ? 'currentColor' : 'none'} />
            </button>
          ))}
        </nav>
        <div className="rail-bottom">
          <button className={`rail-btn ${view === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')} data-label="Configuración" aria-label="Configuración" aria-current={view === 'settings' ? 'page' : undefined}><Settings size={view === 'settings' ? 22 : 20} strokeWidth={view === 'settings' ? 2 : 1.5} /></button>
          <button className={`rail-run ${running ? 'busy' : ''}`} onClick={run} disabled={running || !canRun} data-label={canRun ? 'Actualizar búsqueda' : 'Sin cambios en el fit'} aria-label="Actualizar búsqueda" title={runTitle}>
            {running ? <LoaderCircle className="spin" size={22} /> : <RefreshCw size={22} strokeWidth={1.8} />}
          </button>
        </div>
      </aside>

      {error && <div className="error-banner"><XCircle size={17} /><span>{error}</span><button onClick={() => setError('')}>Cerrar</button></div>}

      {agentOpen && demoCfg && <div className="ag-overlay"><AgentRun config={demoCfg} title={`Actualizar búsqueda para ${demoCfg.project.name}`} onClose={() => setAgentOpen(false)} onDone={() => void run()} /></div>}

      <main className="page">
        {view === 'research' && <ResearchPage />}
        {view === 'overview' && <Overview data={data} greetingName={founderName} onOpen={openInvestor} onNavigate={navigate} onRun={run} />}
        {view === 'investors' && <InvestorsModule data={data} selectedId={selectedId} onSelect={selectInvestor} onOpenDossier={openDossier} view={investorView} onViewChange={changeInvestorView} />}
        {view === 'fund' && dossierId && <FundDossier key={dossierId} data={data} fundId={dossierId} onBack={() => navigate('investors')} onOpen={openDossier} onReload={load} />}
        {view === 'pipeline' && <PipelineBoard data={data} onOpen={openDossier} onBack={() => navigate('investors')} onReload={load} />}
        {view === 'project' && <ProjectManagement data={data} orgName={founderName} tab={pmTab}
          onTab={openProject} onSettings={() => navigate('settings')} onOpen={openInvestor} onPipeline={() => navigate('pipeline')} />}
        {view === 'settings' && <SettingsPage onSaved={async () => { markFit(true); await load(); }} />}
      </main>
    </div>
  );
}

/* ───────────────────────── Overview ───────────────────────── */

function Overview({ data, greetingName, onOpen, onNavigate, onRun }: { data: Dashboard; greetingName: string; onOpen: (id: string) => void; onNavigate: (v: View) => void; onRun: () => void }) {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  const dateLabel = now.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'short' }).replace('.', '').toUpperCase();
  const recs = data.recommendations;
  const warm = recs.filter((rec) => rec.best_path).length;
  const ready = data.readiness.filter((item) => item.ready).length;
  const analyzed = Math.max(data.stats.fund_profile || 0, recs.length);
  const [spotId, setSpotId] = useState<string | null>(null);
  const locate = (id: string) => {
    setSpotId(id);
    const card = document.querySelector('.atlas-card');
    if (card) { const r = card.getBoundingClientRect(); if (r.top < 0 || r.bottom > window.innerHeight) card.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  };

  return (
    <div className="bento">
      <section className="card hero-card">
        <div className="hero-inner">
        <div className="hero-copy">
          <span className="hero-date">{dateLabel}</span>
          <h1>{greeting}, {greetingName}</h1>
          <p>Esto es lo que está pasando en tu ronda hoy.</p>
        </div>
        <div className="hero-kpis">
          <Kpi label="Fondos analizados" value={num(analyzed)} chip={`${recs.length} en top`} tone="blue" />
          <Kpi label="Rutas cálidas" value={num(warm)} chip={`${recs.length ? Math.round(warm / recs.length * 100) : 0}% del top`} tone="gold" />
          <Kpi label="Relaciones" value={num(data.stats.edges)} chip={`${num(data.stats.interactions)} privadas`} tone="black" />
          <Kpi label="Preparación" value={`${ready}/${data.readiness.length}`} chip="fuentes" tone="gray" />
        </div>
        </div>
      </section>
      <ActivityTimeline data={data} onOpen={onOpen} onNavigate={onNavigate} />
      <InvestorFlow data={data} onSelect={onOpen} onExplore={() => onNavigate('investors')} focusId={spotId} />
      <Leaderboard recs={recs} onOpen={locate} activeId={spotId} onRun={onRun} />
    </div>
  );
}

function Kpi({ label, value, chip, tone }: { label: string; value: string; chip: string; tone: 'blue' | 'gold' | 'black' | 'gray' }) {
  return <div className="kpi"><span>{label}</span><div><strong>{value}</strong><em className={`chip ${tone}`}>{chip}</em></div></div>;
}

function ActivityTimeline({ data, onOpen, onNavigate }: { data: Dashboard; onOpen: (id: string) => void; onNavigate: (v: View) => void }) {
  const steps = useMemo(() => buildSteps(data), [data]);
  const [done, setDone] = useState<string[]>(readDone);
  const toggle = (id: string) => {
    const next = done.includes(id) ? done.filter((d) => d !== id) : [...done, id];
    setDone(next);
    writeDone(next);
  };
  const pending = steps.filter((s) => !done.includes(s.id));
  const visible = [...pending, ...steps.filter((s) => done.includes(s.id))];

  return (
    <section className="card timeline-card steps-card">
      <div className="timeline-accent" aria-hidden="true" />
      <CardHead title="Próximos pasos"><span className="steps-count">{pending.length} pendientes</span></CardHead>
      <ul className="timeline-list steps-list">
        {visible.map((step) => {
          const isDone = done.includes(step.id);
          return (
            <li key={step.id} className={isDone ? 'done' : ''}>
              <button className={`step-check ${step.kind}`} onClick={() => toggle(step.id)} aria-pressed={isDone} aria-label={isDone ? 'Marcar como pendiente' : 'Marcar como hecho'}>{isDone && <Check size={13} strokeWidth={3} />}</button>
              <div>
                <p className="step-title" title={step.detail}>{step.title}</p>
                <div className="timeline-meta">
                  <span className={`step-kind ${step.kind}`}>{STEP_LABEL[step.kind]}</span>
                  <span className="step-when">{weekLabel(step.week)}</span>
                  {step.fundId
                    ? <button className="who" onClick={() => onOpen(step.fundId!)}><i>{initials(step.who)}</i>{step.fundName}</button>
                    : <button className="who" onClick={() => onNavigate('investors')}><i>{initials(step.who)}</i>Ver shortlist</button>}
                </div>
              </div>
            </li>
          );
        })}
        {!steps.length && <li className="timeline-empty">Ejecuta el ranking para generar tu plan de calentamiento.</li>}
      </ul>
    </section>
  );
}

const leaderSorts: { id: 'score' | FactorKey; label: string }[] = [
  { id: 'score', label: 'Score total' }, { id: 'path', label: 'Warm path' }, { id: 'thesis', label: 'Tesis' },
  { id: 'seed', label: 'Comparables' }, { id: 'coinvest', label: 'Co-inversión' }, { id: 'activity', label: 'Actividad' },
];
function Leaderboard({ recs, onOpen, onRun, activeId }: { recs: Recommendation[]; onOpen: (id: string) => void; onRun: () => void; activeId?: string | null }) {
  const [sort, setSort] = useState<'score' | FactorKey>('score');
  const value = (rec: Recommendation) => sort === 'score' ? rec.score : rec.factors[sort] || 0;
  const ranked = [...recs].sort((a, b) => value(b) - value(a));
  const podium = [ranked[2], ranked[0], ranked[1]];
  return (
    <section className="card leader-card">
        <CardHead title="Leaderboard">
          <label className="select-pill">
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Ordenar leaderboard">
              {leaderSorts.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
            <ChevronDown size={16} />
          </label>
        </CardHead>
        {ranked.length ? <>
          <div className="podium">
            {podium.map((rec, index) => rec ? (
              <button key={rec.fund_id} className={`podium-slot p${[3, 1, 2][index]} ${activeId === rec.fund_id ? 'located' : ''}`} onClick={() => onOpen(rec.fund_id)} title="Ubicar en el mapa">
                <Avatar className="podium-avatar" name={rec.name} src={investorImage(rec)}><b>{[3, 1, 2][index]}</b></Avatar>
                <strong>{rec.name}</strong>
                <small>{pts(value(rec))} pts</small>
              </button>
            ) : <span key={index} />)}
          </div>
          <ol className="leader-list" start={4}>
            {ranked.slice(3, 9).map((rec, index) => (
              <li key={rec.fund_id}>
                <button onClick={() => onOpen(rec.fund_id)} className={activeId === rec.fund_id ? 'located' : ''} title="Ubicar en el mapa">
                  <b>{index + 4}</b><Avatar className={`tone-${index % 3}`} name={rec.name} src={investorImage(rec)} /><span>{rec.name}</span><small>{pts(value(rec))} pts</small>
                </button>
              </li>
            ))}
          </ol>
        </> : <EmptyCompact onRun={onRun} />}
    </section>
  );
}

/* ───────────────────────── Inversionistas ───────────────────────── */

/* ───────────────────────── Pipeline ───────────────────────── */

function Pipeline({ data, onNavigate, onOpen }: { data: Dashboard; onNavigate: (v: View) => void; onOpen: (id: string) => void }) {
  const stages = ['intro_pedida', 'intro_aceptada', 'reunion', 'dd', 'term_sheet'];
  const counts = Object.fromEntries(data.outcomes.map((item) => [item.stage, item.count]));
  return <><PageHead eyebrow="Fundraising pipeline" title="De shortlist a term sheet" copy="Registra resultados para aprender qué señales predicen una introducción exitosa." />
    <section className="pipeline-board">{stages.map((stage, index) => <article key={stage}><header><span>{String(index + 1).padStart(2, '0')}</span><h2>{outcomeLabels[stage]}</h2><b>{counts[stage] || 0}</b></header><div className="stage-body">{data.recommendations.filter((rec) => rec.outcome_stage === stage).map((rec) => <button className="deal-card" key={rec.fund_id} onClick={() => onOpen(rec.fund_id)}><div><i>{initials(rec.name)}</i><strong>{rec.name}</strong></div><span>Score {Math.round(rec.score * 100)}</span></button>)}{!counts[stage] && <div className="stage-empty">Sin fondos en esta etapa</div>}</div></article>)}</section>
    {!data.outcomes.length && <div className="pipeline-hint"><Activity size={20} /><div><strong>El pipeline aprende contigo</strong><p>Abre un inversionista, registra cada avance y luego usa el backtest para evaluar el ranking.</p></div><button onClick={() => onNavigate('investors')}>Ir al shortlist <ArrowRight size={15} /></button></div>}
  </>;
}

/* ───────────────────────── Utilidades ───────────────────────── */

function EmptyCompact({ onRun }: { onRun: () => void }) { return <div className="empty-compact"><Target size={24} /><strong>Sin ranking todavía</strong><span>Ejecuta el motor para generar el top 20.</span><button onClick={onRun}>Empezar análisis</button></div>; }
function Splash({ compact = false }: { compact?: boolean }) { return <div className={`splash ${compact ? 'compact' : ''}`}><img src="/igc-outreach-mark.png" alt="" width={44} height={44} /><LoaderCircle className="spin" size={20} /><span>Cargando inteligencia…</span></div>; }
function ConnectionError({ message, onRetry }: { message: string; onRetry: () => void }) { return <div className="connection-error"><div><XCircle size={30} /></div><h1>No pudimos conectar con el motor</h1><p>{message}</p><code>cd backend && warmpath-api</code><button onClick={onRetry}><RefreshCw size={16} /> Reintentar</button></div>; }
export function formatRun(id: string) { if (!/^\d{8}-\d{6}$/.test(id)) return id; const d = new Date(Number(id.slice(0, 4)), Number(id.slice(4, 6)) - 1, Number(id.slice(6, 8)), Number(id.slice(9, 11)), Number(id.slice(11, 13))); return `${d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }).replace('.', '')} · ${id.slice(9, 11)}:${id.slice(11, 13)}`; }
