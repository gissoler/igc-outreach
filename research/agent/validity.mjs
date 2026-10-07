import { deadlineDecision } from '../server/research/dates.mjs';

const baseValidity = today => ({status:'unknown',opens_on:null,closes_on:null,deadline_label:null,deadline_quote:null,deadline_doc_id:null,as_of:today,computed_by:'code',conflict:false});
export function computeValidity(entity, docsById, textOf, today) {
  const docs = entity.source_doc_ids.map(id=>docsById.get?.(id)||docsById[id]).filter(Boolean);
  const source = docs.find(d=>d.official&&d.page_type==='call') || docs.find(d=>d.official) || docs[0]; if(!source)return baseValidity(today);
  const decide = d => deadlineDecision(typeof textOf==='function'?textOf(d.doc_id):(textOf.get?.(d.doc_id)||textOf[d.doc_id]||''),{today,title:d.title,url:d.url});
  const d=decide(source); const result={status:source.page_type==='award_record'?'awarded':d.status,opens_on:d.opens??null,closes_on:d.deadline??null,deadline_label:d.phase??null,deadline_quote:d.quote||null,deadline_doc_id:source.doc_id,as_of:today,computed_by:'code',conflict:false};
  const officialDates=docs.filter(x=>x.official).map(x=>decide(x).deadline).filter(Boolean); if(new Set(officialDates).size>1)result.conflict=true; return result;
}
