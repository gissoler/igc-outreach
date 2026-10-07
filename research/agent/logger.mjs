import { mkdirSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validate } from './contracts.mjs';
const zeroTokens=()=>({prompt:0,completion:0,total:0,nominal_total:0,estimated:false,cached:false}); const zeroLatency=()=>({actual_ms:0,nominal_ms:0});
export function createRunLogger({dir,header,clock=()=>new Date().toISOString()}){mkdirSync(dir,{recursive:true});const path=resolve(dir,'steps.jsonl');let seq=0,versions=header.versions;return{path,setVersions(v){versions=v},log(kind,step,data,{tokens=zeroTokens(),latency=zeroLatency(),errors=[],budget_used}={}){const now=clock(),entry={run_id:header.run_id,seq,step,kind,ts:typeof now==='string'?now:new Date(now).toISOString(),case_id:header.case_id,condition:header.condition,seed:header.seed,versions,tokens,latency,errors,...(budget_used?{budget_used}:{}),data};validate('log_entry',entry);appendFileSync(path,`${JSON.stringify(entry)}\n`);seq++;return entry}}}
