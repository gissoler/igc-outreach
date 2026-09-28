// Backtest del Módulo 2 con corte temporal estricto (T = fecha del anuncio − 1 día).
// Métricas: hit@10 y MRR del líder real a nivel de firma (0 si no está en el top 50), IC por bootstrap,
// y techo de cobertura (% de líderes con al menos un deal en la base antes de T).
import { matchFunds, startupKey } from './entities.mjs';
import { rankAppFit, rankRevealed } from './revealed.mjs';

export const dayBefore = (iso) => new Date(Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

/** Posición (1..) del primer fondo del ranking que coincide con algún líder real; null si no está en el top `cut`. */
export function leadRank(names, leads, cut = 50) {
  for (let i = 0; i < Math.min(cut, names.length); i++) if (leads.some((l) => matchFunds(names[i], l).decision === 'auto')) return i + 1;
  return null;
}
export const metricsOf = (ranks, k = 10) => ({ n: ranks.length, hitAtK: ranks.length ? ranks.filter((r) => r && r <= k).length / ranks.length : null, mrr: ranks.length ? ranks.reduce((s, r) => s + (r ? 1 / r : 0), 0) / ranks.length : null });

/** Bootstrap pareado de la diferencia de una métrica entre dos condiciones (mismas rondas). */
export function bootstrapDiff(ranksA, ranksB, { k = 10, metric = 'hitAtK', B = 1000, seed = 7 } = {}) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
  const n = ranksA.length;
  const diffs = [];
  for (let b = 0; b < B; b++) {
    const idx = Array.from({ length: n }, () => Math.floor(rnd() * n));
    diffs.push(metricsOf(idx.map((i) => ranksA[i]), k)[metric] - metricsOf(idx.map((i) => ranksB[i]), k)[metric]);
  }
  diffs.sort((a, b) => a - b);
  return { mean: metricsOf(ranksA, k)[metric] - metricsOf(ranksB, k)[metric], ci95: [diffs[Math.floor(0.025 * B)], diffs[Math.floor(0.975 * B)]] };
}

/**
 * Corre las condiciones sobre las rondas.
 * rounds: [{id, company, announced, stage, sector, leads:[...], profile_ex_ante, ...}]
 * baselines: { llm: { [roundId]: { names:[...], contaminated:bool } } }
 */
export async function runBacktest(rounds, { allDeals, vehicles, env = {}, fetcher = fetch, useFleet = true, baselines = {}, cache = new Map(), log = () => {}, cutoff = null }) {
  const rows = [];
  for (const r of rounds) {
    const asOf = dayBefore(r.announced);
    const sk = startupKey(r.company);
    const deals = allDeals.filter((d) => d.date && d.date < asOf && d.startupKey !== sk);
    const profile = r.profile_ex_ante || r.profile_hint || '';
    const covered = deals.some((d) => d.investors.some((i) => r.leads.some((l) => matchFunds(i.name, l).decision === 'auto')));
    const app = rankAppFit(profile, { deals, asOf, industry: r.sector });
    const s1 = await rankRevealed(profile, { deals, asOf, vehicles, env, fetcher, useFleet, useRerank: false, useMomentum: false, cache, stage: r.stage });
    const s2 = await rankRevealed(profile, { deals, asOf, vehicles, env, fetcher, useFleet, useRerank: true, useMomentum: true, cache, stage: r.stage });
    const llm = baselines.llm?.[r.id];
    const row = {
      id: r.id, company: r.company, announced: r.announced, stage: r.stage, region: r.region, asOf, leads: r.leads, covered, dealsBeforeT: deals.length,
      ranks: {
        B1_app: leadRank(app.map((f) => f.name), r.leads),
        S1_revelada: leadRank(s1.funds.map((f) => f.name), r.leads),
        S2_revelada_momento_rerank: leadRank(s2.funds.map((f) => f.name), r.leads),
        ...(llm ? { B0_llm: leadRank(llm.names || [], r.leads) } : {}),
      },
      contaminated: llm?.contaminated ?? null,
      method: s2.method,
      top10: s2.funds.slice(0, 10).map((f) => f.name),
    };
    rows.push(row);
    log(`${r.id} ${r.company}: ${JSON.stringify(row.ranks)} (covered: ${covered})`);
  }
  return summarize(rows, { cutoff });
}

export function summarize(rows, { cutoff = null } = {}) {
  const conds = [...new Set(rows.flatMap((r) => Object.keys(r.ranks)))];
  const subsets = {
    todas: rows,
    cubiertas: rows.filter((r) => r.covered),
    no_contaminadas: rows.filter((r) => r.contaminated === false),
    semilla: rows.filter((r) => ['pre-seed', 'seed'].includes(r.stage)),
    ...(cutoff ? { [`posteriores_a_${cutoff}`]: rows.filter((r) => r.announced > cutoff) } : {}),
  };
  const table = {};
  for (const [name, rs] of Object.entries(subsets)) {
    table[name] = {};
    for (const c of conds) { const ranks = rs.filter((r) => c in r.ranks).map((r) => r.ranks[c]); table[name][c] = metricsOf(ranks); }
  }
  const paired = (a, b) => { const rs = rows.filter((r) => a in r.ranks && b in r.ranks); return rs.length ? bootstrapDiff(rs.map((r) => r.ranks[a]), rs.map((r) => r.ranks[b])) : null; };
  const vsBaseline = paired('S2_revelada_momento_rerank', 'B0_llm');
  const vsApp = paired('S2_revelada_momento_rerank', 'B1_app');
  const coverage = rows.length ? rows.filter((r) => r.covered).length / rows.length : null;
  const beatsBaseline = vsBaseline ? vsBaseline.mean > 0 && vsBaseline.ci95[0] > 0 : null;
  return { rows, table, vsBaseline, vsApp, coverage, decision: vsBaseline == null ? 'Missing baseline (b) LLM: run scripts/baseline-llm.mjs.' : beatsBaseline ? 'S2 beats baseline LLM alone (95% CI of hit@10 difference > 0).' : 'S2 does NOT confidently beat baseline LLM alone: stop and report before Module 3.' };
}

export function markdownReport(res) {
  const pct = (x) => x == null ? '—' : `${(100 * x).toFixed(1)} %`;
  const lines = [`Coverage (lead with ≥1 deal in the base before T): ${pct(res.coverage)}`, ''];
  for (const [name, t] of Object.entries(res.table)) {
    lines.push(`### ${name}`, '', '| Condition | n | hit@10 | MRR |', '|---|---|---|---|');
    for (const [c, m] of Object.entries(t)) lines.push(`| ${c} | ${m.n} | ${pct(m.hitAtK)} | ${m.mrr == null ? '—' : m.mrr.toFixed(3)} |`);
    lines.push('');
  }
  if (res.vsApp) lines.push(`S2 − app (hit@10): ${pct(res.vsApp.mean)} [IC 95 %: ${pct(res.vsApp.ci95[0])} a ${pct(res.vsApp.ci95[1])}]`);
  if (res.vsBaseline) lines.push(`S2 − LLM base (hit@10): ${pct(res.vsBaseline.mean)} [IC 95 %: ${pct(res.vsBaseline.ci95[0])} a ${pct(res.vsBaseline.ci95[1])}]`);
  lines.push('', `**Decision:** ${res.decision}`);
  return lines.join('\n');
}
