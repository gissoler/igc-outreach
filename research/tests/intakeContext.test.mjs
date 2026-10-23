import test from 'node:test';
import assert from 'node:assert/strict';
import { intakeContext } from '../server/research/intakeContext.mjs';
import {newIntake,runTurn,fieldValue} from '../server/research/intake.mjs';
const env={INTAKE_CONTEXT_V2:'1',INTAKE_LLM_BASE_URL:'http://model/v1',INTAKE_LLM_MODEL:'openai/gpt-oss-120b'};
const json=(body)=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(body)}}]})});
const updates=[['company.name','Veritea'],['product.name','Veritea'],['funding.objectives',['grant']],['product.one_liner','AI chatbot for anxiety and stress'],['geography',['CO']],['company.entity_type','for_profit']].map(([path,value])=>({path,value,quote:''}));
test('memory retains relevant older messages beyond seven turns and 400 characters',()=>{
 const s=newIntake();s.messages=[];
 for(let i=0;i<25;i++)s.messages.push({at:String(i),role:i%2?'assistant':'user',text:i===4?'Earlier correction: Veritea is based in Bogotá. '+ 'evidence '.repeat(80):'other context '.repeat(70)});
 const c=intakeContext(s,{message:'Remember the earlier correction about Bogotá',budget:18000});
 assert.ok(c.history.some(m=>m.text.includes('Earlier correction')&&m.text.length>400));
 const restored=JSON.parse(JSON.stringify(s));restored.messages=[];
 assert.ok(intakeContext(restored,{message:'Bogotá'}).history.some(m=>m.text.includes('Bogotá')));
});
test('memory separates inference, source and explicit unknown',()=>{
 const s=newIntake();s.fields={'industry.sectors':{value:['mental health'],confidence:'inferred',origin:'model',quote:''},'company.country':{value:'Colombia',confidence:'source',origin:'conversation',quote:'Colombia'}};s.skipped=['funding.use_of_funds'];
 const c=intakeContext(s);assert.equal(c.profile['industry.sectors'].status,'inferred');assert.equal(c.profile['company.country'].quote,'Colombia');assert.ok(c.unknown_fields.includes('funding.use_of_funds'));
});
test('extract first, then converse using the updated profile; known sector cannot be asked again',async()=>{
 const s=newIntake();const stages=[];
 await runTurn(s,{text:'Veritea is an AI chatbot for anxiety and stress in Colombia.',env,fetchImpl:async(_url,req)=>{
  const b=JSON.parse(req.body),system=b.messages[0].content;stages.push(system);
  if(system.includes('[intake:extract/v2]'))return json({updates,ack:'',question:'',asking:null});
  const c=JSON.parse(b.messages[1].content);assert.ok(c.profile['industry.sectors']);assert.equal(c.current_profile['product.name'],'Veritea');assert.ok(!c.open_questions.some(f=>f.path==='industry.sectors'));
  return json({ack:'AI and mental health noted.',question:'Which industry sector?',asking:'industry.sectors',updates:[],ready:false});
 }});
 assert.equal(stages.length,2);assert.ok(fieldValue(s,'industry.sectors').includes('mental health'));assert.notEqual(s.pending,'industry.sectors');assert.doesNotMatch(s.messages.at(-1).text,/Which industry sector/);
});
test('enough context can lead to review without inventing all remaining fields',async()=>{
 const s=newIntake();let calls=0;
 await runTurn(s,{text:'Veritea is an AI chatbot for anxiety and stress in Colombia.',env,fetchImpl:async()=>json(++calls===1?{updates}:{ack:'Ready to review.',asking:null,question:'',ready:true,updates:[]})});
 assert.equal(calls,2);assert.equal(s.pending,null);assert.match(s.messages.at(-1).text,/review Veritea now/);assert.equal(fieldValue(s,'funding.amount_usd'),undefined);assert.ok(s.conversationMemory.turns.some(m=>m.role==='user'));
});

const description = 'Experimental small-molecule binding prediction platform';
test('IGC: a model misclassifying the initial description cannot store it as a product name', async () => {
 const s=newIntake(); let calls=0;
 await runTurn(s,{text:description,env,fetchImpl:async()=>json(++calls===1?{updates:[{path:'product.name',value:description,quote:description}]}:{ack:'Got it, your product is '+description+'.',question:'Are you seeking grants, investment, or research partnerships?',asking:'funding.objectives'})});
 assert.equal(fieldValue(s,'product.name'),undefined); assert.equal(fieldValue(s,'product.one_liner'),description);
 assert.equal(s.fields['product.one_liner'].confidence,'source');assert.equal(s.pending,'funding.objectives');assert.doesNotMatch(s.messages.at(-1).text,/Got it|your product is/);
});
test('IGC: an existing mistaken name is repaired from user evidence without deleting history',async()=>{
 const s=newIntake();s.fields['product.name']={value:description,origin:'model',confidence:'source',quote:description};
 s.messages.push({role:'user',at:'old',text:description});s.pending='company.name'; let calls=0;
 await runTurn(s,{text:'IGC Pharma',env,fetchImpl:async()=>json(++calls===1?{updates:[{path:'company.name',value:'IGC Pharma',quote:'IGC Pharma'}]}:{ack:'Company name recorded as IGC Pharma.',question:'Are you seeking grants, investment, or research partnerships?',asking:'funding.objectives'})});
 assert.equal(fieldValue(s,'product.name'),undefined);assert.equal(fieldValue(s,'product.one_liner'),description);assert.equal(fieldValue(s,'company.name'),'IGC Pharma');assert.equal(s.pending,'funding.objectives');
 assert.doesNotMatch(s.messages.at(-1).text,/recorded|IGC Pharma/);assert.ok(s.messages.some(m=>m.text===description));
});
test('explicit or manually edited descriptive brand names are preserved',async()=>{
 for(const origin of ['model','user']) {
  const s=newIntake();s.fields['product.name']={value:description,origin,confidence:'source',quote:description};
  s.messages.push({role:'user',at:'old',text:origin==='model'?'Our product is called '+description:description});
  await runTurn(s,{text:'We need grants',env,fetchImpl:async()=>json({updates:[],asking:'company.name',question:'Which company would apply?'})});assert.equal(fieldValue(s,'product.name'),description);
 }
});
test('company plus description is sufficient without inventing a separate product name or demanding a sector',async()=>{
 const s=newIntake();let calls=0;
 await runTurn(s,{text:'IGC Pharma seeks grants for a binding prediction platform in Colombia. We are a for-profit company.',env,fetchImpl:async()=>json(++calls===1?{updates:[['company.name','IGC Pharma'],['product.one_liner',description],['funding.objectives',['grant']],['geography',['CO']],['company.entity_type','for_profit']].map(([path,value])=>({path,value}))}:{ready:true})});
 assert.equal(s.pending,null);assert.match(s.messages.at(-1).text,/review IGC Pharma now/);assert.equal(fieldValue(s,'product.name'),undefined);assert.notEqual(s.pending,'industry.sectors');
});
test('historical user evidence supports a source quote and explicitly skipped facts can be corrected',async()=>{
 const s=newIntake();s.messages.push({role:'user',at:'old',text:description});s.skipped=['funding.use_of_funds'];let calls=0;
 await runTurn(s,{text:'The use of funds is lab validation.',env,fetchImpl:async()=>json(++calls===1?{updates:[{path:'product.one_liner',value:description,quote:description},{path:'funding.use_of_funds',value:'lab validation',quote:'lab validation'}]}:{asking:'company.name',question:'Which company would apply?'})});
 assert.equal(s.fields['product.one_liner'].confidence,'source');assert.equal(fieldValue(s,'funding.use_of_funds'),'lab validation');assert.ok(!s.skipped.includes('funding.use_of_funds'));
});

test('review does not depend on the model continuing an optional questionnaire',async()=>{
 const s=newIntake();let calls=0;
 await runTurn(s,{text:'Veritea is an AI chatbot for anxiety and stress in Colombia.',env,fetchImpl:async()=>json(++calls===1?{updates}:{ack:'',asking:'funding.amount_usd',question:'What amount?',ready:false})});
 assert.equal(s.pending,null);assert.doesNotMatch(s.messages.at(-1).text,/What amount/);assert.match(s.messages.at(-1).text,/review/);
});
test('v2 fallback uses an actionable funding question instead of field labels or a five-item form',async()=>{
 const s=newIntake();let calls=0;
 await runTurn(s,{text:description,env,fetchImpl:async()=>json(++calls===1?{updates:[{path:'product.one_liner',value:description,quote:description}]}:{})});
 assert.equal(s.pending,'funding.objectives');assert.match(s.messages.at(-1).text,/research grants, investment/);assert.doesNotMatch(s.messages.at(-1).text,/funding objectives|Can be more than one|Got it/);
});

test('experimental capability with unknown validation is preserved without repeating the maturity menu',async()=>{
 const s=newIntake();s.fields['funding.objectives']={value:['investment']};s.fields['product.one_liner']={value:description};s.pending='product.maturity';s.asked=['product.maturity'];let calls=0;
 const text='experimental capability; technical validation details unknow';
 await runTurn(s,{text,env,fetchImpl:async(_url,req)=>{
  if(++calls===1)return json({updates:[]});
  const c=JSON.parse(JSON.parse(req.body).messages[1].content);
  assert.equal(c.unresolved_answers['product.maturity'].text,text);assert.ok(!c.open_questions.some(q=>q.path==='product.maturity'));
  return json({asking:'product.maturity',question:'Where is it: idea, prototype, preclinical, clinical or on the market?'});
 }});
 assert.equal(fieldValue(s,'product.maturity'),undefined);assert.equal(s.unresolvedAnswers['product.maturity'].text,text);
 assert.notEqual(s.pending,'product.maturity');assert.doesNotMatch(s.messages.at(-1).text,/Where is it|preclinical/);
});
test('unmapped enum answers remain deferred on later turns without inventing a stage',async()=>{
 const s=newIntake();s.pending='product.maturity';s.asked=['product.maturity'];
 await runTurn(s,{text:'It is experimental; validation is still being explored.',env,fetchImpl:async()=>json({updates:[]})});
 assert.ok(s.unresolvedAnswers['product.maturity']);
 await runTurn(s,{text:'IGC Pharma',env,fetchImpl:async()=>json({updates:[{path:'company.name',value:'IGC Pharma',quote:'IGC Pharma'}],asking:'product.maturity',question:'What stage?'})});
 assert.notEqual(s.pending,'product.maturity');assert.equal(fieldValue(s,'product.maturity'),undefined);
});
test('clarification requests and out-of-order facts do not silently defer the pending enum',async()=>{
 for(const text of ['What do you mean by preclinical?', 'IGC Pharma']) {
  const s=newIntake();s.pending='product.maturity';s.asked=['product.maturity'];
  await runTurn(s,{text,env,fetchImpl:async()=>json({updates:text==='IGC Pharma'?[{path:'company.name',value:text,quote:text}]:[],asking:'product.maturity',question:'Has it been tested in humans?'})});
  assert.equal(s.unresolvedAnswers?.['product.maturity'],undefined);
 }
});
test('a later concrete answer or manual correction resolves the deferred enum',async()=>{
 const {editField}=await import('../server/research/intake.mjs');
 const s=newIntake();s.unresolvedAnswers={'product.maturity':{text:'experimental',status:'unconfirmed'}};
 await runTurn(s,{text:'We now have a working prototype.',env,fetchImpl:async()=>json({updates:[{path:'product.maturity',value:'prototype',quote:'working prototype'}]})});
 assert.equal(fieldValue(s,'product.maturity'),'prototype');assert.equal(s.unresolvedAnswers['product.maturity'],undefined);
 s.unresolvedAnswers['product.maturity']={text:'old'};editField(s,'product.maturity','preclinical');assert.equal(s.unresolvedAnswers['product.maturity'],undefined);
});

test('explicit unknown validation cannot be overwritten by a model guessing prototype',async()=>{
 const s=newIntake();s.pending='product.maturity';s.asked=['product.maturity'];let calls=0;
 await runTurn(s,{text:'experimental capability; technical validation details unknow',env,fetchImpl:async()=>json(++calls===1?{updates:[{path:'product.maturity',value:'prototype',quote:'experimental capability'}]}:{asking:'product.maturity',question:'What stage?'})});
 assert.equal(fieldValue(s,'product.maturity'),undefined);assert.ok(s.skipped.includes('product.maturity'));assert.notEqual(s.pending,'product.maturity');
});

test('recording a partial description does not cause an unanswered enum menu to be repeated',async()=>{
 const s=newIntake();s.pending='product.maturity';s.asked=['product.maturity'];let calls=0;
 await runTurn(s,{text:'Experimental capability, validation still being explored.',env,fetchImpl:async()=>json(++calls===1?{updates:[{path:'product.description',value:'Experimental capability; validation being explored',quote:'Experimental capability'}]}:{asking:'product.maturity',question:'What stage?'})});
 assert.notEqual(s.pending,'product.maturity');assert.ok(s.unresolvedAnswers['product.maturity']);assert.equal(fieldValue(s,'product.maturity'),undefined);
});
