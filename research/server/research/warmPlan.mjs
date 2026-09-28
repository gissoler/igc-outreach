// Warm path para TODOS los candidatos. Un warm path no es solo "alguien de tu red que te presenta":
// también es la relación que construyes antes de pedir dinero (pedir consejo sin pedir dinero,
// updates periódicos al fondo antes de abrir la ronda, eventos, program officer en grants).
// Regla determinista y explicable; el asesor IA la puede refinar después.

const DAY = 86400000;

/** Meses hasta abrir la ronda a partir del texto libre del perfil ("Q2 2026", "6 months", "en 3 meses"). */
export function monthsToRound(timeline, now = new Date()) {
  const t = String(timeline || '').toLowerCase();
  const q = t.match(/\bq([1-4])\s*(?:of\s*)?(\d{4})\b/) || t.match(/\b(\d{4})\s*q([1-4])\b/);
  if (q) {
    const [quarter, year] = /^\d{4}$/.test(q[1]) ? [Number(q[2]), Number(q[1])] : [Number(q[1]), Number(q[2])];
    const start = new Date(Date.UTC(year, (quarter - 1) * 3, 1));
    return Math.max(0, Math.round((start - now) / (30 * DAY)));
  }
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*(months?|meses?|mo)\b/);
  if (m) return Math.round(Number(m[1].replace(',', '.')));
  const w = t.match(/(\d+)\s*(weeks?|semanas?)\b/);
  if (w) return Math.max(0, Math.round(Number(w[1]) / 4));
  const y = t.match(/\b(20\d\d)\b/);
  if (y) return Math.max(0, Math.round((Date.UTC(Number(y[1]), 0, 1) - now) / (30 * DAY)));
  return null;
}

const addDays = (d, n) => new Date(d.getTime() + n * DAY).toISOString().slice(0, 10);

/**
 * Plan de warm path para un candidato.
 * route: intro (hay conector) · direct (relación directa) · updates (construir relación con updates) ·
 *        advice (pedir consejo, sin dinero) · program_officer (grants) · monitor (radar).
 */
export function planWarmPath(lead, brief = {}, { now = new Date() } = {}) {
  if (lead.bucket === 'discarded') return null;
  const best = [...(lead.paths || [])].sort((a, b) => (b.strength || 0) - (a.strength || 0))[0] || null;
  const months = monthsToRound(brief.timeline, now);
  // Cadencia de updates: con la ronda cerca se comprime; lejos, cada 3–4 meses (no saturar).
  const cadence = months == null ? 90 : months <= 3 ? 30 : months <= 6 ? 45 : months <= 12 ? 90 : 120;
  const name = lead.person || lead.org;
  const first = String(lead.person || '').split(' ')[0] || lead.org;
  const grant = lead.fundingType === 'grant' || lead.kind === 'opportunity';
  const partner = lead.fundingType === 'partnering' || lead.fundingType === 'sponsorship';
  const roundLabel = months == null ? 'before you open the round' : months <= 1 ? 'now' : `in ~${months} months`;

  if (grant) {
    const days = lead.daysToDeadline;
    const far = days == null || days > 45;
    return {
      route: 'program_officer', label: 'Talk to the program officer', built: false, cadenceDays: null,
      why: 'Grants are warmer when the program officer already knows your project and has confirmed fit before you submit.',
      steps: [
        { when: addDays(now, 0), what: far ? 'Email the program officer a 5-line summary and one specific fit question.' : 'Confirm eligibility with the published contact before drafting.' },
        { when: addDays(now, far ? 14 : 3), what: 'Adjust the aims to their answer; ask if a pre-submission call is possible.' },
        ...(days != null ? [{ when: addDays(now, Math.max(0, days - 7)), what: 'Submit a week before the deadline.' }] : []),
      ],
    };
  }

  if (best && (best.nodes || []).length > 2) {
    const via = best.nodes[1];
    return {
      route: 'intro', label: `Warm intro via ${via}`, built: true, via, cadenceDays: cadence,
      why: `${via} connects you to ${first}. Keep ${via} updated so the intro comes with context, and keep ${first} warm with updates after it.`,
      steps: [
        { when: addDays(now, 0), what: `Send ${via} a short update and ask if they'd be comfortable introducing you (double opt-in).` },
        { when: addDays(now, 7), what: `After the intro, ask ${first} for feedback, not money, and permission to send updates.` },
        { when: addDays(now, cadence), what: `Send ${first} your next investor update.` },
        { when: months == null ? null : addDays(now, Math.max(cadence * 2, months * 30)), what: `Ask for a meeting ${roundLabel}, when you open the round.` },
      ],
    };
  }

  if (best) {
    return {
      route: 'direct', label: 'Direct relationship', built: true, cadenceDays: cadence,
      why: `You already have a documented relationship with ${first}. Turn it into a fundraising relationship with updates before asking.`,
      steps: [
        { when: addDays(now, 0), what: `Reconnect with ${first}: share what you're building and ask one specific question.` },
        { when: addDays(now, cadence), what: 'Send your investor update.' },
        { when: months == null ? null : addDays(now, Math.max(cadence * 2, months * 30)), what: `Ask for a meeting ${roundLabel}.` },
      ],
    };
  }

  // Sin camino en la red: buscar en la evidencia del candidato un ángulo concreto (evento, contenido,
  // portafolio, office hours, tesis publicada, afiliación compartida…). Si no hay señal, consejo + updates.
  const angle = findAngle(lead, brief);
  if (angle) {
    const updatesN = Math.max(2, Math.min(3, months == null ? 2 : Math.floor((months * 30) / cadence)));
    return {
      route: angle.route, label: angle.label, built: false, cadenceDays: cadence, updates: updatesN, hook: angle.hook, source: 'signals',
      evidence: angle.evidence ? { id: angle.evidence.id, url: angle.evidence.url, quote: String(angle.evidence.quote || '').slice(0, 240) } : null,
      why: angle.why(first),
      steps: [
        ...angle.steps(first).map((what, i) => ({ when: addDays(now, i * 7), what })),
        ...Array.from({ length: updatesN }, (_, i) => ({ when: addDays(now, cadence * (i + 1)), what: i === 0 ? 'Send your first investor update, referencing that first exchange.' : `Update ${i + 1}: momentum since the last one.` })),
        { when: addDays(now, cadence * (updatesN + 1)), what: `Ask for a meeting ${roundLabel}.` },
      ],
    };
  }

  // Sin camino en la red: el warm path se construye. Pedir consejo primero, luego updates, y pedir dinero solo al final.
  const updates = Math.max(2, Math.min(4, months == null ? 3 : Math.floor((months * 30) / cadence)));
  const route = partner ? 'advice' : 'updates';
  const steps = [
    { when: addDays(now, 0), what: partner ? `Ask ${first} for 20 minutes of feedback on a pilot or collaboration idea. No ask yet.` : `Ask ${first} for feedback on one specific question (not money), and whether you can send them updates.` },
    ...Array.from({ length: updates }, (_, i) => ({ when: addDays(now, cadence * (i + 1)), what: i === 0 ? 'First investor update: progress, one number, one specific ask (an intro or advice).' : `Update ${i + 1}: show momentum since the last one.` })),
    { when: addDays(now, cadence * (updates + 1)), what: partner ? 'Propose a concrete pilot or partnership.' : `Ask for a meeting ${roundLabel}: by then ${first} has seen ${updates} updates.` },
  ];
  return {
    route, label: partner ? 'Build it: advice first' : `Build it: updates every ${cadence} days`, built: false, cadenceDays: cadence, updates,
    why: partner
      ? `No one in your network connects to ${name} yet. Start with advice, not a pitch; partners say yes to people they've already worked with.`
      : `No one in your network connects to ${name} yet. Funds invest in lines, not dots: ${updates} updates before the round turn a cold contact into a warm one.`,
    steps,
  };
}

export function addWarmPlans(leads, brief, opts) {
  return leads.map((l) => { const plan = planWarmPath(l, brief, opts); return plan ? { ...l, warmPlan: plan } : l; });
}

/* ───────── Ángulos: señales en la evidencia que abren una puerta sin conocer a nadie ─────────
   Cada ángulo exige una cita concreta del candidato (url + quote). El orden es de más a menos cálido. */
const text = (e) => `${e.quote || ''} ${e.title || ''}`;
const ANGLES = [
  {
    route: 'portfolio_founder', rx: /\b(portfolio|invested in|led the (?:seed|round|series)|backed|participated in the round|co-?led)\b/i,
    label: 'Via a founder they backed', hook: 'Founders they already funded are the most trusted intro a fund gets.',
    why: (f) => `${f} has backed companies close to yours. A founder from that portfolio can vouch for you, and asking them for advice is easy.`,
    steps: (f) => ['Pick one founder from their portfolio in an adjacent space and ask for 15 minutes of advice on fundraising with this fund.', `If it goes well, ask whether they'd mention you to ${f}.`],
  },
  {
    route: 'office_hours', rx: /\b(office hours|open door|pitch us|apply (?:now|here)|applications? (?:are )?open|accelerator|fellowship|cohort|demo day|request for (?:startups|proposals)|open until|now accepting|call for (?:proposals|applications|pilots))\b/i,
    label: 'Use their open door', hook: 'They publicly invite founders in: that is a sanctioned, warm-enough entry.',
    why: (f) => `${f}'s organization runs an open program or office hours. Using the channel they built is warmer than a cold email.`,
    steps: () => ['Apply to or book their office hours / program, tailoring the pitch to what they said they look for.', 'After the session, ask permission to send updates.'],
  },
  {
    route: 'event', rx: /\b(conference|summit|panel|keynote|speaker|speaking at|webinar|meetup|fireside|demo day|event)\b/i,
    label: 'Meet them at an event', hook: 'A question in their Q&A or a follow-up on their talk is a natural first touch.',
    why: (f) => `${f} speaks at or attends events. A thoughtful follow-up on what they said is a warm first touch.`,
    steps: (f) => [`Attend (or watch) ${f}'s next talk; ask one sharp question tied to your space.`, 'Follow up within 48h referencing their point and one data point of yours.'],
  },
  {
    route: 'content', rx: /\b(podcast|episode|newsletter|blog|substack|op-?ed|interview|wrote|writes|article|thread|post(?:ed)? on)\b/i,
    label: 'Engage with what they publish', hook: 'Answering their own thinking with your data makes you memorable, not another pitch.',
    why: (f) => `${f} publishes their views. Reply to one specific piece with a data point from your work; that earns a conversation.`,
    steps: (f) => [`Reply to ${f}'s most relevant piece with one insight or number from your product (no ask).`, 'A week later, ask one question their piece left open for founders like you.'],
  },
  {
    route: 'thesis', rx: /\b(thesis|we (?:look|are looking) for|we invest in|focus(?:es|ed)? on|interested in|investment areas?|mandate|priorit(?:y|ies))\b/i,
    label: 'Answer their published thesis', hook: 'Mirroring their own words shows fit before the first call.',
    why: (f) => `${f}'s published thesis overlaps with you. Open with how you fit their words, not your deck.`,
    steps: (f) => [`Write 4 lines to ${f} mapping your company to their stated thesis (quote it), and ask for feedback, not money.`, 'Offer to send a short update when you hit your next milestone.'],
  },
  {
    route: 'research_link', rx: /\b(co-?author|publication|paper|study|trial|investigator|grant(?:ee)?|lab|professor|university)\b/i,
    label: 'Through the science', hook: 'A shared research topic is a peer-to-peer opener, not a pitch.',
    why: (f) => `${f} has research ties to your area. Lead with the science or data, then the company.`,
    steps: (f) => [`Share with ${f} a result or protocol from your work related to theirs and ask for their critique.`, 'If they engage, invite them to advise on the pilot.'],
  },
];
export function findAngle(lead, brief = {}) {
  const ev = (lead.evidence || []).filter((e) => e && e.url);
  // Afiliación compartida con el equipo (universidad, empleador anterior).
  const mine = [brief.company, brief.organization, ...(brief.affiliations || [])].map((x) => String(x || '').toLowerCase()).filter((x) => x.length > 3);
  const theirs = (lead.affiliations || []).map((x) => String(x || '').toLowerCase());
  const shared = theirs.find((t) => mine.some((m) => t.includes(m) || m.includes(t)));
  if (shared) return {
    route: 'shared_affiliation', label: 'Shared affiliation', hook: `You share ${shared}.`, evidence: ev[0] || null,
    why: (f) => `You and ${f} share ${shared}. Open with that, it's a legitimate reason to talk.`,
    steps: (f) => [`Reach out to ${f} through the ${shared} community (alumni group, former colleagues) with one specific question.`],
  };
  for (const a of ANGLES) {
    const hit = ev.find((e) => a.rx.test(text(e))) || (a.rx.test(`${lead.title || ''} ${lead.role || ''}`) ? ev[0] : null);
    if (hit) return { ...a, evidence: hit };
  }
  return null;
}
