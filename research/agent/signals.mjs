/**
 * Calcula señales de avance y paciencia del loop.
 * No ejecuta acciones ni modifica el registro.
 * Contratos: deltas de búsqueda y cobertura.
 * No conoce ningún dominio: todo lo específico llega por el DomainPack.
 */
import { computeGaps } from './gaps.mjs';

/**
 * Mantiene el contador de búsquedas sin nuevas entidades oficiales.
 * Efectos: actualiza un contador privado en memoria.
 * @param {number} n Umbral de paciencia.
 * @returns {object} Contador con transiciones y estado de agotamiento.
 */
export function createPatience(n) {
  let value = 0;
  return {
    afterSearch(count) {
      value = count > 0 ? 0 : value + 1;
      return value;
    },
    afterExtraFetches(count) {
      if (count > 0) value = 0;
      return value;
    },
    get value() {
      return value;
    },
    get exhausted() {
      return value >= n;
    },
  };
}

/**
 * Resume el avance observable de una búsqueda para el planner y el log.
 * Puro respecto de red, disco y reloj.
 * @param {object} input Resultados, estado previo, registro, catálogo y paciencia.
 * @returns {object} Señales deterministas de novedad, errores y cobertura.
 */
export function searchSignals({
  resultsNormUrls,
  seenBefore,
  fetchResults,
  registryDelta,
  registry,
  catalog,
  patienceValue,
  seenOfficialDomains = new Set(),
}) {
  const unique = resultsNormUrls.filter(url => !seenBefore.has(url));
  const entities = registry.entities();
  const fresh = registryDelta.filter(delta => delta.newOfficial).map(delta => delta.stable_id);
  const officialDomains = [...new Set(
    fetchResults.filter(result => result.doc?.official).map(result => result.doc.registrable_domain),
  )];
  const deadlinesParsed = fresh.filter(stableId => {
    const entity = entities.find(item => item.stable_id === stableId);
    return entity && (entity.validity.closes_on || entity.validity.status === 'rolling');
  }).length;
  return {
    new_unique_docs: unique.length,
    duplicates: resultsNormUrls.length - unique.length,
    new_official_opportunities: fresh,
    new_official_domains: officialDomains.filter(domain => !seenOfficialDomains.has(domain)),
    fetch_errors: fetchResults.filter(result => !result.ok || result.doc?.text_chars < 200).length,
    deadlines_parsed: deadlinesParsed,
    criteria_unknown: computeGaps(registry, catalog).filter(gap => gap.type === 'criterion_missing').length,
    searches_without_new_official: patienceValue,
  };
}
