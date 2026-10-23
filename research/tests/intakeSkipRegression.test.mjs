import test from 'node:test';
import assert from 'node:assert/strict';
import { newIntake, planFields, runTurn, fieldValue, missingRequired } from '../server/research/intake.mjs';
function veritea() {
 const s=newIntake(); s.fields['funding.objectives']={value:['grant']};
 for(const path of planFields(s)) if(!['funding.objectives','funding.use_of_funds'].includes(path)) s.fields[path]={value:path==='company.name'||path==='product.name'?'Veritea':'provided'};
 s.pending='funding.use_of_funds';s.asked=['funding.use_of_funds','funding.use_of_funds'];return s;
}
for(const answer of ['idk',"I don't know",'I don’t know','no sé']) test(`Veritea: ${answer} ends the question without a model call or invented use of funds`,async()=>{
 const s=veritea();let calls=0;
 await runTurn(s,{text:answer,env:{INTAKE_LLM_BASE_URL:'http://model/v1'},fetchImpl:async()=>{calls++;throw new Error('Skip must not call a model');}});
 assert.equal(calls,0);assert.equal(s.pending,null);assert.ok(s.skipped.includes('funding.use_of_funds'));
 assert.equal(fieldValue(s,'funding.use_of_funds'),undefined);assert.ok(missingRequired(s).includes('funding.use_of_funds'));
 assert.match(s.messages.at(-1).text,/review Veritea now/);assert.doesNotMatch(s.messages.at(-1).text,/\?/);
 await runTurn(s,{text:"I don't know"});assert.doesNotMatch(s.messages.at(-1).text,/\?/);
});
test('an existing session already trapped with pending=null recovers without resetting its history',async()=>{
 const s=veritea();s.skipped=['funding.use_of_funds'];s.pending=null;
 s.messages.push({role:'assistant',text:'What will this money get you to?'});const count=s.messages.length;
 await runTurn(s,{text:'idk'});
 assert.ok(s.messages.length>count);assert.match(s.messages.at(-1).text,/review Veritea now/);assert.equal(s.pending,null);
});
test('a model reply cannot reopen a skipped question at the end',async()=>{
 const s=veritea();s.skipped=['funding.use_of_funds'];s.pending=null;
 await runTurn(s,{text:'Please continue',env:{INTAKE_LLM_BASE_URL:'http://model/v1'},fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({ack:'',question:'What will this money get you to?',asking:'funding.use_of_funds',updates:[]})}}]})})});
 assert.match(s.messages.at(-1).text,/review Veritea now/);assert.doesNotMatch(s.messages.at(-1).text,/\?/);
});
test('a skipped detail can still be supplied later',async()=>{
 const s=veritea();await runTurn(s,{text:'idk'});
 await runTurn(s,{text:'Use of funds: a six-month pilot with psychologists',env:{INTAKE_LLM_BASE_URL:'http://model/v1'},fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({ack:'Pilot noted.',question:'',asking:null,updates:[{path:'funding.use_of_funds',value:'a six-month pilot with psychologists',quote:'a six-month pilot with psychologists'}]})}}]})})});
 assert.equal(fieldValue(s,'funding.use_of_funds'),'a six-month pilot with psychologists');assert.ok(!s.skipped.includes('funding.use_of_funds'));
});

test('grant discovery does not require the founder to supply search queries', () => {
 const s=veritea(); assert.ok(!planFields(s).includes('funding.search_terms'));
});

test('explicit unknown use of funds inside a long answer cannot be replaced by a model guess', async () => {
 const s=veritea();s.pending='company.state';
 await runTurn(s,{text:"We are in Bogotá, Colombia. I don't know the use of funds yet. We would like to apply directly.",env:{INTAKE_LLM_BASE_URL:'http://model/v1'},fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({ack:'',question:'What will this money get you to?',asking:'funding.use_of_funds',updates:[{path:'funding.use_of_funds',value:'clinical trials',quote:''}]})}}]})})});
 assert.equal(fieldValue(s,'funding.use_of_funds'),undefined);assert.ok(s.skipped.includes('funding.use_of_funds'));assert.notEqual(s.pending,'funding.use_of_funds');
});
