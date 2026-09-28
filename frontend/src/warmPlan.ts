import type { Dashboard, Recommendation } from './api';
import { buildGroups, cleanPerson, useModelData } from './atlasModel';

/** Plan de warm path por fondo: los pasos que el sistema propone para llegar a él. */
export type PlanStatus = 'done' | 'next' | 'pending';
export type PlanStep = { id: string; title: string; detail: string; week: number; status: PlanStatus; doneAt?: string };

export const PIPELINE_STAGES = [
  { id: 'identificado', label: 'Identificado' },
  { id: 'calentando', label: 'Calentando' },
  { id: 'intro_pedida', label: 'Intro pedida' },
  { id: 'intro_aceptada', label: 'Intro aceptada' },
  { id: 'reunion', label: 'Reunión' },
  { id: 'dd', label: 'Due diligence' },
  { id: 'term_sheet', label: 'Term sheet' },
] as const;

const DONE_KEY = 'warmpath-plan-done';
export function readPlanDone(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(DONE_KEY) || '{}'); } catch { return {}; }
}
export function togglePlanDone(id: string): Record<string, string> {
  const current = readPlanDone();
  if (current[id]) delete current[id]; else current[id] = new Date().toISOString();
  try { localStorage.setItem(DONE_KEY, JSON.stringify(current)); } catch { /* sin almacenamiento */ }
  return { ...current };
}

const fmtDay = (value?: string | null) => {
  if (!value) return '';
  const d = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '');
};

/** Contexto compartido: grupos de socios en común (para saber si hay un conector que abre varios fondos). */
export function planContext(data: Dashboard) {
  const { funds, links } = useModelData(data);
  const networks = buildGroups(funds, links, 'network').filter((g) => g.id !== 'net:loose');
  const groupOf = new Map<string, { lead: string; size: number }>();
  networks.forEach((g) => g.funds.forEach((f) => groupOf.set(f.fund_id, { lead: g.label, size: g.funds.length })));
  const peersOf = (id: string) => funds.filter((f) => f.fund_id !== id && links.some((l) => (l.source === id && l.target === f.fund_id) || (l.target === id && l.source === f.fund_id)));
  return { funds, groupOf, peersOf };
}

const STAGE_ORDER = ['intro_pedida', 'intro_aceptada', 'reunion', 'dd', 'term_sheet'];

export function buildFundPlan(fund: Recommendation, ctx: ReturnType<typeof planContext>, done: Record<string, string>): PlanStep[] {
  const net = ctx.groupOf.get(fund.fund_id);
  const contact = fund.people?.[0] ? cleanPerson(fund.people[0].name) : null;
  const hop = fund.best_path?.hops[0];
  const stageIdx = fund.outcome_stage ? STAGE_ORDER.indexOf(fund.outcome_stage) : -1;
  const raw: Omit<PlanStep, 'status'>[] = [
    net
      ? { id: `${fund.fund_id}:connector`, week: 0, title: `Conecta con ${net.lead}`, detail: `Es socio en ${net.size} fondos de tu top: una sola relación te abre ${net.size} puertas.` }
      : { id: `${fund.fund_id}:connector`, week: 0, title: contact ? `Identifica a ${contact}` : 'Encuentra un contacto en el fondo', detail: contact ? `Aparece como socio en el Form D${fund.profile.vehicle ? ` de ${fund.profile.vehicle}` : ''}.` : 'El Form D no trae personas; busca al partner en LinkedIn.' },
    { id: `${fund.fund_id}:engage`, week: 1, title: `Sigue a ${net?.lead || contact || 'su equipo'} y comenta su actividad`, detail: fund.profile.last_activity ? `Su última ronda registrada fue el ${fmtDay(fund.profile.last_activity)}.` : 'Aparecer en su radar antes de escribir.' },
    { id: `${fund.fund_id}:update`, week: 2, title: 'Inclúyelo en tu update mensual', detail: 'Tracción, próximo hito y una petición concreta.' },
    hop
      ? { id: `${fund.fund_id}:ask`, week: 4, title: `Pide la intro a ${hop.to_name}`, detail: `Camino de ${fund.best_path!.n_hops} saltos, ${Math.round(fund.best_path!.strength * 100)}% de fuerza.` }
      : { id: `${fund.fund_id}:ask`, week: 4, title: `Pide 20 minutos a ${net?.lead || contact || 'un partner'}`, detail: 'Con el update como contexto, ya no llega en frío.' },
    { id: `${fund.fund_id}:meeting`, week: 6, title: 'Primera reunión', detail: 'Lleva el deck corto y la evidencia de mundo real.' },
  ];
  // Un avance registrado en el pipeline cierra los pasos anteriores.
  const closedByStage = stageIdx >= 0 ? (stageIdx >= 2 ? 5 : 4) : 0;
  let nextAssigned = false;
  return raw.map((step, i) => {
    const isDone = Boolean(done[step.id]) || i < closedByStage;
    if (isDone) return { ...step, status: 'done', doneAt: done[step.id] };
    if (!nextAssigned) { nextAssigned = true; return { ...step, status: 'next' }; }
    return { ...step, status: 'pending' };
  });
}

/** Etapa del pipeline: el outcome registrado manda; si hay pasos hechos, está "calentando". */
export function pipelineStage(fund: Recommendation, plan: PlanStep[]): string {
  if (fund.outcome_stage && STAGE_ORDER.includes(fund.outcome_stage)) return fund.outcome_stage;
  return plan.some((s) => s.status === 'done') ? 'calentando' : 'identificado';
}

export const weekLabel = (week: number) => {
  if (week === 0) return 'Esta semana';
  if (week === 1) return 'Próxima semana';
  const d = new Date(); d.setDate(d.getDate() + week * 7 - ((d.getDay() + 6) % 7));
  return `Sem. del ${d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }).replace('.', '')}`;
};
export { fmtDay };
