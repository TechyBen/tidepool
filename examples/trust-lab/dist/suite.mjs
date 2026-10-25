import {VERSION, enc, dec, clone, canonical, digest, objectHash, nonce, hex, Journal,
  validateBundle, verifyEnvelope, Authority, sponsorDecision, FraudBounties} from './engine.mjs';
import {SAMPLE_CSV, calculateEnergy, verifyEnergy, chunkData, proofFor, checkChunk, randomIndices, joinBytes, energyCsv} from './work.mjs';

// Expectations belong to the test harness, never to the service verifier.
export const CASES = [
  ['compute.honest','Compute','Cooperate','Calculate a real energy budget','ACCEPTED','Compute exportable Wh from the CSV; independently recompute every row.'],
  ['compute.forged','Compute','Attack','Inflate the useful result','REJECTED','Add 1,000 Wh to a real result and sign the false answer.'],
  ['compute.self-hash','Compute','Attack','Hash a wrong answer correctly','REJECTED','A valid checksum of an inflated result must not establish correct computation.'],
  ['compute.input-swap','Compute','Attack','Substitute a different input','REJECTED','Perform real work on different bytes; the input commitment must fail.'],
  ['compute.signature','Compute','Attack','Edit a signed result','INVALID','Change the result after signing; envelope integrity must fail.'],
  ['delivery.honest','Delivery','Cooperate','Deliver bytes through a relay','ACCEPTED','Pass the payload between two workers through a MessageChannel; verify the recipient’s signed receipt.'],
  ['delivery.corrupt','Delivery','Attack','Corrupt bytes in transit','REJECTED','Flip one payload byte in the relay. A valid destination signature must still fail the agreed content hash.'],
  ['delivery.replay','Delivery','Attack','Reuse an old delivery receipt','REJECTED','Present a signed receipt carrying a different challenge nonce.'],
  ['delivery.drop','Delivery','Attack','Drop the message','INCOMPLETE','Send no payload and wait for the transport deadline. A timeout is unavailability evidence, not proof of intent.'],
  ['delivery.collusion','Delivery','Boundary','Trade inside one operator group','LOCAL_ONLY','Deliver real bytes between locally preferred actors. Known common ownership gives no automatic sponsored demand.'],
  ['storage.restore','Storage','Cooperate','Store, reopen, and restore','ACCEPTED','Write actual chunks, close and reopen the store, challenge them, and reconstruct the exact payload.'],
  ['storage.missing','Storage','Attack','Delete a requested chunk','UNAVAILABLE','Remove stored bytes before a challenge that explicitly asks for them.'],
  ['storage.corrupt','Storage','Attack','Change stored bytes','REJECTED','Corrupt one persisted chunk; its original Merkle proof must fail.'],
  ['storage.sample-miss','Storage','Boundary','Let a sample miss deleted data','LIMIT_OBSERVED','Delete one chunk and deliberately sample another. The sample passes; full restoration must still fail.'],
  ['storage.replay','Storage','Attack','Replay a storage response','REJECTED','Return correct bytes and proofs bound to an old nonce.'],
  ['storage.bad-proof','Storage','Attack','Forge a Merkle path','REJECTED','Keep the bytes correct but change a sibling hash in the proof.'],
  ['evidence.selective','Evidence','Cooperate','Fetch only this contract’s branch','SUPPORTED_AS_OF','Fetch the three linked contract events while leaving twelve unrelated events in their own store.'],
  ['evidence.omission','Evidence','Attack','Hide a required dependency','INCOMPLETE','Omit the requester’s signed terms from the fetched evidence.'],
  ['evidence.fork','Evidence','Attack','Sign two journal histories','CONFLICT','Use the same real signing key for two events at one journal position.'],
  ['evidence.budget','Evidence','Boundary','Exceed the evidence budget','INCOMPLETE','Limit the requester to two objects when this decision requires three.'],
  ['funding.race','Funding','Attack','Race two eight-unit reservations','BOUNDED','Submit concurrent requests against one ten-unit authority; only reserved work may execute.'],
  ['funding.replay','Funding','Attack','Redeem one reservation twice','BOUNDED','Retry exactly the same request. The reservation must be idempotent and its work must execute once.'],
  ['funding.binding','Funding','Attack','Move a grant to another contract','CONFLICT','Reuse a reservation ID with a different contract binding.'],
  ['funding.sybil','Funding','Attack','Create ten newcomer identities','BOUNDED','Ten identities each ask for three units from one ten-unit pool. New keys must not multiply its budget.'],
  ['funding.partition','Funding','Boundary','Split a pool before partition','BOUNDED','Compare two unsafe copies of ten units with disjoint enforced quotas of six and four.'],
  ['fraud.valid','Disputes','Cooperate','Expose signed equivocation','CORROBORATED','Independently verify both conflicting signatures before accepting the report.'],
  ['fraud.false','Disputes','Attack','Accuse with altered evidence','INVALID','Modify one claimed proof without its author’s signature; do not reward an assertion.'],
  ['fraud.repeat','Disputes','Attack','Claim the same bounty twice','DUPLICATE','Report the same offending journal position again; reward at most once.'],
  ['fraud.self-farm','Disputes','Boundary','Manufacture a real bounty offense','LIMIT_OBSERVED','Create genuine equivocations in fresh journals and self-report. A proof-only bounty rule loses its bounded budget.']
].map(([id,family,mode,title,expected,description])=>({id,family,mode,title,expected,description}));

async function context(runtime, spec, csv, bytes) {
  const [requester,provider,recipient]=await Promise.all(['requester','provider','recipient'].map(n=>runtime.actor(n)));
  const keys=Object.fromEntries([requester,provider,recipient].map(a=>[a.info.name,a.info]));
  const challenge=nonce();
  const terms={protocol:VERSION,instance:nonce(),service:spec.family.toLowerCase(),requester:'requester',provider:'provider',recipient:'recipient',
    csvHash:await digest(csv),payloadHash:await digest(bytes),payloadBytes:bytes.length,challenge,
    units:'lab-service-units',price:1,verification:'explicit per-service checks',retention:'this experiment only'};
  const contract=await objectHash('tidepool.lab.contract',terms);
  const journals=Object.fromEntries([requester,provider,recipient].map(a=>[a.info.name,new Journal(a,contract)]));
  const namespace=nonce(), stores=Object.fromEntries(['requester','provider','recipient','unrelated'].map(n=>[n,runtime.store(namespace+'/'+n)]));
  const locations=new Map(), all=[];
  async function save(event) {
    await stores[event.body.author].put(event.eventId,event);locations.set(event.eventId,event.body.author);all.push(event);return event;
  }
  const append=async (author,kind,payload,deps=[])=>save(await journals[author].append(kind,payload,deps));
  const ask=await append('requester','contract.ask',terms);
  const accept=await append('provider','contract.accept',{termsHash:contract},[ask.eventId]);
  async function fetch(root) {
    const fetched=[],seen=new Set(),todo=[root];
    while(todo.length){
      const id=todo.shift();if(seen.has(id))continue;seen.add(id);
      const store=stores[locations.get(id)];if(!store)continue;
      const event=await store.get(id);if(!event)continue;fetched.push(event);
      todo.push(...event.body.dependsOn);if(event.body.prev)todo.push(event.body.prev);
    }
    return fetched;
  }
  const policy=root=>({keys,contract,roots:[root],maxObjects:256,maxBytes:2097152,maxDepth:64});
  return {runtime,keys,terms,contract,challenge,requester,provider,recipient,journals,stores,all,append,save,fetch,policy,ask,accept};
}
const check=(name,passed)=>({name,passed:!!passed});
const clock=()=>performance.now();

async function computeCase(ctx,spec,csv) {
  let input=csv;
  if(spec.id==='compute.input-swap') {
    const lines=csv.trim().split(/\r?\n/),cells=lines[1].split(',');
    cells[1]=String(Number(cells[1])===0?1:Number(cells[1])-1);lines[1]=cells.join(',');input=lines.join('\n')+'\n';
  }
  const strategy=['compute.forged','compute.self-hash'].includes(spec.id)?'inflate':'honest';
  const start=clock(),answer=await ctx.provider.call('compute',{csv:input,strategy}),workMs=clock()-start;
  const result=await ctx.append('provider','compute.result',{inputHash:await digest(input),result:answer,
    outputHash:await objectHash('tidepool.lab.output',answer)},[ctx.accept.eventId]);
  let objects=await ctx.fetch(result.eventId);
  if(spec.id==='compute.signature') {objects=clone(objects);objects[0].body.payload.result.total_wh++;}
  const verifyStart=clock(),envelope=await validateBundle(objects,ctx.policy(result.eventId));
  const bytesMatch=await objectHash('tidepool.lab.output',result.body.payload.result)===result.body.payload.outputHash;
  const inputMatch=result.body.payload.inputHash===ctx.terms.csvHash;
  const correct=verifyEnergy(csv,result.body.payload.result);
  const observed=envelope.status!=='SUPPORTED_AS_OF'?envelope.status:(!inputMatch||!correct||!bytesMatch?'REJECTED':'ACCEPTED');
  return {observed,reason:observed==='ACCEPTED'?'Every result row matches the separate verifier and the agreed input bytes.':
    observed==='INVALID'?envelope.reason:!inputMatch?'The signed result names different input bytes.':'The answer’s checksum is valid, but independent arithmetic rejects its values.',
    assertions:[check('Output bytes have a valid checksum',bytesMatch),check('Decision matches contract policy',observed===spec.expected)],
    metrics:{inputBytes:enc.encode(csv).length,outputBytes:enc.encode(canonical(answer)).length,rows:answer.rows.length,workMs,verifyMs:clock()-verifyStart},
    facts:{checksumMatches:bytesMatch,inputMatches:inputMatch,arithmeticMatches:correct},output:answer,
    artifacts:observed==='ACCEPTED'?[{name:'energy-budget.csv',type:'text/csv',text:energyCsv(answer)}]:[],
    bundle:{objects,policy:ctx.policy(result.eventId)},envelope};
}
async function deliveryCase(ctx,spec,bytes) {
  const packet={contract:ctx.contract,acceptId:ctx.accept.eventId,nonce:spec.id==='delivery.replay'?'previous-challenge':ctx.challenge};
  const strategy=spec.id==='delivery.corrupt'?'corrupt':spec.id==='delivery.drop'?'drop':'honest';
  const start=clock(),delivery=await ctx.runtime.deliver(ctx.provider,ctx.recipient,bytes,packet,strategy),workMs=clock()-start;
  if(!delivery.receipt) return {observed:'INCOMPLETE',reason:'No destination receipt arrived before the 1.5 s lab transport deadline. Intent is unknown.',
    assertions:[check('No acceptance without a receipt',delivery.timedOut)],metrics:{inputBytes:bytes.length,deliveredBytes:0,workMs},facts:{timedOut:true},bundle:null};
  const receipt=await ctx.save(delivery.receipt),objects=await ctx.fetch(receipt.eventId),startVerify=clock();
  const envelope=await validateBundle(objects,ctx.policy(receipt.eventId)),p=receipt.body.payload;
  const correct=p.digest===ctx.terms.payloadHash && p.bytes===bytes.length && p.nonce===ctx.challenge && receipt.body.author==='recipient';
  const registry={requester:'operator-a',provider:spec.id==='delivery.collusion'?'operator-a':'operator-b',recipient:'operator-a'};
  const sponsor=sponsorDecision({validService:correct,requester:'requester',provider:'provider',registeredAsk:true},registry);
  const observed=envelope.status!=='SUPPORTED_AS_OF'?envelope.status:!correct?'REJECTED':sponsor.status==='LOCAL_ONLY'?'LOCAL_ONLY':'ACCEPTED';
  return {observed,reason:observed==='LOCAL_ONLY'?sponsor.reason:!correct?'The signed recipient receipt fails the agreed content hash or fresh challenge.':'The recipient hashed the bytes it actually received; content, size, signature, and nonce match.',
    assertions:[check('Receipt signature is authentic',await verifyEnvelope(receipt,ctx.keys)),check('Decision matches contract policy',observed===spec.expected)],
    metrics:{inputBytes:bytes.length,deliveredBytes:delivery.bytes.length,workMs,verifyMs:clock()-startVerify},
    facts:{contentMatches:p.digest===ctx.terms.payloadHash,nonceMatches:p.nonce===ctx.challenge,sponsorDecision:sponsor.status,operatorRegistry:registry},
    bundle:{objects,policy:ctx.policy(receipt.eventId)},envelope,
    artifacts:observed==='ACCEPTED'||observed==='LOCAL_ONLY'?[{name:'delivered-payload.bin',type:'application/octet-stream',bytes:delivery.bytes}]:[]};
}
async function storageCase(ctx,spec,bytes) {
  const start=clock(),tree=await chunkData(bytes,Math.min(128,Math.max(1,Math.floor(bytes.length/4))));
  const store=ctx.runtime.store(ctx.contract+'/chunks');
  for(let i=0;i<tree.chunks.length;i++)await store.put(String(i),tree.chunks[i]);
  await store.reopen();
  const commitment=await ctx.append('provider','storage.committed',{root:tree.root,count:tree.chunks.length,bytes:bytes.length,fullHash:tree.fullHash},[ctx.accept.eventId]);
  const last=tree.chunks.length-1;
  if(['storage.missing','storage.sample-miss'].includes(spec.id))await store.remove(String(last));
  if(spec.id==='storage.corrupt'){const chunk=await store.get(String(last));chunk[0]^=1;await store.put(String(last),chunk);}
  // Adversarial regression fixtures choose a particular challenge. Honest runs use fresh random indices.
  const indices=spec.id==='storage.sample-miss'?[0]:['storage.missing','storage.corrupt','storage.bad-proof'].includes(spec.id)?[last]:randomIndices(tree.chunks.length,3);
  const challenge=await ctx.append('requester','storage.challenge',{nonce:ctx.challenge,indices,root:tree.root},[commitment.eventId]);
  const replies=[];
  for(const index of indices){const chunk=await store.get(String(index));const proof=proofFor(tree,index);
    if(spec.id==='storage.bad-proof'&&proof.length)proof[0].hash='0'.repeat(64);
    replies.push({index,bytes:chunk?hex(chunk):null,proof});}
  const response=await ctx.append('provider','storage.response',{nonce:spec.id==='storage.replay'?'previous-challenge':ctx.challenge,replies},[challenge.eventId]);
  const objects=await ctx.fetch(response.eventId),workMs=clock()-start,startVerify=clock(),envelope=await validateBundle(objects,ctx.policy(response.eventId));
  let samplePass=response.body.payload.nonce===ctx.challenge && replies.length===indices.length;
  for(let j=0;j<replies.length;j++){
    const reply=replies[j];samplePass=samplePass && reply.index===indices[j] && await checkChunk({root:tree.root,index:reply.index,
      bytes:reply.bytes===null?null:Uint8Array.from(reply.bytes.match(/../g)||[],x=>parseInt(x,16)),proof:reply.proof,count:tree.chunks.length});
  }
  // Full restore is an additional check, never inferred from passing a sample.
  const restored=[];for(let i=0;i<tree.chunks.length;i++)restored.push(await store.get(String(i)));
  const complete=restored.every(Boolean),restoredBytes=complete?joinBytes(restored):null;
  const restorePass=!!restoredBytes && restoredBytes.length===bytes.length && await digest(restoredBytes)===ctx.terms.payloadHash;
  const unavailable=replies.some(r=>r.bytes===null);
  const observed=envelope.status!=='SUPPORTED_AS_OF'?envelope.status:samplePass&&!restorePass?'LIMIT_OBSERVED':
    unavailable?'UNAVAILABLE':samplePass&&restorePass?'ACCEPTED':'REJECTED';
  return {observed,reason:observed==='LIMIT_OBSERVED'?'The chosen sample is authentic and passes, while a deleted unchallenged chunk prevents full restoration.':
    unavailable?'The requested chunk is absent. The experiment establishes failed availability, not malicious intent.':
    observed==='ACCEPTED'?'Persisted chunks survived reopening; sampled Merkle paths and the complete restored file match.':'A chunk, proof path, or challenge binding fails the storage contract.',
    assertions:[check('Committed file matches the contract input',tree.fullHash===ctx.terms.payloadHash),check('Decision matches storage policy',observed===spec.expected),
      ...(spec.id==='storage.sample-miss'?[check('Sample passes but full restore fails',samplePass&&!restorePass)]:[])],
    metrics:{inputBytes:bytes.length,chunks:tree.chunks.length,sampled:indices.length,restoredBytes:restoredBytes?.length??0,storageReads:store.reads,storageWrites:store.writes,workMs,verifyMs:clock()-startVerify},
    facts:{merkleRoot:tree.root,indices,samplePass,restorePass,reopenedStore:true},bundle:{objects,policy:ctx.policy(response.eventId)},envelope,
    artifacts:restorePass?[{name:'restored-payload.bin',type:'application/octet-stream',bytes:restoredBytes}]:[]};
}
async function evidenceCase(ctx,spec,csv) {
  const answer=await ctx.provider.call('compute',{csv,strategy:'honest'});
  const result=await ctx.append('provider','compute.result',{inputHash:ctx.terms.csvHash,result:answer},[ctx.accept.eventId]);
  const unrelated=new Journal(ctx.requester,await objectHash('unrelated',{id:nonce()}));
  for(let i=0;i<12;i++){const event=await unrelated.append('local.observation',{i});await ctx.stores.unrelated.put(event.eventId,event);}
  let objects=await ctx.fetch(result.eventId),policy=ctx.policy(result.eventId);
  if(spec.id==='evidence.omission')objects=objects.filter(e=>e.eventId!==ctx.ask.eventId);
  if(spec.id==='evidence.fork'){
    const body=clone(result.body);body.payload.result.total_wh++;
    objects.push(await ctx.provider.sign(body));
  }
  if(spec.id==='evidence.budget')policy={...policy,maxObjects:2};
  const start=clock(),envelope=await validateBundle(objects,policy);
  return {observed:envelope.status,reason:envelope.reason,
    assertions:[check('No unrelated journal was read',ctx.stores.unrelated.reads===0),check('Evidence status matches policy',envelope.status===spec.expected),
      check('Underlying useful computation is correct',verifyEnergy(csv,answer))],
    metrics:{availableEvents:15,fetchedEvents:objects.length,unrelatedReads:ctx.stores.unrelated.reads,verifyMs:clock()-start,inputBytes:enc.encode(csv).length},
    facts:{usefulResultWh:answer.total_wh,coverage:'This contract only; no claim about undisclosed failures elsewhere.'},bundle:{objects,policy},envelope};
}
async function fundingCase(ctx,spec,csv) {
  const pool=new Authority(10),request=(id,units,extra={})=>({id,units,scope:'trial-pool',contract:ctx.contract,holder:'provider',...extra});
  let decisions=[],observed='BOUNDED',facts={},used=0,workCount=0;
  if(spec.id==='funding.race')decisions=await Promise.all([pool.reserve(request('west',8)),pool.reserve(request('east',8))]);
  if(spec.id==='funding.replay'){decisions.push(await pool.reserve(request('one',4)));decisions.push(await pool.reserve(request('one',4)));}
  if(spec.id==='funding.binding'){decisions.push(await pool.reserve(request('one',4)));decisions.push(await pool.reserve(request('one',4,{contract:'other-contract'})));observed=decisions[1].status;}
  if(spec.id==='funding.sybil')decisions=await Promise.all(Array.from({length:10},(_,i)=>pool.reserve(request('id-'+i,3,{holder:'newcomer-'+i}))));
  if(spec.id==='funding.partition'){
    const west=new Authority(6),east=new Authority(4),unsafeWest=new Authority(10),unsafeEast=new Authority(10);
    const unsafe=await Promise.all([unsafeWest.reserve(request('w',8)),unsafeEast.reserve(request('e',8))]);
    decisions=[await west.reserve(request('w',6)),await east.reserve(request('e',4))];
    used=west.used+east.used;facts={unsafeDuplicatedPoolUsed:unsafeWest.used+unsafeEast.used,unsafeBothAccepted:unsafe.every(r=>r.status==='RESERVED'),westQuota:6,eastQuota:4};
  }else used=pool.used;
  const completed=new Set();
  for(const decision of decisions){
    if(decision.status!=='RESERVED')continue;
    const id=decision.certificate.request.id;if(completed.has(id))continue;
    const answer=await ctx.provider.call('compute',{csv,strategy:'honest'});
    if(!verifyEnergy(csv,answer))throw Error('Reserved work failed its independent verifier');
    completed.add(id);workCount++;
  }
  if(spec.id!=='funding.binding')observed=used<=10&&workCount===decisions.filter(d=>d.status==='RESERVED').length?'BOUNDED':'VIOLATION';
  const record=await ctx.append('requester','allocation.experiment',{capacity:10,used,decisions,workCount},[ctx.accept.eventId]);
  const objects=await ctx.fetch(record.eventId);
  return {observed,reason:spec.id==='funding.partition'?'Disjoint enforced quotas use 10 units; two independent copies of the original balance would allocate 16.':
    spec.id==='funding.binding'?'The authority rejects changed terms under an already used reservation ID.':
    'Only new reservations authorize work. One live authority keeps cumulative allocation within ten units.',
    assertions:[check('Allocated units never exceed capacity',used<=10),check('Only newly reserved jobs execute',workCount===decisions.filter(d=>d.status==='RESERVED').length),
      check('Case-specific boundary holds',spec.id==='funding.race'?workCount===1&&used===8:spec.id==='funding.replay'?workCount===1&&used===4&&decisions[1].status==='REPLAY':
        spec.id==='funding.sybil'?workCount===3&&used===9:spec.id==='funding.partition'?used===10&&facts.unsafeDuplicatedPoolUsed===16:observed===spec.expected)],
    metrics:{capacity:10,allocatedUnits:used,jobsExecuted:workCount,inputBytes:enc.encode(csv).length*workCount},facts:{...facts,decisions:decisions.map(d=>d.status),authority:'One trusted in-memory process; resets are new experiments.'},
    bundle:{objects,policy:ctx.policy(record.eventId)}};
}
async function fraudCase(ctx,spec) {
  const first=ctx.accept,body=clone(first.body);body.payload.termsHash='different-terms';
  let second=await ctx.provider.sign(body),pair=[first,second];
  const fund=new FraudBounties(2);let result;const manufactured=[];
  if(spec.id==='fraud.false'){pair=clone(pair);pair[1].body.payload.termsHash='edited-without-signing';}
  if(spec.id==='fraud.repeat')await fund.report(pair,ctx.keys);
  if(spec.id==='fraud.self-farm'){
    const outcomes=[];
    for(let i=0;i<3;i++){
      const a=clone(first.body),b=clone(body);a.journal=b.journal='provider/manufactured-'+i;
      const proof=[await ctx.provider.sign(a),await ctx.provider.sign(b)];manufactured.push(...proof);
      outcomes.push(await fund.report(proof,ctx.keys));
    }
    const reward=outcomes.reduce((n,x)=>n+x.reward,0);
    result={status:reward>0?'LIMIT_OBSERVED':'REJECTED',reward,reason:reward>0?'Real equivocations can be manufactured by their signer. Proof validity alone lets self-reports consume the two-unit bounty pool.':'Manufactured offenses received no bounty under the current policy.',outcomes};
  }else result=await fund.report(pair,ctx.keys);
  const expectedReward={'fraud.valid':1,'fraud.false':0,'fraud.repeat':0,'fraud.self-farm':2}[spec.id];
  return {observed:result.status,reason:result.reason,
    assertions:[check('Report classification matches verified evidence',result.status===spec.expected),check('Reward matches this proof policy',result.reward===expectedReward),check('Bounty loss stays within its explicit cap',fund.budget>=0)],
    metrics:{rewardUnits:result.reward,bountyRemaining:fund.budget},facts:{proofOnlyBountyIsUnsafe:true,reportResult:result},
    bundle:{objects:[ctx.ask,...(manufactured.length?manufactured:pair)],policy:{...ctx.policy(first.eventId),roots:(manufactured.length?manufactured:pair).map(e=>e.eventId)}},
    note:'Bounty units are simulated accounting. A production fund must commission investigation or apply a reviewed anti-self-dealing policy; cryptographic proof alone cannot establish an independent whistleblower.'};
}

export async function runCase(id,runtime,{csv=SAMPLE_CSV,payload=enc.encode(csv)}={}) {
  const spec=CASES.find(c=>c.id===id);if(!spec)throw Error('Unknown test case');
  if(payload.length<8||payload.length>131072)throw Error('Payload must contain 8 bytes to 128 KiB.');
  const started=clock();let result;
  try {
    const ctx=await context(runtime,spec,csv,payload);
    const execute={Compute:()=>computeCase(ctx,spec,csv),Delivery:()=>deliveryCase(ctx,spec,payload),Storage:()=>storageCase(ctx,spec,payload),
      Evidence:()=>evidenceCase(ctx,spec,csv),Funding:()=>fundingCase(ctx,spec,csv),Disputes:()=>fraudCase(ctx,spec)};
    result=await execute[spec.family]();
    result.contract=ctx.terms;result.contractId=ctx.contract;
    result.assertions.push(check('Observed outcome equals the regression expectation',result.observed===spec.expected));
    result.ok=result.assertions.every(c=>c.passed);
  }catch(error){result={observed:'ERROR',reason:error.message,ok:false,assertions:[check('Experiment completed',false)],metrics:{},bundle:null};}
  finally {await runtime.close();}
  return {...spec,...result,runtime:runtime.kind,elapsedMs:clock()-started,completedAt:new Date().toISOString(),version:VERSION};
}

// An incentive experiment over actual computed results. Payoffs are assumed lab units.
export async function runIncentives(runtime,{csv=SAMPLE_CSV,rounds=40,auditPercent=50,cheatPercent=50,reward=5,cost=2,penalty=0,seed=7}={}) {
  if(!Number.isSafeInteger(rounds)||rounds<1||rounds>200)throw Error('Use 1–200 rounds.');
  for(const x of [auditPercent,cheatPercent])if(!Number.isFinite(x)||x<0||x>100)throw Error('Percentages must be 0–100.');
  for(const x of [reward,cost,penalty])if(!Number.isFinite(x)||x<0||x>1000)throw Error('Payoff values must be 0–1,000.');
  // Seeded schedule is reproducible but NOT adversary-resistant randomness.
  let state=seed>>>0;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const totals={honest:0,cheats:0,audits:0,detected:0,unpaidCorrect:0,paidWrong:0,validRows:0,credits:0,payoff:0,verificationMs:0};
  const transcript=[];
  try {
    const actor=await runtime.actor('experiment-worker');
    for(let i=0;i<rounds;i++){
      const cheated=random()<cheatPercent/100;
      const output=await actor.call('compute',{csv,strategy:cheated?'skip':'honest'});
      // Commit first; the schedule chooses an audit after the result exists.
      const commitment=await objectHash('tidepool.lab.output',output),audited=random()<auditPercent/100;
      const start=clock(),valid=audited?verifyEnergy(csv,output):null;totals.verificationMs+=clock()-start;
      const paid=!audited||valid,detected=audited&&!valid;
      const payoff=(paid?reward:0)-(cheated?0:cost)-(detected?penalty:0);
      totals[cheated?'cheats':'honest']++;if(audited)totals.audits++;if(detected)totals.detected++;
      if(cheated&&paid)totals.paidWrong++;if(!cheated)totals.validRows+=output.rows.length;
      totals.credits+=paid?reward:0;totals.payoff+=payoff;
      transcript.push({round:i+1,strategy:cheated?'skip work':'cooperate',commitment,audited,valid,paid,payoff});
    }
    const p=auditPercent/100;
    return {version:VERSION,assumptions:{rounds,auditPercent,cheatPercent,reward,cost,penalty,seed,scope:'Single actor, perfect recomputation when audited, guaranteed collectible penalty if configured; no collusion, identity reset, or verifier cost in payoffs.'},
      totals,transcript,expectedHonest:reward-cost,expectedCheat:(1-p)*reward-p*penalty,
      threshold:reward+penalty?cost/(reward+penalty):null};
  }finally{await runtime.close();}
}
