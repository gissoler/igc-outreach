const daysBetween = (a, b) => Math.floor((Date.parse(a) - Date.parse(b)) / 86400000);

export function classifyActivity({ explicitInactive = false, currentOfficialThesis = false, recentEvidence = [], asOf, recencyDays }) {
  if (explicitInactive) return 'inactive';
  const recentOfficial = recentEvidence.some(x => x.source_kind === 'official' && x.published_on && daysBetween(asOf, x.published_on) >= 0 && daysBetween(asOf, x.published_on) <= recencyDays);
  if (recentOfficial) return 'active';
  if (currentOfficialThesis) return 'possibly_active';
  return 'unknown';
}
