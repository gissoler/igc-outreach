const value = (profile, key) => profile.fields[key]?.value ?? null;
const norm = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function investorB0Queries(profile, templates, today) {
  const vars = {
    sector: value(profile, 'sector'), stage: value(profile, 'funding_stage'), geography: value(profile, 'target_markets')?.[0] ?? value(profile, 'operating_regions')?.[0] ?? value(profile, 'incorporation_country'),
    comparable: value(profile, 'comparable_companies')?.[0] ?? null, subsector: value(profile, 'subsectors')?.[0] ?? null, business_model: value(profile, 'business_model')?.[0] ?? null, year: today.slice(0, 4)
  };
  const seen = new Set(), out = [];
  for (const item of templates) {
    if (item.requires.some(key => vars[key] == null)) continue;
    const query = item.template.replace(/\{\{([a-z_]+)\}\}/g, (_, key) => vars[key]);
    const key = norm(query); if (!key || seen.has(key)) continue; seen.add(key); out.push({ query, origin: `b0:${item.id}` });
  }
  return out;
}

export function validatePlannerBatch(output, seen, maxQueries) {
  const accepted = [], rejected = [];
  for (const query of output.queries ?? []) {
    const key = norm(query);
    if (!key || seen.has(key)) rejected.push({ query, reason: 'duplicate_query' });
    else if (accepted.length >= maxQueries) rejected.push({ query, reason: 'over_limit' });
    else { seen.add(key); accepted.push({ query, origin: output.mode === 'adaptive_step' ? 'planner:adaptive' : 'planner:initial' }); }
  }
  return { accepted, rejected, stop: output.stop === true };
}
