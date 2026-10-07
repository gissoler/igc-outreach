import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractDocument } from '../../agent/extractor.mjs';
import { createRegistry } from '../../agent/registry.mjs';
import { createLlm } from '../../agent/llm.mjs';
import { createFixtureTransport } from '../../agent/fixtures.mjs';
import { loadPrompt } from '../../agent/prompts.mjs';
import { docIdOf, normalizeUrl, registrableDomain, officialBasisOf } from '../../agent/docs.mjs';

const F=resolve(import.meta.dirname,'fixtures/world-v1'), root=resolve(import.meta.dirname,'../../..'); const j=p=>JSON.parse(readFileSync(p,'utf8'));
const world=j(resolve(F,'world.json')), llmData=j(resolve(F,'llm.json')), E=j(resolve(F,'expected.json')), catalog=j(resolve(root,'docs/contracts/criteria_catalog.grant.v1.json')), domains=j(resolve(root,'research/agent/config/official_domains.v1.json'));
const prompt=loadPrompt('extractor','v1');
async function item(id, condition='B1', fetchSeq=0){const p=world.pages.find(x=>x.id===id),text=readFileSync(resolve(F,p.file),'utf8'),transport=createFixtureTransport(F,{condition,profileId:'prof-fixture-aha'}),llm=createLlm({transport});const base={doc_id:docIdOf(p.url),url:p.url,normalized_url:normalizeUrl(p.url),host:new URL(p.url).hostname.replace(/^www\./,''),registrable_domain:registrableDomain(new URL(p.url).hostname),host_kind:id==='p5'?'other':'other',official:false,official_basis:'none',fetched_at:'2026-10-20T00:00:00.000Z',fetch_via:'direct',ok:true,text_chars:text.length,text_sha256:createHash('sha256').update(text).digest('hex'),title:p.title,published_date:null};const er=await extractDocument({doc:base,text,llm,prompt,catalog,today:'2026-10-20',step:1,fetchSeq,maxChars:30000});const basis=officialBasisOf({url:p.url,extraction:er.extraction},domains);return {doc:{...base,official:basis!=='none',official_basis:basis},er};}

test('ACC-08 extractor verifies literal evidence, REQ and official links',async()=>{const {doc,er}=await item('p1');assert.equal(er.evidenceDrafts.length,8);assert.deepEqual(er.rejected,{quotes:1,identifiers:0});assert.equal(er.officialLinks[0].link_id,'l000-00');const r=createRegistry({today:'2026-10-20',catalog});const x=r.register({doc,extractionResult:er,ctx:{step:1,searchIndex:0,queryId:'q000'}});const ev=r.evidenceFor(x.stable_id);assert.equal(ev.find(e=>e.requirement_summary)?.criterion_id,'REQ-01');assert.deepEqual(ev.map(e=>e.evidence_id),E.evidence_ids[x.stable_id].filter(e=>e.doc==='p1').map(e=>e.evidence_id));});

test('ACC-09 registry merges identifiers and tracks official transition',async()=>{const p1=await item('p1'),p5=await item('p5', 'B1',1),p7=await item('p7','B2',2);let r=createRegistry({today:'2026-10-20',catalog});let a=r.register({doc:p1.doc,extractionResult:p1.er,ctx:{step:1,searchIndex:0,queryId:'q000'}}),b=r.register({doc:p5.doc,extractionResult:p5.er,ctx:{step:1,searchIndex:0,queryId:'q000'}});assert.equal(b.isNew,false);assert.equal(b.newOfficial,false);assert.equal(r.entities()[0].source_doc_ids.length,2);r=createRegistry({today:'2026-10-20',catalog});a=r.register({doc:p5.doc,extractionResult:p5.er,ctx:{step:1,searchIndex:0,queryId:'q000'}});assert.equal(a.newOfficial,false);b=r.register({doc:p1.doc,extractionResult:p1.er,ctx:{step:1,searchIndex:0,queryId:'q000'}});assert.equal(b.newOfficial,true);r.register({doc:p7.doc,extractionResult:p7.er,ctx:{step:2,searchIndex:1,queryId:'q001'}});r.finalize();assert.equal(r.entities()[0].stable_id,'opp:nih:RFA-AG-27-010');});

test('ACC-10 validity matches fixture and detects awarded/conflict',async()=>{const ids=['p1','p2','p3','p6'];const r=createRegistry({today:'2026-10-20',catalog});for(let i=0;i<ids.length;i++){const x=await item(ids[i],'B1',i);r.register({doc:x.doc,extractionResult:x.er,ctx:{step:i+1,searchIndex:i,queryId:`q${String(i).padStart(3,'0')}`}});}r.finalize();for(const e of r.entities()){assert.equal(e.validity.status,E.validity[e.stable_id].status);assert.equal(e.validity.closes_on,E.validity[e.stable_id].closes_on);assert.equal(e.validity.deadline_doc_id,E.doc_ids[E.validity[e.stable_id].deadline_doc]);}});
