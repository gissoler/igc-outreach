import {
  Bell, BellRing, Check, ChevronDown, ChevronsUpDown, Clock3, Ellipsis, Info, Mic, Monitor, Paperclip,
  Camera, Pin, Plus, Repeat, SendHorizontal, Sparkles, TextAlignCenter, TextAlignEnd, TextAlignStart, UsersRound, X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Dashboard, Recommendation } from './api';
import { buildGroups, cleanPerson, titleCase, useModelData } from './atlasModel';
import { buildSteps, readDone, weekLabel, writeDone, type Step } from './steps';
import { Avatar, initials, investorImage, money, outcomeLabels } from './ui';

export type PmTab = 'overview' | 'notifications';
type Props = {
  data: Dashboard; orgName: string; tab: PmTab;
  onTab: (tab: PmTab) => void; onSettings: () => void;
  onOpen: (fundId: string) => void; onPipeline: () => void;
};

const pts = (value: number) => (Math.round(value * 1000) / 10).toLocaleString('es-CO', { maximumFractionDigits: 1 });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const TONES = ['blue', 'gold', 'black', 'steel'] as const;

/** Módulo Project Management: réplica del tablero de referencia con los datos reales de la ronda. */
export function ProjectManagement({ data, orgName, tab, onTab, onSettings, onOpen, onPipeline }: Props) {
  const steps = useMemo(() => buildSteps(data), [data]);
  const [done, setDone] = useState<string[]>(readDone);
  const toggle = (id: string) => { const next = done.includes(id) ? done.filter((d) => d !== id) : [...done, id]; setDone(next); writeDone(next); };

  return (
    <div className="pm">
      <div className="pm-top">
        <TodoCard steps={steps} done={done} onToggle={toggle} onOpen={onOpen} />
        <ReminderCard data={data} />
        <TeamCard data={data} orgName={orgName} onOpen={onOpen} onEdit={onSettings} />
      </div>

      <section className="pm-lower">
        <div className="pm-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'overview'} className={`pm-bigtab ${tab === 'overview' ? 'on' : ''}`} onClick={() => onTab('overview')}>
            <Monitor size={20} strokeWidth={1.6} />Project Overview<Info size={14} className="pm-info" />
          </button>
          <button role="tab" aria-selected={tab === 'notifications'} className={`pm-bigtab ${tab === 'notifications' ? 'on' : ''}`} onClick={() => onTab('notifications')}>
            <Bell size={20} strokeWidth={1.4} />Notifications Panel
          </button>
          <div className="pm-tab-actions">
            <button className="pm-mini" onClick={() => onTab('notifications')} aria-label="Notificaciones"><Bell size={15} strokeWidth={1.6} /></button>
            <button className="pm-mini" onClick={onSettings} aria-label="Configuración"><Ellipsis size={16} /></button>
          </div>
        </div>
        <div className="pm-lower-body">
          {tab === 'overview'
            ? <><ReportCard data={data} onPipeline={onPipeline} onOpen={onOpen} /><ChatCard data={data} steps={steps} done={done} /><PerformanceCard data={data} /></>
            : <NotificationsPanel data={data} steps={steps} done={done} onOpen={onOpen} onEdit={onSettings} />}
        </div>
      </section>
    </div>
  );
}

/* ───────────── To do list (tarjeta dorada) ───────────── */

function TodoCard({ steps, done, onToggle, onOpen }: { steps: Step[]; done: string[]; onToggle: (id: string) => void; onOpen: (id: string) => void }) {
  const [filter, setFilter] = useState<'task' | 'collab'>('task');
  const [onlyDone, setOnlyDone] = useState(false);
  const now = new Date();
  const dateLabel = cap(now.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }).replace(/\./g, '').replace(/ de /g, ' '));
  const time = now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
  const collabKinds = ['hub', 'intro'];
  const byFilter = steps.filter((s) => (filter === 'collab' ? collabKinds.includes(s.kind) : !collabKinds.includes(s.kind)));
  const list = (onlyDone ? byFilter.filter((s) => done.includes(s.id)) : byFilter).slice(0, 6);
  const extra = Math.max(0, steps.length - list.length);
  const who = [...new Set(steps.map((s) => s.who))].slice(0, 3);
  return (
    <section className="pm-card pm-todo">
      <header className="pm-todo-head">
        <span className="pm-todo-date">{dateLabel}</span>
        <em className="pm-time"><Clock3 size={13} strokeWidth={2.2} />{time}</em>
        <span className="pm-grow" />
        <button className="pm-dots" aria-label="Opciones"><Ellipsis size={16} /></button>
        <button className={`pm-done-btn ${onlyDone ? 'on' : ''}`} onClick={() => setOnlyDone(!onlyDone)} aria-pressed={onlyDone}>Done</button>
      </header>
      <div className="pm-todo-body">
        <div className="pm-chips">
          <button className={filter === 'task' ? 'on' : ''} onClick={() => setFilter('task')}><Pin size={14} strokeWidth={1.6} />Task</button>
          <button className={filter === 'collab' ? 'on' : ''} onClick={() => setFilter('collab')}>Collaboration</button>
          <span className="pm-more">+{extra}</span>
          <span className="pm-grow" />
          <span className="pm-bell"><BellRing size={14} strokeWidth={1.8} /></span>
        </div>
        <div className="pm-title-row">
          <h3>To do list</h3><span className="pm-vsep" /><AvatarStack names={who} size={22} />
        </div>
        <ul className="pm-checklist">
          {list.map((s) => {
            const isDone = done.includes(s.id);
            return (
              <li key={s.id} className={isDone ? 'done' : ''}>
                <button className="pm-check" aria-pressed={isDone} onClick={() => onToggle(s.id)} aria-label={isDone ? 'Marcar como pendiente' : 'Marcar como hecho'}>{isDone && <Check size={12} strokeWidth={3} />}</button>
                <button className="pm-task" title={s.detail} onClick={() => s.fundId && onOpen(s.fundId)}>{s.title}{s.fundName ? ` · ${s.fundName}` : ''}</button>
              </li>
            );
          })}
          {!list.length && <li className="pm-empty">{onlyDone ? 'Aún no has completado tareas de este tipo.' : 'Sin tareas pendientes en esta categoría.'}</li>}
        </ul>
        <footer className="pm-tools" aria-hidden="true">
          <TextAlignStart size={14} /><TextAlignCenter size={14} /><TextAlignEnd size={14} /><span className="pm-vsep" /><Paperclip size={14} /><Camera size={14} />
        </footer>
      </div>
    </section>
  );
}

/* ───────────── Reminder + selector de día ───────────── */

function ReminderCard({ data }: { data: Dashboard }) {
  const [offset, setOffset] = useState(0);
  const day = new Date(); day.setDate(day.getDate() + offset);
  const dayLabel = `${cap(day.toLocaleDateString('es-CO', { weekday: 'long' }))}, ${cap(day.toLocaleDateString('es-CO', { month: 'short' }).replace('.', ''))}`;
  return (
    <section className="pm-card pm-reminder">
      <header className="pm-head"><h3>Reminder, <span>{new Date().getFullYear()}</span></h3><button className="pm-dots" aria-label="Opciones"><Ellipsis size={16} /></button></header>
      <p className="pm-activities">Activities <b>{data.readiness.length}</b></p>
      <ul className="pm-remind-list">
        {data.readiness.map((r, i) => (
          <li key={r.id} title={`${r.label}: ${r.detail}`}>
            <span className={`pm-check static ${r.ready ? 'on' : ''}`}>{r.ready && <Check size={11} strokeWidth={3} />}</span>
            <span className="pm-pair"><i className={`t-${TONES[i % 4]}`}>{initials(r.label)}</i><i className={`t-${TONES[(i + 1) % 4]}`}>{r.label.slice(0, 1)}{r.id.slice(0, 1).toUpperCase()}</i></span>
            <span className="pm-rep"><Repeat size={13} strokeWidth={1.8} />{r.ready ? 'Listo' : 'Falta'}</span>
          </li>
        ))}
      </ul>
      <div className="pm-daypicker">
        <button className="pm-day-top" onClick={() => setOffset(0)} title="Volver a hoy" aria-label="Volver a hoy">
          {dayLabel}<ChevronsUpDown size={15} />
        </button>
        <div className="pm-day-num">
          <button onClick={() => setOffset(offset - 1)} aria-label="Día anterior">‹</button>
          <strong>{day.getDate()}</strong>
          <button onClick={() => setOffset(offset + 1)} aria-label="Día siguiente">›</button>
        </div>
      </div>
    </section>
  );
}

/* ───────────── Team Collaboration ───────────── */

type Person = { name: string; sub: string; note?: string; fundId?: string; active: boolean };

function TeamCard({ data, orgName, onOpen, onEdit }: { data: Dashboard; orgName: string; onOpen: (id: string) => void; onEdit: () => void }) {
  const { funds, links } = useModelData(data);
  const connectors: Person[] = useMemo(() => {
    const nets = buildGroups(funds, links, 'network').filter((g) => g.id !== 'net:loose');
    const list: Person[] = nets.map((g) => ({ name: titleCase(cleanPerson(g.label)), sub: `Socio en ${g.funds.length} fondos`, note: `Conecta con ${g.funds.slice(0, 2).map((f) => f.name).join(' y ')}`, fundId: g.funds[0].fund_id, active: true }));
    for (const f of funds) {
      if (list.length >= 3) break;
      const p = f.people?.[0];
      if (p && !list.some((x) => x.name === titleCase(cleanPerson(p.name)))) list.push({ name: titleCase(cleanPerson(p.name)), sub: 'Contacto del fondo', note: f.name, fundId: f.fund_id, active: false });
    }
    return list.slice(0, 3);
  }, [data]);
  const hasFounder = Boolean(data.founder.name) && !/NOMBRE DEL FOUNDER/i.test(data.founder.name);
  const team: Person[] = [
    { name: hasFounder ? data.founder.name : 'Tu perfil', sub: hasFounder ? 'Founder' : 'Founder · completa tu nombre', active: hasFounder },
    { name: data.founder.org || data.project.name, sub: `Empresa · ${data.project.stage}`, active: true },
  ];
  const head = [...team, ...connectors, { name: orgName, sub: '', active: true }].slice(0, 5);
  return (
    <section className="pm-team">
      <div className="pm-team-tabrow">
        <div className="pm-tab"><UsersRound size={20} strokeWidth={1.8} />Team Collaboration</div>
        <div className="pm-team-avatars">
          {head.map((p, i) => <span key={p.name + i} className={`pm-av t-${TONES[i % 4]}`} title={p.name}>{initials(p.name)}<i className={p.active ? 'on' : 'off'} /></span>)}
        </div>
        <span className="pm-grow" />
        <button className="pm-dots float" onClick={onEdit} aria-label="Editar equipo"><Ellipsis size={16} /></button>
      </div>
      <div className="pm-team-body">
        <div className="pm-team-col">
          <button className="pm-slot" onClick={onEdit} title="Editar founder y comparables"><Plus size={18} strokeWidth={1.4} /><span className="pm-dots">⋯</span><i className="off" /></button>
          {team.map((p, i) => (
            <div key={p.name} className="pm-person">
              <span className={`pm-av lg t-${i ? 'gold' : 'blue'}`}>{initials(p.name)}</span>
              <span><strong>{p.name}</strong><small>{p.sub}</small></span>
              <button className="pm-cal" onClick={onEdit} aria-label="Editar"><CalendarIcon /></button>
              <i className="on" />
            </div>
          ))}
          <button className="pm-slot" onClick={onEdit} title="Añadir comparable"><Plus size={18} strokeWidth={1.4} /><span className="pm-dots">⋯</span><i className="off" /></button>
        </div>
        <div className="pm-team-col right">
          {connectors.map((p, i) => (
            <button key={p.name} className="pm-person tall" onClick={() => p.fundId && onOpen(p.fundId)} title="Ver fondo">
              <i className={p.active ? 'on' : 'off'} />
              <span className={`pm-av lg t-${['blue', 'gold', 'black'][i]}`}>{initials(p.name)}</span>
              <span><strong>{p.name}</strong><small>{p.sub}</small></span>
              <span className="pm-cal"><CalendarIcon /></span>
              <em>{p.note}</em>
            </button>
          ))}
          {!connectors.length && <div className="pm-person tall empty"><span><strong>Sin conectores aún</strong><small>Ejecuta la búsqueda</small></span></div>}
        </div>
      </div>
    </section>
  );
}
const CalendarIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></svg>;

/* ───────────── Detailed Report ───────────── */

function ReportCard({ data, onPipeline, onOpen }: { data: Dashboard; onPipeline: () => void; onOpen: (id: string) => void }) {
  const [mode, setMode] = useState<'task' | 'collab' | 'meeting'>('task');
  const [scope, setScope] = useState<'top' | 'all'>('top');
  const recs = scope === 'top' ? data.recommendations.slice(0, 10) : data.recommendations;
  const count = (stage: string) => recs.filter((r) => r.outcome_stage === stage).length;
  const { funds, links } = useModelData(data);
  const networked = new Set(buildGroups(funds, links, 'network').filter((g) => g.id !== 'net:loose').flatMap((g) => g.funds.map((f) => f.fund_id)));
  const cols: { label: string; value: number; status: string; high: boolean }[] =
    mode === 'task' ? ['intro_pedida', 'intro_aceptada', 'reunion', 'dd'].map((s, i) => ({ label: outcomeLabels[s], value: count(s), status: count(s) ? 'En curso' : 'Pendiente', high: i === 0 || i === 3 }))
    : mode === 'collab' ? [
      { label: 'Ruta cálida', value: recs.filter((r) => r.best_path).length, status: 'Activas', high: true },
      { label: 'En red', value: recs.filter((r) => networked.has(r.fund_id)).length, status: 'Hecho', high: false },
      { label: 'Con socios', value: recs.filter((r) => r.people?.length).length, status: 'Hecho', high: false },
      { label: 'Sin ruta', value: recs.filter((r) => !r.best_path).length, status: 'En curso', high: true },
    ]
    : ['reunion', 'dd', 'term_sheet', 'rechazada'].map((s, i) => ({ label: outcomeLabels[s], value: count(s), status: count(s) ? 'En curso' : 'Pendiente', high: i < 2 }));
  const faces = recs.slice(0, 2);
  return (
    <article className="pm-card pm-report">
      <header className="pm-head">
        <span><h3>Detailed Report</h3><small>Pipeline en tiempo real</small></span>
        <label className="pm-select"><select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} aria-label="Alcance"><option value="top">Top 10</option><option value="all">Top 20</option></select><ChevronDown size={15} /></label>
      </header>
      <div className="pm-report-faces">
        <div className="pm-stack">
          {faces.map((r, i) => <button key={r.fund_id} onClick={() => onOpen(r.fund_id)} title={r.name}><Avatar className={`pm-face t-${TONES[i]}`} name={r.name} src={investorImage(r)} /></button>)}
          <span className="pm-face t-steel plus">{Math.max(0, recs.length - faces.length)}+</span>
        </div>
        <button className="pm-dots" onClick={onPipeline} aria-label="Abrir pipeline"><Ellipsis size={16} /></button>
      </div>
      <div className="pm-pills">
        <button className={mode === 'task' ? 'on' : ''} onClick={() => setMode('task')}>Task</button>
        <button className={mode === 'collab' ? 'on' : ''} onClick={() => setMode('collab')}>Collaboration</button>
        <button className={mode === 'meeting' ? 'on' : ''} onClick={() => setMode('meeting')}>Meeting</button>
      </div>
      <div className="pm-report-cols">
        {cols.map((c) => (
          <button key={c.label} className="pm-col" onClick={onPipeline} title={`${c.label}: ${c.value}`}>
            <span className="pm-col-label">{c.label}<ArrowUpIcon /></span>
            <span className="pm-col-val"><b>{c.value}</b><small>{c.status}</small></span>
            <span className={`pm-prio ${c.high ? 'high' : 'low'}`}>{c.high ? 'Alta' : 'Baja'}</span>
          </button>
        ))}
      </div>
    </article>
  );
}
const ArrowUpIcon = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>;

/* ───────────── AI Chat (responde con los datos de la ronda) ───────────── */

type Msg = { from: 'me' | 'ai'; text: string };
function answer(q: string, data: Dashboard, steps: Step[], done: string[]): string {
  const t = q.toLowerCase();
  const recs = data.recommendations;
  const top = recs[0];
  if (!recs.length) return 'Aún no hay ranking. Pulsa "Actualizar búsqueda" para generar tu top 20 y te respondo con datos.';
  if (/ruta|intro|conector|c[aá]lid/.test(t)) {
    const warm = recs.filter((r) => r.best_path);
    return warm.length
      ? `Tienes ${warm.length} fondos con ruta cálida. La más fuerte es a ${warm[0].name} vía ${warm[0].best_path?.hops[0]?.to_name || 'tu conector'}.`
      : `Todavía no hay rutas cálidas en el top: tu red privada no tiene interacciones cargadas. Lo más rápido es conectar con socios que se repiten entre fondos (ver Team Collaboration).`;
  }
  if (/paso|hacer|semana|tarea|pendiente/.test(t)) {
    const next = steps.filter((s) => !done.includes(s.id));
    return next.length ? `Tienes ${next.length} pasos pendientes. El siguiente: "${next[0].title}" (${weekLabel(next[0].week).toLowerCase()}). ${next[0].detail}` : 'No te quedan pasos pendientes. Buen momento para enviar el update mensual.';
  }
  if (/levant|capital|ronda|monto|ticket/.test(t)) return `${data.project.name} busca ${money(data.project.raise_usd)} en etapa ${data.project.stage}. ${recs.filter((r) => r.profile.ticket_min).length} fondos del top publican ticket.`;
  if (/mejor|top|fondo|quien|quién/.test(t)) return `Tu mejor fondo hoy es ${top.name} con ${pts(top.score)} pts${top.profile.city ? `, en ${titleCase(top.profile.city)}` : ''}. Le siguen ${recs.slice(1, 3).map((r) => r.name).join(' y ')}.`;
  if (/configur|personaliz|fit|criterio/.test(t)) return 'Sí. Edita perfil, sectores, geografías y comparables en Configuración (ícono de engranaje en la barra izquierda). Al guardar se habilita "Actualizar búsqueda" para re-rankear.';
  return 'Puedo responderte sobre tu mejor fondo, rutas cálidas, próximos pasos o el monto de la ronda. Prueba: "¿qué hago esta semana?"';
}

function ChatCard({ data, steps, done }: { data: Dashboard; steps: Step[]; done: string[] }) {
  const seed = '¿Puedo personalizar el tablero según mi flujo de trabajo?';
  const [msgs, setMsgs] = useState<Msg[]>(() => [{ from: 'me', text: seed }, { from: 'ai', text: answer(seed, data, steps, done) }]);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); }, [msgs]);
  const send = (e: FormEvent) => {
    e.preventDefault();
    const q = text.trim(); if (!q) return;
    setMsgs([...msgs, { from: 'me', text: q }, { from: 'ai', text: answer(q, data, steps, done) }]);
    setText('');
  };
  return (
    <article className="pm-card pm-chat">
      <header className="pm-head">
        <h3 className="pm-chat-title"><span className="pm-ai-ico"><Sparkles size={14} /></span>AI Chat</h3>
        <div className="pm-head-icons">
          <button className="pm-mini" aria-label="Silenciar"><Bell size={14} strokeWidth={1.6} /></button>
          <button className="pm-mini" aria-label="Limpiar chat" onClick={() => setMsgs([])}><X size={14} strokeWidth={1.8} /></button>
          <button className="pm-mini" aria-label="Opciones"><Ellipsis size={15} /></button>
        </div>
      </header>
      <div className="pm-msgs" ref={listRef}>
        {msgs.map((m, i) => (
          <div key={i} className={`pm-msg ${m.from}`}>
            {m.from === 'ai' && <span className="pm-av sm t-black">AI</span>}
            <p>{m.text}</p>
            {m.from === 'me' && <span className="pm-av sm t-gold">{initials(data.project.name)}</span>}
          </div>
        ))}
        {!msgs.length && <p className="pm-empty">Pregunta por tu mejor fondo, rutas cálidas o próximos pasos.</p>}
      </div>
      <form className="pm-input" onSubmit={send}>
        <Paperclip size={15} strokeWidth={1.6} />
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribe un mensaje…" aria-label="Mensaje" />
        <Mic size={16} strokeWidth={1.6} />
        <button type="submit" className="pm-send" aria-label="Enviar"><SendHorizontal size={17} fill="currentColor" /></button>
      </form>
    </article>
  );
}

/* ───────────── Performances ───────────── */

function PerformanceCard({ data }: { data: Dashboard }) {
  const recs = data.recommendations;
  const avg = recs.length ? recs.reduce((s, r) => s + r.score, 0) / recs.length : 0;
  return (
    <article className="pm-card pm-perf">
      <header className="pm-head"><span><h3>Performances</h3><small>Eficiencia del top<br />de la ronda</small></span><button className="pm-dots" aria-label="Opciones"><Ellipsis size={16} /></button></header>
      <div className="pm-perf-num"><span className="pm-perf-shade" /><strong>{pts(avg)}</strong></div>
      <p className="pm-perf-foot">Score promedio (pts) <Info size={13} /></p>
    </article>
  );
}

/* ───────────── Notifications Panel ───────────── */

function NotificationsPanel({ data, steps, done, onOpen, onEdit }: { data: Dashboard; steps: Step[]; done: string[]; onOpen: (id: string) => void; onEdit: () => void }) {
  const missing = data.readiness.filter((r) => !r.ready);
  const thisWeek = steps.filter((s) => s.week === 0 && !done.includes(s.id));
  const recent = [...data.recommendations].filter((r) => r.profile.last_activity).sort((a, b) => (b.profile.last_activity || '').localeCompare(a.profile.last_activity || '')).slice(0, 4);
  return (
    <>
      <article className="pm-card pm-notes">
        <header className="pm-head"><span><h3>Fuentes por completar</h3><small>{missing.length} de {data.readiness.length}</small></span></header>
        <ul>{missing.map((r) => <li key={r.id}><span className="pm-dot gold" /><span><strong>{r.label}</strong><small>{r.detail}</small></span><button onClick={onEdit}>Completar</button></li>)}
          {!missing.length && <li className="pm-empty">Todas las fuentes están listas.</li>}
          {data.stats.review_queue ? <li><span className="pm-dot steel" /><span><strong>{data.stats.review_queue.toLocaleString('es-CO')} entidades por revisar</strong><small>Posibles duplicados entre fuentes</small></span></li> : null}</ul>
      </article>
      <article className="pm-card pm-notes">
        <header className="pm-head"><span><h3>Esta semana</h3><small>{thisWeek.length} pasos</small></span></header>
        <ul>{thisWeek.slice(0, 5).map((s) => <li key={s.id}><span className="pm-dot blue" /><span><strong>{s.title}</strong><small>{s.fundName || s.who}</small></span>{s.fundId && <button onClick={() => onOpen(s.fundId!)}>Ver</button>}</li>)}
          {!thisWeek.length && <li className="pm-empty">Nada pendiente esta semana.</li>}</ul>
      </article>
      <article className="pm-card pm-notes">
        <header className="pm-head"><span><h3>Actividad reciente</h3><small>Fondos del top</small></span></header>
        <ul>{recent.map((r: Recommendation) => <li key={r.fund_id}><span className="pm-dot black" /><span><strong>{r.name}</strong><small>{r.profile.last_activity?.slice(0, 10)}</small></span><button onClick={() => onOpen(r.fund_id)}>Ver</button></li>)}
          {!recent.length && <li className="pm-empty">Sin actividad registrada.</li>}</ul>
      </article>
    </>
  );
}

/* ───────────── Utilidades ───────────── */

function AvatarStack({ names, size = 24 }: { names: string[]; size?: number }) {
  return <span className="pm-stack-sm">{names.map((n, i) => <i key={n + i} className={`t-${TONES[i % 4]}`} style={{ width: size, height: size }} title={n}>{initials(n)}</i>)}</span>;
}
