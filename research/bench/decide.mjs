/**
 * Aplica la regla congelada de decisión experimental.
 * No calcula métricas ni incorpora la referencia productiva.
 * Contratos: metrics_report/1 y decision_rule@v1.
 */

/**
 * Evalúa los siete controles de adopción sin alterar las métricas recibidas.
 * Puro respecto de red, disco y reloj.
 * @param {object} input Reporte de métricas y comparaciones por condición.
 * @returns {object} Decisión reproducible con el detalle de cada control.
 */
export function decide(input) {
  const b1 = input.vs_b1 || input.comparisons?.B1 || {};
  const b0 = input.vs_b0 || input.comparisons?.B0 || {};
  const means = input.means || input.conditions || {};
  const integrity = input.integrity || {};
  const probability = b1.p ?? b1.sign_test_p_one_sided;
  const interval = b1.ci ?? b1.bootstrap_ci95 ?? [0, 0];
  const n = (b1.wins || 0) + (b1.losses || 0);
  const hfp2 = means.B2?.hard_false_positive_rate ?? input.hfp?.B2 ?? 0;
  const hfp0 = means.B0?.hard_false_positive_rate ?? input.hfp?.B0 ?? 0;
  const hfp1 = means.B1?.hard_false_positive_rate ?? input.hfp?.B1 ?? 0;
  const abstentions2 = means.B2?.correct_abstentions ?? input.abstentions?.B2 ?? 0;
  const abstentions0 = means.B0?.correct_abstentions ?? input.abstentions?.B0 ?? 0;
  const abstentions1 = means.B1?.correct_abstentions ?? input.abstentions?.B1 ?? 0;
  const hit2 = means.B2?.hit_at_20 ?? input.hit?.B2 ?? 0;
  const hit1 = means.B1?.hit_at_20 ?? input.hit?.B1 ?? 0;
  const controls = [
    n >= 8 && probability <= 0.05,
    interval[0] > 0,
    (b0.wins || 0) > (b0.losses || 0),
    hfp2 <= Math.min(hfp0, hfp1) + 0.05,
    abstentions2 >= Math.max(abstentions0, abstentions1) - 1,
    hit2 >= hit1 - 0.05,
    (integrity.fatal_rate ?? 0) <= 0.05 &&
      (integrity.logs_valid ?? true) &&
      (integrity.unknown_to_met ?? 0) === 0 &&
      (integrity.kappa_positive ?? input.kappa_positive ?? 1) >= 0.6,
  ];
  const checks = controls.map((passed, index) => ({
    id: `D${index + 1}`,
    passed,
    detail: `D${index + 1} ${passed ? 'passed' : 'failed'}`,
  }));
  let outcome;
  if (!controls[6]) outcome = 'INCONCLUSIVE';
  else if ((b1.wins || 0) <= (b1.losses || 0) || !controls[3] || !controls[4] || !controls[5]) {
    outcome = 'DO_NOT_ADOPT';
  } else if (controls.slice(0, 6).every(Boolean)) outcome = 'ADOPT_B2';
  else outcome = 'INCONCLUSIVE';
  return {
    rule_version: 'decision_rule@v1',
    outcome,
    checks,
    label: 'business_rule_exploratory',
  };
}
