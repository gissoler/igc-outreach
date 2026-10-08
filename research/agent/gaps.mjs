/**
 * Deriva brechas de evidencia para el siguiente paso.
 * No ejecuta acciones ni consulta al juez.
 * Contratos: estado del registro y catálogo de criterios.
 * No conoce ningún dominio: todo lo específico llega por el DomainPack.
 */
import { createHash } from 'node:crypto';
import { norm } from '../server/research/core.mjs';

const order = {
  official_source_missing: 0,
  criterion_missing: 1,
  deadline_unparsed: 2,
  link_unfetched: 3,
  mention_unresolved: 4,
};

const gapId = (type, stableId, criterionId, key = '') => {
  const input = `${type}|${stableId || ''}|${criterionId || ''}|${key}`;
  return `g-${createHash('sha256').update(input).digest('hex').slice(0, 8)}`;
};

function makeGap(type, entity, criterionId, detail, key, opportunityRefs) {
  return {
    gap_id: gapId(type, entity?.stable_id, criterionId, key),
    type,
    opportunity_ref: entity ? opportunityRefs.get(entity.stable_id) : null,
    criterion_id: criterionId,
    detail,
  };
}

function mentionIsResolved(mention, entities, identifierKeys) {
  if (mention.identifier_text && identifierKeys.has(norm(mention.identifier_text))) return true;
  const mentionName = norm(mention.name);
  return entities.some(entity => {
    const entityName = norm(entity.name);
    const short = mentionName.length <= entityName.length ? mentionName : entityName;
    const long = mentionName.length <= entityName.length ? entityName : mentionName;
    return short.split(' ').length >= 2 && ` ${long} `.includes(` ${short} `);
  });
}

function sortGaps(gaps, catalog) {
  return gaps.sort((left, right) => (
    order[left.type] - order[right.type] ||
    Number(left.opportunity_ref?.slice(1) || 999) - Number(right.opportunity_ref?.slice(1) || 999) ||
    catalog.criteria.findIndex(item => item.criterion_id === left.criterion_id) -
      catalog.criteria.findIndex(item => item.criterion_id === right.criterion_id)
  )).slice(0, 40);
}

/**
 * Calcula brechas ordenadas sin leer resultados del juez.
 * Invariante: una mención sin entidad conserva opportunity_ref nulo.
 * @param {object} registry Registro consolidado de la corrida.
 * @param {object} catalog Catálogo de criterios validado.
 * @returns {object[]} Hasta cuarenta brechas en orden determinista.
 */
export function computeGaps(registry, catalog) {
  const entities = registry.entities();
  const gaps = [];
  const evidence = stableId => registry.evidenceFor(stableId);
  const opportunityRefs = new Map(entities.map(entity => [
    entity.stable_id,
    `o${entity.first_seen.order + 1}`,
  ]));
  for (const entity of entities) {
    if (!entity.official) {
      gaps.push(makeGap('official_source_missing', entity, null, 'Official source not found', '', opportunityRefs));
    }
    if (entity.official) {
      for (const criterion of catalog.criteria) {
        const missing = criterion.kind === 'hard' &&
          criterion.evaluator === 'llm' &&
          criterion.applicability === 'always' &&
          !evidence(entity.stable_id).some(item => item.criterion_id === criterion.criterion_id);
        if (missing) {
          const detail = `Missing verified evidence for ${criterion.criterion_id}`;
          gaps.push(makeGap('criterion_missing', entity, criterion.criterion_id, detail, '', opportunityRefs));
        }
      }
    }
    if (entity.official && !entity.validity.closes_on && entity.validity.status === 'unknown') {
      gaps.push(makeGap('deadline_unparsed', entity, null, 'Deadline could not be parsed', '', opportunityRefs));
    }
  }
  for (const link of registry.links().filter(item => !item.fetched)) {
    const entity = entities.find(item => item.stable_id === link.stable_id);
    gaps.push(makeGap('link_unfetched', entity, null, link.anchor_text || link.url, link.link_id, opportunityRefs));
  }
  const identifierKeys = new Set(entities.flatMap(entity => entity.identifiers.map(item => norm(item.value))));
  for (const mention of registry.mentions().slice(-10)) {
    if (mentionIsResolved(mention, entities, identifierKeys)) continue;
    const entity = entities.find(item => item.stable_id === mention.stable_id);
    gaps.push({
      gap_id: gapId('mention_unresolved', null, null, norm(mention.name)),
      type: 'mention_unresolved',
      opportunity_ref: entity ? opportunityRefs.get(entity.stable_id) : null,
      criterion_id: null,
      detail: mention.name,
    });
  }
  return sortGaps(gaps, catalog);
}
