import {
  ArrowLeft, Building2, CalendarDays, Check, ChevronRight, CircleDollarSign, Database, Eye, Flag, Link2, LoaderCircle, Lock, Mail,
  MessageSquareQuote, Plus, Search, ShieldCheck, Sparkles, UserRound, UsersRound, X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { FundingType, ProjectConfig, TeamRole } from './api';
import { AgentRun } from './AgentRun';
import { blankConfig, buildDemoDashboard, demoApi, sampleConfig, switchAccount } from './demo';
import { FUNDING, ROLES } from './Settings';

/* Onboarding de la cuenta demo, inspirado en flujos tipo "Relay": ventana dividida, panel de contexto a la
   izquierda, stepper de puntos a la derecha. Campos pedidos en la reunión: quién eres, empresa, producto,
   descripción del producto y tipo de financiación. Todo simulado. */

type Step = 'signup' | 'about' | 'product' | 'funding' | 'sources' | 'team' | 'run' | 'finding' | 'ready';
const DOTS: Step[] = ['about', 'product', 'funding', 'sources', 'team'];
const SECTORS = ['mental health', 'neuro', 'wearables', 'digital health', 'biotech', 'medtech', 'pharma', 'AI', 'diagnostics', 'healthtech'];
const COMP_SUGGESTIONS = ['Calmwave', 'NeuroNest', 'Pulsely', 'Brightpath Care', 'Mindloop', 'Vitalframe', 'Sanaria Labs'];
type Source = { id: string; label: string; icon: typeof Link2; tint: string; gives: string };
const SOURCES: Source[] = [
  { id: 'li', label: 'LinkedIn', icon: Link2, tint: '#0a66c2', gives: 'Conexiones y a quién le escribes' },
  { id: 'ol', label: 'Outlook', icon: Mail, tint: '#0f6cbd', gives: 'Encabezados de correo' },
  { id: 'gm', label: 'Gmail', icon: Mail, tint: '#d93025', gives: 'Encabezados de correo' },
  { id: 'cal', label: 'Calendario', icon: CalendarDays, tint: '#188038', gives: 'Reuniones pequeñas = vínculos fuertes' },
  { id: 'hs', label: 'HubSpot', icon: Database, tint: '#ff7a59', gives: 'Contactos y pipeline existentes' },
  { id: 'ap', label: 'Apollo', icon: Search, tint: '#6b4eff', gives: 'Correos verificados de socios' },
];

export function Onboarding({ onFinished }: { onFinished: () => void }) {
  const [step, setStep] = useState<Step>('signup');
  const [cfg, setCfg] = useState<ProjectConfig>(sampleConfig);
  const [example, setExample] = useState(true);
  const [picked, setPicked] = useState('li');
  const [connected, setConnected] = useState<string[]>(['li']);
  const [linking, setLinking] = useState<Source | null>(null);

  const dot = DOTS.indexOf(step);
  const setProject = (patch: Partial<ProjectConfig['project']>) => setCfg({ ...cfg, project: { ...cfg.project, ...patch } });
  const setFounder = (patch: Partial<ProjectConfig['founder']>) => setCfg({ ...cfg, founder: { ...cfg.founder, ...patch } });
  const funding = cfg.project.funding_types || [];
  const toggleFunding = (id: FundingType) => setProject({ funding_types: funding.includes(id) ? funding.filter((x) => x !== id) : [...funding, id] });
  const addComp = (name: string) => { if (!name.trim() || cfg.comparables.some((c) => c.name === name)) return; setCfg({ ...cfg, comparables: [...cfg.comparables, { name, domain: '', sec_cik: '', aliases: [], why: '' }] }); };
  const go = (s: Step) => { setStep(s); window.scrollTo({ top: 0 }); };
  const next = () => { const i = DOTS.indexOf(step); if (i >= 0 && i < DOTS.length - 1) go(DOTS[i + 1]); else if (step === 'team') start(); };
  const back = () => { const i = DOTS.indexOf(step); go(i <= 0 ? 'signup' : DOTS[i - 1]); };
  const start = async () => { await demoApi.saveConfig(cfg); go('run'); };
  const toggleExample = () => { if (example) { const b = blankConfig(); setCfg({ ...b, founder: { ...b.founder, name: cfg.founder.name, email: cfg.founder.email } }); setConnected([]); } else { setCfg(sampleConfig()); setConnected(['li']); } setExample(!example); };

  useEffect(() => {
    if (!linking) return;
    const id = window.setTimeout(() => { setConnected((c) => [...new Set([...c, linking.id])]); setLinking(null); }, 2300);
    return () => window.clearTimeout(id);
  }, [linking]);

  const valid: Partial<Record<Step, boolean>> = {
    about: Boolean(cfg.founder.name.trim() && cfg.founder.org.trim()),
    product: Boolean(cfg.project.name.trim() && cfg.project.one_liner.trim() && cfg.project.sectors.length),
    funding: funding.length > 0,
    sources: true, team: true,
  };

  if (step === 'run') return <AgentRun config={cfg} onDone={async () => { await demoApi.run(); go('finding'); }} />;
  if (step === 'finding') return <Finding cfg={cfg} onBack={() => go('run')} onNext={() => go('ready')} />;
  if (step === 'ready') return <Ready cfg={cfg} onDone={onFinished} />;
  if (step === 'signup') return <Signup cfg={cfg} setFounder={setFounder} onNext={() => go('about')} />;

  const left: Record<string, ReactNode> = {
    about: <AboutAside cfg={cfg} />,
    product: <ProductAside cfg={cfg} />,
    funding: <FundingAside />,
    sources: <SourcesAside />,
    team: <TeamAside cfg={cfg} />,
  };

  return (
    <Frame>
      <aside className="rl-left">
        <Brand />
        <div className="rl-left-body" key={step}>{left[step]}</div>
        <p className="rl-sim"><Sparkles size={13} /> Cuenta demo · todo es simulado</p>
      </aside>
      <main className="rl-right">
        <div className="rl-nav">
          <button className="rl-back" onClick={back} aria-label="Atrás"><ArrowLeft size={18} /></button>
          <ol className="rl-dots" aria-label={`Paso ${dot + 1} de ${DOTS.length}`}>{DOTS.map((d, i) => <li key={d} className={i < dot ? 'done' : i === dot ? 'now' : ''} />)}</ol>
          <button className="rl-example" onClick={toggleExample}>{example ? 'Empezar en blanco' : 'Usar datos de ejemplo'}</button>
        </div>
        <section className="rl-step" key={step}>
          {step === 'about' && <>
            <h1>¿Quién eres?</h1>
            <h2>Tú y tu empresa</h2>
            <p className="rl-sub">El agente te presenta con estos datos en cada correo, así que escríbelos como te gustaría que te leyera un inversionista.</p>
            <div className="rl-form">
              <Input icon={UserRound} label="Nombre completo" value={cfg.founder.name} onChange={(v) => setFounder({ name: v })} />
              <Input icon={Flag} label="Tu rol" value={cfg.founder.title || ''} placeholder="CEO, founder, director científico…" onChange={(v) => setFounder({ title: v })} />
              <Input icon={Building2} label="Empresa" value={cfg.founder.org} onChange={(v) => setFounder({ org: v })} wide />
            </div>
          </>}

          {step === 'product' && <>
            <h1>¿Qué producto quieres financiar?</h1>
            <h2>La financiación se busca por producto</h2>
            <p className="rl-sub">Es más fácil convencer con un producto concreto y creíble que con toda la empresa. Si tienes varios, empieza por uno.</p>
            <div className="rl-form">
              <Input icon={Sparkles} label="Producto" value={cfg.project.name} onChange={(v) => setProject({ name: v })} />
              <label className="rl-field"><span>Etapa</span>
                <div className="rl-seg">{['pre-seed', 'seed', 'series-a'].map((s) => <button key={s} type="button" className={cfg.project.stage === s ? 'on' : ''} onClick={() => setProject({ stage: s })}>{s}</button>)}</div>
              </label>
              <Input label="Qué hace, en una frase" value={cfg.project.one_liner} onChange={(v) => setProject({ one_liner: v })} wide />
              <label className="rl-field wide"><span>Descripción del producto</span><textarea rows={3} value={cfg.project.description} placeholder="Problema, para quién, evidencia o tracción…" onChange={(e) => setProject({ description: e.target.value })} /></label>
              <div className="rl-field wide"><span>Sector</span>
                <div className="rl-pills">{SECTORS.map((s) => { const on = cfg.project.sectors.includes(s); return <button key={s} className={on ? 'on' : ''} onClick={() => setProject({ sectors: on ? cfg.project.sectors.filter((x) => x !== s) : [...cfg.project.sectors, s] })}><i>{on && <Check size={12} strokeWidth={3} />}</i>{s}</button>; })}</div>
              </div>
              <Input icon={CircleDollarSign} label="Monto a levantar (USD)" value={String(cfg.project.raise_usd || '')} onChange={(v) => setProject({ raise_usd: Number(v.replace(/\D/g, '')) || null })} />
              <Input label="Dónde operas" value={cfg.project.geo.join(', ')} onChange={(v) => setProject({ geo: v.split(',').map((x) => x.trim()).filter(Boolean) })} />
            </div>
          </>}

          {step === 'funding' && <>
            <h1>¿Qué tipo de financiación buscas?</h1>
            <h2>Elige una o varias</h2>
            <p className="rl-sub">Filtramos por tu preferencia. Si no hay suficientes resultados exactos, te mostramos lo más cercano y te decimos por qué no encaja del todo.</p>
            <div className="rl-pills big">{FUNDING.map((f) => { const on = funding.includes(f.id); return <button key={f.id} className={on ? 'on' : ''} onClick={() => toggleFunding(f.id)}><i>{on && <Check size={13} strokeWidth={3} />}</i>{f.label}</button>; })}</div>
            <h2 className="rl-h2-gap">Pares que ya levantaron <small>opcional</small></h2>
            <p className="rl-sub">Empresas parecidas. Sus inversionistas son la mejor pista; el agente también las busca en la SEC.</p>
            <div className="rl-pills">
              {cfg.comparables.map((c, i) => <button key={c.name + i} className="on" onClick={() => setCfg({ ...cfg, comparables: cfg.comparables.filter((_, j) => j !== i) })}><i><Check size={12} strokeWidth={3} /></i>{c.name}<X size={13} className="rl-x" /></button>)}
              {COMP_SUGGESTIONS.filter((s) => !cfg.comparables.some((c) => c.name === s)).slice(0, 4).map((s) => <button key={s} onClick={() => addComp(s)}><i><Plus size={12} /></i>{s}</button>)}
            </div>
          </>}

          {step === 'sources' && <>
            <h1>Conecta tus fuentes</h1>
            <h2>¿Dónde vive tu red?</h2>
            <p className="rl-sub">Con tu red encontramos quién te puede presentar. Sin ella, igual preparamos el cold email.</p>
            <div className="rl-tiles">{SOURCES.map((s) => {
              const on = connected.includes(s.id);
              const Icon = s.icon;
              return <button key={s.id} className={`${picked === s.id ? 'picked' : ''} ${on ? 'linked' : ''}`} onClick={() => setPicked(s.id)}>
                <i style={{ color: s.tint, background: `${s.tint}14` }}><Icon size={18} /></i><span>{s.label}</span>
                {on && <b><Check size={11} strokeWidth={3} /></b>}
              </button>;
            })}</div>
            <p className="rl-hint">{SOURCES.find((s) => s.id === picked)?.gives}.</p>
          </>}

          {step === 'team' && <>
            <h1>Tu red extendida</h1>
            <h2>¿Quién más puede abrir puertas?</h2>
            <p className="rl-sub">Cofounders, board, advisors, inversionistas actuales y personas del grupo. Cada una es un punto de partida más.</p>
            <div className="rl-team">
              {cfg.team.map((m, i) => <div key={i} className="rl-member">
                <span className="rl-avatar">{m.name.split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase() || '?'}</span>
                <input aria-label="Nombre" placeholder="Nombre" value={m.name} onChange={(e) => { const t = [...cfg.team]; t[i] = { ...m, name: e.target.value }; setCfg({ ...cfg, team: t }); }} />
                <select aria-label="Rol" value={m.role} onChange={(e) => { const t = [...cfg.team]; t[i] = { ...m, role: e.target.value as TeamRole }; setCfg({ ...cfg, team: t }); }}>{ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
                <label className="cfg-switch"><input type="checkbox" checked={m.shares_network} onChange={(e) => { const t = [...cfg.team]; t[i] = { ...m, shares_network: e.target.checked }; setCfg({ ...cfg, team: t }); }} /><i />Comparte su red</label>
                <button className="rl-del" onClick={() => setCfg({ ...cfg, team: cfg.team.filter((_, j) => j !== i) })} aria-label="Quitar"><X size={15} /></button>
              </div>)}
              <div className="rl-pills">{(['cofounder', 'board', 'advisor', 'inversionista', 'grupo'] as TeamRole[]).map((r) => <button key={r} onClick={() => setCfg({ ...cfg, team: [...cfg.team, { name: '', email: '', linkedin_url: '', org: '', role: r, shares_network: r === 'cofounder', closeness: null }] })}><i><Plus size={12} /></i>{ROLES.find((x) => x.id === r)?.label}</button>)}</div>
            </div>
          </>}

          <div className="rl-actions">
            {step === 'sources'
              ? <>
                <button className="rl-skip" onClick={next}>Omitir por ahora</button>
                {connected.includes(picked)
                  ? <button className="rl-primary" onClick={next}>Continuar <ChevronRight size={17} /></button>
                  : <button className="rl-primary" onClick={() => setLinking(SOURCES.find((s) => s.id === picked)!)}>Conectar {SOURCES.find((s) => s.id === picked)?.label} <ChevronRight size={17} /></button>}
              </>
              : <button className="rl-primary" onClick={next} disabled={!valid[step]}>{step === 'team' ? 'Iniciar búsqueda' : 'Continuar'} <ChevronRight size={17} /></button>}
          </div>
        </section>
        <p className="rl-foot">*Tus datos son privados. Solo leemos metadatos (quién, cuándo, canal), nunca el contenido de tus mensajes.</p>
      </main>
      {linking && <Linking source={linking} />}
    </Frame>
  );
}

/* ───────────── Piezas ───────────── */

function Frame({ children, plain }: { children: ReactNode; plain?: boolean }) { return <div className="rl"><div className={`rl-window ${plain ? 'plain' : ''}`}>{children}</div></div>; }
function Brand() { return <div className="rl-brand"><img src="/igc-outreach-mark.png" alt="" width={44} height={44} /><span><strong>IGC Outreach</strong><small>Outreach a inversionistas</small></span></div>; }
function Input({ label, value, onChange, icon: Icon, placeholder, wide }: { label: string; value: string; onChange: (v: string) => void; icon?: typeof Link2; placeholder?: string; wide?: boolean }) {
  return <label className={`rl-field ${wide ? 'wide' : ''}`}><span>{label}</span><div className="rl-input">{Icon && <Icon size={17} />}<input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /></div></label>;
}

function Signup({ cfg, setFounder, onNext }: { cfg: ProjectConfig; setFounder: (p: Partial<ProjectConfig['founder']>) => void; onNext: () => void }) {
  const [agree, setAgree] = useState(true);
  const [show, setShow] = useState(false);
  return (
    <Frame>
      <section className="rl-signup">
        <Brand />
        <div className="rl-signup-body">
          <small>Bienvenida a IGC Outreach</small>
          <h1>Crea tu cuenta</h1>
          <div className="rl-sso"><button onClick={onNext}>Continuar con Google</button><button onClick={onNext}>Continuar con Microsoft</button></div>
          <div className="rl-or"><span>o</span></div>
          <h3>Completa tus datos para registrarte.</h3>
          <Input icon={UserRound} label="Nombre completo" value={cfg.founder.name} onChange={(v) => setFounder({ name: v })} />
          <Input icon={Mail} label="Correo" value={cfg.founder.email} onChange={(v) => setFounder({ email: v })} />
          <label className="rl-field"><span>Contraseña</span><div className="rl-input"><Lock size={17} /><input type={show ? 'text' : 'password'} defaultValue="Aurora2026!" /><button className="rl-eye" onClick={() => setShow(!show)} aria-label="Mostrar contraseña"><Eye size={17} /></button></div></label>
          <p className="rl-ok"><Check size={14} /> Mínimo 8 caracteres, una mayúscula y un número.</p>
          <label className="rl-check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><i>{agree && <Check size={12} strokeWidth={3} />}</i>Acepto los términos y la política de privacidad.</label>
          <button className="rl-primary full" disabled={!agree || !cfg.founder.name.trim()} onClick={onNext}>Crear cuenta</button>
        </div>
        <p className="rl-login">¿Ya tienes cuenta? <button onClick={() => { switchAccount('igc'); window.location.assign('/'); }}>Iniciar sesión</button></p>
      </section>
      <section className="rl-promo">
        <h2>Llega a cada inversionista<br />por la puerta correcta</h2>
        <p>Encontramos quién te puede presentar y, si nadie puede, te dejamos listo un cold email corto con lo que tienen en común.</p>
        <div className="rl-promo-dots"><i className="on" /><i /><i /></div>
        <div className="rl-promo-stage">
          <span className="rl-orb o1"><Link2 size={20} /></span>
          <span className="rl-orb o2"><Mail size={20} /></span>
          <span className="rl-orb o3"><CalendarDays size={20} /></span>
          <span className="rl-orb o4"><Search size={20} /></span>
          <div className="rl-mock">
            <div className="rl-mock-head"><b>Harbor Oak Bio Fund</b><em>Ruta cálida</em></div>
            <p className="rl-mock-path"><span>Tú</span><ChevronRight size={13} /><span>Mateo Rincón</span><ChevronRight size={13} /><span>Laura Whitfield</span></p>
            <div className="rl-mock-card">
              <strong>Pedir intro a Mateo</strong>
              <p><CalendarDays size={13} /> Esta semana</p>
              <div className="rl-tags"><span className="t1">Grants</span><span className="t2">Neuro</span><span className="t3">Pre-seed</span></div>
              <div className="rl-mock-foot"><span>Fit 82%</span><em>Prioridad alta</em></div>
            </div>
          </div>
        </div>
      </section>
    </Frame>
  );
}

function Linking({ source }: { source: Source }) {
  const Icon = source.icon;
  return (
    <div className="rl-linking" role="dialog" aria-label="Integración en progreso">
      <div className="rl-linking-card">
        <div className="rl-linking-logos"><i style={{ color: source.tint }}><Icon size={26} /></i><span><Link2 size={16} /></span><i><img src="/igc-outreach-mark.png" alt="" width={34} height={34} /></i></div>
        <h3><LoaderCircle className="spin" size={20} /> Conectando {source.label}…</h3>
        <p>Estamos leyendo los metadatos de tu cuenta. Puede tardar un momento.</p>
        <small>*Simulación: no se conecta ninguna cuenta real.</small>
      </div>
    </div>
  );
}

/* Paneles izquierdos */
function AboutAside({ cfg }: { cfg: ProjectConfig }) {
  return <>
    <h4>Así te presentará el agente</h4>
    <div className="rl-mail">
      <div className="rl-mail-head"><span className="rl-avatar sm">{cfg.founder.name.split(' ').map((x) => x[0]).slice(0, 2).join('')}</span><div><b>{cfg.founder.name || 'Tu nombre'}</b><small>{cfg.founder.email || 'tu@correo.com'}</small></div></div>
      <p>Hola Laura,</p>
      <p><mark className="c2">Soy {cfg.founder.name.split(' ')[0] || '…'}, {cfg.founder.title || 'founder'} de {cfg.founder.org || 'mi empresa'}.</mark> Estamos construyendo {cfg.project.name || 'nuestro producto'}…</p>
    </div>
    <ul className="rl-list">
      <li><Check size={14} /> Tu nombre y rol dan credibilidad en la primera línea.</li>
      <li><Check size={14} /> La empresa conecta tu producto con tu historia.</li>
    </ul>
  </>;
}
function ProductAside({ cfg }: { cfg: ProjectConfig }) {
  return <>
    <h4>Así lo verá un inversionista</h4>
    <div className="rl-prod">
      <small>{cfg.founder.org || 'Empresa'}</small>
      <strong>{cfg.project.name || 'Producto'}</strong>
      <p>{cfg.project.one_liner || 'Qué hace, en una frase.'}</p>
      <div className="rl-tags">{cfg.project.sectors.slice(0, 3).map((s, i) => <span key={s} className={`t${(i % 3) + 1}`}>{s}</span>)}</div>
      <div className="rl-prod-meta"><span>{cfg.project.stage}</span><span>US${(cfg.project.raise_usd || 0).toLocaleString('es-CO')}</span><span>{cfg.project.geo.join(' · ')}</span></div>
    </div>
    <p className="rl-quote"><MessageSquareQuote size={16} /> “Es más fácil financiar un producto en el que tienes credibilidad que financiar toda la empresa.”</p>
  </>;
}
function FundingAside() {
  const rows = [
    { t: 'Grants', d: 'No dilutivo: no entregas participación. Más lento y con reportes.', k: 'g' },
    { t: 'Venture capital', d: 'Capital a cambio de participación. Busca crecimiento rápido.', k: 'v' },
    { t: 'Ángeles', d: 'Tickets pequeños, deciden rápido, valoran la relación.', k: 'a' },
    { t: 'Corporativo', d: 'Farmas o empresas del sector: capital + distribución.', k: 'c' },
  ];
  return <>
    <h4>¿Cuál me conviene?</h4>
    <ul className="rl-fund">{rows.map((r) => <li key={r.t} className={r.k}><b>{r.t}</b><span>{r.d}</span></li>)}</ul>
  </>;
}
function SourcesAside() {
  return <>
    <h4>Qué leemos y qué no</h4>
    <ul className="rl-privacy">
      <li className="yes"><Check size={14} /> Con quién hablas y cada cuánto</li>
      <li className="yes"><Check size={14} /> Reuniones pequeñas y respuestas mutuas</li>
      <li className="yes"><Check size={14} /> Correos verificados de socios (Apollo, HubSpot)</li>
      <li className="no"><X size={14} /> El contenido de tus mensajes</li>
      <li className="no"><X size={14} /> Adjuntos o archivos</li>
    </ul>
    <div className="rl-shield"><ShieldCheck size={20} /><p>Puedes desconectar una fuente cuando quieras y sus datos se borran.</p></div>
  </>;
}
function TeamAside({ cfg }: { cfg: ProjectConfig }) {
  const people = [cfg.founder.name || 'Tú', ...cfg.team.map((m) => m.name).filter(Boolean)];
  return <>
    <h4>{people.length} puntos de partida</h4>
    <div className="rl-roots">{people.map((p, i) => <div key={p + i} className={i === 0 ? 'me' : ''}><span className="rl-avatar sm">{p.split(' ').map((x) => x[0]).slice(0, 2).join('')}</span><b>{p}</b><small>{i === 0 ? 'Tú' : ROLES.find((r) => r.id === cfg.team[i - 1]?.role)?.label}</small></div>)}</div>
    <p className="rl-note"><UsersRound size={14} /> Mientras más personas, más probable que alguien conozca al socio del fondo.</p>
  </>;
}

/* Primer hallazgo: ruta cálida o cold email en 3 pasos (common ground · contexto · petición). */
function Finding({ cfg, onBack, onNext }: { cfg: ProjectConfig; onBack: () => void; onNext: () => void }) {
  const recs = useMemo(() => buildDemoDashboard(cfg).recommendations, [cfg]);
  const rec = recs.find((r) => r.best_path) || recs[0];
  const partner = rec?.people?.[0]?.name || 'Socio';
  const first = partner.split(' ')[0];
  const email = `${first.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}@${(rec?.name || 'fondo').toLowerCase().replace(/[^a-z]/g, '').slice(0, 14)}.example`;
  const [mode, setMode] = useState<'warm' | 'cold'>(rec?.best_path ? 'warm' : 'cold');
  const conn = rec?.best_path?.hops.find((h) => h.rel === 'knows')?.to_name || rec?.best_path?.connector;
  const sector = cfg.project.sectors[0] || 'salud';
  return (
    <Frame>
      <aside className="rl-left wide">
        <Brand />
        <div className="rl-left-body">
          <h4><Search size={14} /> Contexto encontrado</h4>
          <div className="rl-post">
            <div className="rl-mail-head"><span className="rl-avatar sm">{partner.split(' ').map((x) => x[0]).join('')}</span><div><b>{partner}</b><small>Partner · {rec?.name} · post en LinkedIn</small></div></div>
            <p>“Cada vez más convencida de que <mark className="c1">los wearables con evidencia clínica</mark> van a cambiar cómo tratamos el estrés y el deterioro cognitivo. Busco founders en {sector}.”</p>
            <small>Fragmento público vía búsqueda web (simulado)</small>
          </div>
          <div className="rl-post alt">
            <b>{rec?.name}</b>
            <p>Invirtió en {cfg.comparables[0]?.name || 'un par tuyo'} · tesis {Math.round((rec?.factors.thesis || 0) * 100)}% parecida · activo este año.</p>
          </div>
        </div>
      </aside>
      <main className="rl-right">
        <div className="rl-nav"><button className="rl-back" onClick={onBack} aria-label="Atrás"><ArrowLeft size={18} /></button><ol className="rl-dots">{DOTS.map((d) => <li key={d} className="done" />)}<li className="now" /></ol></div>
        <section className="rl-step">
          <h1>Primer <span className="rl-grad">hallazgo</span> <em className="rl-conf">92% de confianza</em></h1>
          <h2>Encontramos a quién escribirle y por qué</h2>
          <p className="rl-sub">Revisa, edita o aprueba antes de que pase a tu pipeline.</p>
          <div className="rl-lead">
            <div className="rl-lead-head"><span className="rl-avatar">{partner.split(' ').map((x) => x[0]).join('')}</span><div><strong>{partner}</strong><small>Partner · {rec?.name}</small></div><em><Mail size={13} /> {email}</em></div>
            <ul className="rl-why">
              <li><Check size={13} /> Mismo espacio: {sector}</li>
              <li><Check size={13} /> Financia {rec?.profile.stages?.join(' / ')}</li>
              <li><Check size={13} /> Invirtió en un par tuyo</li>
              {conn && <li><Check size={13} /> {conn} lo conoce</li>}
            </ul>
            <div className="rl-seg sm">
              <button className={mode === 'warm' ? 'on' : ''} onClick={() => setMode('warm')} disabled={!conn}>Ruta cálida</button>
              <button className={mode === 'cold' ? 'on' : ''} onClick={() => setMode('cold')}>Cold email</button>
            </div>
            {mode === 'warm' && conn
              ? <div className="rl-draft"><small>Mensaje para {conn}</small><p>Hola {conn.split(' ')[0]}, ¿conoces a {partner} de {rec?.name}? Estamos levantando para {cfg.project.name} y encaja con su tesis. ¿Te molestaría presentarnos? Te dejo 3 líneas para reenviar.</p></div>
              : <div className="rl-draft">
                <small>Para {partner} · asunto: {cfg.project.name} × {rec?.name}</small>
                <p><mark className="c1">Hola {first}, vi tu post sobre wearables con evidencia clínica; es justo lo que hacemos.</mark> <mark className="c2">Soy {cfg.founder.name.split(' ')[0]}, {cfg.founder.title || 'founder'} de {cfg.founder.org}: {cfg.project.name} {cfg.project.one_liner.charAt(0).toLowerCase() + cfg.project.one_liner.slice(1)}.</mark> <mark className="c3">¿Tienes 20 minutos la próxima semana para mostrártelo como opción de inversión?</mark></p>
                <div className="rl-legend"><span className="c1">Common ground</span><span className="c2">Contexto</span><span className="c3">Petición</span></div>
              </div>}
          </div>
          <div className="rl-actions"><button className="rl-skip" onClick={onNext}>Omitir</button><button className="rl-primary" onClick={onNext}>Aprobar y continuar <ChevronRight size={17} /></button></div>
        </section>
        <p className="rl-foot">*Contactos, correos y posts de esta cuenta son inventados.</p>
      </main>
    </Frame>
  );
}

function Ready({ cfg, onDone }: { cfg: ProjectConfig; onDone: () => void }) {
  const [n, setN] = useState(0);
  const d = useMemo(() => buildDemoDashboard(cfg), [cfg]);
  const warm = d.recommendations.filter((r) => r.best_path).length;
  const items = [
    { icon: Search, t: `${38 + d.recommendations.length} candidatos encontrados en la web y la SEC.` },
    { icon: ShieldCheck, t: `${d.recommendations.length} aprobados por el agente evaluador.` },
    { icon: Link2, t: `${warm} con ruta cálida a través de tu red.` },
    { icon: Mail, t: `${d.recommendations.length - warm} cold emails listos para revisar.` },
  ];
  useEffect(() => { if (n >= items.length) return; const id = window.setTimeout(() => setN(n + 1), 650); return () => window.clearTimeout(id); }, [n]);
  const done = n >= items.length;
  return (
    <Frame plain>
      <Brand />
      <section className="rl-ready">
        <h1>{done ? <Check size={30} className="rl-ready-ok" /> : <LoaderCircle className="spin" size={30} />} {done ? 'Tu espacio está listo' : 'Estamos preparando tu espacio…'}</h1>
        <p>Organizamos a los inversionistas de {cfg.project.name} con el porqué de cada uno y a quién escribirle.</p>
        <ul>{items.slice(0, n).map(({ icon: Icon, t }) => <li key={t} className="pop"><i><Icon size={15} /></i>{t}<Check size={16} className="ok" /></li>)}</ul>
        {done && <button className="rl-primary pop" onClick={onDone}>Ir a mi dashboard <ChevronRight size={17} /></button>}
      </section>
    </Frame>
  );
}
