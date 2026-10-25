import {CASES,runCase,runIncentives} from './suite.mjs';
import {BrowserRuntime} from './browser-runtime.mjs';
import {SAMPLE_CSV,parseEnergyCsv} from './work.mjs';
import {enc,hex,digest} from './engine.mjs';

const $=id=>document.getElementById(id);
const state={selected:CASES[0].id,results:new Map(),busy:false,payload:null,fileName:null,game:null};
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty=value=>JSON.stringify(value,(_key,v)=>v instanceof Uint8Array?{encoding:'hex',data:hex(v)}:v,2);
const fmt=n=>typeof n==='number'?(Number.isInteger(n)?n.toLocaleString():n.toFixed(1)):String(n);
const labels={inputBytes:'Input bytes',outputBytes:'Output bytes',rows:'Rows computed',workMs:'Work + transport ms',verifyMs:'Verification ms',
  deliveredBytes:'Bytes delivered',chunks:'Stored chunks',sampled:'Chunks challenged',restoredBytes:'Restored bytes',storageReads:'Storage reads',storageWrites:'Storage writes',
  availableEvents:'Events in modeled stores',fetchedEvents:'Fetched objects',unrelatedReads:'Unrelated reads',capacity:'Pool capacity',allocatedUnits:'Units reserved',jobsExecuted:'Useful jobs executed',rewardUnits:'Reward units',bountyRemaining:'Bounty remaining'};
$('csv-input').value=SAMPLE_CSV;

function renderList(){
  const filter=$('case-filter').value;let family='';
  $('case-list').innerHTML=CASES.filter(c=>filter==='all'||c.mode===filter).map(c=>{
    const group=c.family!==family?`<div class="case-group">${esc(c.family)}</div>`:'';family=c.family;
    const result=state.results.get(c.id),dot=result?(result.ok?(c.mode==='Boundary'?'boundary':'matched'):'failed'):'';
    return group+`<button class="case-button" data-case="${c.id}" aria-pressed="${state.selected===c.id}"><span class="case-dot ${dot}" aria-label="${result?(result.ok?'Expected outcome reproduced':'Unexpected outcome'):'Not run'}"></span><span>${esc(c.title)}</span><span class="arrow" aria-hidden="true">›</span></button>`;
  }).join('');
}
function metricsHTML(metrics){return '<dl class="metric-grid">'+Object.entries(metrics).map(([key,value])=>`<div><dt>${esc(labels[key]||key)}</dt><dd>${esc(fmt(value))}</dd></div>`).join('')+'</dl>';}
function renderDetail(){
  const spec=CASES.find(c=>c.id===state.selected),result=state.results.get(spec.id);
  $('case-family').textContent=spec.family+' / '+(spec.mode==='Cooperate'?'Cooperation':spec.mode==='Attack'?'Attack or fault':'Known boundary');
  $('case-index').textContent=String(CASES.indexOf(spec)+1).padStart(2,'0')+' / '+CASES.length;
  $('case-title').textContent=spec.title;$('case-description').textContent=spec.description;$('expected-outcome').textContent=spec.expected;
  $('export-case').disabled=state.busy||!result;$('run-one').disabled=state.busy;
  if(!result){$('case-result').innerHTML='<div class="empty-result"><span aria-hidden="true">⌁</span><p>Waiting for observed evidence.</p><small>Results are calculated when you run the case.</small></div>';return;}
  const warning=result.mode==='Boundary'||['INCOMPLETE','UNAVAILABLE'].includes(result.observed);
  let content=`<div class="outcome-head"><span class="outcome ${!result.ok?'error':warning?'warning':''}">${esc(result.observed)}</span><span class="match-label">${result.ok?'Expectation reproduced':'Unexpected outcome'}</span></div><p class="reason">${esc(result.reason)}</p>`;
  content+=metricsHTML(result.metrics);
  content+='<ul class="assertions">'+result.assertions.map(a=>`<li class="${a.passed?'':'fail'}"><span aria-hidden="true">${a.passed?'✓':'×'}</span>${esc(a.name)}</li>`).join('')+'</ul>';
  if(result.output&&result.observed==='ACCEPTED'){
    content+=`<table class="output-table"><caption>Computed output · ${fmt(result.output.total_wh)} Wh exportable</caption><thead><tr><th scope="col">Node</th><th scope="col">Exportable Wh</th></tr></thead><tbody>`+
      result.output.rows.slice(0,12).map(r=>`<tr><td>${esc(r.node)}</td><td>${fmt(r.exportable_wh)}</td></tr>`).join('')+'</tbody></table>';
    if(result.output.rows.length>12)content+=`<p class="muted">Showing 12 of ${result.output.rows.length} rows. Download the complete output.</p>`;
  }
  if(result.artifacts?.length)content+='<div class="downloads">'+result.artifacts.map((a,i)=>`<button data-artifact="${i}">↓ ${esc(a.name)}</button>`).join('')+'</div>';
  if(result.note)content+=`<p class="reason">${esc(result.note)}</p>`;
  content+=`<details class="evidence-details"><summary>Observed facts & limitations</summary><pre>${esc(pretty(result.facts||{}))}</pre></details>`;
  content+=`<details class="evidence-details"><summary>Contract terms · ${esc(result.contractId?.slice(0,12)||'unavailable')}…</summary><pre>${esc(pretty(result.contract||{}))}</pre></details>`;
  if(result.bundle)content+=`<details class="evidence-details"><summary>Inspect signed evidence · ${result.bundle.objects.length} objects</summary><p class="muted" style="font-size:10px;margin-top:10px">Public keys here are pinned by this experiment. They are not externally verified identities.</p><pre>${esc(pretty(result.bundle))}</pre></details>`;
  content+=`<p class="muted" style="font-size:9px;margin-top:15px">Last observed ${esc(new Date(result.completedAt).toLocaleTimeString())} · ${esc(result.runtime)} · ${fmt(result.elapsedMs)} ms including setup</p>`;
  $('case-result').innerHTML=content;
}
function renderSummary(){
  const results=[...state.results.values()];$('tested-count').textContent=results.length||'—';
  $('matched-count').textContent=results.length?results.filter(r=>r.ok).length:'—';
  $('boundary-count').textContent=results.length?results.filter(r=>r.ok&&r.mode==='Boundary').length:'—';
  $('export-run').disabled=state.busy||!results.length;
  $('run-ledger').innerHTML=results.length?results.map(r=>`<div class="ledger-row"><button data-case="${r.id}">${esc(r.title)}</button><span class="status">${esc(r.observed)}</span><span class="elapsed">${fmt(r.elapsedMs)} ms</span><span class="verdict" style="color:${r.ok?'var(--green)':'var(--red)'}">${r.ok?'Matched':'Mismatch'}</span></div>`).join(''):'<p class="muted">Each executed case will appear here with its observed decision.</p>';
}
function setBusy(busy){
  state.busy=busy;
  for(const id of ['run-all','run-one','run-game','csv-input','payload-file','reset-input','clear-file','audit-rate','cheat-rate','reward','cost','penalty','rounds','seed'])$(id).disabled=busy;
  $('case-detail').classList.toggle('running',busy);renderSummary();$('export-case').disabled=busy||!state.results.has(state.selected);
}
function inputs(){const csv=$('csv-input').value;parseEnergyCsv(csv);const payload=state.payload??enc.encode(csv);
  if(payload.length<8||payload.length>131072)throw Error('The payload must contain 8 bytes to 128 KiB.');return{csv,payload};}
function showError(error){$('run-state').textContent=error.message;$('case-result').innerHTML='<p class="error-message">'+esc(error.message)+'</p>';}
async function run(ids){
  if(state.busy)return;let config;try{config=inputs();}catch(error){showError(error);return;}
  if(!globalThis.crypto?.subtle||!globalThis.Worker||!globalThis.indexedDB){showError(Error('This browser needs Web Crypto, Workers, and IndexedDB in a secure context.'));return;}
  if(ids.length===CASES.length)state.results.clear();
  setBusy(true);
  try{
    for(let i=0;i<ids.length;i++){
      const spec=CASES.find(c=>c.id===ids[i]);state.selected=spec.id;renderList();renderDetail();
      $('run-state').textContent=`Running ${i+1} / ${ids.length} · ${spec.title}`;
      $('case-result').innerHTML='<div class="empty-result"><span aria-hidden="true">⌁</span><p>Executing the contract and checking evidence…</p></div>';
      const result=await runCase(spec.id,new BrowserRuntime(),config);
      result.inputSummary={csv:config.csv,payloadName:state.fileName??'current-energy.csv',payloadHash:await digest(config.payload),payloadBytes:config.payload.length};
      state.results.set(spec.id,result);renderList();renderDetail();renderSummary();
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    const results=[...state.results.values()],mismatches=results.filter(r=>!r.ok).length;
    $('run-state').textContent=mismatches?`${mismatches} unexpected outcome(s) · inspect the run ledger`:`${results.length} cases observed · all expectations reproduced`;
    if(ids.length>1){state.selected='compute.honest';renderList();renderDetail();}
  }catch(error){showError(error);}finally{setBusy(false);}
}
function download(name,value,type='application/json'){
  const blob=new Blob([value],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function exportResult(result){download('tidepool-'+result.id+'.json',pretty({format:'tidepool-experiment-export-1',trust:'Public keys and operator labels are local experiment assumptions, not external identity attestations.',result}));}
document.addEventListener('click',e=>{
  const button=e.target.closest('[data-case]');if(button){state.selected=button.dataset.case;renderList();renderDetail();if(button.closest('#run-ledger'))$('case-detail').scrollIntoView({behavior:'smooth',block:'start'});}
  const artifact=e.target.closest('[data-artifact]');if(artifact){const a=state.results.get(state.selected)?.artifacts?.[Number(artifact.dataset.artifact)];if(a)download(a.name,a.bytes??a.text,a.type);}
});
$('case-filter').addEventListener('change',renderList);
$('run-all').addEventListener('click',()=>run(CASES.map(c=>c.id)));
$('run-one').addEventListener('click',()=>run([state.selected]));
$('export-case').addEventListener('click',()=>exportResult(state.results.get(state.selected)));
$('export-run').addEventListener('click',()=>download('tidepool-run.json',pretty({format:'tidepool-run-export-1',exportedAt:new Date().toISOString(),
  trust:'Local keys and operator registry are experimental anchors. Successful regression checks are not a production security proof.',results:[...state.results.values()],incentives:state.game})));
$('reset-input').addEventListener('click',()=>{$('csv-input').value=SAMPLE_CSV;});
$('clear-file').addEventListener('click',()=>{state.payload=null;state.fileName=null;$('payload-file').value='';$('payload-label').textContent='Uses the current CSV bytes until you choose a file.';});
$('payload-file').addEventListener('change',async e=>{
  const file=e.target.files[0];if(!file)return;
  if(file.size<8||file.size>131072){e.target.value='';state.payload=null;state.fileName=null;$('payload-label').textContent='Choose a file between 8 bytes and 128 KiB. CSV bytes remain selected.';return;}
  state.payload=new Uint8Array(await file.arrayBuffer());state.fileName=file.name;$('payload-label').textContent=file.name+' · '+file.size.toLocaleString()+' bytes · local only';
});
function gameSettings(){const settings={auditPercent:+$('audit-rate').value,cheatPercent:+$('cheat-rate').value,reward:+$('reward').value,cost:+$('cost').value,penalty:+$('penalty').value,rounds:+$('rounds').value,seed:+$('seed').value};
  for(const id of ['reward','cost','penalty','rounds','seed'])if(!$(id).value||!$(id).checkValidity())throw Error('Check the numeric limits for '+id+'.');return settings;}
function updatePayoff(){
  $('audit-display').textContent=$('audit-rate').value+'%';$('cheat-display').textContent=$('cheat-rate').value+'%';
  let s;try{s=gameSettings();}catch(error){$('payoff-preview').textContent=error.message;return;}
  const p=s.auditPercent/100,h=s.reward-s.cost,c=(1-p)*s.reward-p*s.penalty,max=Math.max(1,Math.abs(h),Math.abs(c));
  const bar=(name,value,kind)=>`<div class="payoff-row ${kind}"><span>${name}</span><div class="bar-track"><div style="position:absolute;left:50%;height:100%;width:1px;background:#9aab93"></div><div class="bar-fill" style="position:absolute;width:${Math.abs(value)/max*49}%;left:${value<0?50-Math.abs(value)/max*49:50}%"></div></div><span class="payoff-number">${value.toFixed(1)}</span></div>`;
  $('payoff-preview').innerHTML='<div class="payoff-bars"><h4>Expected net units per attempt · assumed payoffs</h4>'+bar('Cooperate',h,'honest')+bar('Skip work',c,'cheat')+'</div>'+`<p>${h>c?'Cooperation has the higher modeled payoff.':h<c?'Skipping work has the higher modeled payoff.':'Both strategies have the same modeled payoff.'} Audit × (payment + collectible penalty) must exceed work cost for cooperation to win in this model.</p>`;
}
for(const id of ['audit-rate','cheat-rate','reward','cost','penalty','rounds','seed'])$(id).addEventListener('input',updatePayoff);
$('run-game').addEventListener('click',async()=>{
  if(state.busy)return;let settings,csv;try{settings=gameSettings();csv=inputs().csv;}catch(error){$('game-result').innerHTML='<p class="error-message">'+esc(error.message)+'</p>';return;}
  setBusy(true);$('game-result').textContent='Computing actual jobs and auditing committed outputs…';$('run-state').textContent='Running the incentive experiment';
  try{
    const result=await runIncentives(new BrowserRuntime(),{...settings,csv});state.game=result;const t=result.totals;
    $('game-result').innerHTML=`<div class="game-counts"><div><strong>${t.validRows}</strong><small>Useful rows computed</small></div><div><strong>${t.detected} / ${t.cheats}</strong><small>Skipped jobs detected</small></div><div><strong>${t.paidWrong}</strong><small>Invalid jobs paid</small></div></div><p class="model-callout">Observed ${t.audits} audits in ${result.assumptions.rounds} rounds. ${t.credits} units paid; ${t.payoff} net assumed worker units. These are finite observations under this schedule.</p><details class="evidence-details"><summary>Round-by-round decisions & commitments</summary><pre>${esc(pretty(result.transcript))}</pre></details><div class="downloads"><button id="export-game">↓ Export experiment JSON</button></div>`;
    $('export-game').addEventListener('click',()=>download('tidepool-incentives.json',pretty(result)));
    $('run-state').textContent='Incentive experiment complete · '+settings.rounds+' actual attempts';
  }catch(error){$('game-result').innerHTML='<p class="error-message">'+esc(error.message)+'</p>';$('run-state').textContent='Incentive experiment failed';}
  finally{setBusy(false);}
});
renderList();renderDetail();renderSummary();updatePayoff();
