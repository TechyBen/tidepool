import {ROLES,OPERATORS,BASE_NODES} from './network-model.mjs';
export const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const e=escapeHtml;
const palette=['#527345','#8e6748','#5c719e','#8b5980','#3c7f83','#9c7131','#645d91','#58768b','#876347','#477d63','#9a5d59','#70723c'];
const powerColors=new Map([...new Set([...BASE_NODES.map(n=>n.powerDomain),'shared-storage-feeder'])].map((id,i)=>[id,palette[i]]));
export function domainColor(value){return powerColors.get(value)??'#868d85';}
export function nodeColor(node,lens){return lens==='operator'?(OPERATORS[node.operator]?.color??'#868d85'):lens==='power'?domainColor(node.powerDomain):ROLES[node.primary].color;}
export function visibleRoutes(plan,state){const all=state.layer==='evidence'?plan.evidenceRoutes:plan.flows;return state.layer==='transport'?[]:state.route==='all'?all:all.filter((_,i)=>String(i)===state.route);}
export function networkSvg(model,plan,state={lens:'role',layer:'work',selected:'compute-east',role:'all',route:'all'}) {
  const byId=Object.fromEntries(model.nodes.map(n=>[n.id,n])),routes=visibleRoutes(plan,state),usedEdges=new Map(),usedNodes=new Set();
  const priority={work:4,verify:3,evidence:2,fund:1},colors={work:'#266e58',verify:'#7a6196',evidence:'#397b9c',fund:'#af7930'};
  for(const flow of routes){flow.route.nodes.forEach(id=>usedNodes.add(id));for(const id of flow.route.edges){if((priority[usedEdges.get(id)]??0)<priority[flow.kind])usedEdges.set(id,flow.kind);}}
  const edgePath=link=>link.id==='client-fallback'?'M110 110 C25 180 25 380 110 450':`M${byId[link.a].x} ${byId[link.a].y} L${byId[link.b].x} ${byId[link.b].y}`;
  const grid='<defs><pattern id="tidepool-net-grid" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".6" fill="#c8d1c1" opacity=".5"/></pattern></defs>';
  let svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 550" width="900" height="550" role="group" aria-labelledby="net-svg-title net-svg-desc"><title id="net-svg-title">Tidepool declared network: 12 nodes, seven primary roles</title><desc id="net-svg-desc">Select a node for its operator, power, compute, storage, communications and local ledger. Lines are declared links; highlighted paths are computed from the current scenario. Nodes are illustrative, not real independently operated machines.</desc>${grid}<rect width="900" height="550" fill="#f9faf3"/><rect width="900" height="550" fill="url(#tidepool-net-grid)"/><style>.net-svg-node{cursor:pointer}.net-svg-node:focus{outline:none}.net-svg-node:focus .net-focus-ring{stroke:#193d34;stroke-width:3}.net-svg-node:hover .net-focus-ring{stroke:#7a9472}</style>`;
  svg+='<g font-family="ui-monospace, monospace" font-size="10" letter-spacing="2" fill="#6a796c"><text x="58" y="38">COVE / WEST</text><text x="412" y="528">RIDGE</text><text x="702" y="38">UPLAND / EAST</text></g>';
  // Links are undirected in this fixture; directional asks and replies use these paths.
  for(const link of model.links){
    const online=link.online&&byId[link.a].online&&byId[link.b].online,kind=usedEdges.get(link.id),stroke=!online?'#c3aaa0':kind?colors[kind]:'#c9d3c1';
    svg+=`<path d="${edgePath(link)}" fill="none" stroke="${stroke}" stroke-width="${online&&kind?3.5:1.7}" stroke-linecap="round" ${!online?'stroke-dasharray="4 7" opacity=".5"':kind==='verify'||kind==='evidence'?'stroke-dasharray="7 5"':''}/>`;
  }
  for(const link of model.links.filter(l=>['backbone','ridge-west','ridge-east','client-fallback'].includes(l.id))){
    const online=link.online&&byId[link.a].online&&byId[link.b].online;
    const x=link.id==='client-fallback'?49:(byId[link.a].x+byId[link.b].x)/2,y=link.id==='client-fallback'?280:(byId[link.a].y+byId[link.b].y)/2;
    svg+=`<g font-family="ui-monospace,monospace" font-size="9" text-anchor="middle"><rect x="${x-27}" y="${y-10}" width="54" height="18" rx="4" fill="#f9faf3" stroke="#dce2d5"/><text x="${x}" y="${y+2}" fill="${online?'#62715e':'#a26f5c'}">${online?link.mbps+' Mb/s':'offline'}</text></g>`;
  }
  for(const node of model.nodes){
    const color=nodeColor(node,state.lens),selected=state.selected===node.id,dim=state.role!=='all'&&!node.roles.includes(state.role);
    const focused=state.layer==='evidence'?plan.evidenceNodes.includes(node.id):usedNodes.has(node.id),owner=node.operator?OPERATORS[node.operator].name:'Operator unknown';
    const label=state.lens==='operator'?(node.operator??'unknown control'):state.lens==='power'?node.powerDomain:ROLES[node.primary].label;
    svg+=`<g class="net-svg-node" data-node="${node.id}" role="button" tabindex="0" aria-pressed="${selected}" aria-label="${e(node.name+', '+ROLES[node.primary].label+', '+owner+', '+(node.online?'online':'offline'))}" transform="translate(${node.x} ${node.y})" opacity="${dim?.3:1}">`;
    if(focused&&node.online)svg+=`<circle r="34" fill="${color}" opacity=".09"/>`;
    svg+=`<circle class="net-focus-ring" r="29" fill="none" stroke="${selected?'#244b3b':'transparent'}" stroke-width="2"/>`;
    svg+=`<circle r="23" fill="${node.online?'#fffefa':'#efeee6'}" stroke="${node.online?color:'#adaea2'}" stroke-width="${focused?2.6:1.8}" ${!node.operator?'stroke-dasharray="4 3"':''}/>`;
    svg+=`<text text-anchor="middle" y="4" font-family="ui-monospace,monospace" font-weight="600" font-size="11" fill="${node.online?color:'#8e9086'}">${ROLES[node.primary].code}</text>`;
    svg+=`<circle cx="18" cy="-17" r="5" fill="${node.online?'#6e9653':'#b67a66'}" stroke="#f9faf3" stroke-width="2"/>`;
    if(!node.online)svg+='<path d="M-12 -12L12 12" stroke="#ab7968" stroke-width="2"/>';
    svg+=`<rect x="-65" y="31" width="130" height="32" rx="4" fill="#f9faf3" opacity=".96"/><text text-anchor="middle" y="43" font-family="Arial, sans-serif" font-size="12" font-weight="${selected?700:500}" fill="#254536">${e(node.name)}</text><text text-anchor="middle" y="57" font-family="Arial,sans-serif" font-size="9" fill="${color}">${e(label)}</text></g>`;
  }
  return svg+'</svg>';
}
