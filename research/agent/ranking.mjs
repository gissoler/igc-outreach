/**
 * Ordena entidades con una clave determinista.
 * No cambia juicios ni resuelve empates al azar.
 * Contratos: entidades y judgments v1.
 * No conoce ningún dominio: todo lo específico llega por el DomainPack.
 */
const classRank = {
  eligible: 0,
  eligible_pending: 1,
  conflict: 2,
  ineligible: 3,
  unjudged: 4,
};
const scopeRank = {
  met: 0,
  unknown: 1,
  not_applicable: 1,
  conflict: 2,
  not_met: 3,
};

/**
 * Construye la tupla total que hace reproducible el ranking.
 * Puro respecto de red, disco y reloj.
 * @param {object} entity Entidad consolidada.
 * @param {object|undefined} judgment Juicio asociado, si existe.
 * @returns {Array<unknown>} Clave lexicográfica del ranking.
 */
export function sortKey(entity, judgment) {
  const aggregate = judgment?.aggregate;
  const scope = judgment?.criteria?.find(item => item.criterion_id === 'G-SCOPE')?.state;
  return [
    classRank[aggregate?.eligibility_class] ?? 4,
    entity.official ? 0 : 1,
    scopeRank[scope] ?? 1,
    aggregate?.eligibility_class === 'unjudged' ? 99 : (aggregate?.hard_unknown?.length ?? 99),
    -(aggregate?.soft_score ?? 0),
    entity.validity.closes_on ?? '9999-12-31',
    entity.first_seen.search_index,
    entity.first_seen.order,
    entity.stable_id,
  ];
}

function compareKeys(left, right) {
  for (let index = 0; index < left.length; index++) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

/**
 * Ordena entidades sin modificar los juicios que recibió.
 * Puro respecto de red, disco y reloj.
 * @param {object[]} entities Entidades consolidadas.
 * @param {object[]} judgments Juicios por stable_id.
 * @returns {object[]} Ranking numerado con su clave auditable.
 */
export function rank(entities, judgments) {
  const byStableId = new Map(judgments.map(judgment => [judgment.stable_id, judgment]));
  return entities
    .map(entity => ({
      entity,
      judgment: byStableId.get(entity.stable_id),
      key: sortKey(entity, byStableId.get(entity.stable_id)),
    }))
    .sort((left, right) => compareKeys(left.key, right.key))
    .map(({ entity, judgment, key }, index) => ({
      rank: index + 1,
      stable_id: entity.stable_id,
      eligibility_class: judgment?.aggregate.eligibility_class || 'unjudged',
      recommendable: judgment?.aggregate.recommendable || false,
      official: entity.official,
      sort_key: key,
    }));
}
