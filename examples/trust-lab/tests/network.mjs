import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {makeNetwork,networkCounts,findRoute,planRequest,compareDomains,separateStorageDomains,SCENARIOS,REQUESTS,BASE_NODES} from '../dist/network-model.mjs';
import {networkSvg,domainColor} from '../dist/network-view.mjs';
let checks=0;
function test(name,fn){fn();checks++;console.log('PASS network: '+name);}
const normal=makeNetwork();
test('Node count does not become an operator count',()=>assert.deepEqual(networkCounts(normal),{nodes:12,online:12,operators:10,unknownOperators:0,links:14}));
test('All three baseline asks have a valid declared plan',()=>{
  for(const request of Object.keys(REQUESTS))assert.equal(planRequest(normal,request).status,'PLANNABLE');
});
test('The fastest single cross-region route has a six-unit link bottleneck',()=>{
  const route=findRoute(normal,'client','compute-east');
  assert.equal(route.mbps,6);assert.deepEqual(route.nodes,['client','hub-west','hub-east','compute-east']);
});
test('Backbone failure routes through the independent newcomer at two Mb/s',()=>{
  const model=makeNetwork({scenario:'backbone-down'}),route=findRoute(model,'client','compute-east');
  assert.equal(route.mbps,2);assert.ok(route.nodes.includes('ridge-relay'));assert.equal(planRequest(model,'compute').status,'PLANNABLE');
});
test('Hub outage preserves delivery, but does not silently lower the verifier requirement',()=>{
  const model=makeNetwork({scenario:'hub-down'});
  assert.equal(findRoute(model,'client','compute-east').mbps,2);
  assert.equal(planRequest(model,'delivery').status,'PLANNABLE');
  const compute=planRequest(model,'compute');assert.equal(compute.status,'DEFER');assert.equal(compute.verifiers.length,1);
});
test('An endpoint issuer cannot become an unconfigured transit router',()=>{
  const model=makeNetwork({scenario:'partition'});
  assert.ok(findRoute(model,'client','fund'));assert.equal(findRoute(model,'client','compute-east'),null);
});
test('A shared operator failure removes both of its storage nodes',()=>{
  const model=makeNetwork({scenario:'east-owner-down'});
  assert.equal(model.nodes.filter(n=>!n.online).length,2);assert.equal(planRequest(model,'storage').status,'DEFER');
});
test('Separate keys or roles do not turn one storage owner into two providers',()=>{
  const plan=planRequest(makeNetwork({scenario:'same-owner'}),'storage');assert.equal(plan.status,'DEFER');
  assert.equal(plan.checks.find(c=>c.id==='replicas').ok,true);assert.equal(plan.checks.find(c=>c.id==='domains').ok,false);
});
test('Distinct owners sharing power fail the independent-replica requirement',()=>{
  const model=makeNetwork({scenario:'shared-power'}),west=model.nodes.find(n=>n.id==='store-west'),east=model.nodes.find(n=>n.id==='store-east');
  assert.deepEqual(compareDomains(west,east),{operator:'distinct',site:'distinct',powerDomain:'shared'});
  assert.equal(planRequest(model,'storage').status,'DEFER');
});
test('Unknown ownership causes a missing-assurance result, not independent votes',()=>{
  const model=makeNetwork({scenario:'unknown-owner'});assert.equal(networkCounts(model).unknownOperators,2);
  assert.equal(planRequest(model,'storage').status,'DEFER');
  assert.equal(compareDomains(model.nodes[2],model.nodes.find(n=>n.id==='store-east')).operator,'unknown');
});
test('A provider-controlled verifier cannot count toward outside checking',()=>{
  const plan=planRequest(makeNetwork({scenario:'verifier-capture'}),'compute');
  assert.equal(plan.status,'DEFER');assert.deepEqual(plan.verifiers,['verify-west']);
});
test('Issuer loss defers allocation even when useful-work routing survives',()=>{
  const model=makeNetwork({scenario:'issuer-down'});assert.ok(findRoute(model,'client','compute-east'));
  for(const request of Object.keys(REQUESTS))assert.equal(planRequest(model,request).status,'DEFER');
});
test('Local compute remains visible without earning sponsored outside-demand credit',()=>{
  const model=makeNetwork({offline:['compute-east']}),plan=planRequest(model,'compute');
  assert.equal(model.nodes.find(n=>n.id==='compute-west').online,true);assert.equal(plan.status,'DEFER');assert.equal(plan.providers.length,0);assert.ok(plan.warnings.length);
});
test('A remaining archive can replace a failed storage node, but cannot count beside its own operator',()=>{
  const plan=planRequest(makeNetwork({offline:['store-east']}),'storage');assert.equal(plan.status,'PLANNABLE');
  assert.deepEqual(plan.providers,['store-west','archive-east']);
  assert.equal(separateStorageDomains(normal.nodes.find(n=>n.id==='store-east'),normal.nodes.find(n=>n.id==='archive-east')),false);
});
test('Resource exhaustion removes offers; inspection does not reserve a budget',()=>{
  const model=makeNetwork();model.nodes.find(n=>n.id==='compute-east').offers.computeSlots=0;
  assert.equal(planRequest(model,'compute').status,'DEFER');
  const low=makeNetwork();low.pool.available=2;assert.equal(planRequest(low,'compute').status,'DEFER');
  assert.equal(low.pool.available,2);assert.equal(normal.pool.available,10);
});
test('The compute evidence view includes only relevant modeled holders',()=>{
  const plan=planRequest(normal,'compute');
  assert.deepEqual(plan.evidenceNodes,['client','compute-east','verify-west','verify-east','fund']);
  assert.ok(!plan.evidenceNodes.includes('store-west'));assert.ok(!plan.evidenceNodes.includes('hub-east'));
});
test('No returned route traverses an offline node, broken edge, or unconfigured endpoint',()=>{
  for(const scenario of Object.keys(SCENARIOS)){
    const model=makeNetwork({scenario});const byId=Object.fromEntries(model.nodes.map(n=>[n.id,n]));
    for(const request of Object.keys(REQUESTS))for(const flow of [...planRequest(model,request).flows,...planRequest(model,request).evidenceRoutes]){
      for(const id of flow.route.nodes)assert.ok(byId[id].online);
      for(const id of flow.route.nodes.slice(1,-1))assert.ok(byId[id].transit);
      for(const id of flow.route.edges)assert.ok(model.links.find(e=>e.id===id).online);
      assert.equal(flow.route.edges.length,flow.route.nodes.length-1);
    }
  }
});
test('Scenario mutation never changes the original topology fixture',()=>{
  makeNetwork({scenario:'same-owner'});assert.equal(makeNetwork().nodes.find(n=>n.id==='store-east').operator,'eastarchive');
  assert.equal(BASE_NODES.find(n=>n.id==='hub-west').online,true);
});
test('Power colours distinguish every named dependency in the fixture',()=>{
  const domains=[...new Set([...BASE_NODES.map(n=>n.powerDomain),'shared-storage-feeder'])];
  assert.equal(new Set(domains.map(domainColor)).size,domains.length);
});
test('The graph and downloadable snapshot contain finite values and selectable nodes',()=>{
  const plan=planRequest(normal,'compute');const svg=networkSvg(normal,plan,{lens:'role',layer:'work',role:'all',selected:'compute-east',route:'all'});
  assert.equal((svg.match(/class="net-svg-node"/g)||[]).length,12);assert.ok(svg.includes('aria-label="East compute'));
  assert.ok(!/NaN|Infinity|undefined/.test(svg));assert.ok(!JSON.stringify({normal,plan}).includes('Infinity'));
});
await mkdir(new URL('../.qa/',import.meta.url),{recursive:true});
for(const [name,scenario,request,lens] of [['network','normal','compute','role'],['network-outage','hub-down','delivery','operator'],['network-shared-power','shared-power','storage','power']]){
  const model=makeNetwork({scenario}),plan=planRequest(model,request);
  await writeFile(new URL('../.qa/'+name+'.svg',import.meta.url),networkSvg(model,plan,{lens,layer:'work',selected:'compute-east',role:'all',route:'all'}));
}
console.log(JSON.stringify({networkChecks:checks,scenarioRequestCombinations:Object.keys(SCENARIOS).length*Object.keys(REQUESTS).length,failures:0}));
