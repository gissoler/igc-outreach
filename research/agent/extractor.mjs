import { literalIn } from '../server/research/verify.mjs';
import { isPublicUrl } from '../server/research/localSearch.mjs';
import { render, sanitizePageText } from './prompts.mjs';
import { identifiersFromText } from './identifiers.mjs';

const FOCUS = /\b(eligib\w*|who (?:can|may) apply|applicants?|deadline|due date|closing date|letter of intent|open to|not eligible|cost[- ]shar\w*|foreign|award (?:ceiling|amount|size)|budget|purpose|objective|priorit\w*|will not (?:fund|support)|out of scope|how to apply|submission)\b/gi;
export function excerptForExtraction(text, max) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim(); if (clean.length <= max) return clean;
  const ranges = [[0, Math.min(6000, clean.length)]];
  for (const m of clean.matchAll(FOCUS)) ranges.push([Math.max(0, m.index - 600), Math.min(clean.length, m.index + 600)]);
  ranges.sort((a,b)=>a[0]-b[0]); const merged=[]; for(const r of ranges){const last=merged.at(-1); if(last&&r[0]<=last[1]) last[1]=Math.max(last[1],r[1]); else merged.push(r);}
  return merged.map(([a,b])=>clean.slice(a,b)).join(' … ').slice(0,max);
}

export async function extractDocument({ doc, text, llm, prompt, catalog, today, step, fetchSeq, maxChars = 30000, temperature = 0, maxTokens = 8000 }) {
  const criteria = catalog.criteria.map(c => ({ criterion_id: c.criterion_id, label: c.label })); criteria.push({ criterion_id:'REQ', label:'Any other binding requirement of this call' });
  const user = render(prompt.user, { today, criteria_json: criteria, url: doc.url, title: sanitizePageText(doc.title), page_text: `<page_data>${sanitizePageText(excerptForExtraction(text,maxChars))}</page_data>` });
  const call = await llm.call({ promptRef: prompt, system: prompt.system, user, schemaName:'extraction', temperature, seed:0, maxTokens, meta:{ promptId:'extractor', url:doc.url } });
  const extraction = call.json; const evidenceDrafts=[]; let quotes=0, identifiers=0;
  for(const e of extraction.evidence){ if(!literalIn(e.quote,text) || (e.criterion_id==='REQ'&&!e.requirement_summary)){quotes++;continue;} evidenceDrafts.push({...e}); }
  const aboutIdentifierTexts=[];
  for(const t of extraction.about?.identifier_texts||[]){ if(literalIn(t,text)||String(doc.url).includes(t)){aboutIdentifierTexts.push(t);} else identifiers++; }
  const aboutIdentifiers=aboutIdentifierTexts.flatMap(identifiersFromText);
  const officialLinks=[]; for(const l of extraction.official_links) if(String(text).includes(l.url)&&isPublicUrl(l.url)) officialLinks.push({...l,link_id:`l${String(fetchSeq).padStart(3,'0')}-${String(officialLinks.length).padStart(2,'0')}`});
  return { extraction, evidenceDrafts, aboutIdentifiers, officialLinks, mentions: extraction.mentions, rejected:{quotes,identifiers}, tokens:call.tokens, latency:call.latency, modelId:call.modelId, fullText:text, promptRef:{id:prompt.id,version:prompt.version,sha256:prompt.sha256}, step };
}
