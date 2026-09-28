import {
  Building2, CheckCircle2, Filter, GraduationCap, LoaderCircle, Network, Plus, SlidersHorizontal, Target, Trash2, UserRound, UsersRound,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api, type Affiliation, type DeclaredContact, type FactorKey, type FundingType, type ProjectConfig, type TeamMember, type TeamRole } from './api';
import { factorLabels } from './ui';

type Section = 'project' | 'founder' | 'team' | 'contacts' | 'affiliations' | 'comparables' | 'filters' | 'ranking';
const SECTIONS: { id: Section; label: string; hint: string; icon: typeof Target; group: string }[] = [
  { id: 'project', label: 'Empresa y producto', hint: 'Qué producto financias y con qué tipo de capital', icon: Building2, group: 'Empresa' },
  { id: 'comparables', label: 'Comparables', hint: 'Startups parecidas que ya levantaron', icon: Target, group: 'Empresa' },
  { id: 'founder', label: 'Founder', hint: 'Raíz de los caminos cálidos', icon: UserRound, group: 'Red' },
  { id: 'team', label: 'Equipo y grupo', hint: 'Cofounders, board, advisors e inversionistas actuales', icon: UsersRound, group: 'Red' },
  { id: 'contacts', label: 'Contactos clave', hint: 'Personas que conocen sin export de por medio', icon: Network, group: 'Red' },
  { id: 'affiliations', label: 'Afiliaciones', hint: 'Universidades, empresas, aceleradoras, grupo', icon: GraduationCap, group: 'Red' },
  { id: 'filters', label: 'Filtros de inversión', hint: 'Etapa, ticket, geografía y exclusiones', icon: Filter, group: 'Ranking' },
  { id: 'ranking', label: 'Criterios del ranking', hint: 'Pesos y tamaño del top', icon: SlidersHorizontal, group: 'Ranking' },
];
const FACTORS: FactorKey[] = ['thesis', 'seed', 'coinvest', 'path', 'activity'];
export const ROLES: { id: TeamRole; label: string; tie: number }[] = [
  { id: 'cofounder', label: 'Cofounder', tie: 0.92 }, { id: 'equipo', label: 'Equipo', tie: 0.8 },
  { id: 'board', label: 'Board', tie: 0.75 }, { id: 'inversionista', label: 'Inversionista actual', tie: 0.7 },
  { id: 'advisor', label: 'Advisor', tie: 0.65 }, { id: 'grupo', label: 'Grupo empresarial', tie: 0.6 },
];
const CLOSENESS: { value: number | null; label: string }[] = [
  { value: null, label: 'Según rol' }, { value: 0.9, label: 'Muy cercana' }, { value: 0.7, label: 'Cercana' }, { value: 0.45, label: 'Ocasional' },
];
const STRENGTHS: { id: DeclaredContact['strength']; label: string }[] = [{ id: 'fuerte', label: 'Fuerte' }, { id: 'media', label: 'Media' }, { id: 'debil', label: 'Débil' }];
const AFF_KINDS: { id: Affiliation['kind']; label: string }[] = [
  { id: 'universidad', label: 'Universidad' }, { id: 'empresa', label: 'Empresa anterior' }, { id: 'aceleradora', label: 'Aceleradora' },
  { id: 'comunidad', label: 'Comunidad' }, { id: 'grupo', label: 'Grupo empresarial' },
];
const STAGES = ['pre-seed', 'seed', 'series-a', 'series-b', 'growth'];
export const FUNDING: { id: FundingType; label: string; hint: string }[] = [
  { id: 'grant', label: 'Grants (no dilutivo)', hint: 'No entregas participación de la empresa' },
  { id: 'venture', label: 'Venture capital', hint: 'Capital a cambio de participación' },
  { id: 'angel', label: 'Ángeles', hint: 'Personas que invierten su propio dinero' },
  { id: 'corporate', label: 'Corporativo / estratégico', hint: 'Farmas, aseguradoras o empresas del sector' },
  { id: 'debt', label: 'Deuda / venture debt', hint: 'Préstamo; no diluye, pero hay que pagarlo' },
  { id: 'bootstrapping', label: 'Bootstrapping / ingresos', hint: 'Crecer con ventas o revenue-based financing' },
];

const emptyMember = (): TeamMember => ({ name: '', email: '', linkedin_url: '', org: '', role: 'cofounder', shares_network: false, closeness: null });
const emptyContact = (): DeclaredContact => ({ name: '', org: '', linkedin_url: '', known_by: '', strength: 'media', note: '' });
const emptyAffiliation = (): Affiliation => ({ name: '', kind: 'universidad', members: [] });
/** El backend puede devolver configuraciones anteriores sin las listas nuevas. */
const withDefaults = (c: ProjectConfig): ProjectConfig => ({ ...c, team: c.team || [], contacts: c.contacts || [], affiliations: c.affiliations || [], exclude_funds: c.exclude_funds || [] });

/** Página de configuración independiente: define qué significa "buen fit" para el motor. */
export function SettingsPage({ onSaved }: { onSaved: () => Promise<void> }) {
  const [config, setConfig] = useState<ProjectConfig | null>(null);
  const [saved, setSaved] = useState<string>('');
  const [section, setSection] = useState<Section>('project');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { api.config().then((raw) => { const c = withDefaults(raw); setConfig(c); setSaved(JSON.stringify(c)); }).catch((e) => setMessage(e.message)); }, []);

  if (!config) return <div className="cfg-loading">{message || <><LoaderCircle className="spin" size={18} /> Cargando configuración…</>}</div>;
  const dirty = JSON.stringify(config) !== saved;
  const save = async () => {
    setSaving(true); setMessage('');
    try { await api.saveConfig(config); setSaved(JSON.stringify(config)); await onSaved(); setMessage('Guardado. Ya puedes actualizar la búsqueda.'); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'No fue posible guardar'); }
    finally { setSaving(false); }
  };
  const updateProject = (key: keyof ProjectConfig['project'], value: unknown) => setConfig({ ...config, project: { ...config.project, [key]: value } });
  const updateFounder = (key: keyof ProjectConfig['founder'], value: string) => setConfig({ ...config, founder: { ...config.founder, [key]: value } });
  const list = (value: string) => value.split(',').map((v) => v.trim()).filter(Boolean);
  const patchAt = <K extends 'comparables' | 'team' | 'contacts' | 'affiliations'>(key: K, index: number, patch: Partial<ProjectConfig[K][number]>) => {
    const items = [...config[key]] as ProjectConfig[K][number][]; items[index] = { ...items[index], ...patch }; setConfig({ ...config, [key]: items });
  };
  const removeAt = (key: 'comparables' | 'team' | 'contacts' | 'affiliations', index: number) => setConfig({ ...config, [key]: (config[key] as unknown[]).filter((_, i) => i !== index) });
  const weightTotal = FACTORS.reduce((s, k) => s + (config.weights[k] || 0), 0) || 1;
  const current = SECTIONS.find((s) => s.id === section)!;
  const people = [config.founder.name || 'Founder', ...config.team.map((m) => m.name).filter(Boolean)];
  const counts: Partial<Record<Section, number>> = { team: config.team.length, contacts: config.contacts.length, affiliations: config.affiliations.length, comparables: config.comparables.length };
  const sharing = config.team.filter((m) => m.shares_network).length;

  return (
    <div className="cfg">
      <header className="cfg-head">
        <div><span>Configuración</span><h1>El fit de tu empresa</h1><p>Qué hace la empresa, quién la respalda y qué inversionista le conviene. El ranking no inventa campos que no hayas declarado.</p></div>
        <div className="cfg-save">
          <small className={dirty ? 'dirty' : ''}>{message || (dirty ? 'Cambios sin guardar' : 'Todo guardado')}</small>
          <button className="run-pill" onClick={save} disabled={saving || !dirty}>{saving ? <LoaderCircle className="spin" size={17} /> : <CheckCircle2 size={17} />} Guardar</button>
        </div>
      </header>

      <div className="cfg-body">
        <nav className="cfg-nav" aria-label="Secciones de configuración">
          {SECTIONS.map(({ id, label, hint, icon: Icon, group }, i) => (
            <div key={id} className="cfg-nav-item">
              {(i === 0 || SECTIONS[i - 1].group !== group) && <em className="cfg-nav-group">{group}</em>}
              <button className={section === id ? 'on' : ''} onClick={() => setSection(id)} aria-current={section === id ? 'page' : undefined}>
                <i><Icon size={18} strokeWidth={1.7} /></i><span><strong>{label}{counts[id] ? <b className="cfg-count">{counts[id]}</b> : null}</strong><small>{hint}</small></span>
              </button>
            </div>
          ))}
        </nav>

        <section className="cfg-panel">
          <header><h2>{current.label}</h2><p>{current.hint}.</p></header>
          {section === 'project' && <div className="form-grid">
            <Field label="Empresa"><input value={config.founder.org} onChange={(e) => updateFounder('org', e.target.value)} /></Field>
            <Field label="Producto a financiar"><input value={config.project.name} onChange={(e) => updateProject('name', e.target.value)} /></Field>
            <div className="wide cfg-field-group" role="group" aria-label="Tipo de financiación"><span>Tipo de financiación que buscas</span>
              <div className="cfg-chips plain">{FUNDING.map((f) => {
                const cur = config.project.funding_types || ['venture'];
                const on = cur.includes(f.id);
                return <button key={f.id} className={on ? 'on' : ''} title={f.hint} onClick={() => updateProject('funding_types', on ? cur.filter((x) => x !== f.id) : [...cur, f.id])}>{f.label}</button>;
              })}</div>
            </div>
            <Field label="Etapa"><select value={config.project.stage} onChange={(e) => updateProject('stage', e.target.value)}>{STAGES.map((stage) => <option key={stage}>{stage}</option>)}</select></Field>
            <Field label="Qué hace el producto, en una frase" wide><input value={config.project.one_liner} onChange={(e) => updateProject('one_liner', e.target.value)} /></Field>
            <Field label="Descripción del producto" wide><textarea rows={5} value={config.project.description} onChange={(e) => updateProject('description', e.target.value)} /></Field>
            <Field label="Capital a levantar (USD)"><input type="number" value={config.project.raise_usd || ''} onChange={(e) => updateProject('raise_usd', Number(e.target.value) || null)} /></Field>
            <Field label="Geografías (separadas por coma)"><input value={config.project.geo.join(', ')} onChange={(e) => updateProject('geo', list(e.target.value))} /></Field>
            <Field label="Sectores (separados por coma)" wide><input value={config.project.sectors.join(', ')} onChange={(e) => updateProject('sectors', list(e.target.value))} /></Field>
            <Field label="Palabras clave (separadas por coma)" wide><input value={(config.project.keywords || []).join(', ')} onChange={(e) => updateProject('keywords', list(e.target.value))} /></Field>
          </div>}

          {section === 'founder' && <div className="form-grid">
            <Field label="Nombre"><input value={config.founder.name} onChange={(e) => updateFounder('name', e.target.value)} /></Field>
            <Field label="Rol"><input placeholder="CEO, founder, director científico…" value={config.founder.title || ''} onChange={(e) => updateFounder('title', e.target.value)} /></Field>
            <Field label="Email"><input type="email" value={config.founder.email} onChange={(e) => updateFounder('email', e.target.value)} /></Field>
            <Field label="LinkedIn"><input value={config.founder.linkedin_url} onChange={(e) => updateFounder('linkedin_url', e.target.value)} /></Field>
          </div>}

          {section === 'team' && <div className="cfg-list">
            <NetworkReach config={config} />
            {config.team.map((m, i) => (
              <article key={i} className="cfg-card">
                <div className="cfg-card-row">
                  <span className="cfg-num">{i + 1}</span>
                  <input aria-label="Nombre" placeholder="Nombre completo" value={m.name} onChange={(e) => patchAt('team', i, { name: e.target.value })} />
                  <select aria-label="Rol" value={m.role} onChange={(e) => patchAt('team', i, { role: e.target.value as TeamRole })}>{ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
                  <button className="cfg-del" onClick={() => removeAt('team', i)} aria-label={`Quitar ${m.name || 'miembro'}`}><Trash2 size={16} /></button>
                </div>
                <div className="cfg-card-grid">
                  <input aria-label="Organización" placeholder="Organización / fondo / empresa del grupo" value={m.org} onChange={(e) => patchAt('team', i, { org: e.target.value })} />
                  <input aria-label="Email" placeholder="email@dominio.com" value={m.email} onChange={(e) => patchAt('team', i, { email: e.target.value })} />
                  <input aria-label="LinkedIn" placeholder="linkedin.com/in/…" value={m.linkedin_url} onChange={(e) => patchAt('team', i, { linkedin_url: e.target.value })} />
                </div>
                <div className="cfg-card-foot">
                  <label className="cfg-inline">Cercanía contigo
                    <select value={m.closeness ?? ''} onChange={(e) => patchAt('team', i, { closeness: e.target.value ? Number(e.target.value) : null })}>
                      {CLOSENESS.map((c) => <option key={c.label} value={c.value ?? ''}>{c.label}{c.value === null ? ` (${Math.round((ROLES.find((r) => r.id === m.role)?.tie || 0) * 100)}%)` : ''}</option>)}
                    </select>
                  </label>
                  <label className="cfg-switch"><input type="checkbox" checked={m.shares_network} onChange={(e) => patchAt('team', i, { shares_network: e.target.checked })} /><i />Comparte su red (con consentimiento)</label>
                </div>
                {m.shares_network && <p className="cfg-note">Carga su export con <code>warmpath consent add "{m.name || 'Nombre'}"</code> y luego <code>warmpath linkedin &lt;carpeta&gt; --owner-name "{m.name || 'Nombre'}"</code>. Sus contactos pasan a ser 1er grado de tu red.</p>}
              </article>
            ))}
            <button className="cfg-add" onClick={() => setConfig({ ...config, team: [...config.team, emptyMember()] })}><Plus size={15} /> Añadir persona</button>
            {!config.team.length && <Empty text="Suma a tus cofounders, board, advisors, inversionistas actuales o personas del grupo. Cada una se vuelve un punto de partida más para llegar a un fondo." />}
          </div>}

          {section === 'contacts' && <div className="cfg-list">
            <p className="cfg-lead">Personas que tú o tu equipo conocen y que no aparecen en ningún export: un partner con quien coincidiste, un ángel, un exjefe. Si trabajan en un fondo, el motor abre la ruta directa.</p>
            {config.contacts.map((c, i) => (
              <article key={i} className="cfg-card">
                <div className="cfg-card-row">
                  <span className="cfg-num">{i + 1}</span>
                  <input aria-label="Nombre del contacto" placeholder="Nombre del contacto" value={c.name} onChange={(e) => patchAt('contacts', i, { name: e.target.value })} />
                  <input aria-label="Fondo o empresa" placeholder="Fondo o empresa donde trabaja" value={c.org} onChange={(e) => patchAt('contacts', i, { org: e.target.value })} />
                  <button className="cfg-del" onClick={() => removeAt('contacts', i)} aria-label={`Quitar ${c.name || 'contacto'}`}><Trash2 size={16} /></button>
                </div>
                <div className="cfg-card-foot">
                  <label className="cfg-inline">Lo conoce
                    <select value={c.known_by} onChange={(e) => patchAt('contacts', i, { known_by: e.target.value })}>
                      {people.map((p, j) => <option key={p + j} value={j === 0 ? '' : p}>{p}</option>)}
                    </select>
                  </label>
                  <div className="cfg-seg" role="group" aria-label="Fuerza del vínculo">
                    {STRENGTHS.map((s) => <button key={s.id} className={c.strength === s.id ? 'on' : ''} onClick={() => patchAt('contacts', i, { strength: s.id })}>{s.label}</button>)}
                  </div>
                  <input className="cfg-grow" aria-label="Nota" placeholder="Contexto: dónde se conocieron, último contacto…" value={c.note} onChange={(e) => patchAt('contacts', i, { note: e.target.value })} />
                </div>
              </article>
            ))}
            <button className="cfg-add" onClick={() => setConfig({ ...config, contacts: [...config.contacts, emptyContact()] })}><Plus size={15} /> Añadir contacto</button>
          </div>}

          {section === 'affiliations' && <div className="cfg-list">
            <p className="cfg-lead">Organizaciones que comparten con personas del grafo. El motor las usa como <b>hipótesis</b> débiles (hay que confirmar que se conocen), nunca como un camino confirmado.</p>
            {config.affiliations.map((a, i) => (
              <article key={i} className="cfg-card">
                <div className="cfg-card-row">
                  <span className="cfg-num">{i + 1}</span>
                  <input aria-label="Organización" placeholder="Ej.: Universidad de los Andes, Y Combinator, Grupo XYZ" value={a.name} onChange={(e) => patchAt('affiliations', i, { name: e.target.value })} />
                  <select aria-label="Tipo" value={a.kind} onChange={(e) => patchAt('affiliations', i, { kind: e.target.value as Affiliation['kind'] })}>{AFF_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select>
                  <button className="cfg-del" onClick={() => removeAt('affiliations', i)} aria-label={`Quitar ${a.name || 'afiliación'}`}><Trash2 size={16} /></button>
                </div>
                <div className="cfg-chips" role="group" aria-label="Quiénes pertenecen">
                  <small>Pertenecen:</small>
                  {people.map((p, j) => {
                    const key = j === 0 ? '' : p;
                    const on = j === 0 ? !a.members.length || a.members.includes('') : a.members.includes(p);
                    const toggle = () => {
                      const base = a.members.length ? a.members : [''];
                      const next = on ? base.filter((x) => x !== key) : [...base, key];
                      patchAt('affiliations', i, { members: next.length === 1 && next[0] === '' ? [] : next });
                    };
                    return <button key={p + j} className={on ? 'on' : ''} onClick={toggle}>{p}</button>;
                  })}
                </div>
              </article>
            ))}
            <button className="cfg-add" onClick={() => setConfig({ ...config, affiliations: [...config.affiliations, emptyAffiliation()] })}><Plus size={15} /> Añadir afiliación</button>
          </div>}

          {section === 'comparables' && <div className="cfg-comps">
            {config.comparables.map((item, index) => (
              <div key={index} className="cfg-comp">
                <span className="cfg-num">{index + 1}</span>
                <input aria-label={`Comparable ${index + 1}`} placeholder="Nombre" value={item.name} onChange={(e) => patchAt('comparables', index, { name: e.target.value })} />
                <input aria-label={`Dominio comparable ${index + 1}`} placeholder="dominio.com" value={item.domain} onChange={(e) => patchAt('comparables', index, { domain: e.target.value })} />
                <button className="cfg-del" onClick={() => removeAt('comparables', index)} aria-label={`Quitar comparable ${index + 1}`}><Trash2 size={16} /></button>
              </div>
            ))}
            <button className="cfg-add" onClick={() => setConfig({ ...config, comparables: [...config.comparables, { name: '', domain: '', sec_cik: '', aliases: [], why: '' }] })}><Plus size={15} /> Añadir comparable</button>
          </div>}

          {section === 'filters' && <div className="form-grid">
            <div className="wide cfg-field-group" role="group" aria-label="Etapas que aceptas"><span>Etapas que aceptas</span>
              <div className="cfg-chips plain">{STAGES.map((st) => {
                const on = config.filters.stages_allowed.includes(st);
                return <button key={st} className={on ? 'on' : ''} onClick={() => setConfig({ ...config, filters: { ...config.filters, stages_allowed: on ? config.filters.stages_allowed.filter((x) => x !== st) : [...config.filters.stages_allowed, st] } })}>{st}</button>;
              })}</div>
            </div>
            <Field label="Ticket mínimo (USD)"><input type="number" value={config.filters.ticket_min_usd || ''} onChange={(e) => setConfig({ ...config, filters: { ...config.filters, ticket_min_usd: Number(e.target.value) || null } })} /></Field>
            <Field label="Ticket máximo (USD)"><input type="number" value={config.filters.ticket_max_usd || ''} onChange={(e) => setConfig({ ...config, filters: { ...config.filters, ticket_max_usd: Number(e.target.value) || null } })} /></Field>
            <Field label="Geografías de los fondos (US, LATAM, GLOBAL…)" wide><input value={config.filters.geos.join(', ')} onChange={(e) => setConfig({ ...config, filters: { ...config.filters, geos: list(e.target.value) } })} /></Field>
            <Field label="Fondos a excluir (separados por coma)" wide><input placeholder="Conflictos, fondos que ya dijeron que no…" value={config.exclude_funds.join(', ')} onChange={(e) => setConfig({ ...config, exclude_funds: list(e.target.value) })} /></Field>
            <label className="cfg-switch wide"><input type="checkbox" checked={config.filters.require_known_stage} onChange={(e) => setConfig({ ...config, filters: { ...config.filters, require_known_stage: e.target.checked } })} /><i />Descartar fondos que no publican su etapa</label>
          </div>}

          {section === 'ranking' && <div className="cfg-rank">
            {FACTORS.map((key) => (
              <label key={key} className="cfg-weight">
                <span><strong>{factorLabels[key]}</strong><small>{Math.round((config.weights[key] || 0) / weightTotal * 100)}% del score</small></span>
                <input type="range" min={0} max={1} step={0.05} value={config.weights[key] || 0} onChange={(e) => setConfig({ ...config, weights: { ...config.weights, [key]: Number(e.target.value) } })} />
                <b>{(config.weights[key] || 0).toFixed(2)}</b>
              </label>
            ))}
            <div className="form-grid cfg-rank-extra">
              <Field label="Tamaño del top"><input type="number" min={5} max={100} value={config.top_n} onChange={(e) => setConfig({ ...config, top_n: Number(e.target.value) || 20 })} /></Field>
              <Field label="Saltos máximos en la ruta"><input type="number" min={1} max={4} value={config.max_hops} onChange={(e) => setConfig({ ...config, max_hops: Number(e.target.value) || 2 })} /></Field>
            </div>
          </div>}
          {sharing > 0 && section === 'team' && <p className="cfg-foot-note">{sharing} {sharing === 1 ? 'persona comparte' : 'personas comparten'} su red. Solo se usan metadatos (quién, cuándo, canal); nunca el contenido de los mensajes.</p>}
        </section>
      </div>
    </div>
  );
}

/** Resumen visual: el founder en el centro y el equipo como raíces adicionales de caminos cálidos. */
function NetworkReach({ config }: { config: ProjectConfig }) {
  const members = config.team.filter((m) => m.name.trim());
  const size = 168, c = size / 2, r = 58;
  return (
    <div className="cfg-reach">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <circle cx={c} cy={c} r={r} className="reach-ring" />
        {members.slice(0, 10).map((m, i, arr) => {
          const a = (i / Math.max(1, arr.length)) * Math.PI * 2 - Math.PI / 2;
          const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
          return <g key={i}><line x1={c} y1={c} x2={x} y2={y} className={`reach-line ${m.shares_network ? 'shared' : ''}`} /><circle cx={x} cy={y} r={m.shares_network ? 9 : 7} className={`reach-dot ${m.shares_network ? 'shared' : ''}`} /></g>;
        })}
        <circle cx={c} cy={c} r={16} className="reach-core" />
      </svg>
      <div>
        <strong>{1 + members.length} {members.length ? 'puntos de partida' : 'punto de partida'}</strong>
        <p>Hoy los caminos salen de {config.founder.name || 'ti'}{members.length ? ` y de ${members.length} ${members.length === 1 ? 'persona' : 'personas'} del equipo y el grupo` : ''}. {config.contacts.length} contactos declarados y {config.affiliations.length} afiliaciones suman rutas nuevas.</p>
        <div className="reach-legend"><span><i className="reach-dot-k" />Declarado</span><span><i className="reach-dot-k shared" />Comparte su red</span></div>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) { return <p className="cfg-empty">{text}</p>; }
function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) { return <label className={wide ? 'wide' : ''}><span>{label}</span>{children}</label>; }
