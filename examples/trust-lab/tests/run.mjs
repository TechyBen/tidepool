import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {CASES,runCase,runIncentives} from '../dist/suite.mjs';
import {SAMPLE_CSV,calculateEnergy,verifyEnergy,chunkData,proofFor,checkChunk,parseEnergyCsv,applyComputeStrategy} from '../dist/work.mjs';
import {enc,canonical,Authority,createIdentity,seal,VERSION,verifyEnvelope} from '../dist/engine.mjs';
import {NodeRuntime} from './node-runtime.mjs';

let count=0;
function pass(name){count++;console.log('PASS '+name);}
assert.deepEqual(calculateEnergy(SAMPLE_CSV).rows.map(r=>r.exportable_wh),[200,150,550,100,25,0,220,300]);
assert.equal(calculateEnergy(SAMPLE_CSV).total_wh,1545);pass('Independent golden energy fixture');
const header=SAMPLE_CSV.split('\n')[0]+'\n';
assert.equal(calculateEnergy(header+'a,0,0,1,2,3,4\n').total_wh,0);
assert.equal(calculateEnergy(header+'a,1000000000,1000000000,0,0,0,0\n').total_wh,2000000000);
assert.throws(()=>parseEnergyCsv(header+'a,1.5,0,0,0,0,0\n'));
assert.throws(()=>parseEnergyCsv(header+'a,1,0,0,0,0,0\na,1,0,0,0,0,0\n'));
pass('Floor, integer bounds, duplicate identity, invalid data');
assert.deepEqual(applyComputeStrategy('deliberately not parseable as CSV','skip'),{rows:[],total_wh:0});
pass('The skip-work strategy actually bypasses computation');

const results=[];
for(const c of CASES){const result=await runCase(c.id,await NodeRuntime.create());results.push(result);
  assert.equal(result.ok,true,c.id+': '+result.reason+' '+JSON.stringify(result.assertions));pass(c.id+' → '+result.observed);}
for(const size of [8,127,128,129,513,4096]){
  const bytes=Uint8Array.from({length:size},(_,i)=>i%251),tree=await chunkData(bytes,128);
  for(let index=0;index<tree.chunks.length;index++){
    const p={root:tree.root,index,bytes:tree.chunks[index],proof:proofFor(tree,index),count:tree.chunks.length};
    assert.equal(await checkChunk(p),true);
    const changed=p.bytes.slice();changed[0]^=1;assert.equal(await checkChunk({...p,bytes:changed}),false);
  }
}pass('Merkle inclusion rejects changed bytes across odd and even trees');

const owner=await createIdentity('owner'),outsider=await createIdentity('outsider');
const body={v:VERSION,author:'owner',keyId:outsider.publicInfo.keyId,journal:'j',seq:0,prev:null,dependsOn:[],contract:'c',payload:{},kind:'test'};
assert.equal(await verifyEnvelope(await seal(outsider,body),{owner:owner.publicInfo}),false);
pass('A valid signature from an unpinned key cannot impersonate an author');

for(let budget=0;budget<20;budget++){
  const authority=new Authority(budget);
  const results=await Promise.all(Array.from({length:30},(_,i)=>authority.reserve({id:String(i),units:(i%7)+1,scope:'trial-pool',contract:'c',holder:'p'})));
  assert.ok(authority.used<=budget);
  assert.equal(results.filter(r=>r.status==='RESERVED').reduce((sum,r)=>sum+r.certificate.request.units,0),authority.used);
}pass('Conservation under 600 competing reservations');

for(const csv of [header+'custom,42,17,3,4,5,6\n',SAMPLE_CSV.replace('1200','1000')]){
  const r=await runCase('compute.honest',await NodeRuntime.create(),{csv});assert.equal(r.ok,true);assert.ok(verifyEnergy(csv,r.output));
}pass('Uploaded-style datasets drive real output, not fixture-specific answers');

const noAudit=await runIncentives(await NodeRuntime.create(),{rounds:10,auditPercent:0,cheatPercent:100});
assert.equal(noAudit.totals.paidWrong,10);assert.equal(noAudit.totals.detected,0);
const allAudit=await runIncentives(await NodeRuntime.create(),{rounds:10,auditPercent:100,cheatPercent:100});
assert.equal(allAudit.totals.paidWrong,0);assert.equal(allAudit.totals.detected,10);
const honest=await runIncentives(await NodeRuntime.create(),{rounds:10,auditPercent:100,cheatPercent:0});
assert.equal(honest.totals.validRows,80);assert.equal(honest.totals.payoff,30);
pass('Actual work/audit boundary cases for the explicitly assumed payoff model');
await writeFile(new URL('../.qa/last-run.json',import.meta.url),JSON.stringify({checks:count,cases:results.length,results},null,2));
console.log(JSON.stringify({checks:count,cases:results.length,failures:0}));
