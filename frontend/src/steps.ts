import type { Dashboard } from './api';
import { buildGroups, cleanPerson, useModelData } from './atlasModel';

/* Plan de calentamiento compartido por Overview y Project Management. */
export type StepKind = 'hub' | 'engage' | 'update' | 'intro' | 'follow';
export type Step = { id: string; kind: StepKind; week: number; title: string; detail: string; who: string; fundId?: string; fundName?: string };
export const STEP_LABEL: Record<StepKind, string> = { hub: 'Conector', engage: 'Calentar', update: 'Update', intro: 'Intro', follow: 'Seguimiento' };

/** Plan de calentamiento: qué hacer esta semana y las siguientes para que los fondos te conozcan antes del lanzamiento. */
export function buildSteps(data: Dashboard): Step[] {
  const { funds, links } = useModelData(data);
  const steps: Step[] = [];
  const networks = buildGroups(funds, links, 'network').filter((g) => g.id !== 'net:loose');
  const inNetwork = new Set(networks.flatMap((g) => g.funds.map((f) => f.fund_id)));
  for (const rec of funds) {
    if (rec.outcome_stage === 'intro_pedida') steps.push({ id: `follow:${rec.fund_id}`, kind: 'follow', week: 0, title: 'Seguimiento a tu intro', detail: 'Si no hay respuesta en 5 días hábiles, un recordatorio corto funciona mejor que un correo nuevo.', who: rec.best_path?.connector || rec.name, fundId: rec.fund_id, fundName: rec.name });
    if (rec.best_path?.connector && !rec.outcome_stage) {
      const hop = rec.best_path.hops[0];
      steps.push({ id: `intro:${rec.fund_id}`, kind: 'intro', week: 1, title: `Pide la intro a ${hop?.to_name || 'tu conector'}`, detail: `Tu camino más fuerte a ${rec.name} (${Math.round(rec.best_path.strength * 100)}% de fuerza). Mándale un blurb de 3 líneas que pueda reenviar.`, who: hop?.to_name || 'Conector', fundId: rec.fund_id, fundName: rec.name });
    }
  }
  networks.forEach((g, i) => {
    const lead = g.label;
    steps.push({ id: `hub:${g.id}`, kind: 'hub', week: i === 0 ? 0 : 1, title: `Conecta con ${lead}`, detail: `Aparece como socio en ${g.funds.length} fondos de tu top. Una sola relación te abre ${g.funds.length} puertas.`, who: lead, fundId: g.funds[0].fund_id, fundName: g.funds[0].name });
  });
  funds.filter((f) => !inNetwork.has(f.fund_id)).slice(0, 3).forEach((rec, i) => {
    const contact = rec.people?.[0] ? cleanPerson(rec.people[0].name) : rec.name;
    const when = rec.profile.last_activity ? `registró actividad el ${formatDay(rec.profile.last_activity)}` : 'está activo este año';
    steps.push({ id: `engage:${rec.fund_id}`, kind: 'engage', week: i < 2 ? 0 : 1, title: `Sigue a ${contact}`, detail: `${rec.name} ${when}. Aparecer en su radar ahora hace que tu update no llegue en frío.`, who: contact, fundId: rec.fund_id, fundName: rec.name });
  });
  if (funds.length) {
    steps.push({ id: 'update:1', kind: 'update', week: 2, title: `Primer update a ${funds.length} fondos`, detail: 'Corto: tracción, próximo hito y una petición concreta. Repítelo cada mes hasta el lanzamiento.', who: data.project.name });
    steps.push({ id: 'update:2', kind: 'update', week: 6, title: 'Segundo update + lanzamiento', detail: 'Los que respondieron al primero son tus candidatos para pedir la reunión antes de abrir la ronda.', who: data.project.name });
  }
  return steps.sort((a, b) => a.week - b.week);
}

export const weekLabel = (week: number) => {
  if (week === 0) return 'Esta semana';
  if (week === 1) return 'Próxima semana';
  const d = new Date(); d.setDate(d.getDate() + week * 7 - ((d.getDay() + 6) % 7));
  return `Sem. del ${d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }).replace('.', '')}`;
};
export const readDone = (): string[] => { try { return JSON.parse(localStorage.getItem('warmpath-steps-done') || '[]'); } catch { return []; } };

export const writeDone = (ids: string[]) => { try { localStorage.setItem('warmpath-steps-done', JSON.stringify(ids)); } catch { /* almacenamiento no disponible */ } };
export function formatDay(value: string) { const d = new Date(`${value.slice(0, 10)}T12:00:00`); return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', ''); }
