import { ArrowDownWideNarrow, ArrowLeft, Plus, Share2, SignalHigh, SignalLow, SignalMedium, Star, Target } from 'lucide-react';
import { useMemo, useState, type DragEvent } from 'react';
import { api, type Dashboard, type Recommendation } from './api';
import { cleanPerson, pct, placeOf } from './atlasModel';
import { PIPELINE_STAGES, buildFundPlan, pipelineStage, planContext, readPlanDone } from './warmPlan';
import { Avatar, investorImage, money } from './ui';

/* Colores de columna (paleta DECODE) */
const BAR = ['#2150f5', '#a8862e', '#8fa6ff', '#262626', '#1a3fd0', '#c9a44a', '#5b7cff'];
const DISCARDED = ['rechazada', 'sin_respuesta'];
/** Solo las etapas con outcome se pueden registrar arrastrando (Identificado / Calentando salen del plan). */
const DROPPABLE = new Set(['intro_pedida', 'intro_aceptada', 'reunion', 'dd', 'term_sheet']);
const readFavs = (): string[] => { try { return JSON.parse(localStorage.getItem('warmpath-favs') || '[]'); } catch { return []; } };

type Card = { f: Recommendation; stage: string; discarded: boolean; contact: string; isNew: boolean; fav: boolean };

export function PipelineBoard({ data, onOpen, onBack, onReload }: {
  data: Dashboard; onOpen: (id: string) => void; onBack: () => void; onReload: () => Promise<void>;
}) {
  const ctx = useMemo(() => planContext(data), [data]);
  const [showDiscarded, setShowDiscarded] = useState(false);
  const [sortBy, setSortBy] = useState<Record<string, 'score' | 'activity'>>({});
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  /* Cada columna muestra 5 tarjetas; "+5" abre las siguientes. */
  const PAGE = 5;
  const [shown, setShown] = useState<Record<string, number>>({});
  const favs = readFavs();

  const cards: Card[] = useMemo(() => {
    const done = readPlanDone();
    const newest = data.recommendations.map((r) => r.profile.last_activity || '').sort().at(-1) || '';
    const cutoff = newest ? new Date(new Date(`${newest.slice(0, 10)}T12:00:00`).getTime() - 14 * 864e5).toISOString().slice(0, 10) : '';
    return data.recommendations.map((f) => ({
      f, stage: pipelineStage(f, buildFundPlan(f, ctx, done)), discarded: DISCARDED.includes(f.outcome_stage || ''),
      contact: f.people?.[0] ? cleanPerson(f.people[0].name) : '', isNew: Boolean(cutoff && (f.profile.last_activity || '') >= cutoff), fav: favs.includes(f.fund_id),
    }));
  }, [data, ctx]); // eslint-disable-line react-hooks/exhaustive-deps

  const drop = async (e: DragEvent, stage: string) => {
    e.preventDefault(); setOver(null);
    const id = e.dataTransfer.getData('text/plain') || drag; setDrag(null);
    if (!id || !DROPPABLE.has(stage)) return;
    const card = cards.find((c) => c.f.fund_id === id); if (!card || card.stage === stage) return;
    setSaving(id);
    try { await api.outcome(id, stage, card.f.best_path?.connector || '', 'Movido en el tablero del pipeline'); await onReload(); } finally { setSaving(null); }
  };
  const raise = data.project.raise_usd ? `Levantando ${money(data.project.raise_usd)}` : 'Ronda en preparación';

  return (
    <div className="pb">
      <header className="pb-head">
        <div>
          <button className="pb-back" onClick={onBack}><ArrowLeft size={17} /> Inversionistas</button>
          <div className="pb-title"><span className="pb-up"><Target size={18} /></span><h1>Pipeline de fundraising</h1><em>{data.project.name}</em></div>
          <p><span>{data.project.stage}</span> | {raise}</p>
        </div>
        <div className="pb-actions">
          <button className="pb-icon" onClick={() => navigator.clipboard?.writeText(window.location.href)} aria-label="Copiar enlace"><Share2 size={18} /></button>
          <label className="pb-toggle">Mostrar descartados
            <input type="checkbox" checked={showDiscarded} onChange={(e) => setShowDiscarded(e.target.checked)} /><i />
          </label>
        </div>
      </header>

      <div className="pb-board" role="list">
        {PIPELINE_STAGES.map((s, i) => {
          const all = cards.filter((c) => c.stage === s.id);
          const visible = all.filter((c) => showDiscarded || !c.discarded);
          const mode = sortBy[s.id] || 'score';
          const list = visible.slice().sort((a, b) => mode === 'score' ? b.f.score - a.f.score : (b.f.profile.last_activity || '').localeCompare(a.f.profile.last_activity || ''));
          const canDrop = DROPPABLE.has(s.id);
          return (
            <section key={s.id} className={`pb-col ${over === s.id ? (canDrop ? 'over' : 'no-drop') : ''}`} role="listitem"
              onDragOver={(e) => { if (drag) { e.preventDefault(); setOver(s.id); } }} onDragLeave={() => setOver(null)} onDrop={(e) => drop(e, s.id)}>
              <header>
                <span className="pb-check" aria-hidden="true" />
                <h2>{s.label}</h2>
                {i === 0 && <button className="pb-add" onClick={onBack}><Plus size={15} /> Agregar</button>}
                <button className="pb-sort" onClick={() => setSortBy({ ...sortBy, [s.id]: mode === 'score' ? 'activity' : 'score' })} title={mode === 'score' ? 'Ordenado por afinidad' : 'Ordenado por actividad'} aria-label="Cambiar orden"><ArrowDownWideNarrow size={18} /></button>
              </header>
              <div className="pb-stats"><b>{all.filter((c) => !c.contact).length}</b><small>Sin contacto</small><b className="r">{all.length}</b><small>Total</small></div>
              <i className="pb-bar" style={{ background: BAR[i % BAR.length] }} />
              <div className="pb-cards">
                {list.slice(0, shown[s.id] || PAGE).map((c) => {
                  const Sig = c.f.score >= .07 ? SignalHigh : c.f.score >= .064 ? SignalMedium : SignalLow;
                  return (
                    <article key={c.f.fund_id} className={`pb-card ${drag === c.f.fund_id ? 'dragging' : ''} ${c.discarded ? 'discarded' : ''} ${saving === c.f.fund_id ? 'saving' : ''}`}
                      draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', c.f.fund_id); e.dataTransfer.effectAllowed = 'move'; setDrag(c.f.fund_id); }} onDragEnd={() => { setDrag(null); setOver(null); }}
                      onClick={() => onOpen(c.f.fund_id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(c.f.fund_id); }}>
                      <Avatar className="pb-avatar" name={c.f.name} src={investorImage(c.f)} />
                      <div className="pb-main">
                        <div className="pb-name"><Sig size={20} className={`sig ${c.f.score >= .07 ? 'hi' : c.f.score >= .064 ? 'mid' : 'lo'}`} /><strong title={c.f.name}>{c.f.name}</strong>{c.isNew && <em className="pb-new">Nuevo</em>}</div>
                        <span className="pb-city">{placeOf(c.f).label}</span>
                      </div>
                      <div className="pb-foot">
                        <span className="pb-score">{pct(c.f.score)} <Star size={14} /></span>
                        <span className="pb-contact" title={c.contact}>{c.contact || 'Sin contacto'}</span>
                        {c.fav && <em className="pb-fav">Favorito</em>}
                      </div>
                    </article>
                  );
                })}
                {list.length > (shown[s.id] || PAGE) && (() => { const rest = list.length - (shown[s.id] || PAGE); return (
                  <button className="pb-more" onClick={() => setShown({ ...shown, [s.id]: (shown[s.id] || PAGE) + PAGE })}>
                    <span className="pb-more-stack" aria-hidden="true">{list.slice(shown[s.id] || PAGE, (shown[s.id] || PAGE) + 3).map((c) => <Avatar key={c.f.fund_id} className="pb-mini" name={c.f.name} src={investorImage(c.f)} />)}</span>
                    +{Math.min(PAGE, rest)} {rest > PAGE ? <small>de {rest} más</small> : <small>más</small>}
                  </button>); })()}
                {(shown[s.id] || PAGE) > PAGE && list.length > PAGE && <button className="pb-less" onClick={() => setShown({ ...shown, [s.id]: PAGE })}>Ver menos</button>}
                {!list.length && <div className={`pb-empty ${canDrop ? '' : 'muted'}`}>{canDrop ? 'Arrastra aquí un fondo para registrar el avance' : 'Sin fondos en esta etapa'}</div>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
