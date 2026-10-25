import {ROLES,OPERATORS,REQUESTS,SCENARIOS,makeNetwork,planRequest,networkCounts,compareDomains,BASE_NODES} from './network-model.mjs';
import {networkSvg,nodeColor,escapeHtml as esc} from './network-view.mjs';
const $=id=>document.getElementById(id);
const state={request:'compute',scenario:'normal',selected:'compute-east',lens:'role',layer:'work',role:'all',route:'all',offline:new Set()};
let current;
const options=entries=>Object.entries(entries).map(([id,item])=>`<option value="${id}">${esc(item.name??item.label)}</option>`).join('');
const panel=$('network-app');
panel.innerHTML=`<div class="net-controls"><label for="net-request">Network ask<select id="net-request">${options(REQUESTS)}</select></label><label for="net-scenario">Stress scenario<select id="net-scenario">${options(SCENARIOS)}</select></label><label for="net-lens">Colour nodes by<select id="net-lens"><option value="role">Service role</option><option value="operator">Operator ownership</option><option value="power">Power dependency</option></select></label><button id="net-reset" class="secondary">Reset network</button></div>
  <div class="net-readout" aria-live="polite" id="net-counts"></div>
  <div class="net-layout"><div class="net-map-column"><div class="net-map-toolbar"><div class="net-layers" role="group" aria-label="Graph layer"><button data-net-layer="work" aria-pressed="true">Work routes</button><button data-net-layer="evidence" aria-pressed="false">Evidence routes</button><button data-net-layer="transport" aria-pressed="false">All links</button></div><label class="sr-only" for="net-role">Highlight a service role</label><select id="net-role"><option value="all">All roles</option>${options(ROLES)}</select></div>
  <div class="net-canvas" id="net-canvas" aria-label="Scrollable network graph"></div><div class="net-map-key"><span><i class="key-line work"></i>Work</span><span><i class="key-line verify"></i>Check</span><span><i class="key-line fund"></i>Funding</span><span><i class="key-line evidence"></i>Evidence</span><span><i class="key-line inactive"></i>Offline</span></div>
  <div class="net-map-caption"><span>Declared topology · link numbers are illustrative</span><span class="net-swipe">Swipe to explore, or use the node selector</span></div>
  <div class="net-route-picker"><label for="net-route">Inspect a route</label><select id="net-route"></select></div><div id="net-legend" class="net-legend" aria-label="Node colour legend"></div></div>
  <aside class="net-inspector"><div class="eyebrow">Node inspector</div><label class="sr-only" for="net-node">Select node</label><select id="net-node">${BASE_NODES.map(n=>`<option value="${n.id}">${esc(n.name)}</option>`).join('')}</select><div id="net-node-detail"></div><div class="net-node-actions"><button id="net-toggle" class="secondary">Take node offline</button><button id="net-fail-operator" class="text-button">Fail this operator’s nodes</button><button id="net-fail-power" class="text-button">Fail this power domain</button></div></aside></div>
  <div class="net-plan" id="net-plan" aria-live="polite"></div><div class="net-bottom"><p><strong>Independence is an assumption to investigate.</strong> New keys, separate service roles, or two paths do not establish separate control. This planner uses declared ownership, sites and power dependencies; it does not discover or certify real operators.</p><div><button id="net-export-json" class="secondary">Export topology JSON</button><button id="net-export-svg" class="secondary">Download graph SVG</button></div></div>`;

function renderInspector(model){
  const node=model.nodes.find(n=>n.id===state.selected),role=ROLES[node.primary],peers=model.nodes.filter(n=>n.id!==node.id);
  $('net-node').value=node.id;
  const shared=field=>!node[field]?'Unknown':peers.filter(n=>n[field]===node[field]).map(n=>n.name).join(', ')||'No shared peer declared';
  const owner=node.operator?OPERATORS[node.operator].name:'Unknown operator';
  const color=nodeColor(node,state.lens);
  $('net-node-detail').innerHTML=`<div class="net-node-heading"><span class="net-role-badge" style="--node-color:${color}">${role.code}</span><div><h3>${esc(node.name)}</h3><p>${esc(role.label)} · ${node.online?'online':'offline'}</p></div></div><p class="net-purpose">${esc(role.purpose)}</p>
    <dl class="net-properties"><div><dt>Operator</dt><dd>${esc(owner)}</dd></div><div><dt>Site</dt><dd>${esc(node.site??'Unknown')}</dd></div><div><dt>Power domain</dt><dd>${esc(node.powerDomain??'Unknown')}</dd></div></dl>
    <div class="net-resource-title">Local resource base <span>illustrative</span></div><div class="net-resource-grid"><div><strong>${node.energy.spareWh} Wh</strong><small>Exportable energy</small></div><div><strong>${node.offers.computeSlots}</strong><small>Offered compute slots</small></div><div><strong>${node.offers.storageGiB} GiB</strong><small>Offered storage</small></div><div><strong>${node.transit?'Forwards':'Endpoint'}</strong><small>Network function</small></div></div>
    <p class="net-base-note">${esc(node.energy.source)} · ${node.energy.protectedReserveWh} Wh protected reserve. Every node also has local controller compute, journal storage and communications; zero offered capacity means no export of that service.</p>
    <details class="net-local-state"><summary>Local ledger & shared dependencies</summary><p>${esc(role.ledger)}</p><dl class="net-properties"><div><dt>Same operator</dt><dd>${esc(shared('operator'))}</dd></div><div><dt>Same site</dt><dd>${esc(shared('site'))}</dd></div><div><dt>Same power</dt><dd>${esc(shared('powerDomain'))}</dd></div></dl></details>`;
  const baseOffline=!makeNetwork({scenario:state.scenario}).nodes.find(n=>n.id===node.id).online;
  $('net-toggle').disabled=baseOffline;$('net-toggle').textContent=baseOffline?'Offline in this scenario':state.offline.has(node.id)?'Restore this node':'Take node offline';
  $('net-fail-operator').disabled=!node.operator;$('net-fail-power').disabled=!node.powerDomain;
}
function renderLegend(model){
  let items=[];
  if(state.lens==='role')items=Object.values(ROLES).map(r=>({label:r.label,color:r.color}));
  else if(state.lens==='operator')items=[...new Set(model.nodes.map(n=>n.operator))].map(id=>({label:OPERATORS[id]?.name??'Unknown operator',color:OPERATORS[id]?.color??'#868d85'}));
  else items=[...new Set(model.nodes.map(n=>n.powerDomain))].map(id=>({label:id??'Unknown power',color:nodeColor(model.nodes.find(n=>n.powerDomain===id),'power')}));
  $('net-legend').innerHTML=items.map(item=>`<span><i style="background:${item.color}"></i>${esc(item.label)}</span>`).join('');
}
function renderPlan(model,plan){
  const name=id=>model.nodes.find(n=>n.id===id)?.name??id,failed=plan.checks.filter(c=>!c.ok),route=plan.primaryRoute;
  const evidence=plan.evidenceNodes.map(id=>`<span>${esc(name(id))}</span>`).join('');
  const storagePair=plan.providers.length===2&&plan.request==='storage'?compareDomains(...plan.providers.map(id=>model.nodes.find(n=>n.id===id))):null;
  $('net-plan').innerHTML=`<div class="net-plan-main"><div class="net-plan-heading"><div><p class="eyebrow">Request-specific plan</p><h3>${esc(plan.name)}</h3></div><span class="outcome ${plan.status==='DEFER'?'warning':''}">${plan.status==='PLANNABLE'?'PLAN FOUND':'DEFER'}</span></div><p class="net-plan-description">${esc(plan.description)}</p><div class="net-scenario-note">${esc(SCENARIOS[state.scenario].note)}</div>
    <ul class="net-checks">${plan.checks.map(c=>`<li class="${c.ok?'':'net-check-fail'}"><span aria-hidden="true">${c.ok?'✓':'—'}</span><div><strong>${esc(c.label)}</strong><small>${esc(c.detail)}</small></div></li>`).join('')}</ul>${plan.warnings.map(w=>`<p class="net-warning">${esc(w)}</p>`).join('')}
    <p class="net-plan-limit">${failed.length?'Unmet conditions defer this ask; they do not establish fraud.':'Plan found under the displayed assumptions. A real contract still needs live reservations, signatures, and service verification.'}</p></div>
    <div class="net-plan-evidence"><p class="eyebrow">Relevant evidence holders</p><div class="net-holder-list">${evidence}</div><p class="net-evidence-note">${plan.status==='DEFER'?'Partial plan: some required participants or routes are missing.':'These are the modeled sources for this ask.'} Routing peers do not need every source’s full history. No ledger objects are fetched by this graph.</p>
    <dl class="net-plan-facts"><div><dt>Grant scope</dt><dd>${esc(plan.scope)}</dd></div><div><dt>Budget needed</dt><dd>${plan.units} of ${model.pool.available} test units · not reserved</dd></div><div><dt>Primary route</dt><dd>${route?route.nodes.map(name).map(esc).join(' → '):'No qualifying work route'}</dd></div><div><dt>Route bottleneck</dt><dd>${route?.mbps??'—'}${route?' Mb/s, illustrative':''}</dd></div>${storagePair?`<div><dt>Replica domains</dt><dd>Control, site, and power are distinct in this fixture.</dd></div>`:''}</dl><p class="net-evidence-note">Bandwidth is a per-route upper bound. Concurrent flow competition, latency budgets, radio interference and shared infrastructure outside this fixture are not modeled.</p><button id="net-open-test" class="primary">Open related work test →</button><p class="net-test-note">The test bench runs real local operations with its own worker identities. It does not deploy this topology.</p></div>`;
  $('net-open-test').addEventListener('click',()=>document.dispatchEvent(new CustomEvent('tidepool:open-case',{detail:{id:plan.caseId}})));
}
function render(){
  const model=makeNetwork({scenario:state.scenario,offline:[...state.offline]}),plan=planRequest(model,state.request),counts=networkCounts(model);current={model,plan};
  const routes=state.layer==='evidence'?plan.evidenceRoutes:plan.flows;
  if(state.route!=='all'&&!routes[Number(state.route)])state.route='all';
  $('net-route').innerHTML='<option value="all">All required routes</option>'+routes.map((r,i)=>`<option value="${i}">${esc(r.label)} · ${esc(model.nodes.find(n=>n.id===r.from).name)} → ${esc(model.nodes.find(n=>n.id===r.to).name)}</option>`).join('');
  $('net-route').value=state.route;$('net-route').disabled=state.layer==='transport';
  $('net-counts').innerHTML=`<span><strong>${counts.online}/${counts.nodes}</strong> nodes online</span><span><strong>${counts.operators}</strong> declared operators${counts.unknownOperators?' + '+counts.unknownOperators+' nodes with unknown control':''}</span><span><strong>${counts.links}</strong> available links</span><span>Seven service roles · independent control is separate</span>`;
  $('net-canvas').innerHTML=networkSvg(model,plan,state);renderInspector(model);renderLegend(model);renderPlan(model,plan);
  for(const button of panel.querySelectorAll('[data-net-layer]'))button.setAttribute('aria-pressed',String(button.dataset.netLayer===state.layer));
}
function selectNode(id){if(!BASE_NODES.some(n=>n.id===id))return;state.selected=id;render();}
for(const [id,field] of [['net-request','request'],['net-scenario','scenario'],['net-lens','lens'],['net-role','role'],['net-route','route']]){
  $(id).addEventListener('change',event=>{state[field]=event.target.value;if(['request','scenario'].includes(field))state.route='all';if(field==='scenario')state.offline.clear();render();});
}
$('net-node').addEventListener('change',event=>selectNode(event.target.value));
panel.addEventListener('click',event=>{
  const node=event.target.closest('[data-node]');if(node)selectNode(node.dataset.node);
  const layer=event.target.closest('[data-net-layer]');if(layer){state.layer=layer.dataset.netLayer;state.route='all';render();}
});
panel.addEventListener('keydown',event=>{const node=event.target.closest('[data-node]');if(node&&(event.key==='Enter'||event.key===' ')){event.preventDefault();const id=node.dataset.node;selectNode(id);panel.querySelector(`[data-node="${id}"]`)?.focus();}});
$('net-toggle').addEventListener('click',()=>{state.offline.has(state.selected)?state.offline.delete(state.selected):state.offline.add(state.selected);render();});
$('net-fail-operator').addEventListener('click',()=>{const n=current.model.nodes.find(n=>n.id===state.selected);current.model.nodes.filter(peer=>peer.operator===n.operator).forEach(peer=>state.offline.add(peer.id));render();});
$('net-fail-power').addEventListener('click',()=>{const n=current.model.nodes.find(n=>n.id===state.selected);current.model.nodes.filter(peer=>peer.powerDomain===n.powerDomain).forEach(peer=>state.offline.add(peer.id));render();});
$('net-reset').addEventListener('click',()=>{state.scenario='normal';state.offline.clear();state.route='all';state.role='all';$('net-scenario').value='normal';$('net-role').value='all';render();});
function download(name,body,type){const url=URL.createObjectURL(new Blob([body],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
$('net-export-json').addEventListener('click',()=>download('tidepool-network.json',JSON.stringify({assumptions:'Declared synthetic topology. Planner output is not evidence of independent real operators, a reservation, or completed work.',...current,view:{...state,offline:[...state.offline]}},null,2),'application/json'));
$('net-export-svg').addEventListener('click',()=>download('tidepool-network.svg',networkSvg(current.model,current.plan,state),'image/svg+xml'));
$('net-node').value=state.selected;render();
