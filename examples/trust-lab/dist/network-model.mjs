// A declared topology fixture and deterministic planner, not discovery of real peers.
// Every participant has local power, a controller, storage, and communications.
export const ROLES = {
  requester:{label:'Requester',code:'RQ',color:'#76502c',fill:'#f2e5cf',purpose:'Commissions useful work and evaluates the evidence required by its policy.',ledger:'Own asks, acceptances, outputs, and obligations.'},
  compute:{label:'Compute',code:'CP',color:'#226b57',fill:'#dbeadf',purpose:'Offers bounded compute capacity and returns a result bound to exact input bytes.',ledger:'Own job commitments, output references, and capacity reservations.'},
  storage:{label:'Storage',code:'ST',color:'#356e8b',fill:'#dceaf0',purpose:'Retains contracted data and answers fresh retrieval challenges.',ledger:'Own storage commitments, challenges, and retention obligations.'},
  relay:{label:'Relay',code:'RL',color:'#657043',fill:'#e8ecd5',purpose:'Forwards requested traffic; a hub does not become a trust or settlement authority.',ledger:'Own delivery contracts and receipt references, not all routed contract histories.'},
  verifier:{label:'Verifier',code:'VF',color:'#735b92',fill:'#e9e0f1',purpose:'Checks named work under an explicit policy; a signature is not a universal reputation score.',ledger:'Own checks, methods, result references, and dispute evidence.'},
  sponsor:{label:'Sponsor / issuer',code:'SP',color:'#98612a',fill:'#f5e6ca',purpose:'Controls one funded scope and must conserve its available allowance.',ledger:'Complete authoritative allocation state for its pool; no network-wide ledger.'},
  archive:{label:'Evidence archive',code:'AR',color:'#397a7a',fill:'#deeded',purpose:'Retains authorized evidence bundles and can also offer data storage.',ledger:'Contracted evidence objects and its own custody/retention receipts.'}
};

export const OPERATORS = {
  cove:{name:'Cove cooperative',color:'#246755'},
  harbor:{name:'Harbor storage collective',color:'#397aa0'},
  westmesh:{name:'West Mesh',color:'#866225'},
  westlab:{name:'West review lab',color:'#776296'},
  ridge:{name:'Ridge newcomer',color:'#597532'},
  fund:{name:'Common fund',color:'#ab683e'},
  eastmesh:{name:'East Mesh',color:'#856154'},
  forge:{name:'East compute workshop',color:'#a44765'},
  eastarchive:{name:'East archive cooperative',color:'#358389'},
  eastlab:{name:'East review lab',color:'#657bb0'}
};

const node = (id,name,primary,operator,site,powerDomain,x,y,spareWh,computeSlots,storageGiB,source,transit=false) => ({
  id,name,primary,roles:primary==='archive'?['archive','storage']:[primary],operator,site,powerDomain,x,y,transit,online:true,
  energy:{source,spareWh,protectedReserveWh:200},offers:{computeSlots,storageGiB},
  base:{compute:'Local resource controller; optional LLM agent',storage:'Local journal and operating data',communications:'Authenticated links to declared neighbours'}
});

export const BASE_NODES = [
  node('client','Cove client','requester','cove','cove-home','cove-solar',110,110,40,0,0,'Solar + battery'),
  node('compute-west','Solar compute','compute','cove','cove-workshop','cove-solar',110,280,200,2,0,'Solar + battery'),
  node('store-west','Cove storage','storage','harbor','west-dock','dock-battery',110,450,150,0,64,'Solar + battery',true),
  node('hub-west','West hub','relay','westmesh','west-mast','west-mast-battery',305,280,50,0,0,'Solar + battery',true),
  node('verify-west','West verifier','verifier','westlab','west-lab','west-lab-ups',290,110,90,0,0,'Grid + UPS'),
  node('fund','Common fund','sponsor','fund','ridge-office','ridge-office-ups',450,65,20,0,0,'Grid + UPS'),
  node('ridge-relay','Ridge relay','relay','ridge','ridge-mast','ridge-solar',450,450,30,0,0,'Solar + battery',true),
  node('verify-east','East verifier','verifier','eastlab','east-observatory','observatory-ups',610,110,90,0,0,'Grid + UPS'),
  node('hub-east','East hub','relay','eastmesh','east-mast','east-mast-battery',595,280,50,0,0,'Solar + battery',true),
  node('compute-east','East compute','compute','forge','east-workshop','workshop-ups',790,110,550,4,0,'Grid + solar + battery'),
  node('store-east','East storage','storage','eastarchive','east-store','east-store-battery',790,280,100,0,128,'Solar + battery',true),
  node('archive-east','East archive','archive','eastarchive','east-vault','east-vault-ups',790,450,300,0,256,'Grid + UPS',true)
];
const edge=(id,a,b,mbps,ms)=>({id,a,b,mbps,ms,online:true});
export const BASE_LINKS = [
  edge('client-hub','client','hub-west',10,5),edge('local-compute','compute-west','hub-west',10,5),
  edge('west-storage','store-west','hub-west',10,5),edge('west-check','verify-west','hub-west',10,5),
  edge('fund-west','fund','hub-west',4,10),edge('fund-east','fund','hub-east',4,10),
  edge('backbone','hub-west','hub-east',6,20),edge('east-check','verify-east','hub-east',10,5),
  edge('east-compute','compute-east','hub-east',10,5),edge('east-storage','store-east','hub-east',10,5),
  edge('east-archive','archive-east','hub-east',10,5),edge('client-fallback','client','store-west',2,15),
  edge('ridge-west','store-west','ridge-relay',2,20),edge('ridge-east','ridge-relay','archive-east',2,20)
];

export const REQUESTS = {
  compute:{name:'Compute + independent checks',description:'One externally operated compute provider, two separately controlled verifiers, and a reachable grant issuer.',units:3,caseId:'compute.honest'},
  storage:{name:'Two recoverable storage copies',description:'Two 2 GiB providers with distinct declared operators, sites, and power domains; one outside verifier and a reachable issuer.',units:4,caseId:'storage.restore'},
  delivery:{name:'Delivery across the network',description:'A route from Cove client to East compute, a destination receipt, and a reachable issuer. A route alone does not prove delivery.',units:1,caseId:'delivery.honest'}
};
export const SCENARIOS = {
  normal:{name:'Normal operation',note:'All nodes and links are available. Ownership and failure domains are declared fixture assumptions.'},
  'hub-down':{name:'West hub offline',note:'The local shortcut fails. Delivery can use the slower Ridge path; West verifier becomes unreachable.'},
  'backbone-down':{name:'Main backbone offline',note:'Ridge relay provides an alternate path. Each route is limited by its 2 Mb/s links.'},
  'east-owner-down':{name:'East archive operator offline',note:'East storage and East archive fail together because one operator controls both.'},
  'same-owner':{name:'All storage under one operator',note:'Three storage nodes are still visible, but they provide only one declared control domain.'},
  'shared-power':{name:'Storage shares one power supply',note:'Distinct operators and sites do not protect against their newly shared power dependency.'},
  'unknown-owner':{name:'East storage ownership unknown',note:'Unknown ownership is not an independent operator and is not an accusation of fraud. The two-copy ask defers.'},
  'verifier-capture':{name:'Provider controls East verifier',note:'East compute and East verifier now share control. This verifier cannot count as outside checking of that provider.'},
  'issuer-down':{name:'Grant issuer offline',note:'Service routes can remain available, but a new sponsored allocation cannot be assumed while its scope authority is unreachable.'},
  partition:{name:'Backbone and Ridge path offline',note:'The two regions are disconnected. Common fund is an endpoint, not an alternate forwarding router.'}
};

export function makeNetwork({scenario='normal',offline=[]}={}) {
  if(!SCENARIOS[scenario])throw Error('Unknown graph scenario');
  const model={version:'tidepool-topology-1',scenario,nodes:structuredClone(BASE_NODES),links:structuredClone(BASE_LINKS),pool:{scope:'common-fund/trial-pool',available:10}};
  const byId=Object.fromEntries(model.nodes.map(n=>[n.id,n]));
  const storage=model.nodes.filter(n=>n.roles.includes('storage'));
  if(scenario==='hub-down')byId['hub-west'].online=false;
  if(['backbone-down','partition'].includes(scenario))model.links.find(e=>e.id==='backbone').online=false;
  if(scenario==='east-owner-down')model.nodes.filter(n=>n.operator==='eastarchive').forEach(n=>n.online=false);
  if(scenario==='same-owner')storage.forEach(n=>n.operator='harbor');
  if(scenario==='shared-power')storage.forEach(n=>n.powerDomain='shared-storage-feeder');
  if(scenario==='unknown-owner'){byId['store-east'].operator=null;byId['archive-east'].operator=null;}
  if(scenario==='verifier-capture')byId['verify-east'].operator='forge';
  if(scenario==='issuer-down')byId.fund.online=false;
  if(scenario==='partition')byId['ridge-relay'].online=false;
  for(const id of offline){if(!byId[id])throw Error('Unknown offline node: '+id);byId[id].online=false;}
  return model;
}

// Widest *single* route; among equal bottlenecks prefer fewer hops.
// This is not simultaneous-flow allocation or a measured throughput estimate.
export function findRoute(model,from,to) {
  const nodes=new Map(model.nodes.map(n=>[n.id,n]));
  if(!nodes.get(from)?.online||!nodes.get(to)?.online)return null;
  if(from===to)return {nodes:[from],edges:[],mbps:null,latencyMs:0};
  const best=new Map([[from,{nodes:[from],edges:[],mbps:Infinity,latencyMs:0}]]),done=new Set();
  while(true){
    const choices=[...best.entries()].filter(([id])=>!done.has(id)).sort((a,b)=>b[1].mbps-a[1].mbps||a[1].edges.length-b[1].edges.length||a[0].localeCompare(b[0]));
    if(!choices.length)return null;
    const [current,path]=choices[0];if(current===to)return path;done.add(current);
    if(current!==from&&!nodes.get(current).transit)continue;
    for(const link of model.links){
      if(!link.online||(link.a!==current&&link.b!==current))continue;
      const next=link.a===current?link.b:link.a;
      if(!nodes.get(next)?.online||done.has(next))continue;
      const candidate={nodes:[...path.nodes,next],edges:[...path.edges,link.id],mbps:Math.min(path.mbps,link.mbps),latencyMs:path.latencyMs+link.ms};
      const old=best.get(next);
      if(!old||candidate.mbps>old.mbps||(candidate.mbps===old.mbps&&candidate.edges.length<old.edges.length))best.set(next,candidate);
    }
  }
}
export function compareDomains(a,b) {
  return Object.fromEntries(['operator','site','powerDomain'].map(key=>[key,!a[key]||!b[key]?'unknown':a[key]===b[key]?'shared':'distinct']));
}
export function separateStorageDomains(a,b) {return Object.values(compareDomains(a,b)).every(x=>x==='distinct');}

function chooseVerifiers(model,providers,count) {
  const requester=model.nodes.find(n=>n.id==='client');
  const excluded=new Set([requester.operator,...providers.map(n=>n.operator)]);
  const candidates=model.nodes.filter(n=>n.online&&n.primary==='verifier'&&n.energy.spareWh>=1&&n.operator&&!excluded.has(n.operator)&&
    findRoute(model,'client',n.id)&&providers.every(p=>findRoute(model,p.id,n.id)));
  const chosen=[];
  for(const n of candidates){if(!chosen.some(other=>other.operator===n.operator))chosen.push(n);if(chosen.length===count)break;}
  return chosen;
}
export function planRequest(model,request='compute') {
  const spec=REQUESTS[request];if(!spec)throw Error('Unknown graph request');
  const byId=Object.fromEntries(model.nodes.map(n=>[n.id,n])),client=byId.client;
  const plan={request,name:spec.name,description:spec.description,units:spec.units,scope:model.pool.scope,caseId:spec.caseId,
    status:'DEFER',providers:[],verifiers:[],checks:[],flows:[],evidenceNodes:[],evidenceRoutes:[],warnings:[]};
  const check=(id,label,ok,detail)=>plan.checks.push({id,label,ok:!!ok,detail});
  const flow=(from,to,kind,label)=>{const route=findRoute(model,from,to);if(route)plan.flows.push({from,to,kind,label,route});return route;};
  check('client','Requester online',client.online,'The requester needs a live path to the required actors.');
  let providers=[],verifiers=[];
  if(request==='compute'){
    const eligible=model.nodes.filter(n=>n.online&&n.roles.includes('compute')&&n.offers.computeSlots>=1&&n.energy.spareWh>=1&&
      n.operator&&client.operator&&n.operator!==client.operator&&findRoute(model,'client',n.id));
    // Prefer a provider for which the complete verification policy can be met.
    eligible.sort((a,b)=>chooseVerifiers(model,[b],2).length-chooseVerifiers(model,[a],2).length||a.id.localeCompare(b.id));
    if(eligible.length)providers=[eligible[0]];
    check('provider','Reachable outside compute provider',providers.length===1,'This sponsored ask requires declared control distinct from the requester, one offered slot, and spare energy.');
    if(!providers.length&&byId['compute-west'].online)plan.warnings.push('Solar compute remains available for local work. Shared control with the requester does not earn outside-demand credit for this sponsored ask.');
    if(providers.length){
      flow('client',providers[0].id,'work','Compute request / result');
      verifiers=chooseVerifiers(model,providers,2);
    }
    check('verifiers','Two separately controlled verifiers',verifiers.length===2,'Both must be reachable and have known control distinct from the requester, provider, and each other.');
  }else if(request==='storage'){
    const candidates=model.nodes.filter(n=>n.online&&n.roles.includes('storage')&&n.offers.storageGiB>=2&&n.energy.spareWh>=1&&findRoute(model,'client',n.id));
    const pairs=[];
    for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length;j++)if(separateStorageDomains(candidates[i],candidates[j])&&client.operator&&candidates[i].operator!==client.operator&&candidates[j].operator!==client.operator)pairs.push([candidates[i],candidates[j]]);
    pairs.sort((a,b)=>chooseVerifiers(model,b,1).length-chooseVerifiers(model,a,1).length);
    if(pairs.length)providers=pairs[0];
    check('replicas','Two reachable 2 GiB offers',candidates.length>=2,'Capacity is a declared snapshot; storage contracts still need reservations and retrieval tests.');
    check('domains','Distinct control, sites, and power',providers.length===2,'Providers must also be outside the requester’s control. Unknown domains do not establish independence; two nodes with one owner are one control domain.');
    if(providers.length){providers.forEach(p=>flow('client',p.id,'work','Store / restore copy'));verifiers=chooseVerifiers(model,providers,1);}
    check('verifiers','One separately controlled verifier',verifiers.length===1,'The checker must be reachable and controlled separately from both providers and the requester.');
  }else{
    const route=flow('client','compute-east','work','Payload / destination receipt');
    check('delivery','Reachable destination and forwarding path',!!route,'Only nodes explicitly configured to forward can be intermediate hops.');
    if(route)providers=route.nodes.slice(1,-1).map(id=>byId[id]);
    check('destination','Known destination control distinct from requester',!!byId['compute-east'].operator&&!!client.operator&&byId['compute-east'].operator!==client.operator,
      'This is a declared identity assumption. A real contract also requires a fresh signed destination receipt.');
  }
  for(const verifier of verifiers)for(const provider of providers)flow(provider.id,verifier.id,'verify','Work for independent check');
  const issuerRoute=flow('client','fund','fund','Scoped allocation request');
  check('issuer','Reachable scoped grant issuer',!!issuerRoute,'A routed service is not a fresh reservation. The graph only plans this request.');
  check('budget','Declared pool can cover the ask',model.pool.available>=spec.units,`${spec.units} test units needed; ${model.pool.available} shown as unallocated. No units are spent by this planner.`);
  plan.providers=providers.map(n=>n.id);plan.verifiers=verifiers.map(n=>n.id);
  const needed=['client',...plan.providers,...plan.verifiers,'fund',...(request==='delivery'?['compute-east']:[])];
  plan.evidenceNodes=[...new Set(needed)];
  for(const id of plan.evidenceNodes){const route=findRoute(model,'client',id);if(route&&route.edges.length)plan.evidenceRoutes.push({from:'client',to:id,kind:'evidence',label:'Fetch relevant evidence / scoped state',route});}
  plan.status=plan.checks.every(c=>c.ok)?'PLANNABLE':'DEFER';
  plan.primaryRoute=plan.flows.find(f=>f.kind==='work')?.route??null;
  return plan;
}
export function networkCounts(model) {
  const online=model.nodes.filter(n=>n.online);
  return {nodes:model.nodes.length,online:online.length,operators:new Set(online.map(n=>n.operator).filter(Boolean)).size,
    unknownOperators:online.filter(n=>!n.operator).length,links:model.links.filter(e=>e.online&&online.some(n=>n.id===e.a)&&online.some(n=>n.id===e.b)).length};
}
