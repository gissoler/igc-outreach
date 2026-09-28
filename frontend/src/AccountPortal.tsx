import { ArrowLeft, AtSign, Pencil, CalendarDays, Check, ChevronRight, Eye, FileSpreadsheet, Inbox, Link2, LoaderCircle, Lock, LogOut, Mail, Network, ShieldCheck, UserRound } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { ProjectConfig } from './api';
import { blankConfig } from './demo';
import { accountApi, intakeApi, type AccountConnector, type AccountSession, type AuthenticatedGraphResult, type IntakeState, type LinkedInInteractions, type LinkedInPublicProfile, type NetworkGraphData } from './accountApi';
import { NetworkGraphView } from './NetworkGraph';
import { AgentChat, ConfirmProfile, LiveProfile, PlanAside } from './IntakeAgent';
import { ResearchPage } from './Research';

/* Perfilamiento: cuenta → conversación con el agente de prerregistro (texto + documentos) →
   confirmación del perfil estructurado (con plan de investigación) → LinkedIn → espacio. */
type Step = 'account' | 'agent' | 'confirm' | 'sources';
const STEPS: Step[] = ['agent', 'confirm', 'sources'];
const errorText = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la operación.';

function Brand() { return <div className="rl-brand"><img src="/igc-outreach-mark.png" alt="" width={44} height={44}/><span><strong>IGC Outreach</strong><small>Outreach a inversionistas</small></span></div>; }
function LinkedInLogo({size=30}:{size?:number}) { return <svg className="rl-linkedin-logo" width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="LinkedIn"><rect width="32" height="32" rx="5" fill="#0A66C2"/><path fill="#fff" d="M8.1 12.2h3.4V23H8.1V12.2Zm1.7-5.4a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM13.7 12.2H17v1.5h.1c.5-.9 1.6-1.9 3.3-1.9 3.5 0 4.2 2.3 4.2 5.3V23h-3.4v-5.2c0-1.2 0-2.8-1.8-2.8-1.7 0-2 1.3-2 2.7V23h-3.4V12.2Z"/></svg>; }
const PLATFORMS: { name: string; detail: string; icon: typeof Mail }[] = [
  { name: 'Gmail', detail: 'Con quién te escribes y con qué frecuencia', icon: Mail },
  { name: 'Google Calendar', detail: 'Reuniones compartidas con cada contacto', icon: CalendarDays },
  { name: 'Outlook', detail: 'Correo y calendario de Microsoft 365', icon: Inbox },
  { name: 'X (Twitter)', detail: 'Interacciones públicas con inversionistas', icon: AtSign },
  { name: 'Happenstance', detail: 'Red compartida de tu equipo', icon: Network },
  { name: 'Contactos CSV', detail: 'Importa una lista de contactos', icon: FileSpreadsheet },
];
export function OtherPlatforms() {
  return <div className="rl-platforms"><h2>Otras plataformas</h2><p className="rl-sub">Cada fuente adicional ayuda a encontrar más caminos cálidos. Por ahora solo el mapa público de LinkedIn está habilitado.</p><ul>
    <li className="on"><i className="li"><LinkedInLogo size={20}/></i><span><b>LinkedIn vía Apify</b><small>Perfil, comentarios, reacciones e interacciones públicas</small></span><em>Habilitado</em></li>
    {PLATFORMS.map(({name,detail,icon:Icon})=><li key={name} aria-disabled="true"><i><Icon size={18}/></i><span><b>{name}</b><small>{detail}</small></span><em>Próximamente</em></li>)}
  </ul></div>;
}
function Frame({children}: {children: ReactNode}) { return <div className="rl"><div className="rl-window">{children}</div></div>; }
function Field({label,value,onChange,icon:Icon,type='text',wide=false}: {label:string;value:string;onChange:(value:string)=>void;icon?:typeof Link2;type?:string;wide?:boolean}) {
  return <label className={`rl-field ${wide?'wide':''}`}><span>{label}</span><div className="rl-input">{Icon&&<Icon size={17}/>}<input type={type} value={value} onChange={e=>onChange(e.target.value)}/></div></label>;
}

export function AccountPortal({session: initial, onReady}: {session: AccountSession | null; onReady:(session:AccountSession)=>void}) {
  const [session,setSession] = useState(initial);
  const [step,setStep] = useState<Step>(initial ? (initial.profile?.intake ? 'sources' : 'agent') : 'account');
  const [login,setLogin] = useState(false);
  const [name,setName] = useState(initial?.user.name || '');
  const [email,setEmail] = useState(initial?.user.email || '');
  const [password,setPassword] = useState('');
  const [showPassword,setShowPassword] = useState(false);
  const [agree,setAgree] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [cfg,setCfg] = useState<ProjectConfig>(() => initial?.profile || blankConfig());
  const [intake,setIntake] = useState<IntakeState|null>(null);
  const [connectors,setConnectors] = useState<Record<string,AccountConnector>>({});
  const [linkedinUrl,setLinkedinUrl] = useState(initial?.profile?.founder.linkedin_url || '');
  const [linkedinProfile,setLinkedinProfile] = useState<LinkedInPublicProfile|undefined>(initial?.profile?.linkedin_profile);
  const [linkedinInteractions,setLinkedinInteractions] = useState<LinkedInInteractions|undefined>(initial?.profile?.linkedin_interactions);
  const [networkGraph,setNetworkGraph] = useState<NetworkGraphData|null>(null);
  const [linkedinCookie,setLinkedinCookie] = useState('');
  const [graphResult,setGraphResult] = useState<AuthenticatedGraphResult|null>(null);
  const dot = STEPS.indexOf(step);
  const signedIn = Boolean(session);
  useEffect(()=>{
    if(!signedIn) return;
    void accountApi.connectors().then(setConnectors).catch(()=>setConnectors({}));
    void intakeApi.get().then(setIntake).catch(e=>setError(errorText(e)));
    void accountApi.networkGraph().then(setNetworkGraph).catch(()=>setNetworkGraph(null));
  },[signedIn]);

  async function authenticate() {
    setBusy(true); setError('');
    try {
      const value = login ? await accountApi.login(email,password) : await accountApi.register(name,email,password);
      setSession(value); setName(value.user.name);
      setCfg(value.profile || {...blankConfig(),founder:{...blankConfig().founder,name:value.user.name,email:value.user.email}});
      if (value.profile?.onboardingComplete) onReady(value); else setStep(value.profile?.intake ? 'sources' : 'agent');
    } catch (error) { setError(errorText(error)); } finally { setBusy(false); }
  }
  async function confirmProfile() {
    setBusy(true); setError('');
    try { const result = await intakeApi.confirm(); setCfg(result.profile); setIntake(result.intake); setStep('sources'); }
    catch(error){setError(errorText(error));} finally{setBusy(false);}
  }
  async function removeDocument(id: string) {
    setError('');
    try { setIntake(await intakeApi.removeDocument(id)); } catch(error){setError(errorText(error));}
  }
  async function reset() {
    setError('');
    try { setIntake(await intakeApi.reset()); setStep('agent'); } catch(error){setError(errorText(error));}
  }
  async function connectLinkedIn() {
    setBusy(true); setError('');
    try {
      const result=await accountApi.connectLinkedIn(linkedinUrl);
      setCfg(result.profile);
      setLinkedinUrl(result.linkedin.linkedinUrl);
      setLinkedinProfile(result.linkedin);
      setLinkedinInteractions(result.interactions);
      setNetworkGraph(await accountApi.networkGraph());
    } catch(error){setError(errorText(error));} finally{setBusy(false);}
  }
  async function buildAuthenticatedGraph() {
    setBusy(true); setError(''); setGraphResult(null);
    try {
      const result=await accountApi.buildAuthenticatedGraph(linkedinCookie);
      setNetworkGraph(result.graph); setGraphResult(result.result); setLinkedinCookie('');
    } catch(error){setError(errorText(error));} finally{setBusy(false);}
  }
  async function finish() {
    setBusy(true);setError('');
    try{
      const profile=await accountApi.saveProfile({...cfg,onboardingComplete:true});
      onReady({user:session!.user,profile,sources:await accountApi.sources()});
    }catch(error){setError(errorText(error));setBusy(false);}
  }
  const back = () => { setError(''); setStep(STEPS[Math.max(0,dot-1)] || 'agent'); };

  if(step==='account') return <Frame><section className="rl-signup"><Brand/><div className="rl-signup-body"><small>{login?'Bienvenido de vuelta':'Bienvenido a IGC Outreach'}</small><h1>{login?'Inicia sesión':'Crea tu cuenta'}</h1><h3>{login?'Continúa donde quedaste.':'Tu espacio, fuentes e investigaciones se guardarán en esta cuenta.'}</h3>{!login&&<Field icon={UserRound} label="Nombre completo" value={name} onChange={setName}/>}<Field icon={Mail} label="Correo" type="email" value={email} onChange={setEmail}/><label className="rl-field"><span>Contraseña</span><div className="rl-input"><Lock size={17}/><input type={showPassword?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)}/><button type="button" className="rl-eye" onClick={()=>setShowPassword(!showPassword)} aria-label="Mostrar contraseña"><Eye size={17}/></button></div></label>{!login&&<><p className="rl-ok"><Check size={14}/> Mínimo 8 caracteres, una mayúscula y un número.</p><label className="rl-check"><input type="checkbox" checked={agree} onChange={e=>setAgree(e.target.checked)}/><i>{agree&&<Check size={12}/>}</i>Acepto los términos y la política de privacidad.</label></>}{error&&<p className="rs-notice error" role="alert">{error}</p>}<button className="rl-primary full" disabled={busy||!email||!password||(!login&&(!name||!agree))} onClick={()=>void authenticate()}>{busy?<LoaderCircle className="spin" size={17}/>:null}{login?'Iniciar sesión':'Crear cuenta'}</button></div><p className="rl-login">{login?'¿No tienes cuenta?':'¿Ya tienes cuenta?'} <button onClick={()=>{setLogin(!login);setError('');}}>{login?'Crear cuenta':'Iniciar sesión'}</button></p></section><section className="rl-promo"><h2>Tu red y tus oportunidades<br/>en un solo lugar</h2><p>Cuéntale al agente qué quieres financiar, conecta las fuentes que ya usas y recibe candidatos con evidencia verificable.</p><div className="rl-promo-stage"><div className="rl-account-promise"><ShieldCheck size={30}/><strong>Datos locales y controlables</strong><span>Desconecta una fuente cuando quieras.</span></div></div></section></Frame>;

  const left: Record<Exclude<Step,'account'>,ReactNode> = {
    agent:<LiveProfile intake={intake} onRemoveDocument={id=>void removeDocument(id)}/>,
    confirm:<PlanAside intake={intake} onReset={()=>void reset()}/>,
    sources:<><h4>Tu mapa profesional público</h4><p className="rl-note">Con un solo enlace, Apify busca relaciones observables en ambos sentidos: quién interactúa contigo y con quién interactúas tú.</p><ul className="rl-list"><li><Check size={14}/> Sin exports, cookies ni contraseña</li><li><Check size={14}/> Posts, comentarios y reacciones públicas recientes</li><li><Check size={14}/> Cada relación conserva su evidencia</li></ul><div className="rl-shield"><ShieldCheck size={20}/><p>Es un mapa de actividad pública, no la lista privada de conexiones de primer grado de LinkedIn.</p></div></>,
  };
  return <Frame><aside className="rl-left"><Brand/><div className={`rl-left-body ${step==='sources'?'':'ia-left'}`} key={step}>{left[step]}</div><p className="rl-live"><ShieldCheck size={13}/> Cuenta real · datos persistentes</p></aside><main className="rl-right"><div className="rl-nav"><button className="rl-back" onClick={back} disabled={step==='agent'} aria-label="Atrás"><ArrowLeft size={18}/></button><ol className="rl-dots" aria-label={`Paso ${dot+1} de ${STEPS.length}`}>{STEPS.map((value,index)=><li key={value} className={index<dot?'done':index===dot?'now':''}/>)}</ol></div><section className={`rl-step ${step==='sources'?'':'ia-step'}`}>{error&&<p className="rs-notice error" role="alert">{error}</p>}
    {step==='agent'&&<AgentChat intake={intake} onChange={setIntake} onReview={()=>{setError('');setStep('confirm');}} onError={setError}/>}
    {step==='confirm'&&(intake?<ConfirmProfile intake={intake} onChange={setIntake} onBack={()=>{setError('');setStep('agent');}} onConfirm={()=>void confirmProfile()} busy={busy} onError={setError}/>:<LoaderCircle className="spin" size={20}/>)}
    {step==='sources'&&<><div className="rl-linkedin-heading"><i><LinkedInLogo/></i><div><h1>Construye tu network graph</h1><p>Apify convierte conexiones e interacciones en caminos con evidencia.</p></div></div><h2>Pega el enlace de tu perfil</h2><p className="rl-sub">Primero mapeamos actividad pública. Después puedes autorizar una consulta puntual para encontrar primer grado y contactos mutuos reales.</p><div className={`rl-linkedin-card ${linkedinProfile?'connected':''}`}><div className="rl-linkedin-input"><LinkedInLogo size={22}/><input aria-label="Enlace de perfil de LinkedIn" placeholder="https://www.linkedin.com/in/tu-perfil" value={linkedinUrl} onChange={e=>{setLinkedinUrl(e.target.value);setLinkedinProfile(undefined);setLinkedinInteractions(undefined);}}/><button className="rl-primary" disabled={busy||!connectors.linkedin?.configured||!linkedinUrl.trim()} onClick={()=>void connectLinkedIn()}>{busy?<LoaderCircle className="spin" size={17}/>:<Link2 size={16}/>} {linkedinProfile?'Volver a mapear':'Mapear con Apify'}</button></div>{linkedinProfile&&<div className="rl-linkedin-result"><span><Check size={15}/></span><div><b>{linkedinProfile.name||'Perfil conectado'}</b><small>{[linkedinProfile.headline,linkedinProfile.location].filter(Boolean).join(' · ')||'Información pública verificada'}</small>{linkedinInteractions&&<small>{linkedinInteractions.status==='ready'?`${linkedinInteractions.count} relaciones públicas encontradas`:linkedinInteractions.status==='partial'?`${linkedinInteractions.count} relaciones encontradas; una fuente de actividad no respondió`:linkedinInteractions.status==='empty'?'Perfil verificado, pero no encontramos actividad pública reciente para construir relaciones':`Perfil verificado; actividad pública no disponible${linkedinInteractions.error?`: ${linkedinInteractions.error}`:''}`}</small>}</div></div>}{!connectors.linkedin?.configured&&<p className="rs-notice error">Apify está temporalmente fuera de servicio. Puedes continuar y volver a mapear después.</p>}</div>{linkedinProfile&&<div className="rl-auth-network"><div><ShieldCheck size={18}/><span><b>Mapa autenticado, uso puntual</b><small>Introduce el valor de <code>li_at</code> o un JSON de cookies. Se envía directamente a los Actors y nunca se guarda en nuestra base de datos.</small></span></div><div className="rl-auth-input"><input type="password" autoComplete="off" aria-label="Sesión temporal de LinkedIn" placeholder="li_at o JSON de cookies" value={linkedinCookie} onChange={e=>setLinkedinCookie(e.target.value)}/><button className="rl-primary" disabled={busy||!linkedinCookie.trim()} onClick={()=>void buildAuthenticatedGraph()}>{busy?<LoaderCircle className="spin" size={16}/>:<Network size={16}/>} Construir red verificada</button></div><p>Consulta hasta 40 perfiles relevantes y hasta 5 candidatos de segundo grado; puede consumir créditos de Apify. LinkedIn puede limitar sesiones automatizadas.</p>{graphResult&&<p className="rs-notice">{graphResult.people} perfiles revisados · {graphResult.direct} conexiones directas · {graphResult.mutualPaths} caminos con contacto mutuo.{graphResult.errors.length?` ${graphResult.errors.length} consultas parciales fallaron.`:''}</p>}</div>}{networkGraph&&networkGraph.nodes.length>1&&<NetworkGraphView graph={networkGraph}/>}<OtherPlatforms/><p className="rl-linkedin-privacy"><ShieldCheck size={15}/> Las líneas continuas son relaciones autenticadas; las punteadas son señales públicas o contactos importados.</p><div className="rl-actions"><button className="rl-skip" onClick={()=>void finish()}>Ahora no</button><button className="rl-primary" disabled={busy||Boolean(linkedinUrl.trim()&&!linkedinProfile)} onClick={()=>void finish()}>Entrar a mi espacio <ChevronRight size={17}/></button></div></>}
  </section><p className="rl-foot">Tus documentos se leen en tu navegador; solo guardamos el texto extraído y el perfil, asociados únicamente a tu cuenta.</p></main></Frame>;
}

/* Movido a app/profile.ts (se reexporta para compatibilidad). */
export { briefFromProfile } from './app/profile';
import { briefFromProfile } from './app/profile';

export function MemberWorkspace({session,onLogout,onSession}: {session:AccountSession;onLogout:()=>void;onSession:(session:AccountSession)=>void}) {
  const profile=session.profile!;
  const [editing,setEditing]=useState(false);
  const [run,setRun]=useState(0);
  const [networkOpen,setNetworkOpen]=useState(false);
  const [networkGraph,setNetworkGraph]=useState<NetworkGraphData|null>(null);
  const [networkCookie,setNetworkCookie]=useState('');
  const [networkBusy,setNetworkBusy]=useState(false);
  const [networkError,setNetworkError]=useState('');
  const [networkResult,setNetworkResult]=useState<AuthenticatedGraphResult|null>(null);
  const brief=briefFromProfile(profile);
  const saved=(next:AccountSession['profile'])=>{
    try { sessionStorage.removeItem('igc-research-job'); } catch { /* sin almacenamiento */ }
    onSession({...session,profile:next});
    setEditing(false); setRun(r=>r+1);
  };
  async function openNetwork() {
    setNetworkOpen(true); setNetworkError('');
    try { setNetworkGraph(await accountApi.networkGraph()); }
    catch(error){setNetworkError(errorText(error));}
  }
  async function buildNetwork() {
    setNetworkBusy(true); setNetworkError(''); setNetworkResult(null);
    try { const value=await accountApi.buildAuthenticatedGraph(networkCookie); setNetworkGraph(value.graph); setNetworkResult(value.result); setNetworkCookie(''); }
    catch(error){setNetworkError(errorText(error));} finally{setNetworkBusy(false);}
  }
  async function removeNetwork() {
    setNetworkBusy(true); setNetworkError('');
    try { setNetworkGraph(await accountApi.deleteAuthenticatedGraph()); setNetworkResult(null); }
    catch(error){setNetworkError(errorText(error));} finally{setNetworkBusy(false);}
  }
  if(editing) return <ProfileEditor onCancel={()=>setEditing(false)} onSaved={saved}/>;
  const org=profile.founder.org, venture=profile.project.venture;
  return <div className="member-shell"><header><Brand/><div><span><b>{venture&&venture!==org?`${venture} · vía ${org}`:org}</b><small>{session.user.email}</small></span><button className="rs-button" onClick={()=>void openNetwork()}><Network size={14}/> Mi red</button><button className="rs-button" onClick={()=>setEditing(true)}><Pencil size={14}/> Editar perfil</button><button className="rs-button" onClick={onLogout}><LogOut size={14}/> Cerrar sesión</button></div></header><main><ResearchPage key={run} initialBrief={brief} autoStart onEdit={()=>setEditing(true)} onLogout={onLogout}/></main>{networkOpen&&<div className="member-network-overlay" role="dialog" aria-modal="true" aria-label="Mi network graph"><div className="member-network-panel"><header><div><button className="rl-back" onClick={()=>setNetworkOpen(false)} aria-label="Cerrar network graph"><ArrowLeft size={18}/></button><span><h2>Mi network graph</h2><p>Conexiones, contactos mutuos e interacciones públicas con evidencia.</p></span></div>{networkGraph&&networkGraph.summary.verified>0&&<button className="rs-button" disabled={networkBusy} onClick={()=>void removeNetwork()}>Eliminar red autenticada</button>}</header>{networkError&&<p className="rs-notice error" role="alert">{networkError}</p>}<div className="rl-auth-network"><div><ShieldCheck size={18}/><span><b>Actualizar desde mi sesión de LinkedIn</b><small>La sesión se usa una sola vez para consultar Apify; no queda guardada. Los Actors son comunitarios y la ejecución puede consumir créditos.</small></span></div><div className="rl-auth-input"><input type="password" autoComplete="off" aria-label="Sesión temporal de LinkedIn" placeholder="Valor de li_at o JSON de cookies" value={networkCookie} onChange={e=>setNetworkCookie(e.target.value)}/><button className="rl-primary" disabled={networkBusy||!networkCookie.trim()} onClick={()=>void buildNetwork()}>{networkBusy?<LoaderCircle className="spin" size={16}/>:<Network size={16}/>} Mapear conexiones reales</button></div>{networkResult&&<p className="rs-notice">{networkResult.people} perfiles revisados · {networkResult.direct} conexiones directas · {networkResult.mutualPaths} caminos con contacto mutuo.{networkResult.errors.length?` ${networkResult.errors.length} consultas no respondieron.`:''}</p>}</div>{networkGraph&&networkGraph.nodes.length>1?<NetworkGraphView graph={networkGraph}/>:<div className="rs-empty"><Network size={28}/><h2>Tu grafo todavía está vacío</h2><p>Mapea tu perfil público o ejecuta una consulta autenticada para añadir relaciones verificadas.</p></div>}<p className="rl-linkedin-privacy"><ShieldCheck size={15}/> Línea continua: relación autenticada. Línea punteada: interacción pública o contacto importado.</p></div></div>}</div>;
}

/* Editar el perfil ya confirmado (con el agente o a mano) y repetir la investigación. */
function ProfileEditor({onCancel,onSaved}: {onCancel:()=>void;onSaved:(profile:AccountSession['profile'])=>void}) {
  const [intake,setIntake]=useState<IntakeState|null>(null);
  const [mode,setMode]=useState<'form'|'agent'>('form');
  const [furthest,setFurthest]=useState<0|1>(0);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{void intakeApi.get().then(setIntake).catch(e=>setError(errorText(e)));},[]);
  async function save() {
    setBusy(true); setError('');
    try {
      const result=await intakeApi.confirm();
      const profile=await accountApi.saveProfile({...result.profile,onboardingComplete:true});
      onSaved(profile);
    } catch(e){ setError(errorText(e)); setBusy(false); }
  }
  const next=()=>{setError('');setFurthest(1);setMode('agent');};
  const remove=(id:string)=>void intakeApi.removeDocument(id).then(setIntake).catch(e=>setError(errorText(e)));
  return <Frame><aside className="rl-left"><Brand/><div className="rl-left-body ia-left"><LiveProfile intake={intake} onRemoveDocument={remove}/></div><p className="rl-live"><ShieldCheck size={13}/> Al guardar se repite la investigación</p></aside><main className="rl-right profile-editor"><div className="rl-nav profile-editor-nav"><button className="rl-back" onClick={onCancel} aria-label="Volver a mis resultados"><ArrowLeft size={18}/></button><ol className="profile-editor-steps" aria-label={`Paso ${mode==='form'?1:2} de 2`}>
    <li className={mode==='form'?'now':'done'}><button onClick={()=>setMode('form')}><i>{mode==='agent'?<Check size={14}/>:1}</i><span><small>Paso 1</small><strong>Editar campos</strong></span></button></li>
    <li className={mode==='agent'?'now':''}><button disabled={furthest<1} onClick={()=>setMode('agent')}><i>2</i><span><small>Paso 2</small><strong>Contarle al agente</strong></span></button></li>
  </ol></div><section className="rl-step ia-step">{error&&<p className="rs-notice error" role="alert">{error}</p>}
    {!intake?<LoaderCircle className="spin" size={20}/>:mode==='agent'?<AgentChat intake={intake} onChange={setIntake} onReview={()=>void save()} onError={setError} title="Cuéntale al agente qué quieres cambiar" description="Añade contexto, adjunta un documento o aclara cualquier dato antes de guardar el perfil." reviewLabel="Guardar y repetir búsqueda" reviewRequiresConversation={false}/>:<ConfirmProfile intake={intake} onChange={setIntake} onBack={onCancel} onConfirm={next} busy={busy} onError={setError} title="Edita los campos de tu perfil" confirmLabel="Continuar" backLabel="Cancelar edición"/>}
  </section></main></Frame>;
}
