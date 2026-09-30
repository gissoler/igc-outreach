/* ─────────────────────────────────────────────────────────────────────────────
   Cómo se aplica a una convocatoria y si llegas a la fecha (30/09).

   Una convocatoria no se «contacta»: se aplica en el portal oficial. Escribir al programa es
   opcional y solo tiene sentido si la convocatoria publica un contacto de programa o científico
   (nunca un helpdesk técnico como grantsgovsupport@…).

   Cada ruta tiene pasos previos con su tiempo típico. Si los días que quedan no alcanzan para
   esos pasos, la fecha publicada no es alcanzable: se apunta al siguiente ciclo cuando se conoce.
   Tiempos: los que publican las agencias (NIH pide registrarse con ≥ 6 semanas; la invitación del
   Project Pitch de NSF SBIR tarda 2–4 semanas). Son estimaciones prudentes, no garantías.
   ───────────────────────────────────────────────────────────────────────────── */

const DAY = 86_400_000;
const iso = (d) => d.toISOString().slice(0, 10);
const text = (lead) => `${lead.title || ''} ${lead.org || ''} ${lead.facts?.agency || ''} ${lead.externalId || ''}`;

/** n-ésimo día de la semana (0=domingo) de un mes. */
function nthWeekday(year, month, weekday, n = 1) {
  const d = new Date(Date.UTC(year, month, 1));
  const shift = (weekday - d.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month, 1 + shift + 7 * (n - 1)));
}

/* NSF SBIR/STTR: ventanas anuales publicadas en NSF 26-511 — primer miércoles de julio,
   primer miércoles de noviembre y primer jueves de marzo. */
function nsfSbirWindows(from, count = 4) {
  const out = [];
  for (let y = from.getUTCFullYear(); out.length < count && y < from.getUTCFullYear() + 3; y++) {
    for (const d of [nthWeekday(y, 2, 4), nthWeekday(y, 6, 3), nthWeekday(y, 10, 3)]) if (d > from) out.push(d);
  }
  return out.sort((a, b) => a - b).slice(0, count);
}

const HELPDESK = /grantsgovsupport|support@|helpdesk|help@|webmaster|noreply|no-reply|grants\.gov support|contact center|servicedesk/i;
/** ¿El contacto publicado es de programa/científico (útil para una pregunta de alcance) o un helpdesk técnico? */
export function isProgramContact(contact, lead = {}) {
  if (!contact || contact.type !== 'email') return false;
  if (HELPDESK.test(String(contact.value)) || HELPDESK.test(String(contact.provenance || ''))) return false;
  return Boolean(lead.person) || /scientific|program (?:officer|director|contact)|research contact/i.test(String(contact.provenance || '') + String(lead.role || ''));
}

const ROUTES = [
  {
    id: 'nsf_sbir', test: (l) => /\bNSF\b|National Science Foundation/i.test(text(l)) && /\bSBIR\b|\bSTTR\b|small business innovation/i.test(text(l)),
    portal: { name: 'Research.gov', url: 'https://www.research.gov' }, info: 'https://seedfund.nsf.gov/apply/',
    steps: [
      { key: 'pitch', label: 'Submit a Project Pitch and receive the official invitation (required for Phase I and Fast-Track)', days: 30, required: true },
      { key: 'sam', label: 'Register the company in SAM.gov (UEI) and the SBA company registry', days: 21, registration: true },
      { key: 'portal', label: 'Research.gov account for the company and the PI', days: 5, registration: true },
      { key: 'proposal', label: 'Write and submit the full proposal in Research.gov (not Grants.gov)', days: 21, required: true },
    ],
    windows: nsfSbirWindows,
    note: 'NSF SBIR/STTR: first a Project Pitch; the invitation is valid for the next two deadlines.',
  },
  {
    id: 'nih', test: (l) => /\bNIH\b|National Institutes? of Health|\b(RFA|PAR|PA|PAS)-[A-Z]{2}-\d{2}/i.test(text(l)),
    portal: { name: 'Grants.gov Workspace or NIH ASSIST', url: 'https://public.era.nih.gov/assist' }, info: 'https://grants.nih.gov/how-to-apply-application-guide',
    steps: [
      { key: 'sam', label: 'Register the organization in SAM.gov (UEI) and Grants.gov', days: 28, registration: true },
      { key: 'era', label: 'eRA Commons accounts for the organization and the PI (NIH asks to start ≥ 6 weeks before)', days: 14, registration: true },
      { key: 'loi', label: 'Letter of intent if the notice asks for one (usually ~30 days before)', days: 0 },
      { key: 'proposal', label: 'Prepare and submit the application package', days: 30, required: true },
    ],
    note: 'NIH: you apply through Grants.gov/ASSIST. Writing to the scientific contact listed in the notice is normal for fit questions, but optional.',
  },
  {
    id: 'nsf', test: (l) => /\bNSF\b|National Science Foundation/i.test(text(l)),
    portal: { name: 'Research.gov', url: 'https://www.research.gov' }, info: 'https://new.nsf.gov/funding/how-to-apply',
    steps: [
      { key: 'sam', label: 'Register the organization in SAM.gov (UEI)', days: 21, registration: true },
      { key: 'portal', label: 'Research.gov accounts for the organization and the PI', days: 5, registration: true },
      { key: 'proposal', label: 'Prepare and submit the proposal in Research.gov', days: 30, required: true },
    ],
  },
  {
    id: 'grantsgov', test: (l) => /grants\.gov/i.test(JSON.stringify(l.evidence || []).slice(0, 4000)) || /^\d{2}-\d{3}$|[A-Z]+-\d{2}-/.test(String(l.externalId || '')),
    portal: { name: 'Grants.gov Workspace', url: 'https://www.grants.gov/applicants/workspace-overview' }, info: 'https://www.grants.gov/applicants/applicant-registration',
    steps: [
      { key: 'sam', label: 'Register the organization in SAM.gov (UEI) and Grants.gov', days: 28, registration: true },
      { key: 'proposal', label: 'Prepare and submit the application in Grants.gov Workspace', days: 30, required: true },
    ],
  },
  {
    id: 'web', test: () => true, portal: null, info: null,
    steps: [{ key: 'proposal', label: 'Apply through the form or instructions on the official program page', days: 21, required: true }],
  },
];

/**
 * Ruta de aplicación y factibilidad de la fecha.
 * brief.registered (opcional): true si la organización ya tiene SAM/UEI y cuentas del portal.
 * Devuelve { route, portal, officialUrl, steps, leadDays, feasible, verdict, nextDeadline, message, contactAdvice }.
 */
export function applicationRoute(lead, brief = {}, today = new Date()) {
  const route = ROUTES.find((r) => r.test(lead));
  const registered = brief.registered === true || /\b(sam|uei|registered)\b/i.test(String(brief.registrations || ''));
  const steps = route.steps.map((s) => ({ ...s, skip: Boolean(registered && s.registration) }));
  const leadDays = steps.filter((s) => !s.skip).reduce((n, s) => Math.max(n, 0) + s.days, 0);
  const deadline = lead.deadline ? new Date(`${lead.deadline}T23:59:59Z`) : null;
  const days = deadline ? Math.floor((deadline - today) / DAY) : null;
  const officialUrl = (lead.evidence || []).find((e) => e.verified && /^https?:/.test(e.url))?.url || (lead.evidence || []).find((e) => /^https?:/.test(e.url))?.url || null;
  let verdict = 'unknown';
  let nextDeadline = null;
  let message;
  if (days === null) message = 'No deadline published: confirm the dates on the official page.';
  else if (days < 0) { verdict = 'closed'; message = 'The deadline has passed.'; }
  else if (days >= leadDays) { verdict = 'feasible'; message = `${days} days left; the steps before submitting take about ${leadDays}.`; }
  else { verdict = days >= Math.round(leadDays * 0.6) ? 'tight' : 'not_feasible'; message = `${days} days left, but the required steps usually take about ${leadDays}.`; }
  if (route.windows && verdict !== 'feasible') {
    const soonest = new Date(today.getTime() + leadDays * DAY);
    nextDeadline = route.windows(today).find((d) => d >= soonest) || null;
    if (nextDeadline) message += ` Realistic target: ${iso(nextDeadline)}.`;
  }
  const program = isProgramContact(lead.contact, lead);
  return {
    route: route.id,
    portal: route.portal,
    infoUrl: route.info,
    officialUrl,
    steps: steps.map(({ key, label, days: d, required, skip }) => ({ key, label, days: d, required: Boolean(required), skip })),
    leadDays,
    daysToDeadline: days,
    feasible: verdict === 'feasible',
    verdict,
    nextDeadline: nextDeadline ? iso(nextDeadline) : null,
    message: [route.note, message].filter(Boolean).join(' '),
    contactAdvice: program
      ? 'Optional: the notice lists a program contact. Write only with a specific scope or eligibility question; the application itself goes through the portal.'
      : 'No need to write to anyone: apply through the official portal.',
  };
}
