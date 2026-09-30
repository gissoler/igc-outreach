import { norm } from './core.mjs';

const sourceCount = (lead, predicate = () => true) => new Set((lead.evidence || []).filter((item) => item.verified && predicate(item)).map((item) => {
  try { return new URL(item.url).hostname.replace(/^www\./, ''); } catch { return item.source; }
})).size;
const values = (facts, field) => (Array.isArray(facts?.[field]) ? facts[field] : []).map((item) => String(item.text || ''));
const includesAny = (haystack, needles) => needles.some((needle) => needle && haystack.includes(needle));

export function assessSufficiency(lead, brief, { now = new Date(), activeWindowMonths = 18, terms = [] } = {}) {
  const facts = lead.facts || {};
  const topicTerms = [brief.industry, ...terms.map((term) => typeof term === 'string' ? term : term.term)].flatMap((term) => norm(term).split(' ').filter((word) => word.length > 2));
  const thesis = norm(values(facts, 'invests_in').join(' '));
  const topicSources = sourceCount(lead, (item) => includesAny(norm(item.quote), topicTerms));
  const fundsSpace = includesAny(thesis, topicTerms) || topicSources >= 2;
  const activityDate = Date.parse(facts.last_activity?.date || '');
  const activeCutoff = new Date(now);
  activeCutoff.setMonth(activeCutoff.getMonth() - activeWindowMonths);
  const active = Number.isFinite(activityDate) ? activityDate >= activeCutoff.getTime() : false;
  const stageFacts = norm(values(facts, 'stages').join(' '));
  const geoFacts = norm(values(facts, 'geographies').join(' '));
  const ticketFacts = values(facts, 'ticket');
  const stageKnown = Boolean(stageFacts);
  const stageFit = stageKnown ? includesAny(stageFacts, norm(`${brief.stage} ${brief.round || ''}`).split(' ').filter((word) => word.length > 2)) : null;
  const geoKnown = Boolean(geoFacts);
  const geoFit = geoKnown ? includesAny(geoFacts, norm(brief.geography).split(' ').filter((word) => word.length > 1)) : null;
  const ticketFit = ticketFacts.length ? true : null;
  const decider = Boolean(lead.person && lead.role && (lead.evidence || []).some((item) => item.verified && ['profile', 'person'].includes(item.field))) || Boolean(facts.decision_makers?.some((person) => person.name && person.title && person.quote));
  const contact = Boolean(lead.contact && (lead.evidence || []).some((item) => item.verified && (item.field === 'contact' || item.url === lead.contact.value || item.field === 'profile')));
  const warmPath = Boolean((lead.paths || []).some((path) => path.hypothesis !== true));
  const items = {
    funds_space: { status: fundsSpace ? 'confirmed' : 'unknown' },
    active: { status: active ? 'confirmed' : Number.isFinite(activityDate) ? 'contradictory' : 'unknown' },
    stage_fit: { status: stageFit === true ? 'confirmed' : stageFit === false ? 'contradictory' : 'unknown' },
    geo_fit: { status: geoFit === true ? 'confirmed' : geoFit === false ? 'contradictory' : 'unknown' },
    ticket_fit: { status: ticketFit ? 'confirmed' : 'unknown' },
    decider: { status: decider ? 'confirmed' : 'unknown' },
    contact: { status: contact ? 'confirmed' : 'none' },
    warm_path: { status: warmPath ? 'confirmed' : 'none', plan: lead.warmPlan || null },
  };
  const gaps = Object.entries(items).filter(([, item]) => !['confirmed'].includes(item.status)).map(([key]) => key);
  const contradictory = Object.values(items).some((item) => item.status === 'contradictory');
  return { verdict: contradictory ? 'contradictory' : gaps.length ? 'insufficient' : 'sufficient', items, gaps };
}

export function assessLeads(leads, brief, options = {}) {
  const assessed = leads.map((lead) => ({ ...lead, sufficiency: assessSufficiency(lead, brief, options) }));
  const top = assessed.slice(0, Math.max(1, Number(options.topN) || 5));
  return {
    leads: assessed,
    sufficient: top.length > 0 && top.every((lead) => lead.sufficiency.verdict === 'sufficient'),
    gaps: [...new Set(top.flatMap((lead) => lead.sufficiency.gaps))],
  };
}
