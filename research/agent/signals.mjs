import { computeGaps } from './gaps.mjs';
export function createPatience(n){let value=0;return{afterSearch(count){value=count>0?0:value+1;return value},afterExtraFetches(count){if(count>0)value=0;return value},get value(){return value},get exhausted(){return value>=n}}}
export function searchSignals({resultsNormUrls,seenBefore,fetchResults,registryDelta,registry,catalog,patienceValue}){
  const unique=resultsNormUrls.filter(x=>!seenBefore.has(x));
  const entities=registry.entities(); const fresh=registryDelta.filter(x=>x.newOfficial).map(x=>x.stable_id);
  return {new_unique_docs:unique.length,duplicates:resultsNormUrls.length-unique.length,new_official_opportunities:fresh,new_official_domains:[...new Set(fetchResults.filter(x=>x.doc?.official).map(x=>x.doc.registrable_domain))],fetch_errors:fetchResults.filter(x=>!x.ok||x.doc?.text_chars<200).length,deadlines_parsed:fresh.filter(id=>{const e=entities.find(x=>x.stable_id===id);return e&&(e.validity.closes_on||e.validity.status==='rolling')}).length,criteria_unknown:computeGaps(registry,catalog).filter(x=>x.type==='criterion_missing').length,searches_without_new_official:patienceValue};
}
