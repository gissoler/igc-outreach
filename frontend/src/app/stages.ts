/* Stages shown in the sidebar (27-10). Every state comes from real data: the intake state during the
   conversation and the live run events during research. Nothing advances on a timer. */
import type { IntakeState } from '../accountApi';
import type { LiveRunEvent } from '../liveRunModel';

export type StageState = 'done' | 'active' | 'pending' | 'warning' | 'failed' | 'skipped';
export type Stage = { id: string; label: string; state: StageState; detail?: string };
export const STATE_TEXT: Record<StageState, string> = { done: 'Done', active: 'Now', pending: 'Not started', warning: 'Done with warnings', failed: 'Failed', skipped: 'Not run' };

const has = (i: IntakeState, p: string) => { const v = i.fields[p]?.value; return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== ''; };

/** Conversation: what the assistant is doing with the user right now. */
export function conversationStages(i: IntakeState | null): Stage[] {
  if (!i) return [];
  const described = has(i, 'company.name') && (has(i, 'product.one_liner') || has(i, 'product.description'));
  const target = has(i, 'funding.objectives') && (has(i, 'investor.types') || has(i, 'geography') || !(i.fields['funding.objectives']?.value as string[] | undefined)?.includes('investment'));
  const summary = Boolean(i.summaryShownAt);
  const confirmed = Boolean(i.confirmedAt);
  const asking = Boolean(i.pending);
  const list: Stage[] = [
    { id: 'describe', label: 'Describe the company', state: described ? 'done' : 'active', detail: described ? String(i.fields['company.name']?.value || '') : 'What it is and what it does' },
    { id: 'target', label: 'Who should fund it', state: target ? 'done' : described ? 'active' : 'pending', detail: target ? undefined : 'Investor type, geography' },
    { id: 'gaps', label: 'Questions that change the search', state: asking && described && target ? 'active' : summary ? 'done' : 'pending', detail: asking ? 'Waiting for your answer' : undefined },
    { id: 'confirm', label: 'Confirm and start', state: confirmed ? 'done' : summary ? 'active' : 'pending', detail: summary && !confirmed ? (i.readiness?.canStart ? 'Ready when you say “start”' : 'Something essential is missing') : undefined },
    { id: 'research', label: 'Research', state: 'pending' },
    { id: 'results', label: 'Results and follow-up', state: 'pending' },
  ];
  // Only one active step: the earliest.
  let seen = false;
  return list.map((s) => (s.state === 'active' ? (seen ? { ...s, state: 'pending' as const } : ((seen = true), s)) : s));
}

const RUN: { id: string; label: string; test: (e: LiveRunEvent) => boolean }[] = [
  { id: 'drafts', label: 'Prepare drafts', test: (e) => e.phase === 'drafting' },
  { id: 'rank', label: 'Rank results', test: (e) => e.phase === 'evaluating' || /decision agent|openjev|\bjev\b|run audit|active investors|creative warm|warm path plan|application plan|grant eligibility/i.test(e.provider || '') },
  { id: 'contacts', label: 'Find contacts', test: (e) => /hunter|contact finder|apollo|your network|people search|firecrawl|scrapegraph|web reader|public profile/i.test(e.provider || '') },
  { id: 'verify', label: 'Verify sources', test: (e) => /page check|registry check/i.test(e.provider || '') || /pages verified|reading skipped|research loop|search leads opened|registry calls/i.test(e.title || '') },
  { id: 'orgs', label: 'Search organizations', test: (e) => ['source_started', 'source_completed', 'reading', 'snapshot'].includes(e.phase) && Boolean(e.provider) },
  { id: 'prepare', label: 'Prepare the search', test: (e) => e.phase === 'planning' },
];
const ORDER = ['prepare', 'orgs', 'verify', 'contacts', 'rank', 'drafts'];

/** Research: one row per real stage, from the run events (the most specific rule wins). */
export function runStages(events: LiveRunEvent[], jobStatus: string | null): Stage[] {
  const buckets = new Map<string, LiveRunEvent[]>(ORDER.map((id) => [id, []]));
  for (const e of events) {
    if (e.phase === 'completed') continue;
    const rule = RUN.find((r) => r.test(e));
    if (rule) buckets.get(rule.id)!.push(e);
  }
  const finished = ['done', 'partial', 'failed', 'cancelled'].includes(String(jobStatus || ''));
  const last = [...events].reverse().find((e) => e.phase !== 'completed');
  const activeId = !finished && last ? RUN.find((r) => r.test(last))?.id : undefined;
  const lastIndex = Math.max(-1, ...ORDER.map((id, i) => (buckets.get(id)!.length ? i : -1)));
  return ORDER.map((id, i) => {
    const list = buckets.get(id)!;
    const label = RUN.find((r) => r.id === id)!.label;
    if (!list.length) return { id, label, state: finished ? 'skipped' : i < lastIndex ? 'skipped' : 'pending' } as Stage;
    const errors = list.filter((e) => e.status === 'error' || e.phase === 'error');
    const warnings = list.filter((e) => e.status === 'warning' || e.phase === 'warning');
    const ok = list.some((e) => e.status === 'success');
    const tail = (errors[errors.length - 1] || warnings[warnings.length - 1] || list[list.length - 1]);
    const detail = (tail?.message || '').replace(/\s+/g, ' ').slice(0, 140);
    if (id === activeId) return { id, label, state: 'active', detail } as Stage;
    if (errors.length && !ok) return { id, label, state: 'failed', detail } as Stage;
    if (errors.length || warnings.length) return { id, label, state: 'warning', detail } as Stage;
    return { id, label, state: finished || i < lastIndex ? 'done' : 'active', detail } as Stage;
  });
}
