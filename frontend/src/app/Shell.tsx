import { Activity, Building2, Check, ChevronDown, ChevronRight, CircleHelp, Eye, FlaskConical, LayoutDashboard, LoaderCircle, Lock, LogOut, Mail, Menu, Network, PanelLeftClose, PanelLeftOpen, Play, Plug, Plus, Search, Send, Settings, ShieldCheck, SlidersHorizontal, Telescope, UserPen, UserRound, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { accountApi, type AccountConnector, type AccountSession, type AccountSource } from '../accountApi';
import { fmtDateTime, fmtInt, initials } from './format';
import { Drawer, ErrorState, SkeletonState } from './ui';

/* ───────── Workspaces known in this browser (each company = one isolated account) ───────── */
export type KnownWorkspace = { userId: string; email: string; name: string; company: string; lastUsed: string };
const KNOWN = 'igc-known-workspaces';
export const knownWorkspaces = (): KnownWorkspace[] => { try { const v = JSON.parse(localStorage.getItem(KNOWN) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
export function rememberWorkspace(s: AccountSession) {
  const company = s.profile ? (s.profile.project.venture && s.profile.project.venture !== s.profile.founder.org ? `${s.profile.project.venture} · via ${s.profile.founder.org}` : s.profile.founder.org || s.profile.project.venture || '') : '';
  const list = knownWorkspaces().filter((w) => w.userId !== s.user.id);
  list.unshift({ userId: s.user.id, email: s.user.email, name: s.user.name, company: company || 'Company not set up', lastUsed: new Date().toISOString() });
  try { localStorage.setItem(KNOWN, JSON.stringify(list.slice(0, 8))); } catch { /* no storage */ }
}
export const forgetWorkspace = (userId: string) => { try { localStorage.setItem(KNOWN, JSON.stringify(knownWorkspaces().filter((w) => w.userId !== userId))); } catch { /* no storage */ } };
export const companyOf = (s: AccountSession | null) => !s?.profile ? 'Company not set up' : s.profile.project.venture && s.profile.project.venture !== s.profile.founder.org ? `${s.profile.project.venture}` : s.profile.founder.org || s.profile.project.venture || 'Company';

export function Brand({ compact = false }: { compact?: boolean }) {
  return <span className="sh-brand"><img src="/igc-outreach-mark.png" alt="" width={26} height={26} />{!compact && <b>IGC Outreach</b>}</span>;
}

/* ───────── Page header (the only breadcrumb on the page) ───────── */
export function PageHeader({ crumb, title, badge, meta, actions, children }: { crumb?: ReactNode; title: ReactNode; badge?: ReactNode; meta?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return <header className="ph">
    {crumb && <span className="ph-crumb">{crumb}</span>}
    <div className="ph-row"><div className="ph-title"><h1>{title}</h1>{badge}</div>{actions && <div className="ph-actions">{actions}</div>}</div>
    {meta && <p className="ph-meta">{meta}</p>}
    {children}
  </header>;
}

/* ───────── Account menu ───────── */
export function AccountMenu({ session, onNavigate, onSwitch, onIntegrations, onLogout, demo }: { session: AccountSession | null; onNavigate: (hash: string) => void; onSwitch: () => void; onIntegrations: () => void; onLogout: () => void; demo?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    window.setTimeout(() => menu.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus(), 10);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const onKey = (e: KeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role=menuitem]') || [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { setOpen(false); ref.current?.querySelector<HTMLElement>('button')?.focus(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
  };
  const act = (fn: () => void) => () => { setOpen(false); fn(); };
  const name = demo ? 'Ana Ríos (demo)' : (session?.user.browser ? session?.profile?.founder.name : session?.user.name) || session?.user.name || 'Guest';
  const role = demo ? 'CEO · fictional' : session?.profile?.founder.title || 'Role not set';
  const company = demo ? 'Lumen Neuro (demo)' : companyOf(session);
  return <div className="am" ref={ref} onKeyDown={onKey}>
    <button className="am-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} aria-label={`Account: ${name}`}><span className="am-av" aria-hidden="true">{initials(name)}</span><ChevronDown size={14} aria-hidden="true" /></button>
    {open && <div className="am-menu" role="menu" ref={menu} aria-label="Account menu">
      <div className="am-head"><span className="am-av lg" aria-hidden="true">{initials(name)}</span><div><b>{name}</b><small>{demo ? 'No account · demo data' : session?.user.browser ? 'Saved in this browser · no login' : session?.user.email}</small><span className="am-meta"><Building2 size={12} /> {company}</span><span className="am-meta"><UserRound size={12} /> {role}</span></div></div>
      {!session?.user.browser && <button role="menuitem" onClick={act(onSwitch)}><Building2 size={15} /> Switch workspace</button>}
      {!demo && <button role="menuitem" onClick={act(() => onNavigate('#/configuracion/empresa'))}><UserPen size={15} /> Edit profile</button>}
      {!demo && <button role="menuitem" onClick={act(() => onNavigate('#/configuracion/revision'))}><Settings size={15} /> Settings</button>}
      <button role="menuitem" onClick={act(onIntegrations)}><Plug size={15} /> Integrations</button>
      {!demo ? <button role="menuitem" onClick={act(() => onNavigate('#/demo'))}><FlaskConical size={15} /> Open demo</button> : <button role="menuitem" onClick={act(() => onNavigate('#/evaluacion'))}><LayoutDashboard size={15} /> Leave demo</button>}
      {!demo && <button role="menuitem" className="danger" onClick={act(onLogout)} title={session?.user.browser ? 'Forget this browser’s workspace and start an empty one' : undefined}><LogOut size={15} /> {session?.user.browser ? 'Start over' : 'Sign out'}</button>}
    </div>}
  </div>;
}

/* ───────── Workspace switcher ───────── */
export function WorkspaceSwitcher({ open, onClose, session, onSwitchTo, onNew, onDemo, demo }: { open: boolean; onClose: () => void; session: AccountSession | null; onSwitchTo: (w: KnownWorkspace) => void; onNew: () => void; onDemo: () => void; demo?: boolean }) {
  const list = knownWorkspaces();
  const [confirm, setConfirm] = useState<KnownWorkspace | null>(null);
  return <Drawer open={open} onClose={onClose} title="Switch workspace" subtitle="Each company is a separate account. Data never mixes." width={480}>
    <ul className="ws-list">
      {demo && <li className="on"><span className="am-av" aria-hidden="true">LN</span><span><b>Lumen Neuro (demo)</b><small>Fictional data</small></span><span className="x-chip ok"><Check size={12} /> Active</span></li>}
      {list.map((w) => { const active = !demo && w.userId === session?.user.id; return <li key={w.userId} className={active ? 'on' : ''}>
        <span className="am-av" aria-hidden="true">{initials(w.company)}</span><span><b>{w.company}</b><small>{w.email} · {fmtDateTime(w.lastUsed)}</small></span>
        {active ? <span className="x-chip ok"><Check size={12} /> Active</span> : <button className="x-btn sm" onClick={() => setConfirm(w)}>Switch</button>}
      </li>; })}
      {!list.length && !demo && <li className="x-muted">No other workspaces in this browser.</li>}
    </ul>
    {confirm && <div className="x-callout" role="alertdialog" aria-label="Confirm switch"><b>Switch to {confirm.company}?</b><span>You'll sign in again as {confirm.email}.</span><div className="x-row"><button className="x-btn primary" onClick={() => onSwitchTo(confirm)}>Switch and sign in</button><button className="x-btn" onClick={() => setConfirm(null)}>Cancel</button></div></div>}
    <div className="ws-actions">
      <button className="x-btn" onClick={onNew}><Plus size={15} /> Add a company</button>
      {!demo && <button className="x-btn" onClick={onDemo}><FlaskConical size={15} /> Open demo</button>}
    </div>
  </Drawer>;
}

/* ───────── Integrations ───────── */
type Health = { status: string; providers: Record<string, string> };
const PROVIDER_LABEL: Record<string, [string, string]> = {
  openalex: ['Publications', 'Who publishes on your topic (OpenAlex)'], clinicalTrials: ['Clinical trials', 'Trial sponsors in your area'],
  grants: ['Public grants', 'Open federal grants (Grants.gov)'], reporter: ['Funded projects', 'NIH projects and program officers'],
  exa: ['Web search', 'Funds, partners and news (Exa · paid)'], rounds: ['Funding rounds', 'Who led similar rounds'],
  web: ['Broad web search', 'Unverified leads (Serper · paid)'], people: ['People on the web', 'Who to contact at each org (paid)'],
  linkedin: ['Your LinkedIn', 'People who appear with you online'], jev: ['AI second opinion', 'Checks evidence before prioritizing (Jev)'], intakeModel: ['Profile assistant', 'Fills your profile from what you share'],
};
const stateOf = (v: string) => /pendiente|sin |falta|missing|not set|pending|no model/i.test(v) ? 'not_configured' : 'ok';
export function IntegrationsDrawer({ open, onClose, demo }: { open: boolean; onClose: () => void; demo?: boolean }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [connectors, setConnectors] = useState<Record<string, AccountConnector> | null>(null);
  const [sources, setSources] = useState<AccountSource[] | null>(null);
  const [error, setError] = useState('');
  const load = () => {
    setError('');
    void fetch('/api/research/health').then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))).then(setHealth).catch((e) => setError(e instanceof Error ? e.message : 'Research server unavailable'));
    if (!demo) { void accountApi.connectors().then(setConnectors).catch(() => setConnectors({})); void accountApi.sources().then(setSources).catch(() => setSources([])); }
  };
  useEffect(() => { if (open) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);
  return <Drawer open={open} onClose={onClose} title="Integrations" subtitle="Active sources and which ones are paid" width={640}>
    {error && <ErrorState title="Couldn't reach the research server" message={`${error}. Run "npm --prefix research start".`} onRetry={load} />}
    {!health && !error ? <SkeletonState rows={6} /> : health && <table className="x-table"><thead><tr><th scope="col">Source</th><th scope="col">Used for</th><th scope="col">Status</th></tr></thead><tbody>{Object.entries(health.providers).map(([k, v]) => <tr key={k}><th scope="row">{PROVIDER_LABEL[k]?.[0] || k}</th><td>{PROVIDER_LABEL[k]?.[1] || ''}</td><td><span className={`x-state ${stateOf(v)}`} title={v}>{stateOf(v) === 'ok' ? <Check size={12} /> : <Lock size={12} />}{stateOf(v) === 'ok' ? (/p[uú]blic/.test(v) ? 'Active · free' : 'Active') : 'Off'}</span></td></tr>)}</tbody></table>}
    {!demo && <><h3 className="x-h3">Your account sources</h3>{sources === null ? <SkeletonState rows={2} /> : sources.length ? <table className="x-table"><tbody>{sources.map((s) => <tr key={s.source}><th scope="row">{s.source}</th><td className="num">{fmtInt(s.count)} records</td><td>{fmtDateTime(s.updatedAt)}</td></tr>)}</tbody></table> : <p className="x-muted">No contacts or public activity connected yet.</p>}
      {connectors && <p className="x-muted">Upload contacts from Setup → Network.</p>}</>}
    <details className="x-tech"><summary>Technical detail</summary>Keys live in <code>research/.env</code> on the server; the browser never sees them. Current values: {health ? Object.entries(health.providers).map(([k, v]) => `${k}: ${v}`).join(' · ') : '—'}</details>
  </Drawer>;
}

/* ───────── Shell: sidebar + top bar ───────── */
export type NavKey = 'evaluacion' | 'analisis' | 'red' | 'ejecucion' | 'configuracion' | 'acercamientos';
export type SearchItem = { id: string; label: string; sub?: string; group: string; onSelect: () => void };
const NAV: { key: NavKey; label: string; icon: ReactNode }[] = [
  { key: 'configuracion', label: 'Setup', icon: <SlidersHorizontal size={17} strokeWidth={1.6} /> },
  { key: 'ejecucion', label: 'Runs', icon: <Activity size={17} strokeWidth={1.6} /> },
  { key: 'analisis', label: 'Analysis', icon: <Telescope size={17} strokeWidth={1.6} /> },
  { key: 'evaluacion', label: 'Evaluation', icon: <LayoutDashboard size={17} strokeWidth={1.6} /> },
  { key: 'red', label: 'Network', icon: <Network size={17} strokeWidth={1.6} /> },
  { key: 'acercamientos', label: 'Outreach', icon: <Send size={17} strokeWidth={1.6} /> },
];

function CommandSearch({ items, onNav }: { items: SearchItem[]; onNav: (k: NavKey) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = (e: globalThis.KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.current?.focus(); setOpen(true); } };
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', key); document.addEventListener('mousedown', close);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('mousedown', close); };
  }, []);
  const all = useMemo<SearchItem[]>(() => [...NAV.map((n) => ({ id: `nav:${n.key}`, label: n.label, group: 'Go to', onSelect: () => onNav(n.key) })), ...items], [items, onNav]);
  const t = q.trim().toLowerCase();
  const list = (t ? all.filter((x) => `${x.label} ${x.sub || ''}`.toLowerCase().includes(t)) : all.filter((x) => x.group === 'Go to')).slice(0, 9);
  const choose = (x?: SearchItem) => { if (!x) return; x.onSelect(); setQ(''); setOpen(false); input.current?.blur(); };
  return <div className="cs" ref={ref}>
    <Search size={16} aria-hidden="true" />
    <input ref={input} value={q} placeholder="Search or type a command" aria-label="Search" onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setI(0); setOpen(true); }}
      onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setI((v) => Math.min(v + 1, list.length - 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setI((v) => Math.max(v - 1, 0)); } if (e.key === 'Enter') choose(list[i]); if (e.key === 'Escape') { setOpen(false); input.current?.blur(); } }} />
    <kbd>⌘K</kbd>
    {open && list.length > 0 && <ul className="cs-list" role="listbox">{list.map((x, n) => <li key={x.id}>{(n === 0 || list[n - 1].group !== x.group) && <span className="cs-group">{x.group}</span>}<button role="option" aria-selected={n === i} className={n === i ? 'on' : ''} onMouseEnter={() => setI(n)} onClick={() => choose(x)}><b>{x.label}</b>{x.sub && <small>{x.sub}</small>}</button></li>)}</ul>}
    {open && t && !list.length && <ul className="cs-list"><li className="cs-none">No matches</li></ul>}
  </div>;
}

export function AppShell({ active, onNav, disabled = [], account, actions, children, demo, running, searchItems = [], onIntegrations, onHelp }: { active: NavKey; onNav: (k: NavKey) => void; disabled?: NavKey[]; account: ReactNode; actions?: ReactNode; children: ReactNode; demo?: boolean; running?: boolean; searchItems?: SearchItem[]; onIntegrations?: () => void; onHelp?: () => void }) {
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('igc-nav-collapsed') === '1'; } catch { return false; } });
  const [mobile, setMobile] = useState(false);
  useEffect(() => { try { localStorage.setItem('igc-nav-collapsed', collapsed ? '1' : '0'); } catch { /* no storage */ } }, [collapsed]);
  const nav = (k: NavKey) => { setMobile(false); onNav(k); };
  const items = NAV.filter((n) => !(demo && ['configuracion', 'analisis', 'acercamientos'].includes(n.key)));
  return <div className={`shell pls ${collapsed ? 'collapsed' : ''} ${mobile ? 'm-open' : ''} ${demo ? 'is-demo' : ''}`}>
    <a className="skip" href="#main">Skip to content</a>
    <aside className="sb" aria-label="Sidebar">
      <div className="sb-top"><Brand compact={collapsed} /><button className="sb-collapse" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button><button className="sb-close" onClick={() => setMobile(false)} aria-label="Close menu"><X size={18} /></button></div>
      <nav className="sb-nav" aria-label="Main">{items.map((n) => <button key={n.key} aria-current={active === n.key ? 'page' : undefined} className={active === n.key ? 'on' : ''} disabled={disabled.includes(n.key)} title={collapsed ? n.label : disabled.includes(n.key) ? 'Finish setup first' : undefined} onClick={() => nav(n.key)}>{n.icon}<span>{n.label}</span>{n.key === 'ejecucion' && running && <i className="sh-live" aria-label="running" />}</button>)}</nav>
      <div className="sb-foot">
        {onIntegrations && <button onClick={onIntegrations} title={collapsed ? 'Integrations' : undefined}><Plug size={17} strokeWidth={1.6} /><span>Integrations</span></button>}
        {onHelp && <button onClick={onHelp} title={collapsed ? 'Demo' : undefined}><CircleHelp size={17} strokeWidth={1.6} /><span>{demo ? 'Leave demo' : 'Demo'}</span>{demo && <em>Demo</em>}</button>}
      </div>
    </aside>
    {mobile && <div className="sb-scrim" onClick={() => setMobile(false)} aria-hidden="true" />}
    <div className="sh-col">
      <header className="tb">
        <button className="tb-menu" onClick={() => setMobile(true)} aria-label="Open menu"><Menu size={18} /></button>
        <CommandSearch items={searchItems} onNav={nav} />
        <div className="tb-right">{demo && <span className="tb-demo">Demo data</span>}{actions}<span className="tb-sep" aria-hidden="true" />{account}</div>
      </header>
      <main id="main" className="sh-main" tabIndex={-1}>{children}</main>
    </div>
  </div>;
}
export const NewEvaluationButton = ({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) => <button className="x-btn primary sm" onClick={onClick} disabled={disabled}><Play size={13} /> New evaluation</button>;
export const ChevronCrumb = ({ parts }: { parts: string[] }) => <>{parts.map((p, i) => <span key={i}>{i > 0 && <ChevronRight size={12} aria-hidden="true" />}{p}</span>)}</>;

/* ───────── Sign in ───────── */
export function AuthScreen({ initialEmail = '', notice = '', startRegister = false, onReady, onDemo }: { initialEmail?: string; notice?: string; startRegister?: boolean; onReady: (s: AccountSession) => void; onDemo: () => void }) {
  const [register, setRegister] = useState(startRegister);
  const [name, setName] = useState('');
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pwOk = password.length >= 8 && /[A-Z]/.test(password) && /\d/.test(password);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { onReady(register ? await accountApi.register(name, email, password) : await accountApi.login(email, password)); }
    catch (err) { setError(err instanceof Error ? err.message : "Couldn't complete that."); } finally { setBusy(false); }
  };
  return <div className="auth pls">
    <section className="auth-form">
      <Brand />
      <form onSubmit={(e) => void submit(e)} noValidate>
        <h1>{register ? 'Create your workspace' : 'Sign in'}</h1>
        <p>{register ? 'One account per company.' : 'Pick up where you left off.'}</p>
        {notice && <p className="x-note" role="status">{notice}</p>}
        {register && <label className="x-field"><span>Full name</span><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required /></label>}
        <label className="x-field"><span>Email</span><span className="x-input-ico"><Mail size={15} aria-hidden="true" /><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></span></label>
        <label className="x-field"><span>Password</span><span className="x-input-ico"><Lock size={15} aria-hidden="true" /><input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={register ? 'new-password' : 'current-password'} required aria-describedby="pw-rule" /><button type="button" className="x-icon-btn sm" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}><Eye size={14} /></button></span></label>
        {register && <small id="pw-rule" className={pwOk ? 'ok' : ''}>{pwOk ? <Check size={12} /> : null} 8+ characters, one uppercase letter and one number.</small>}
        {register && <label className="x-check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I accept the terms and privacy policy.</label>}
        {error && <p className="of-err" role="alert">{error}</p>}
        <button className="x-btn primary lg" disabled={busy || !email || !password || (register && (!name || !agree || !pwOk))}>{busy && <LoaderCircle size={15} className="spin" />}{register ? 'Create account' : 'Sign in'}</button>
        <p className="auth-switch">{register ? 'Already have an account?' : 'New company?'} <button type="button" className="x-link-btn" onClick={() => { setRegister(!register); setError(''); }}>{register ? 'Sign in' : 'Create account'}</button></p>
      </form>
    </section>
    <section className="auth-side" aria-label="What it does">
      <span className="auth-eyebrow">Why warm paths</span>
      <h2>Investors mostly meet founders through someone they already know.</h2>
      <p className="auth-stat"><b>58%</b> of closed VC deals come from a referral — the investor's network, other investors or portfolio companies. Only <b>10%</b> start with a cold email. <small>Gompers et al., “How Do Venture Capitalists Make Decisions?”, 2020</small></p>
      <p className="auth-lead">Outreach puts you on their radar: it finds who is funding your space today and which people can introduce you.</p>
      <ol className="auth-steps">
        <li><b>01</b><span>Tell us what you're raising for<small>7 short questions, or attach your deck</small></span></li>
        <li><b>02</b><span>We find who funds this today<small>funds, programs and the people inside them</small></span></li>
        <li><b>03</b><span>You get who to contact first<small>why, how to reach them, and a 4-line email you review</small></span></li>
      </ol>
      <button className="x-btn primary" onClick={onDemo}><FlaskConical size={15} /> Open the demo · no sign-in</button>
      <p className="auth-foot"><ShieldCheck size={13} /> We never guess emails or send messages for you.</p>
    </section>
  </div>;
}
