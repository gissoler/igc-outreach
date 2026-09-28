import {
  Check, ChevronsRight, FileSpreadsheet, Globe, LoaderCircle, Lock, Pause, Play, RotateCw, Search, Sparkles, X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { ProjectConfig, Recommendation } from './api';
import { buildDemoDashboard } from './demo';

/* ─────────────────────────────────────────────────────────────────────────────
   Agente en acción (simulado): reproduce, paso a paso, lo que hace el motor real
   — leer el perfil, buscar rondas de los comparables en Form D, leer noticias y
   webs de fondos, cruzar la red del equipo, construir el grafo y rankear —
   con un navegador y un cursor falsos, al estilo de un agente que usa el computador.
   Todo lo que se ve aquí es una simulación con datos inventados.
   ───────────────────────────────────────────────────────────────────────────── */

type View = 'profile' | 'web' | 'edgar' | 'evaluate' | 'fundsite' | 'network' | 'graph' | 'rank';
type Target = { at: number; x: number; y: number; click?: boolean };
type Phase = { id: View; title: string; dur: number; urls: string[]; logs: string[]; cursor: Target[] };

const fmt = (n: number) => Math.round(n).toLocaleString('es-CO');
const domainOf = (name: string) => `${name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z]+/g, '').slice(0, 16)}.vc`;

function buildScript(cfg: ProjectConfig, recs: Recommendation[]): Phase[] {
  const comps = cfg.comparables.map((c) => c.name).filter(Boolean);
  const c0 = comps[0] || 'tu primer comparable';
  const team = cfg.team.filter((m) => m.name.trim());
  const f = recs.slice(0, 3).map((r) => r.name);
  const funding = (cfg.project.funding_types || ['venture']).map((t) => FUNDING_SHORT[t]).join(' + ');
  return [
    { id: 'profile', title: 'Leer el perfil de tu empresa', dur: 4.5, urls: ['warmpath://empresa/perfil'],
      logs: [`Abro el perfil de ${cfg.project.name || 'tu producto'} (${cfg.founder.org || 'tu empresa'})`, `Extraigo sector, etapa y palabras clave`, `Financiación buscada: ${funding}`, 'Convierto el perfil en un embedding de búsqueda (512 dimensiones)'],
      cursor: [{ at: 0, x: 72, y: 20 }, { at: 0.35, x: 30, y: 44 }, { at: 0.7, x: 64, y: 70, click: true }] },
    { id: 'web', title: 'Buscar en la web', dur: 7, urls: [`search?q=${encodeURIComponent(`${cfg.project.sectors[0] || 'health'} ${funding} investors`)}`],
      logs: [`Busco quién financia ${cfg.project.sectors.slice(0, 2).join(' y ') || 'tu sector'}`, 'Leo fragmentos públicos de posts de LinkedIn', 'Guardo cada resultado con su URL', `${38 + recs.length} candidatos en la base inicial`],
      cursor: [{ at: 0, x: 40, y: 12 }, { at: 0.25, x: 30, y: 34, click: true }, { at: 0.5, x: 36, y: 56 }, { at: 0.72, x: 30, y: 76, click: true }] },
    { id: 'edgar', title: 'Buscar pares en la SEC (Form D)', dur: 7, urls: ['efts.sec.gov/LATEST/search-index?forms=D', `efts.sec.gov/LATEST/search-index?q="${c0}"&forms=D`],
      logs: [`Busco Form D de ${c0}`, ...comps.slice(1, 4).map((c) => `Busco Form D de ${c}`), 'Abro el filing más reciente → personas relacionadas', `${comps.length * 2 + 3} rondas con fuente citada`],
      cursor: [{ at: 0, x: 20, y: 14 }, { at: 0.12, x: 42, y: 15, click: true }, { at: 0.45, x: 38, y: 37 }, { at: 0.55, x: 38, y: 37, click: true }, { at: 0.8, x: 78, y: 62 }] },
    { id: 'fundsite', title: 'Leer la tesis de cada fondo', dur: 8, urls: f.map((n) => `${domainOf(n)}/thesis`),
      logs: [...f.map((n) => `Tesis de ${n}: comparo con tu perfil`), 'Verifico etapa y ticket publicados', '1.874 perfiles de fondos revisados'],
      cursor: [{ at: 0, x: 30, y: 30 }, { at: 0.2, x: 46, y: 56, click: true }, { at: 0.5, x: 70, y: 30 }, { at: 0.62, x: 60, y: 60, click: true }, { at: 0.9, x: 40, y: 78 }] },
    { id: 'evaluate', title: 'Evaluar candidatos', dur: 7, urls: ['warmpath://evaluador'],
      logs: ['Un agente evaluador revisa cada candidato', 'Descarto los que no tienen web o no financian', 'Apruebo: mismo espacio + financia + contacto verificable', `${recs.length} de ${38 + recs.length} candidatos aprobados`],
      cursor: [{ at: 0, x: 70, y: 20 }, { at: 0.4, x: 82, y: 40, click: true }, { at: 0.8, x: 82, y: 64, click: true }] },
    { id: 'network', title: 'Cruzar la red del equipo', dur: 7, urls: ['warmpath://red/exports'],
      logs: ['Leo Connections.csv (solo metadatos)', 'Leo encabezados de Outlook y calendario', ...(team.length ? team.slice(0, 3).map((m) => `Sumo la red de ${m.name} (${m.role})`) : ['Sin equipo declarado: solo tu red']), ...(cfg.contacts.length ? [`${cfg.contacts.length} contactos declarados a mano`] : []), 'Calculo la fuerza de cada vínculo'],
      cursor: [{ at: 0, x: 24, y: 30 }, { at: 0.15, x: 24, y: 30, click: true }, { at: 0.4, x: 50, y: 30, click: true }, { at: 0.65, x: 76, y: 30, click: true }, { at: 0.9, x: 60, y: 80 }] },
    { id: 'graph', title: 'Encontrar caminos cálidos', dur: 8, urls: ['warmpath://grafo'],
      logs: ['Construyo el grafo personas + fondos', 'Busco caminos por fuerza, no por distancia', ...(recs[0]?.best_path ? [`Mejor ruta: ${recs[0].best_path.hops.map((h) => h.to_name).join(' → ')}`] : []), `${recs.filter((r) => r.best_path).length} fondos del top con ruta cálida`],
      cursor: [{ at: 0, x: 50, y: 50 }, { at: 0.55, x: 50, y: 50 }, { at: 0.7, x: 80, y: 30, click: true }] },
    { id: 'rank', title: 'Rankear y explicar', dur: 5.5, urls: ['warmpath://ranking'],
      logs: ['Combino tesis, comparables, co-inversión, ruta y actividad', `Top ${recs.length} listo, cada fondo con su porqué`],
      cursor: [{ at: 0, x: 60, y: 60 }, { at: 0.8, x: 30, y: 22, click: true }] },
  ];
}

export function AgentRun({ config, onDone, onClose, title }: { config: ProjectConfig; onDone: () => void; onClose?: () => void; title?: string }) {
  const recs = useMemo(() => buildDemoDashboard(config).recommendations, [config]);
  const script = useMemo(() => buildScript(config, recs), [config, recs]);
  const total = script.reduce((s, p) => s + p.dur, 0);
  const [t, setT] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(false);
  const logRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (paused || t >= total) return;
    let last = performance.now();
    const id = window.setInterval(() => { const now = performance.now(); const dt = ((now - last) / 1000) * speed; last = now; setT((v) => Math.min(total, v + dt)); }, 50);
    return () => window.clearInterval(id);
  }, [paused, speed, total, t >= total]);

  let acc = 0, index = script.length - 1, p = 1;
  for (let i = 0; i < script.length; i++) { if (t < acc + script[i].dur) { index = i; p = (t - acc) / script[i].dur; break; } acc += script[i].dur; }
  const done = t >= total;
  const phase = script[index];
  const url = phase.urls[Math.min(phase.urls.length - 1, Math.floor(p * phase.urls.length))];
  const local = done ? 1 : (p * phase.urls.length) % 1;
  const typed = url.slice(0, Math.max(6, Math.ceil(Math.min(1, local * 4) * url.length)));
  const g = t / total;
  const counters = [
    { label: 'Fuentes consultadas', value: fmt(Math.min(1, g * 1.3) * 214) },
    { label: 'Fondos analizados', value: fmt(Math.min(1, Math.max(0, (g - 0.3) * 2.2)) * 1874) },
    { label: 'Rutas cálidas', value: fmt(Math.min(1, Math.max(0, (g - 0.68) * 4)) * recs.filter((r) => r.best_path).length) },
  ];
  const cursor = [...phase.cursor].reverse().find((c) => c.at <= p) || phase.cursor[0];
  const clickKey = `${index}-${phase.cursor.indexOf(cursor)}`;

  useEffect(() => { logRef.current?.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [index, Math.floor(p * 6)]);
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === ' ') { e.preventDefault(); setPaused((v) => !v); } }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, []);

  return (
    <div className="ag" role="dialog" aria-label="Agente buscando inversionistas">
      <aside className="ag-side">
        <header className="ag-head">
          <span className={`ag-orb ${done ? 'done' : ''}`}><Sparkles size={16} /></span>
          <div><strong>Agente WarmPath</strong><small>{done ? 'Búsqueda completa' : paused ? 'En pausa' : 'Trabajando…'}</small></div>
          {onClose && <button className="ag-icon" onClick={onClose} aria-label="Cerrar"><X size={17} /></button>}
        </header>
        <p className="ag-task">{title || `Buscar inversionistas para ${config.project.name || 'tu empresa'}`}</p>
        <div className="ag-counters">{counters.map((c) => <div key={c.label}><b>{c.value}</b><span>{c.label}</span></div>)}</div>
        <ol className="ag-steps" ref={logRef}>
          {script.map((ph, i) => {
            const state = done || i < index ? 'done' : i === index ? 'now' : 'next';
            const shown = state === 'done' ? ph.logs.length : state === 'now' ? Math.max(1, Math.ceil(p * ph.logs.length)) : 0;
            return (
              <li key={ph.id} className={state}>
                <span className="ag-dot">{state === 'done' ? <Check size={12} strokeWidth={3} /> : state === 'now' ? <LoaderCircle className="spin" size={13} /> : i + 1}</span>
                <div>
                  <strong>{ph.title}</strong>
                  {shown > 0 && <ul>{ph.logs.slice(0, shown).map((l, j) => <li key={j} className={state === 'now' && j === shown - 1 ? 'typing' : ''}>{l}</li>)}</ul>}
                </div>
              </li>
            );
          })}
        </ol>
        <footer className="ag-foot">
          <div className="ag-bar"><i style={{ width: `${g * 100}%` }} /></div>
          <div className="ag-controls">
            {done
              ? <button className="ag-primary" onClick={onDone}>Ver resultados <ChevronsRight size={17} /></button>
              : <>
                <button className="ag-icon" onClick={() => setPaused(!paused)} aria-label={paused ? 'Reanudar' : 'Pausar'}>{paused ? <Play size={16} /> : <Pause size={16} />}</button>
                <button className={`ag-chip ${speed === 2 ? 'on' : ''}`} onClick={() => setSpeed(speed === 1 ? 2 : speed === 2 ? 4 : 1)}>{speed}×</button>
                <button className="ag-link" onClick={() => setT(total)}>Saltar al final</button>
              </>}
            {done && <button className="ag-icon" onClick={() => setT(0)} aria-label="Repetir"><RotateCw size={16} /></button>}
          </div>
        </footer>
      </aside>

      <section className="ag-stage">
        <div className="ag-browser">
          <div className="ag-chrome">
            <span className="ag-lights"><i /><i /><i /></span>
            <div className="ag-url"><Lock size={12} /><span>{typed}</span>{!done && local < 0.25 && <em className="ag-caret" />}</div>
            <span className="ag-sim">Simulación</span>
          </div>
          <div className="ag-view" key={phase.id}>
            {phase.id === 'profile' && <ProfileView cfg={config} p={p} />}
            {phase.id === 'edgar' && <EdgarView cfg={config} p={p} recs={recs} />}
            {phase.id === 'web' && <WebView cfg={config} p={p} recs={recs} />}
            {phase.id === 'evaluate' && <EvaluateView p={p} recs={recs} />}
            {phase.id === 'fundsite' && <FundSiteView cfg={config} p={p} recs={recs} />}
            {phase.id === 'network' && <NetworkView cfg={config} p={p} />}
            {phase.id === 'graph' && <GraphView cfg={config} p={done ? 1 : p} recs={recs} />}
            {phase.id === 'rank' && <RankView p={done ? 1 : p} recs={recs} />}
            {!done && <span className="ag-cursor" style={{ left: `${cursor.x}%`, top: `${cursor.y}%` } as CSSProperties}>
              <svg width="22" height="24" viewBox="0 0 22 24" aria-hidden="true"><path d="M2 2 L2 19 L7 14.5 L10.5 22 L13.5 20.6 L10 13.4 L17 13.4 Z" /></svg>
              {cursor.click && <i key={clickKey} className="ag-click" />}
            </span>}
          </div>
        </div>
        <p className="ag-caption"><Globe size={13} /> {done ? 'Listo. Los resultados quedan en tu dashboard.' : `${phase.title} · paso ${index + 1} de ${script.length}`} <kbd>espacio</kbd> pausa</p>
      </section>
    </div>
  );
}

/* ───────────── Vistas del navegador simulado ───────────── */

const PORTFOLIO = ['Neuralia', 'Kinetiq Bio', 'Sanobox', 'Lumacare', 'Oriel Dx', 'Vitae Loop', 'Hearthly', 'Clarimed', 'Pulsewise', 'Somna Labs'];
const reveal = (p: number, n: number, start = 0, end = 1) => Math.max(0, Math.min(n, Math.floor(((p - start) / (end - start)) * n)));

function ProfileView({ cfg, p }: { cfg: ProjectConfig; p: number }) {
  const words = [...cfg.project.sectors, ...cfg.project.keywords, cfg.project.stage].filter(Boolean);
  const text = `${cfg.project.one_liner || 'Tu empresa'}. ${cfg.project.description || ''}`;
  return (
    <div className="agv-doc">
      <span className="agv-eyebrow">Perfil de la empresa</span>
      <h2>{cfg.project.name || 'Empresa sin nombre'}</h2>
      <p className={p > 0.25 ? 'hl' : ''}>{text}</p>
      <div className="agv-meta">
        <span>Etapa <b>{cfg.project.stage}</b></span>
        <span>Ronda <b>US${fmt(cfg.project.raise_usd || 0)}</b></span>
        <span>Geografía <b>{cfg.project.geo.join(', ') || '—'}</b></span>
      </div>
      <div className="agv-extract">
        <small>Señales extraídas</small>
        <div>{words.slice(0, reveal(p, words.length, 0.3, 0.95)).map((w) => <em key={w} className="pop">{w}</em>)}</div>
      </div>
    </div>
  );
}

function EdgarView({ cfg, p, recs }: { cfg: ProjectConfig; p: number; recs: Recommendation[] }) {
  const comps = cfg.comparables.map((c) => c.name).filter(Boolean);
  const q = comps[0] || 'Comparable';
  const typedQ = q.slice(0, reveal(p, q.length, 0.02, 0.14));
  const rows = [...comps, ...['Series Seed', 'Seed extension']].slice(0, 5).map((c, i) => ({ name: i < comps.length ? `${c}, Inc.` : `${q}, Inc. (${c})`, date: `2026-0${(i % 8) + 1}-1${i}`, amount: `US$${(1.5 + i * 0.8).toFixed(1)} M` }));
  const open = p > 0.55;
  return (
    <div className="agv-edgar">
      <div className="agv-search"><Search size={15} /><span>{typedQ}<em className="ag-caret" /></span><button className={p > 0.12 ? 'pressed' : ''}>Buscar</button></div>
      <table>
        <thead><tr><th>Emisor</th><th>Formulario</th><th>Fecha</th><th>Vendido</th></tr></thead>
        <tbody>{rows.slice(0, reveal(p, rows.length, 0.15, 0.4)).map((r, i) => <tr key={i} className={`fade ${open && i === 0 ? 'sel' : ''}`}><td>{r.name}</td><td>D</td><td>{r.date}</td><td>{r.amount}</td></tr>)}</tbody>
      </table>
      {open && <div className="agv-panel fade">
        <strong>Personas relacionadas · Form D</strong>
        <ul>{recs.slice(0, 4).map((r, i) => <li key={r.fund_id} className={p > 0.6 + i * 0.08 ? 'hit' : ''}><span>{r.people?.[0]?.name}</span><small>Director · {r.name}</small></li>)}</ul>
      </div>}
    </div>
  );
}

const FUNDING_SHORT: Record<string, string> = { grant: 'grants', venture: 'venture capital', angel: 'ángeles', corporate: 'corporativo', debt: 'deuda', bootstrapping: 'bootstrapping' };

function WebView({ cfg, p, recs }: { cfg: ProjectConfig; p: number; recs: Recommendation[] }) {
  const sector = cfg.project.sectors[0] || 'health';
  const results = [
    { kind: 'Fondo', title: `${recs[0]?.name} · Tesis`, url: `${domainOf(recs[0]?.name || '')}/thesis`, text: `Invertimos en ${sector} en etapas tempranas…` },
    { kind: 'Grant', title: `Convocatoria 2026: innovación en ${sector}`, url: 'grants.example.org/2026', text: 'Financiación no dilutiva hasta US$500k para pilotos clínicos…' },
    { kind: 'Post', title: `${recs[1]?.people?.[0]?.name} en LinkedIn`, url: 'linkedin.com/posts/…', text: `“Buscamos founders que midan resultados reales en ${sector}…”` },
    { kind: 'Fondo', title: `${recs[2]?.name} anuncia nuevo fondo`, url: 'news.example.com/2026/new-fund', text: 'El vehículo apoyará 20 compañías en etapa semilla…' },
    { kind: 'Post', title: `${recs[3]?.people?.[0]?.name} en LinkedIn`, url: 'linkedin.com/posts/…', text: '“Me encanta ver wearables con evidencia clínica…”' },
  ];
  const q = `${sector} ${(cfg.project.funding_types || ['venture']).map((t) => FUNDING_SHORT[t]).join(' ')} investors`;
  return (
    <div className="agv-web">
      <div className="agv-search"><Search size={15} /><span>{q.slice(0, reveal(p, q.length, 0.02, 0.2))}<em className="ag-caret" /></span><button className={p > 0.2 ? 'pressed' : ''}>Buscar</button></div>
      <ul>{results.slice(0, reveal(p, results.length, 0.22, 0.7)).map((r, i) => (
        <li key={i} className={`fade ${p > 0.72 + i * 0.05 ? 'saved' : ''}`}>
          <em className={`kind ${r.kind.toLowerCase()}`}>{r.kind}</em>
          <div><small>{r.url}</small><strong>{r.title}</strong><p>{r.text}</p></div>
          {p > 0.72 + i * 0.05 && <b className="pop">Guardado</b>}
        </li>
      ))}</ul>
    </div>
  );
}

function EvaluateView({ p, recs }: { p: number; recs: Recommendation[] }) {
  const rows = [
    { name: recs[0]?.name, ok: true, why: 'Mismo espacio · financia pre-seed · contacto verificado' },
    { name: 'Northgate Holdings LLC', ok: false, why: 'Sin página web: no se puede verificar' },
    { name: recs[1]?.name, ok: true, why: 'Invirtió en un comparable · tesis 0,71' },
    { name: 'Bayfront Real Estate Fund', ok: false, why: 'No invierte en salud' },
    { name: recs[2]?.name, ok: true, why: 'Grants + venture · socio con post reciente' },
    { name: 'Sunridge Growth Partners', ok: false, why: 'Solo series B en adelante' },
  ];
  return (
    <div className="agv-eval">
      <h3>Agente evaluador <small>criterios: existe · mismo espacio · financia · contacto</small></h3>
      <ul>{rows.slice(0, reveal(p, rows.length, 0.05, 0.85)).map((r, i) => (
        <li key={i} className={`fade ${r.ok ? 'ok' : 'no'}`}><strong>{r.name}</strong><span>{r.why}</span><em>{r.ok ? 'Aprobado' : 'Descartado'}</em></li>
      ))}</ul>
    </div>
  );
}

function FundSiteView({ cfg, p, recs }: { cfg: ProjectConfig; p: number; recs: Recommendation[] }) {
  const k = Math.min(2, Math.floor(p * 3));
  const r = recs[k];
  const sim = r ? r.factors.thesis : 0.5;
  const local = (p * 3) % 1;
  return (
    <div className="agv-fund">
      <header><b>{r?.name}</b><nav><span>Portafolio</span><span className="on">Tesis</span><span>Equipo</span></nav></header>
      <h2>We back early builders in {cfg.project.sectors[k % Math.max(1, cfg.project.sectors.length)] || 'health'}.</h2>
      <p className={local > 0.3 ? 'hl' : ''}>{r?.profile.thesis}</p>
      <div className="agv-fund-meta">
        <span>Etapas <b>{r?.profile.stages?.join(', ')}</b></span>
        <span>Ticket <b>{r?.profile.ticket_min ? `US$${fmt(r.profile.ticket_min / 1000)}k – ${fmt((r.profile.ticket_max || 0) / 1000)}k` : 'no publicado'}</b></span>
      </div>
      <div className="agv-gauge"><small>Tesis ↔ tu perfil</small><div><i style={{ width: `${Math.min(1, local * 1.6) * sim * 100}%` }} /></div><b>{(Math.min(1, local * 1.6) * sim).toFixed(2)}</b></div>
      <div className="agv-fund-cols">
        <section><small>Portafolio reciente</small><div className="agv-logos">{PORTFOLIO.slice(k * 2, k * 2 + 6).map((n, i) => <span key={n} className={local > 0.45 + i * 0.07 ? 'seen' : ''}>{n}</span>)}</div></section>
        <section><small>Equipo</small><ul>{(r?.people || []).map((x) => <li key={x.key} className={local > 0.7 ? 'seen' : ''}><i>{x.name.split(' ').map((w) => w[0]).join('')}</i>{x.name}<em>Partner</em></li>)}</ul></section>
      </div>
    </div>
  );
}

function NetworkView({ cfg, p }: { cfg: ProjectConfig; p: number }) {
  const team = cfg.team.filter((m) => m.name.trim());
  const files = [
    { name: 'Connections.csv', owner: cfg.founder.name || 'Tú', n: 1248, start: 0.1 },
    { name: 'Outlook · encabezados', owner: cfg.founder.name || 'Tú', n: 3312, start: 0.35 },
    ...(team.length ? team.slice(0, 2).map((m, i) => ({ name: `Red de ${m.name.split(' ')[0]}`, owner: m.role, n: 540 + i * 210, start: 0.6 + i * 0.12 })) : [{ name: 'Calendario .ics', owner: cfg.founder.name || 'Tú', n: 186, start: 0.6 }]),
  ];
  return (
    <div className="agv-net">
      <div className="agv-files">{files.map((f) => {
        const q = Math.max(0, Math.min(1, (p - f.start) / 0.22));
        return <div key={f.name} className={`agv-file ${q >= 1 ? 'ok' : q > 0 ? 'busy' : ''}`}><FileSpreadsheet size={20} /><strong>{f.name}</strong><small>{f.owner}</small><div className="agv-prog"><i style={{ width: `${q * 100}%` }} /></div><em>{q >= 1 ? `${fmt(f.n)} vínculos` : q > 0 ? 'Leyendo metadatos…' : 'En cola'}</em></div>;
      })}</div>
      <div className="agv-privacy"><Lock size={13} /> Solo quién, cuándo y por qué canal. Nunca el contenido de los mensajes.</div>
      <div className="agv-dots">{Array.from({ length: 64 }, (_, i) => <i key={i} className={i < reveal(p, 64, 0.1, 0.95) ? 'on' : ''} style={{ animationDelay: `${(i % 9) * 40}ms` }} />)}</div>
    </div>
  );
}

function GraphView({ cfg, p, recs }: { cfg: ProjectConfig; p: number; recs: Recommendation[] }) {
  const W = 920, H = 460, cx = 90, cy = H / 2;
  const team = cfg.team.filter((m) => m.name.trim()).slice(0, 4);
  const funds = recs.slice(0, 7);
  const best = recs.find((r) => r.best_path);
  const bestHops = best?.best_path?.hops || [];
  // Capas: founder → equipo → conectores → socios → fondos
  const layer = (items: string[], x: number) => items.map((name, i) => ({ name, x, y: 50 + ((i + 0.5) * (H - 100)) / Math.max(1, items.length) }));
  const teamN = layer(team.map((m) => m.name), 250);
  const conn = layer([...new Set(recs.flatMap((r) => r.best_path?.hops.filter((h) => h.rel === 'knows').map((h) => h.to_name) || []))].slice(0, 5), 400);
  const partners = layer([...new Set(funds.map((f) => f.people?.[0]?.name || ''))], 590);
  const fundN = layer(funds.map((f) => f.name), 730);
  const all = [{ name: cfg.founder.name || 'Tú', x: cx, y: cy }, ...teamN, ...conn, ...partners, ...fundN];
  const pos = (name: string) => all.find((n) => n.name === name);
  const edges: { a: string; b: string; hot: boolean }[] = [];
  const onBest = (a: string, b: string) => bestHops.some((h) => (h.from_name === a && h.to_name === b) || (h.from_name === b && h.to_name === a));
  teamN.forEach((n) => edges.push({ a: all[0].name, b: n.name, hot: onBest(all[0].name, n.name) }));
  recs.forEach((r) => r.best_path?.hops.forEach((h) => { if (pos(h.from_name) && pos(h.to_name)) edges.push({ a: h.from_name, b: h.to_name, hot: r === best }); }));
  funds.forEach((f) => { const pn = f.people?.[0]?.name; if (pn) edges.push({ a: pn, b: f.name, hot: f === best }); });
  const seenEdge = new Map<string, { a: string; b: string; hot: boolean }>();
  edges.forEach((e) => { const k = [e.a, e.b].sort().join('|'); const prev = seenEdge.get(k); seenEdge.set(k, { ...e, hot: e.hot || Boolean(prev?.hot) }); });
  edges.splice(0, edges.length, ...seenEdge.values());
  const shownEdges = reveal(p, edges.length, 0.25, 0.6);
  const hot = p > 0.62;
  return (
    <div className="agv-graph">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Grafo de caminos cálidos (simulado)">
        {edges.slice(0, shownEdges).map((e, i) => { const a = pos(e.a)!, b = pos(e.b)!; return <path key={i} d={`M${a.x},${a.y} C${(a.x + b.x) / 2},${a.y} ${(a.x + b.x) / 2},${b.y} ${b.x},${b.y}`} className={`agv-edge ${hot && e.hot ? 'hot' : ''}`} />; })}
        {all.map((n, i) => {
          const kind = i === 0 ? 'me' : teamN.includes(n) ? 'team' : fundN.includes(n) ? 'fund' : 'person';
          const visible = i === 0 || p > 0.02 + (i / all.length) * 0.3;
          const isHot = hot && (i === 0 || bestHops.some((h) => h.to_name === n.name));
          return visible && n.name ? <g key={i} className={`agv-node ${kind} ${isHot ? 'hot' : ''}`} transform={`translate(${n.x},${n.y})`}>
            <circle r={kind === 'me' ? 18 : kind === 'fund' ? 11 : 7} />
            <text x={kind === 'fund' ? 16 : 0} y={kind === 'fund' ? 4 : kind === 'me' ? 34 : -12} textAnchor={kind === 'fund' ? 'start' : 'middle'}>{n.name.length > 22 ? `${n.name.slice(0, 21)}…` : n.name}</text>
          </g> : null;
        })}
      </svg>
      {hot && best?.best_path && <div className="agv-best pop"><small>Ruta más fuerte</small><strong>{[cfg.founder.name || 'Tú', ...best.best_path.hops.map((h) => h.to_name)].join(' → ')}</strong><span>{Math.round(best.best_path.strength * 100)}% de fuerza · eslabón más débil {Math.round(best.best_path.weakest * 100)}%</span></div>}
    </div>
  );
}

function RankView({ p, recs }: { p: number; recs: Recommendation[] }) {
  const top = recs.slice(0, 8);
  const max = top[0]?.score || 1;
  const settle = Math.min(1, p * 1.5);
  const order = settle < 1 ? [...top].sort((a, b) => a.name.localeCompare(b.name)) : top;
  return (
    <div className="agv-rank">
      <h3>Top {recs.length} · ordenando por score explicable</h3>
      <ol>{top.map((r) => {
        const i = settle < 0.6 ? order.indexOf(r) : top.indexOf(r);
        return <li key={r.fund_id} style={{ transform: `translateY(${i * 46}px)` }}><b>{top.indexOf(r) + 1}</b><span>{r.name}</span><div><i style={{ width: `${(r.score / max) * 100 * settle}%` }} /></div><small>{(r.score * 100 * settle).toFixed(1)}</small></li>;
      })}</ol>
    </div>
  );
}
