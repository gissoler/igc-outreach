/* App root: session, hash routes, workspace and the isolated demo. */
import { Play } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { accountApi, browserKey, resetBrowserKey, type AccountSession, type NetworkGraphData } from '../accountApi';
import { LiveAgentRun } from '../LiveAgentRun';
import type { Job } from '../researchApi';
import { demoJob, demoNetwork } from './demoData';
import { OutreachView, type OutreachTab } from './Outreach';
import { EvaluationDashboard } from './Evaluation';
import { OnboardingWorkspace, SECTIONS, type SectionId } from './Onboarding';
import { briefFor, type Profile } from './profile';
import { AccountMenu, AppShell, IntegrationsDrawer, PageHeader, type NavKey, type SearchItem } from './Shell';
import { useResearch } from './useResearch';
import { conversationStages, runStages } from './stages';
import type { IntakeState } from '../accountApi';
import { DemoRibbon, EmptyState, ErrorState, SkeletonState } from './ui';
import './app.css';
import './plan.css';
import './theme.css';

type Route = { demo: boolean; view: NavKey; section: SectionId; lead: string | null; tab: OutreachTab };
const OUTREACH_TABS: OutreachTab[] = ['pipeline', 'analisis', 'reunion'];
/* Internal keys stay stable; the URL shows English slugs (old Spanish links still work). */
const SLUG: Record<string, string> = { evaluacion: 'evaluation', analisis: 'analysis', red: 'network', ejecucion: 'runs', configuracion: 'setup', asistente: 'assistant', empresa: 'company', producto: 'product', objetivo: 'goal', evidencia: 'documents', revision: 'review', asesor: 'advisor', momento: 'momentum', acercamientos: 'outreach', reunion: 'meeting' };
const VIEWS = ['evaluacion', 'ejecucion', 'configuracion', 'acercamientos'];
const UNSLUG = Object.fromEntries(Object.entries(SLUG).map(([k, v]) => [v, k]));
const toEnglish = (hash: string) => hash.replace(/^(#\/?)([^?]*)/, (_m, pre: string, path: string) => pre + path.split('/').map((p) => SLUG[p] || p).join('/'));
function parse(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean).map((p) => UNSLUG[p] || p);
  const demo = parts[0] === 'demo';
  const rest = demo ? parts.slice(1) : parts;
  // Old analysis sub-tabs for outreach and meeting prep now live in the Outreach module.
  if (rest[0] === 'analisis' && (rest[1] === 'acercamientos' || rest[1] === 'reunion')) rest.splice(0, 2, 'acercamientos', rest[1] === 'reunion' ? 'reunion' : 'pipeline');
  // Analysis now lives inside Outreach; the old Network module was removed (its links open the evaluation).
  else if (rest[0] === 'analisis') rest.splice(0, 1, 'acercamientos', 'analisis');
  const view = (VIEWS.includes(rest[0]) ? rest[0] : 'evaluacion') as NavKey;
  const tab = (OUTREACH_TABS.includes(rest[1] as OutreachTab) ? rest[1] : 'pipeline') as OutreachTab;
  const section = (SECTIONS.some((s) => s.id === rest[1]) ? rest[1] : 'asistente') as SectionId;
  const lead = new URLSearchParams(query).get('lead');
  return { demo, view, section, lead, tab };
}
function useRoute() {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const f = () => { if (/^#\/?signin/.test(window.location.hash)) history.replaceState(null, '', '#/evaluacion'); const en = toEnglish(window.location.hash); if (en !== window.location.hash) history.replaceState(null, '', en); setRoute(parse(en)); };
    f(); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f);
  }, []);
  const go = useCallback((raw: string) => { const hash = toEnglish(raw); if (window.location.hash !== hash) window.location.hash = hash; else setRoute(parse(hash)); }, []);
  return [route, go] as const;
}
const href = (r: Partial<Route> & { demo: boolean }) => `#/${r.demo ? 'demo/' : ''}${r.view || 'evaluacion'}${r.view === 'configuracion' ? `/${r.section || 'asistente'}` : ''}${r.lead ? `?lead=${encodeURIComponent(r.lead)}` : ''}`;
const leadItems = (job: Job | null, open: (id: string) => void): SearchItem[] => (job?.leads || []).map((l) => ({ id: `lead:${l.id}`, label: l.person || l.org, sub: l.person ? `${l.role || ''} · ${l.org}` : l.title, group: 'Candidates', onSelect: () => open(l.id) }));

export function App() {
  const [session, setSession] = useState<AccountSession | null | undefined>(undefined);
  const [route, go] = useRoute();
  const [bootError, setBootError] = useState('');
  /* There is no sign-in. The browser keeps a random key and opens its own workspace automatically. */
  const openBrowser = useCallback(() => { setBootError(''); return accountApi.browser(browserKey()).then(setSession).catch((e: unknown) => {
    // If this shows up, the research server is usually an old process without /auth/browser: restart it.
    setBootError(`Couldn't open your workspace (${e instanceof Error ? e.message : 'server error'}). Check that the research server is running and try again.`);
  }); }, []);
  useEffect(() => { void accountApi.me().then((s) => (s.user.browser ? setSession(s) : openBrowser())).catch(() => openBrowser()); }, [openBrowser]);
  const startOver = useCallback(async () => {
    try { await accountApi.logout(); } catch { /* already closed */ }
    try { sessionStorage.removeItem('igc-research-job'); } catch { /* no storage */ }
    resetBrowserKey(); setSession(undefined); go('#/configuracion/asistente'); void openBrowser();
  }, [go, openBrowser]);

  if (route.demo) return <DemoApp route={route} go={go} session={session || null} />;
  if (bootError) return <div className="x-splash"><ErrorState message={bootError} onRetry={() => { setSession(undefined); void openBrowser(); }} /></div>;
  if (!session) return <div className="x-splash"><SkeletonState variant="dashboard" rows={4} label="Loading your workspace…" /></div>;
  return <Workspace key={session.user.id} session={session} setSession={setSession} route={route} go={go} logout={startOver} />;
}

function RunsPage({ children, onBack }: { children: React.ReactNode; onBack?: () => void }) {
  return <div className="pl-page"><PageHeader crumb="Workspace" title="Runs" actions={onBack && <button className="x-btn sm" onClick={onBack}>Back to evaluation</button>} />{children}</div>;
}

function Workspace({ session, setSession, route, go, logout }: { session: AccountSession; setSession: (s: AccountSession) => void; route: Route; go: (h: string) => void; logout: () => Promise<void> }) {
  const research = useResearch(session.user.id);
  const [account, setAccount] = useState<NetworkGraphData | null>(null);
  const [integrations, setIntegrations] = useState(false);
  const [intake, setIntake] = useState<IntakeState | null>(null);
  const complete = Boolean(session.profile?.onboardingComplete);
  const loadAccount = useCallback(() => { void accountApi.networkGraph().then(setAccount).catch(() => setAccount(null)); }, []);
  useEffect(loadAccount, [loadAccount, session.profile?.linkedin_interactions?.updatedAt]);
  const view: NavKey = complete ? route.view : 'configuracion';
  const nav = useCallback((k: NavKey) => go(href({ demo: false, view: k, section: route.section })), [go, route.section]);
  const newEval = () => go('#/configuracion/asistente');
  const onDone = async (p: Profile, run: boolean) => {
    if (run) { const id = await research.start(briefFor(p)); if (id) go('#/ejecucion'); else go('#/configuracion/asistente'); }
    else go('#/evaluacion');
  };
  const job = research.job;
  const items = useMemo(() => leadItems(job, (id) => go(href({ demo: false, view: 'evaluacion', lead: id }))), [job, go]);
  const menu = <AccountMenu session={session} onNavigate={go} onIntegrations={() => setIntegrations(true)} onLogout={() => void logout()} />;
  const actions = complete && <button className="x-btn primary sm" onClick={newEval} disabled={research.running}><Play size={13} /> New evaluation</button>;

  let body;
  if (view === 'configuracion') body = <OnboardingWorkspace session={session} section={route.section} onDone={(p, run) => void onDone(p, run)} onSession={(s) => { setSession(s); }} onIntake={setIntake} onBack={() => go('#/configuracion/asistente')} />;
  else if (view === 'ejecucion') body = <RunsPage onBack={job && !research.running ? () => go('#/evaluacion') : undefined}>{!research.jobId ? <EmptyState title="No runs yet" action={<button className="x-btn primary" onClick={newEval}>Open the conversation</button>}>Each run shows every source it queried, live.</EmptyState>
    : <div className="run-wrap"><LiveAgentRun jobId={research.jobId} events={research.events} jobStatus={job?.status || null} brief={job?.brief || briefFor(session.profile as Profile)} connection={research.connection} structured={!job || !!job.run || research.events.length > 0} legacy={job?.events} error={research.error} onRetry={research.retry}
      onShowResults={job && !research.running ? () => go('#/evaluacion') : undefined} onStop={research.running ? () => void research.stop() : undefined} stopping={research.stopping} startAtEnd={!research.running}
      actions={research.running ? [] : [{ label: 'Run again with the same profile', icon: <Play size={14} />, onClick: () => void research.start(briefFor(session.profile as Profile)) }]} busy={research.starting} demo={job?.mode === 'demo'} variant="live" /></div>}</RunsPage>;
  else if (view === 'acercamientos') body = <OutreachView job={job} defaultProfile={analysisProfile(job?.brief || (session.profile ? briefFor(session.profile as Profile) : null))} tab={route.tab} onTab={(t) => go(`#/acercamientos/${t}`)} onOpenLead={(id) => go(href({ demo: false, view: 'evaluacion', lead: id }))} />;
  else body = research.history === null || (research.loading && !job) ? <SkeletonState variant="dashboard" rows={5} label="Loading evaluation…" />
    : research.error && !job ? <ErrorState message={research.error} onRetry={research.retry} />
    : !job ? <div className="pl-page"><PageHeader crumb="Workspace" title="Evaluation" /><EmptyState title="No evaluations yet" action={<><button className="x-btn primary" onClick={newEval}><Play size={15} /> Start in the conversation</button><button className="x-btn" onClick={() => go('#/demo')}>Open demo</button></>}>Your profile is ready. Nothing runs or spends credit until you start it.</EmptyState></div>
    : <EvaluationDashboard job={job} history={research.history} account={account} onSelectJob={(id) => { research.select(id); go('#/evaluacion'); }} onFeedback={research.feedback} onGo={(t) => go(t === 'network' ? '#/configuracion/red' : t === 'setup' ? '#/configuracion/asistente' : '#/evaluacion')} onOpenRun={() => go('#/ejecucion')} onOpenAdvisor={() => go('#/acercamientos/analisis')} onStartBrief={(brief) => { void research.start(brief).then((id) => { if (id) go('#/ejecucion'); }); }} selectedLeadId={route.lead} onSelectLead={(id) => go(href({ demo: false, view: 'evaluacion', lead: id }))} />;

  // Sidebar: the step the tool is really on. Conversation → intake state; research → live run events; results → final run state.
  const runEvents = research.events.length ? research.events : job?.run?.events || [];
  const rail = view === 'configuracion' && !research.running ? { title: 'Conversation', stages: conversationStages(intake) }
    : job ? { title: research.running ? 'Research in progress' : `Last research · ${job.status === 'partial' ? 'with warnings' : job.status}`, stages: runStages(runEvents, research.running ? 'running' : job.status) }
      : null;
  return <AppShell active={view} onNav={nav} disabled={complete ? [] : ['evaluacion', 'ejecucion', 'acercamientos']} account={menu} actions={actions} running={research.running} searchItems={items} onIntegrations={() => setIntegrations(true)} onHelp={() => go('#/demo')} rail={rail}>
    {research.running && view !== 'ejecucion' && <div className="x-banner"><span className="sh-live" /> Evaluation running. <button className="x-link-btn" onClick={() => go('#/ejecucion')}>Watch live</button></div>}
    {body}
    <IntegrationsDrawer open={integrations} onClose={() => setIntegrations(false)} />
  </AppShell>;
}

/* Profile text for the revealed thesis: sector, stage, geography and product. */
function analysisProfile(b: Job['brief'] | null): string {
  if (!b) return '';
  return [b.stage, b.industry, b.geography, b.product, b.description].filter(Boolean).join(' · ').slice(0, 1200);
}

/* ───────── Demo: no server, no account, no mixing ───────── */
function DemoApp({ route, go, session }: { route: Route; go: (h: string) => void; session: AccountSession | null }) {
  const job = useMemo(() => demoJob(), []);
  const account = useMemo(() => demoNetwork(), []);
  const [integrations, setIntegrations] = useState(false);
  const [feedback, setFeedback] = useState(job);
  const view = route.view === 'configuracion' || route.view === 'acercamientos' ? 'evaluacion' : route.view;
  const menu = <AccountMenu session={session} demo onNavigate={go} onIntegrations={() => setIntegrations(true)} onLogout={() => go('#/evaluacion')} />;
  const localFeedback = async (id: string, decision: 'approve' | 'reject', reason: string, note: string) => {
    const value = { decision, reason: decision === 'approve' ? 'relevant' : reason, note, at: new Date().toISOString() };
    setFeedback((j) => ({ ...j, leads: j.leads.map((l) => (l.id === id ? { ...l, feedback: value } : l)) }));
    return value;
  };
  const items = useMemo(() => leadItems(feedback, (id) => go(href({ demo: true, view: 'evaluacion', lead: id }))), [feedback, go]);
  let body;
  if (view === 'ejecucion') body = <RunsPage onBack={() => go('#/demo/evaluacion')}><div className="run-wrap"><DemoRibbon /><LiveAgentRun jobId={job.id} events={job.run!.events} jobStatus={job.status} brief={job.brief} connection="closed" structured onShowResults={() => go('#/demo/evaluacion')} demo variant="live" startAtEnd={false} actions={[]} /></div></RunsPage>;
  else body = <EvaluationDashboard job={feedback} history={null} account={account} onFeedback={localFeedback} onGo={() => undefined} onOpenRun={() => go('#/demo/ejecucion')} selectedLeadId={route.lead} onSelectLead={(id) => go(href({ demo: true, view: 'evaluacion', lead: id }))} />;
  return <AppShell demo active={view} onNav={(k) => go(href({ demo: true, view: k }))} account={menu} searchItems={items} onIntegrations={() => setIntegrations(true)} onHelp={() => go('#/evaluacion')} actions={<a className="x-btn sm" href="#/evaluacion">{session ? 'Back to my workspace' : 'Start my own'}</a>}>
    {body}
    <IntegrationsDrawer open={integrations} onClose={() => setIntegrations(false)} demo />
  </AppShell>;
}
