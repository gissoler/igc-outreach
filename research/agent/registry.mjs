import { createHash } from 'node:crypto';
import { norm } from '../server/research/core.mjs';
import { identifiersFromText, urlIdentifier, stableIdOf } from './identifiers.mjs';
import { computeValidity } from './validity.mjs';
import { normalizeUrl } from './docs.mjs';
import { validate } from './contracts.mjs';

const hash16=s=>createHash('sha256').update(s).digest('hex').slice(0,16);
export function createRegistry({today,catalog}){
  const records=[]; const docsMap=new Map(), texts=new Map(), linksArr=[], mentionsArr=[]; let order=0;
  const keysOf=e=>new Set(e.identifiers.map(i=>`${i.scheme}:${i.value}`));
  const find=(ids)=>records.find(r=>ids.some(i=>keysOf(r.entity).has(`${i.scheme}:${i.value}`)));
  return {
    register({doc,extractionResult,ctx}){
      docsMap.set(doc.doc_id,{...doc,page_type:extractionResult.extraction.page_type}); texts.set(doc.doc_id,extractionResult.fullText||'');
      const about=extractionResult.extraction.about; if(!about)return {stable_id:null,isNew:false,newOfficial:false};
      const ids=[...extractionResult.aboutIdentifiers,...identifiersFromText(doc.url),urlIdentifier(doc.url)].map(i=>({...i,doc_id:doc.doc_id}));
      const unique=[...new Map(ids.map(i=>[`${i.scheme}:${i.value}`,i])).values()]; let rec=find(unique); const isNew=!rec; const wasOfficial=rec?.entity.official||false;
      if(!rec){const entity={schema_version:'target_entity/1',stable_id:stableIdOf(unique),entity_type:'grant_opportunity',name:about.name,issuer:{name:about.issuer_name,domain:about.issuer_domain},identifiers:unique,canonical_url:doc.url,official:Boolean(doc.official),official_basis:doc.official_basis||'none',validity:{status:'unknown',opens_on:null,closes_on:null,deadline_label:null,deadline_quote:null,deadline_doc_id:null,as_of:today,computed_by:'code',conflict:false},amount_text:about.amount_text,instrument:about.instrument,source_doc_ids:[doc.doc_id],first_seen:{step:ctx.step,search_index:ctx.searchIndex,order:order++,query_id:ctx.queryId??null},query_ids:ctx.queryId?[ctx.queryId]:[]};rec={entity,evidence:[],req:new Map()};records.push(rec);} else {
        rec.entity.identifiers=[...new Map([...rec.entity.identifiers,...unique].map(i=>[`${i.scheme}:${i.value}`,i])).values()]; if(!rec.entity.source_doc_ids.includes(doc.doc_id))rec.entity.source_doc_ids.push(doc.doc_id); if(ctx.queryId&&!rec.entity.query_ids.includes(ctx.queryId))rec.entity.query_ids.push(ctx.queryId); if(doc.official&&!rec.entity.official){rec.entity.official=true;rec.entity.official_basis=doc.official_basis;rec.entity.canonical_url=doc.url;}
      }
      for(const draft of extractionResult.evidenceDrafts){let cid=draft.criterion_id;if(cid==='REQ'){const k=norm(draft.quote);if(!rec.req.has(k))rec.req.set(k,`REQ-${String(rec.req.size+1).padStart(2,'0')}`);cid=rec.req.get(k);}const ev={evidence_id:`ev-${hash16(`${doc.doc_id}|${cid}|${draft.quote.trim()}`)}`,doc_id:doc.doc_id,url:doc.url,official:Boolean(doc.official),stable_id:rec.entity.stable_id,criterion_id:cid,quote:draft.quote.trim(),binding:draft.binding,requirement_summary:draft.requirement_summary??null,retrieved_at:doc.fetched_at,doc_published_date:doc.published_date??null,step:ctx.step,extractor:extractionResult.promptRef};validate('evidence',ev);if(!rec.evidence.some(x=>x.evidence_id===ev.evidence_id))rec.evidence.push(ev);}
      linksArr.push(...extractionResult.officialLinks.map(x=>({...x,stable_id:rec.entity.stable_id,fetched:false})));mentionsArr.push(...extractionResult.mentions.map(x=>({...x,stable_id:rec.entity.stable_id,step:ctx.step})));
      rec.entity.validity=computeValidity(rec.entity,docsMap,texts,today); return {stable_id:rec.entity.stable_id,isNew,newOfficial:rec.entity.official&&(isNew||!wasOfficial)};
    },
    entities(){return records.map(r=>r.entity)}, evidenceFor(id){return records.find(r=>r.entity.stable_id===id)?.evidence||[]}, docs(){return [...docsMap.values()]}, links(){return linksArr}, markFetchedUrl(normalizedUrl){for(const link of linksArr)if(normalizeUrl(link.url)===normalizedUrl)link.fetched=true}, mentions(){return mentionsArr}, textOf(id){return texts.get(id)||''},
    finalize(){for(const r of records){const old=r.entity.stable_id;r.entity.stable_id=stableIdOf(r.entity.identifiers);for(const e of r.evidence)e.stable_id=r.entity.stable_id;for(const l of linksArr)if(l.stable_id===old)l.stable_id=r.entity.stable_id;for(const m of mentionsArr)if(m.stable_id===old)m.stable_id=r.entity.stable_id;r.entity.validity=computeValidity(r.entity,docsMap,texts,today);validate('target_entity',r.entity);}return records.map(r=>r.entity)}
  };
}
