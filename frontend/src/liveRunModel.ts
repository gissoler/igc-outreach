/* ─────────────────────────────────────────────────────────────────────────────
   Modelo puro del Live Agent Run. Solo agrupa y ordena los eventos estructurados
   que emite el servidor; no interpreta textos libres ni inventa estados.
   Sin imports: se prueba directamente con Node (research/tests/liveRun.test.mjs).
   ───────────────────────────────────────────────────────────────────────────── */
export type LivePhase =
  | 'planning'
  | 'source_started'
  | 'browser_opened'
  | 'page_loaded'
  | 'screenshot'
  | 'api_request'
  | 'api_response'
  | 'reading'
  | 'evaluating'
  | 'drafting'
  | 'source_completed'
  | 'warning'
  | 'error'
  | 'completed';
export type LiveStatus = 'pending' | 'running' | 'success' | 'warning' | 'error';
export type ApiDetail = {
  kind: 'api';
  callId: string;
  method: string;
  host: string;
  endpoint: string | null;
  params: Record<string, unknown>;
  httpStatus?: number | null;
  bytes?: number | null;
  sample?: string;
  /** Texto de búsqueda público de la petición. */
  query?: string | null;
  /** Registros reales de la respuesta (título + subtítulo). */
  preview?: { title: string; subtitle: string | null }[];
};
export type NetworkDetail = { kind: 'network'; you: string; contacts: number; candidates: number; paths: { nodes: string[]; target: string; strength: number }[] };
export type LeadCard = { name: string; org: string; title: string; score: number; why: string; bucket: string };
export type RankingDetail = { kind: 'ranking'; top: LeadCard[]; radar: LeadCard[]; discarded: LeadCard[]; counts: { top: number; radar: number; discarded: number } };
export type DraftDetail = { kind: 'draft'; to: string; org: string; subject: string; excerpt: string };
export type PageDetail = { kind: 'page'; visitId: string; host: string; httpStatus?: number | null; via?: 'http' };
export type PlanDetail = { kind: 'plan'; items: { provider: string; query: string }[]; sources: string[] };
export type OtherDetail = { kind?: undefined; parallel?: number; jobStatus?: string };
export type LiveRunEvent = {
  id: string;
  sequence: number;
  at: string;
  phase: LivePhase;
  provider?: string;
  title: string;
  message: string;
  publicUrl?: string;
  frameId?: string;
  resultCount?: number;
  durationMs?: number;
  status?: LiveStatus;
  detail?: ApiDetail | PageDetail | PlanDetail | NetworkDetail | RankingDetail | DraftDetail | OtherDetail;
};

/** Une eventos sin duplicar (clave: sequence) y los devuelve ordenados. */
export function mergeEvents(current: LiveRunEvent[], incoming: LiveRunEvent[]): LiveRunEvent[] {
  if (!incoming.length) return current;
  const bySequence = new Map<number, LiveRunEvent>();
  for (const event of current) bySequence.set(event.sequence, event);
  let changed = false;
  for (const event of incoming) {
    if (!event || !Number.isFinite(event.sequence) || bySequence.has(event.sequence)) continue;
    bySequence.set(event.sequence, event);
    changed = true;
  }
  return changed ? [...bySequence.values()].sort((a, b) => a.sequence - b.sequence) : current;
}

export type StepKind = 'plan' | 'source' | 'evaluate' | 'draft';
export type StepState = 'pending' | 'running' | 'success' | 'warning' | 'error';
export type RunStep = {
  id: string;
  kind: StepKind;
  title: string;
  provider?: string;
  state: StepState;
  events: LiveRunEvent[];
  resultCount: number | null;
  durationMs: number | null;
  channel: 'web' | 'api' | 'web+api' | null;
  parallel: number;
};

const STEP_TITLES: Record<Exclude<StepKind, 'source'>, string> = {
  plan: 'Plan the search',
  evaluate: 'Score and rank candidates',
  draft: 'Draft messages',
};

export function buildSteps(events: LiveRunEvent[]): RunStep[] {
  const make = (id: string, kind: StepKind, title: string, provider?: string): RunStep => ({ id, kind, title, provider, state: 'pending', events: [], resultCount: null, durationMs: null, channel: null, parallel: 0 });
  const plan = make('plan', 'plan', STEP_TITLES.plan);
  const evaluate = make('evaluate', 'evaluate', STEP_TITLES.evaluate);
  const draft = make('draft', 'draft', STEP_TITLES.draft);
  const sources = new Map<string, RunStep>();
  const source = (provider: string) => {
    if (!sources.has(provider)) sources.set(provider, make(`source:${provider}`, 'source', provider, provider));
    return sources.get(provider)!;
  };
  let completed: LiveRunEvent | null = null;
  for (const event of events) {
    if (event.phase === 'planning') {
      plan.events.push(event);
      if (event.status === 'success') plan.state = 'success';
      else if (plan.state === 'pending') plan.state = 'running';
      if (event.detail?.kind === 'plan') for (const name of event.detail.sources) source(name);
      continue;
    }
    if (event.phase === 'completed') {
      completed = event;
      continue;
    }
    if (event.provider) {
      const step = source(event.provider);
      step.events.push(event);
      if (event.phase === 'source_started') {
        step.state = 'running';
        step.parallel = Number((event.detail as OtherDetail | undefined)?.parallel) || 1;
      }
      if (event.phase === 'source_completed') {
        step.resultCount = event.resultCount ?? null;
        step.durationMs = event.durationMs ?? null;
        step.state = event.status === 'error' ? 'error' : step.events.some((e) => e.phase === 'warning' || e.phase === 'error' || e.status === 'error') ? 'warning' : 'success';
      } else if (event.phase === 'warning' && step.state === 'success') step.state = 'warning';
      else if (step.state === 'pending') step.state = 'running';
      const kind = event.detail?.kind;
      if (kind === 'api' || kind === 'page') {
        const channel = kind === 'api' ? 'api' : 'web';
        step.channel = !step.channel || step.channel === channel ? channel : 'web+api';
      }
      continue;
    }
    if (event.phase === 'evaluating') {
      evaluate.events.push(event);
      evaluate.state = event.status === 'success' ? 'success' : 'running';
      if (event.status === 'success') {
        evaluate.resultCount = event.resultCount ?? null;
        evaluate.durationMs = event.durationMs ?? null;
      }
      continue;
    }
    if (event.phase === 'drafting') {
      draft.events.push(event);
      draft.state = event.status === 'success' ? 'success' : 'running';
      if (event.status === 'success') draft.resultCount = event.resultCount ?? null;
      continue;
    }
    // Avisos o errores generales (sin proveedor): se muestran en la etapa en curso.
    const current = draft.events.length ? draft : evaluate.events.length ? evaluate : plan;
    current.events.push(event);
  }
  if (plan.events.length && plan.state === 'pending') plan.state = 'running';
  const steps = [plan, ...sources.values(), evaluate, draft];
  if (completed?.status === 'error') for (const step of steps) if (step.state === 'running') step.state = 'error';
  return steps;
}

export type RunOutcome = 'idle' | 'running' | 'done' | 'partial' | 'failed';
/** Estado de la ejecución a partir del evento `completed` (o del estado del trabajo si falta). */
export function runOutcome(events: LiveRunEvent[], jobStatus?: string | null): RunOutcome {
  const completed = [...events].reverse().find((e) => e.phase === 'completed');
  const status = (completed?.detail as OtherDetail | undefined)?.jobStatus || (completed ? (completed.status === 'success' ? 'done' : completed.status === 'warning' ? 'partial' : 'failed') : jobStatus);
  if (status === 'done' || status === 'partial' || status === 'failed') return status;
  if (!events.length && !jobStatus) return 'idle';
  return 'running';
}
export const outcomeLabel: Record<RunOutcome, string> = {
  idle: 'Preparing',
  running: 'Running',
  done: 'Run complete',
  partial: 'Done with warnings',
  failed: 'Stopped',
};

/** Paso donde ocurrió la actividad más reciente (preferencia por pasos en curso). */
export function autoFocus(steps: RunStep[]): RunStep | null {
  let best: RunStep | null = null;
  let bestSequence = -1;
  const running = steps.filter((s) => s.state === 'running');
  // Sin pasos en curso (ejecución terminada): se prefiere la última fuente con operaciones visibles.
  const withOps = steps.filter((s) => s.channel);
  for (const step of running.length ? running : withOps.length ? withOps : steps) {
    const last = step.events.at(-1)?.sequence ?? -1;
    if (last > bestSequence) {
      best = step;
      bestSequence = last;
    }
  }
  return best;
}

export type ViewerState = 'idle' | 'connecting' | 'querying' | 'reading' | 'processing' | 'done' | 'error';
export const viewerStateLabel: Record<ViewerState, string> = {
  idle: 'Waiting',
  connecting: 'Connecting',
  querying: 'Querying',
  reading: 'Reading',
  processing: 'Processing',
  done: 'Done',
  error: 'Error',
};
export type Operation =
  | { kind: 'page'; id: string; host: string; url: string | null; events: LiveRunEvent[]; frameId: string | null; httpStatus: number | null; error: string | null; viaHttp: boolean; state: ViewerState }
  | { kind: 'api'; id: string; host: string; url: string | null; request: LiveRunEvent; response: LiveRunEvent | null; detail: ApiDetail; state: ViewerState };

/** Operaciones reales (visitas web y llamadas API) de un paso, en orden. */
export function operations(step: RunStep | null): Operation[] {
  if (!step) return [];
  const list: Operation[] = [];
  const index = new Map<string, Operation>();
  const finished = step.state !== 'running' && step.state !== 'pending';
  for (const event of step.events) {
    const detail = event.detail;
    if (detail?.kind === 'api') {
      const existing = index.get(detail.callId);
      if (!existing && event.phase === 'api_request') {
        const op: Operation = { kind: 'api', id: detail.callId, host: detail.host, url: event.publicUrl || detail.endpoint, request: event, response: null, detail, state: 'querying' };
        list.push(op);
        index.set(detail.callId, op);
      } else if (existing?.kind === 'api' && event.phase === 'api_response') {
        existing.response = event;
        existing.detail = { ...existing.detail, ...detail };
        existing.state = event.status === 'error' ? 'error' : finished ? 'done' : 'processing';
      }
    } else if (detail?.kind === 'page') {
      let op = index.get(detail.visitId);
      if (!op) {
        op = { kind: 'page', id: detail.visitId, host: detail.host, url: event.publicUrl || null, events: [], frameId: null, httpStatus: null, error: null, viaHttp: false, state: 'connecting' };
        list.push(op);
        index.set(detail.visitId, op);
      }
      if (op.kind !== 'page') continue;
      op.events.push(event);
      if (event.publicUrl) op.url = event.publicUrl;
      if (event.frameId) op.frameId = event.frameId;
      if (detail.httpStatus) op.httpStatus = detail.httpStatus;
      if (detail.via === 'http' && event.phase !== 'error') op.viaHttp = true;
      if (event.phase === 'error') op.error = event.message;
      if (event.phase === 'error' && detail.via === 'http') op.viaHttp = false;
      op.state = event.phase === 'browser_opened' ? 'connecting'
        : event.phase === 'page_loaded' || event.phase === 'screenshot' ? 'reading'
        : event.phase === 'error' ? 'error'
        : event.phase === 'warning' ? (op.state === 'connecting' ? 'connecting' : op.state)
        : 'processing';
    }
  }
  if (finished) for (const op of list) {
    if (op.kind === 'page') op.state = op.error && !op.viaHttp ? 'error' : 'done';
    else if (op.state !== 'error') op.state = 'done';
  }
  return list;
}

/** Última captura real anterior a un evento (para no parpadear mientras llega la siguiente). */
export function previousFrame(events: LiveRunEvent[], beforeSequence: number): LiveRunEvent | null {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].frameId && events[i].sequence < beforeSequence) return events[i];
  return null;
}

export function progress(steps: RunStep[], outcome: RunOutcome): number {
  if (outcome === 'done' || outcome === 'partial' || outcome === 'failed') return 1;
  if (!steps.length) return 0;
  const closed = steps.filter((s) => s.state === 'success' || s.state === 'warning' || s.state === 'error').length;
  const running = steps.filter((s) => s.state === 'running').length;
  return Math.min(0.97, (closed + running * 0.4) / steps.length);
}

/* ───────── Escenas de la visualización ─────────
   Cada escena corresponde a una operación real (plan, llamada API, visita web, cruce
   de red, evaluación, borrador). La animación que la acompaña es ilustrativa; los
   textos, consultas, registros y capturas vienen de los eventos. */
export type SceneKind = 'profile' | 'search' | 'page' | 'network' | 'evaluate' | 'rank' | 'draft' | 'done';
export type Scene = {
  id: string;
  kind: SceneKind;
  stepId: string;
  provider?: string;
  firstSequence: number;
  lastSequence: number;
  /** false mientras la operación real sigue en curso (p. ej. esperando la respuesta HTTP). */
  complete: boolean;
  events: LiveRunEvent[];
};

const sceneStep = (event: LiveRunEvent) => event.provider ? `source:${event.provider}` : event.phase === 'evaluating' ? 'evaluate' : event.phase === 'drafting' ? 'draft' : event.phase === 'completed' ? 'done' : 'plan';

export function buildScenes(events: LiveRunEvent[]): Scene[] {
  const scenes: Scene[] = [];
  const byId = new Map<string, Scene>();
  const touch = (id: string, kind: SceneKind, event: LiveRunEvent) => {
    let scene = byId.get(id);
    if (!scene) {
      scene = { id, kind, stepId: sceneStep(event), provider: event.provider, firstSequence: event.sequence, lastSequence: event.sequence, complete: false, events: [] };
      byId.set(id, scene);
      scenes.push(scene);
    }
    scene.events.push(event);
    scene.lastSequence = event.sequence;
    return scene;
  };
  const failedProviders = new Set<string>();
  for (const event of events) {
    const d = event.detail;
    if (event.phase === 'planning' && d?.kind === 'plan') { touch('plan', 'profile', event).complete = true; continue; }
    if (d?.kind === 'api') {
      // Llamadas repetidas al mismo endpoint de una fuente se agrupan en una escena.
      const scene = touch(`api:${event.provider || ''}:${d.endpoint || d.host}`, 'search', event);
      const calls = new Map<string, boolean>();
      for (const e of scene.events) if (e.detail?.kind === 'api') calls.set(e.detail.callId, (calls.get(e.detail.callId) || false) || e.phase === 'api_response');
      scene.complete = [...calls.values()].every(Boolean);
      continue;
    }
    if (d?.kind === 'page') {
      const scene = touch(`page:${d.visitId}`, 'page', event);
      if (event.frameId || event.phase === 'error' || (event.phase === 'reading' && /Texto extraído|Documento leído|Text extracted|Document read/.test(event.title)) || event.phase === 'warning') scene.complete = scene.complete || event.phase !== 'warning';
      continue;
    }
    if (d?.kind === 'network') { touch('network', 'network', event).complete = true; continue; }
    if (event.phase === 'evaluating') {
      const scene = touch('evaluate', 'evaluate', event);
      if (event.status === 'success') {
        scene.complete = true;
        if (d?.kind === 'ranking' && d.top.length) touch('rank', 'rank', event).complete = true;
      }
      continue;
    }
    if (event.phase === 'drafting') { touch('draft', 'draft', event).complete = event.status === 'success'; continue; }
    if (event.phase === 'completed') { touch('done', 'done', event).complete = true; continue; }
    if (event.phase === 'source_completed' && event.provider) {
      // Al terminar una fuente, sus escenas quedan completas (una petición fallida ya no espera respuesta).
      if (event.status === 'error') failedProviders.add(event.provider);
      for (const scene of scenes) if (scene.provider === event.provider) { scene.complete = true; }
    }
    // Otros eventos (mensajes, avisos) se adjuntan a la última escena de su fuente.
    const owner = [...scenes].reverse().find((s) => (event.provider ? s.provider === event.provider : !s.provider));
    if (owner) { owner.events.push(event); owner.lastSequence = Math.max(owner.lastSequence, event.sequence); }
  }
  return scenes;
}

/** Duración base (s) de cada escena; el reproductor la acelera si hay operaciones en cola. */
export function sceneDuration(scene: Scene): number {
  switch (scene.kind) {
    case 'profile': return 6;
    case 'search': {
      const calls = new Set(scene.events.map((e) => (e.detail?.kind === 'api' ? e.detail.callId : null)).filter(Boolean)).size;
      return Math.min(9, 5.5 + Math.max(0, calls - 1) * 0.35);
    }
    case 'page': return 6;
    case 'network': return 5.5;
    case 'evaluate': return 5.5;
    case 'rank': return 5;
    case 'draft': return 7;
    default: return 4;
  }
}
/** Hasta dónde avanza la animación mientras la operación real no ha terminado (0–1). */
export const sceneHold: Record<SceneKind, number> = { profile: 1, search: 0.34, page: 0.3, network: 1, evaluate: 0.25, rank: 1, draft: 0.2, done: 1 };
