/**
 * Deriva vigencia y fechas desde evidencia registrada.
 * No interpreta elegibilidad ni prioridad.
 * Contratos: entidad, documentos y estado de vigencia.
 * No conoce ningún dominio: todo lo específico llega por el DomainPack.
 */
import { deadlineDecision } from '../server/research/dates.mjs';

const baseValidity = today => ({
  status: 'unknown',
  opens_on: null,
  closes_on: null,
  deadline_label: null,
  deadline_quote: null,
  deadline_doc_id: null,
  as_of: today,
  computed_by: 'code',
  conflict: false,
});

/**
 * Calcula vigencia desde el documento oficial más vinculante disponible.
 * Puro respecto de red, disco y reloj.
 * @param {object} entity Entidad con referencias a sus documentos.
 * @param {Map|object} docsById Documentos indexados por doc_id.
 * @param {Function|Map|object} textOf Acceso al texto íntegro.
 * @param {string} today Fecha congelada de la corrida.
 * @returns {object} Estado de vigencia con conflicto entre fechas oficiales.
 */
export function computeValidity(entity, docsById, textOf, today) {
  const documents = entity.source_doc_ids
    .map(id => docsById.get?.(id) || docsById[id])
    .filter(Boolean);
  const source = documents.find(doc => doc.official && doc.page_type === 'call') ||
    documents.find(doc => doc.official) ||
    documents[0];
  if (!source) return baseValidity(today);
  const decide = doc => deadlineDecision(
    typeof textOf === 'function' ? textOf(doc.doc_id) : (textOf.get?.(doc.doc_id) || textOf[doc.doc_id] || ''),
    { today, title: doc.title, url: doc.url },
  );
  const decision = decide(source);
  const result = {
    status: source.page_type === 'award_record' ? 'awarded' : decision.status,
    opens_on: decision.opens ?? null,
    closes_on: decision.deadline ?? null,
    deadline_label: decision.phase ?? null,
    deadline_quote: decision.quote || null,
    deadline_doc_id: source.doc_id,
    as_of: today,
    computed_by: 'code',
    conflict: false,
  };
  const officialDates = documents
    .filter(doc => doc.official)
    .map(doc => decide(doc).deadline)
    .filter(Boolean);
  if (new Set(officialDates).size > 1) result.conflict = true;
  return result;
}
