const host = (value) => { try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return String(value || '').replace(/^www\./, '').toLowerCase(); } };
const accepted = (lead, gold) => (gold.acceptable_funders || []).some((item) => host(item.host || item.evidence_url) === host(lead.org) || String(item.name || '').toLowerCase() === String(lead.org || '').toLowerCase());

export function evaluateRun(job, gold) {
  const top = (job.leads || []).filter((lead) => lead.bucket === 'top').slice(0, 10);
  const acceptable = gold.acceptable_funders || [];
  const hits = top.filter((lead) => accepted(lead, gold));
  const top5 = top.slice(0, 5);
  const citedDecider = top.filter((lead) => (lead.person && lead.role && lead.evidence?.some((item) => item.verified)) || lead.facts?.decision_makers?.length).length;
  const claims = top.flatMap((lead) => lead.evidence || []);
  const falseWarmPaths = top.filter((lead) => lead.paths?.some((path) => path.hypothesis === false && !(path.hops || []).every((hop) => hop.evidenceIds?.length))).length;
  const cost = Object.values(job.usage || {}).reduce((sum, row) => sum + Number(row.costUsd || 0), 0);
  // Casos negativos del gold set: convocatorias que NUNCA deben quedar como prioridad ni radar.
  const rejectedIds = new Set((gold.rejected_opportunities || []).flatMap((item) => [item.id, item.number].filter(Boolean).map(String)));
  const falsePositives = (job.leads || []).filter((lead) => lead.bucket !== 'discarded' && rejectedIds.has(String(lead.externalId || ''))).length;
  return {
    id: gold.id,
    recallAt10: acceptable.length ? hits.length / acceptable.length : null,
    precisionAt5: top5.length ? top5.filter((lead) => accepted(lead, gold)).length / top5.length : null,
    deciderCoverageAt10: top.length ? citedDecider / top.length : 0,
    verifiedCitationRate: claims.length ? claims.filter((item) => item.verified).length / claims.length : 0,
    falseWarmPaths,
    falsePositives,
    searches: job.queryLedger?.length || 0,
    costUsd: cost,
    latencyMs: Date.parse(job.finishedAt || 0) - Date.parse(job.createdAt || 0),
    partial: job.status === 'partial' ? 1 : 0,
  };
}

export function aggregateMetrics(rows) {
  const average = (field) => { const values = rows.map((row) => row[field]).filter(Number.isFinite); return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; };
  return { cases: rows.length, ...Object.fromEntries(['recallAt10', 'precisionAt5', 'deciderCoverageAt10', 'verifiedCitationRate', 'falseWarmPaths', 'falsePositives', 'searches', 'costUsd', 'latencyMs', 'partial'].map((field) => [field, average(field)])) };
}

