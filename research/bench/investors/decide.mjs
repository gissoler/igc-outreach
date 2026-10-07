export function proposedInvestorDecision({ comparisons, b2, thresholds }) {
  const checks = {
    recall_vs_b0: comparisons.vs_b0.mean_diff >= thresholds.min_recall_gain && comparisons.vs_b0.sign_test_p_one_sided <= thresholds.alpha,
    recall_vs_b1: comparisons.vs_b1.mean_diff >= thresholds.min_recall_gain && comparisons.vs_b1.sign_test_p_one_sided <= thresholds.alpha,
    ndcg_noninferior: b2.ndcg_delta_min >= -thresholds.max_ndcg_drop,
    hard_false_positive_rate: b2.hard_false_positive_rate <= thresholds.max_hard_false_positive_rate,
    null_abstentions: b2.correct_null_abstentions >= thresholds.min_correct_null_abstentions
  };
  return { status: 'proposed', checks, passes_if_approved: Object.values(checks).every(Boolean), note: 'Thresholds require human approval before any formal run.' };
}
