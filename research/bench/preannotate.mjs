/**
 * Genera preanotaciones trazables para revisión humana.
 * No adjudica ni reemplaza el etiquetado humano.
 * Contratos: pool, prompts y salida de preanotación.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, sanitizePageText } from '../agent/prompts.mjs';
import { excerptForExtraction } from '../agent/extractor.mjs';
import { validate } from '../agent/contracts.mjs';
const id=s=>`lab-${createHash('sha256').update(s).digest('hex').slice(0,12)}`;
/**
 * Conserva el contrato público de sourceTextForItem para que sus consumidores compartan una sola implementación.
 * @param {unknown} input Entrada definida por el contrato de la función.
 * @returns {unknown} Resultado definido por el contrato de la función.
 */
export async function sourceTextForItem(item,fetch) {
  const official=new Set(item.official_urls||[]),urls=[...item.urls].sort((a,b)=>Number(official.has(b))-Number(official.has(a))),
  parts=[];
  for(const url of urls) {
    if(parts.length>=3)break;
    const result=await fetch.fetch(url);
    if(result.ok)parts.push(`=== ${url} ===\n${sanitizePageText(excerptForExtraction(result.text,8000))}`);
  }
  return parts.join('\n')
}
/**
 * Conserva el contrato público de preannotateItems para que sus consumidores compartan una sola implementación.
 * @param {unknown} input Entrada definida por el contrato de la función.
 * @returns {unknown} Resultado definido por el contrato de la función.
 */
export async function preannotateItems( {
  benchId,caseObj,profile,pool,llm,prompt,catalog,sourceText,outDir,append=false,temperature=0,maxTokens=2000,
  clock=()=>new Date().toISOString()
}) {
  const lines=[];
  for(const item of pool) {
    const text=await sourceText(item),safeText=String(text).replaceAll('<page_data>','').replaceAll('</page_data>',
    '');
    const call=await llm.call( {
      promptRef:prompt,system:prompt.system,user:render(prompt.user, {
        today:caseObj.as_of,profile_json:Object.fromEntries(Object.entries(profile.fields).map(([k,v])=>[k,v.value??'UNKNOWN'])),
        criteria_json:catalog.criteria,item_json: {
          name:item.names[0],issuer:item.attributes?.issuer?.name||'',identifiers:item.identifiers,urls:item.urls
        },source_text:`<page_data>${safeText.slice(0,24000)}</page_data>`
      }),schemaName:'preannotator_output',temperature,seed:0,maxTokens,meta: {
        promptId:'preannotator',stable_id:item.stable_id
      }
    });
    const label=validate('label', {
      schema_version:'label/1',label_id:id(`${caseObj.case_id}|${item.stable_id}|preannotator`),case_id:caseObj.case_id,
      stable_id:item.stable_id,role:'preannotator',annotator:`llm:${call.modelId}`,labeled_at:clock(),...call.json
    });
    lines.push(label);
  }
  mkdirSync(resolve(outDir,'labels'), {
    recursive:true
  });
  const output=resolve(outDir,'labels/preannotations.jsonl'),body=lines.map(x=>JSON.stringify(x)).join('\n')+'\n';
  if(append)appendFileSync(output,body);
  else writeFileSync(output,body);
  return lines
}
