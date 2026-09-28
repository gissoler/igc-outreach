import {
  ArrowLeft, ArrowRight, Check, ChevronRight, CircleDollarSign, ExternalLink, LoaderCircle, MapPin, Search, UsersRound, X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { api, type Dashboard, type FactorKey, type OutcomeEvent, type Recommendation } from './api';
import { InvestorFlow, type ViewMode } from './InvestorFlow';
import { InvestorBoard } from './InvestorBoard';
import { cleanPerson, pct, placeOf } from './atlasModel';
import {
  PIPELINE_STAGES, buildFundPlan, fmtDay, pipelineStage, planContext, readPlanDone, togglePlanDone, weekLabel, type PlanStep,
} from './warmPlan';
import { Avatar, Score, confidence, factorLabels, investorImage, money, outcomeLabels } from './ui';

const secUrl = (ref?: string | null) => (ref ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${ref.split('-')[0]}&type=D&dateb=&owner=include&count=40` : '');
const stageLabel = (id: string) => PIPELINE_STAGES.find((s) => s.id === id)?.label || outcomeLabels[id] || id;

/* ───────────── Módulo Inversionistas: mapa / chord / jerárquica / tabla + ficha lateral ───────────── */

export function InvestorsModule({ data, selectedId, onSelect, onOpenDossier, view, onViewChange }: {
  data: Dashboard; selectedId: string | null; onSelect: (id: string | null) => void; onOpenDossier: (id: string) => void;
  view: ViewMode; onViewChange: (v: ViewMode) => void;
}) {
  const [done, setDone] = useState(readPlanDone);
  const [explore, setExplore] = useState(false);
  const ctx = useMemo(() => planContext(data), [data]);
  const selected = data.recommendations.find((r) => r.fund_id === selectedId) || null;
  const preview = selected ? (
    <FundPreview key={selected.fund_id} fund={selected} ctx={ctx} done={done} onToggle={(id) => setDone(togglePlanDone(id))}
      onClose={() => onSelect(null)} onOpen={() => onOpenDossier(selected.fund_id)} onPick={(id) => onSelect(id)} />
  ) : undefined;
  if (explore) return <div className="investors-page">
    <button className="back-link" onClick={() => setExplore(false)}><ArrowLeft size={16} /> Volver a la tabla</button>
    <InvestorFlow data={data} mode="full" selectedId={selectedId} onSelect={(id) => onSelect(id)} side={preview}
      initialView={view === 'table' ? 'map' : view} onViewChange={onViewChange}
      table={<RankingTable data={data} ctx={ctx} done={done} selectedId={selectedId} onSelect={(id) => onSelect(id)} />} />
  </div>;
  return <div className={`investors-page board ${preview ? 'drawer-open' : ''}`}>
    <InvestorBoard data={data} done={done} selectedId={selectedId} onSelect={onSelect} onExplore={() => setExplore(true)} />
    <div className="ib-drawer" aria-hidden={!preview}>{preview}</div>
  </div>;
}

function RankingTable({ data, ctx, done, selectedId, onSelect }: {
  data: Dashboard; ctx: ReturnType<typeof planContext>; done: Record<string, string>; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const rows = data.recommendations.filter((r) => `${r.name} ${placeOf(r).label} ${r.profile.thesis || ''}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="ranking-panel embedded">
      <div className="ranking-toolbar"><div className="search-box"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar fondo, ciudad o tesis" /></div></div>
      <div className="ranking-header table-cols"><span>#</span><span>Inversionista</span><span>Etapa</span><span>Señales</span><span>Score</span></div>
      <div className="ranking-list">
        {rows.map((rec) => {
          const stage = pipelineStage(rec, buildFundPlan(rec, ctx, done));
          return (
            <button key={rec.fund_id} className={`table-cols ${selectedId === rec.fund_id ? 'selected' : ''}`} onClick={() => onSelect(rec.fund_id)}>
              <span className="row-rank">{rec.rank}</span>
              <span className="row-fund"><Avatar className="tone-0" name={rec.name} src={investorImage(rec)} /><span><strong>{rec.name}</strong><small>{placeOf(rec).label}{ctx.groupOf.get(rec.fund_id) ? ` · red de ${ctx.groupOf.get(rec.fund_id)!.lead}` : ''}</small></span></span>
              <span className={`stage-pill s-${stage}`}>{stageLabel(stage)}</span>
              <span className="signal-dots">{(Object.entries(rec.factors) as [FactorKey, number][]).map(([key, value]) => <i key={key} className={value > .05 ? 'on' : ''} title={`${factorLabels[key]}: ${Math.round(value * 100)}`} />)}</span>
              <Score value={rec.score} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PlanList({ steps, onToggle, compact = false }: { steps: PlanStep[]; onToggle: (id: string) => void; compact?: boolean }) {
  return (
    <ol className={`plan-list ${compact ? 'compact' : ''}`}>
      {steps.map((step) => (
        <li key={step.id} className={step.status}>
          <button className="plan-check" onClick={() => onToggle(step.id)} aria-pressed={step.status === 'done'} aria-label={step.status === 'done' ? 'Marcar como pendiente' : 'Marcar como hecho'}>
            {step.status === 'done' && <Check size={12} strokeWidth={3} />}
          </button>
          <div>
            <strong>{step.title}</strong>
            {!compact && <p>{step.detail}</p>}
            <small>{step.status === 'done' ? `Hecho${step.doneAt ? ` · ${fmtDay(step.doneAt)}` : ''}` : step.status === 'next' ? `Siguiente · ${weekLabel(step.week)}` : weekLabel(step.week)}</small>
          </div>
        </li>
      ))}
    </ol>
  );
}

function StagePill({ stage }: { stage: string }) {
  return <span className={`stage-pill s-${stage}`}>{stageLabel(stage)}</span>;
}

/** Ficha previa en el panel lateral: lo esencial del fondo + plan de warm path resumido. */
function FundPreview({ fund, ctx, done, onToggle, onClose, onOpen, onPick }: {
  fund: Recommendation; ctx: ReturnType<typeof planContext>; done: Record<string, string>;
  onToggle: (id: string) => void; onClose: () => void; onOpen: () => void; onPick: (id: string) => void;
}) {
  const plan = buildFundPlan(fund, ctx, done);
  const stage = pipelineStage(fund, plan);
  const peers = ctx.peersOf(fund.fund_id);
  const people = (fund.people || []).map((p) => cleanPerson(p.name));
  const doneCount = plan.filter((s) => s.status === 'done').length;
  return (
    <aside className="card atlas-side fund-preview" aria-label={`Ficha de ${fund.name}`}>
      <button className="preview-close" onClick={onClose} aria-label="Cerrar ficha"><X size={16} /></button>
      <header>
        <Avatar className="preview-avatar" name={fund.name} src={investorImage(fund)} />
        <span className="preview-rank">#{fund.rank} en tu ranking</span>
        <h2>{fund.name}</h2>
        <small><MapPin size={13} /> {placeOf(fund).label}</small>
        <div className="preview-tags"><StagePill stage={stage} /><span>{pct(fund.score)} afinidad</span><span>{confidence(fund)}</span></div>
      </header>

      <section className="preview-block">
        <h3>Plan de warm path <em>{doneCount}/{plan.length}</em></h3>
        <PlanList steps={plan} onToggle={onToggle} compact />
      </section>

      <section className="preview-block">
        <h3>Ficha</h3>
        <dl>
          {people.length > 0 && <div><dt>Contacto</dt><dd>{people.slice(0, 2).join(', ')}{people.length > 2 ? ` +${people.length - 2}` : ''}</dd></div>}
          {fund.profile.total_sold ? <div><dt>Última ronda</dt><dd>{money(fund.profile.total_sold)}{fund.profile.source_date ? ` · ${fmtDay(fund.profile.source_date)}` : ''}</dd></div> : null}
          <div><dt>Ticket</dt><dd>{fund.profile.ticket_min || fund.profile.ticket_max ? `${money(fund.profile.ticket_min)} – ${money(fund.profile.ticket_max)}` : 'No publicado'}</dd></div>
          {fund.profile.source_ref && <div><dt>Fuente</dt><dd><a href={secUrl(fund.profile.source_ref)} target="_blank" rel="noreferrer">Form D (SEC) <ExternalLink size={12} /></a></dd></div>}
        </dl>
      </section>

      {peers.length > 0 && <section className="preview-block">
        <h3>Comparte socio con</h3>
        <div className="peer-chips">{peers.slice(0, 5).map((p) => <button key={p.fund_id} onClick={() => onPick(p.fund_id)}>{p.name}</button>)}{peers.length > 5 && <span>+{peers.length - 5}</span>}</div>
      </section>}

      <button className="preview-cta" onClick={onOpen}>Ver seguimiento completo <ArrowRight size={15} /></button>
    </aside>
  );
}

/* ───────────── Seguimiento completo de un fondo ───────────── */

export function FundDossier({ data, fundId, onBack, onOpen, onReload }: {
  data: Dashboard; fundId: string; onBack: () => void; onOpen: (id: string) => void; onReload: () => Promise<void>;
}) {
  const fund = data.recommendations.find((r) => r.fund_id === fundId);
  const ctx = useMemo(() => planContext(data), [data]);
  const [done, setDone] = useState(readPlanDone);
  const [history, setHistory] = useState<OutcomeEvent[]>([]);
  const [stageDraft, setStageDraft] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { api.history(fundId).then((h) => setHistory(Array.isArray(h) ? h : [])).catch(() => setHistory([])); }, [fundId]);
  if (!fund) return <div className="dossier-missing"><button className="back-link" onClick={onBack}><ArrowLeft size={16} /> Inversionistas</button><p>No encontramos este fondo en la corrida actual.</p></div>;

  const plan = buildFundPlan(fund, ctx, done);
  const stage = pipelineStage(fund, plan);
  const stageIdx = PIPELINE_STAGES.findIndex((s) => s.id === stage);
  const next = plan.find((s) => s.status === 'next');
  const peers = ctx.peersOf(fund.fund_id);
  const people = (fund.people || []).map((p) => cleanPerson(p.name));
  const activity = [
    ...history.map((h) => ({ when: h.ts, title: outcomeLabels[h.stage] || h.stage, detail: h.note, kind: 'outcome' })),
    ...plan.filter((s) => s.doneAt).map((s) => ({ when: s.doneAt!, title: s.title, detail: 'Paso del plan completado', kind: 'plan' })),
  ].sort((a, b) => b.when.localeCompare(a.when));

  const save = async () => {
    if (!stageDraft) return;
    setSaving(true);
    try { await api.outcome(fund.fund_id, stageDraft, fund.best_path?.connector || '', note); setNote(''); setStageDraft(''); setHistory(await api.history(fund.fund_id)); await onReload(); }
    finally { setSaving(false); }
  };

  return (
    <div className="dossier">
      <button className="back-link" onClick={onBack}><ArrowLeft size={16} /> Inversionistas</button>
      <section className="card dossier-head">
        <Avatar className="dossier-avatar" name={fund.name} src={investorImage(fund)} />
        <div className="dossier-title">
          <span>#{fund.rank} en tu ranking · {confidence(fund)} confianza</span>
          <h1>{fund.name}</h1>
          <small><MapPin size={14} /> {placeOf(fund).label}{fund.profile.vehicle ? ` · ${fund.profile.vehicle}` : ''}</small>
        </div>
        <Score value={fund.score} large />
        <ol className="stage-stepper" aria-label="Etapa del pipeline">
          {PIPELINE_STAGES.map((s, i) => <li key={s.id} className={i < stageIdx ? 'past' : i === stageIdx ? 'current' : ''}><i />{s.label}</li>)}
        </ol>
      </section>

      <div className="dossier-grid">
        <div className="dossier-main">
          <section className="card dossier-card">
            <header><h2>Plan de warm path</h2><span>{plan.filter((s) => s.status === 'done').length} de {plan.length} hechos{next ? ` · siguiente: ${next.title}` : ''}</span></header>
            <PlanList steps={plan} onToggle={(id) => setDone(togglePlanDone(id))} />
          </section>

          <section className="card dossier-card">
            <header><h2>Actividad</h2><span>Reuniones, acercamientos y avances</span></header>
            <div className="log-form">
              <select value={stageDraft} onChange={(e) => setStageDraft(e.target.value)} aria-label="Tipo de avance">
                <option value="">Registrar avance…</option>
                {Object.entries(outcomeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota (quién, qué se habló, próximo paso)" />
              <button onClick={save} disabled={!stageDraft || saving}>{saving ? <LoaderCircle className="spin" size={15} /> : 'Guardar'}</button>
            </div>
            {activity.length ? (
              <ul className="activity-log">
                {activity.map((a, i) => <li key={i} className={a.kind}><i /><div><strong>{a.title}</strong>{a.detail && <p>{a.detail}</p>}<small>{fmtDay(a.when)}</small></div></li>)}
              </ul>
            ) : <p className="empty-note">Aún no hay actividad con este fondo. Marca pasos del plan o registra un avance (intro pedida, reunión…).</p>}
          </section>
        </div>

        <div className="dossier-side">
          <section className="card dossier-card">
            <header><h2>Ficha</h2></header>
            <p className="thesis">{fund.profile.thesis || 'La tesis aún no se ha extraído con una cita verificable.'}</p>
            <dl className="fact-list">
              <div><dt><CircleDollarSign size={14} /> Ticket</dt><dd>{fund.profile.ticket_min || fund.profile.ticket_max ? `${money(fund.profile.ticket_min)} – ${money(fund.profile.ticket_max)}` : 'No publicado'}</dd></div>
              {fund.profile.total_sold ? <div><dt>Última ronda</dt><dd>{money(fund.profile.total_sold)}{fund.profile.source_date ? ` · ${fmtDay(fund.profile.source_date)}` : ''}</dd></div> : null}
              {fund.profile.last_activity && <div><dt>Última actividad</dt><dd>{fmtDay(fund.profile.last_activity)}</dd></div>}
              {fund.profile.source_ref && <div><dt>Fuente</dt><dd><a href={secUrl(fund.profile.source_ref)} target="_blank" rel="noreferrer">Form D {fund.profile.source_ref} <ExternalLink size={12} /></a></dd></div>}
            </dl>
          </section>

          <section className="card dossier-card">
            <header><h2>Por qué encaja</h2></header>
            <div className="factor-list">{(Object.entries(fund.factors) as [FactorKey, number][]).map(([key, value]) => <div key={key}><span>{factorLabels[key]}</span><div><i style={{ width: `${Math.round(value * 100)}%` } as CSSProperties} /></div><b>{Math.round(value * 100)}</b></div>)}</div>
          </section>

          <section className="card dossier-card">
            <header><h2>Relaciones</h2></header>
            {people.length > 0 && <div className="rel-block"><small><UsersRound size={13} /> Contactos públicos</small><ul>{people.map((p) => <li key={p}>{p}</li>)}</ul></div>}
            {fund.best_path && <div className="rel-block"><small>Mejor camino ({Math.round(fund.best_path.strength * 100)}%)</small><ul>{fund.best_path.hops.map((h) => <li key={`${h.from}-${h.to}`}>{h.from_name} <ChevronRight size={12} /> {h.to_name}</li>)}</ul></div>}
            {peers.length > 0 && <div className="rel-block"><small>Comparte socio con {peers.length} fondos de tu top</small><div className="peer-chips">{peers.map((p) => <button key={p.fund_id} onClick={() => onOpen(p.fund_id)}>{p.name}</button>)}</div></div>}
            {!people.length && !peers.length && !fund.best_path && <p className="empty-note">Sin relaciones conocidas todavía.</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
