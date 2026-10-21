/* Regla de decisión propuesta del benchmark de inversionistas.
   Arreglo 20-10: antes `null <= umbral` daba true en JS (null → 0), así que si ninguna corrida emitía una recomendación
   (gain ≥ 2), el control de falsos positivos «pasaba» por coerción y no por calibración. Ahora cada check es
   true | false | null (no evaluable); un check no evaluable nunca aprueba, y una corrida que se abstiene en TODOS los
   casos positivos se marca como degenerada (sus abstenciones correctas en los negativos no prueban nada). */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ge = (a, b) => (num(a) === null || num(b) === null ? null : a >= b);
const le = (a, b) => (num(a) === null || num(b) === null ? null : a <= b);
const both = (x, y) => (x === null || y === null ? null : x && y);

export function proposedInvestorDecision({ comparisons, b2, thresholds }) {
  const checks = {
    recall_vs_b0: both(ge(comparisons?.vs_b0?.mean_diff, thresholds.min_recall_gain), le(comparisons?.vs_b0?.sign_test_p_one_sided, thresholds.alpha)),
    recall_vs_b1: both(ge(comparisons?.vs_b1?.mean_diff, thresholds.min_recall_gain), le(comparisons?.vs_b1?.sign_test_p_one_sided, thresholds.alpha)),
    ndcg_noninferior: ge(b2?.ndcg_delta_min, num(thresholds.max_ndcg_drop) === null ? null : -thresholds.max_ndcg_drop),
    hard_false_positive_rate: le(b2?.hard_false_positive_rate, thresholds.max_hard_false_positive_rate),
    null_abstentions: ge(b2?.correct_null_abstentions, thresholds.min_correct_null_abstentions),
  };
  // Sin ninguna recomendación del sistema la tasa de falsos positivos no existe: el sistema no se evaluó, no «acertó».
  const degenerate = num(b2?.hard_false_positive_rate) === null;
  const not_evaluable = Object.entries(checks).filter(([, v]) => v === null).map(([k]) => k);
  const passes = !degenerate && not_evaluable.length === 0 && Object.values(checks).every((v) => v === true);
  return { status: degenerate ? 'not_evaluable' : 'proposed', checks, not_evaluable, degenerate, passes_if_approved: passes,
    note: degenerate ? 'No run emitted a recommendation (gain ≥ 2): abstaining everywhere is not a calibrated result. Thresholds still require human approval.' : 'Thresholds require human approval before any formal run.' };
}
