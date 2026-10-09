export const CAPITAL_STRATEGY_METRICS = Object.freeze([
  'human_segment_acceptance_rate', 'evidence_coverage', 'comparable_validity', 'funding_mechanism_diversity',
  'perceived_utility', 'perceived_novelty', 'unsupported_claim_rate', 'useful_query_rate', 'cost_usd', 'latency_ms',
]);
export const APOLLO_CONTACT_METRICS = Object.freeze([
  'person_precision_at_k', 'role_accuracy', 'people_coverage_by_organization', 'verified_email_rate',
  'credits_per_useful_contact', 'person_organization_match_accuracy', 'possible_bridge_precision', 'false_warm_path_rate',
]);

export function emptyCapitalEvaluation(asOf) {
  return { schema_version: 'capital_strategy_evaluation/1', as_of: asOf, benchmark_independent: true, metrics: Object.fromEntries(CAPITAL_STRATEGY_METRICS.map((key) => [key, null])) };
}
export function emptyApolloEvaluation(asOf) {
  return { schema_version: 'apollo_contact_evaluation/1', as_of: asOf, benchmark_independent: true, metrics: Object.fromEntries(APOLLO_CONTACT_METRICS.map((key) => [key, null])), excluded_outcomes: ['response', 'meeting', 'introduction', 'investment'] };
}
