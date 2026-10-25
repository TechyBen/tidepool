import {enc, dec, digest, objectHash, canonical, unhex, nonce} from './engine.mjs';
export const SAMPLE_CSV = `node,available_wh,generation_wh,essential_wh,reserve_wh,committed_wh,margin_wh
west-compute,1200,400,500,600,200,100
west-storage,900,200,300,500,100,50
east-compute,1800,500,600,800,200,150
east-storage,1000,150,350,550,100,50
relay-north,500,100,250,250,50,25
relay-south,400,100,300,250,30,20
newcomer,600,250,200,300,80,50
archive,1500,300,500,700,200,100
`;
export function parseEnergyCsv(text) {
  if (typeof text !== 'string' || enc.encode(text).length > 131072) throw Error('Energy CSV must be at most 128 KiB.');
  const lines = text.trim().split(/\r?\n/);
  if (lines.shift() !== 'node,available_wh,generation_wh,essential_wh,reserve_wh,committed_wh,margin_wh') throw Error('CSV header must match the example exactly.');
  if (!lines.length || lines.length > 2000) throw Error('Provide 1–2,000 data rows.');
  const names = new Set();
  return lines.map(line => {
    const cells = line.split(',');
    if (cells.length !== 7 || !/^[A-Za-z0-9._-]{1,40}$/.test(cells[0]) || names.has(cells[0])) throw Error('Use unique node names and seven columns; quoted cells are not supported.');
    names.add(cells[0]);
    const values = cells.slice(1).map(x => {
      if (!/^(0|[1-9][0-9]*)$/.test(x) || Number(x) > 1000000000) throw Error('Energy fields must be non-negative integers, at most 1,000,000,000 Wh.');
      return Number(x);
    });
    return {node:cells[0], values};
  });
}
// Worker implementation.
export function calculateEnergy(csv) {
  const rows = parseEnergyCsv(csv).map(({node, values:v}) => ({node,
    exportable_wh:Math.max(0, v.slice(0,2).reduce((a,b)=>a+b,0) - v.slice(2).reduce((a,b)=>a+b,0))}));
  return {rows, total_wh:rows.reduce((sum,row)=>sum+row.exportable_wh,0)};
}
// Separate arithmetic implementation. Shared schema parsing is an explicit common dependency.
export function verifyEnergy(csv, actual) {
  try {
    const input = parseEnergyCsv(csv);
    if (!actual || !Array.isArray(actual.rows) || actual.rows.length !== input.length) return false;
    let total = 0;
    for (let i=0; i<input.length; i++) {
      const v=input[i].values;
      let remaining=v[0]; remaining+=v[1]; remaining-=v[2]; remaining-=v[3]; remaining-=v[4]; remaining-=v[5];
      const expected = remaining < 0 ? 0 : remaining;
      if (actual.rows[i].node !== input[i].node || actual.rows[i].exportable_wh !== expected) return false;
      total += expected;
    }
    return actual.total_wh === total;
  } catch { return false; }
}
export function applyComputeStrategy(csv, strategy) {
  if (strategy === 'skip') return {rows:[],total_wh:0};
  const result = calculateEnergy(csv);
  if (strategy === 'inflate') { result.rows[0].exportable_wh += 1000; result.total_wh += 1000; }
  return result;
}
export async function chunkData(bytes, size=128) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 131072) throw Error('Payload must contain 1 byte to 128 KiB.');
  const chunks=[]; for(let offset=0; offset<bytes.length; offset+=size) chunks.push(bytes.slice(offset,offset+size));
  let level=await Promise.all(chunks.map((chunk,i)=>leafHash(i,chunk)));
  const levels=[level];
  while(level.length>1) {
    const next=[];
    for(let i=0;i<level.length;i+=2) next.push(await branchHash(level[i],level[i+1]??level[i]));
    levels.push(next); level=next;
  }
  return {chunks,levels,root:level[0],size:bytes.length,fullHash:await digest(bytes)};
}
export const leafHash=(index,bytes)=>digest('tidepool.lab.chunk\n'+index+'\n'+[...bytes].join(','));
const branchHash=(left,right)=>digest('tidepool.lab.branch\n'+left+'\n'+right);
export function proofFor(tree,index) {
  const proof=[];
  for(let l=0;l<tree.levels.length-1;l++) {
    const level=tree.levels[l], sibling=index^1;
    proof.push({side:index%2?'left':'right',hash:level[sibling]??level[index]}); index=Math.floor(index/2);
  }
  return proof;
}
export async function checkChunk({root,index,bytes,proof,count}) {
  if (!bytes || !Number.isSafeInteger(index) || index<0 || index>=count || proof.length !== Math.ceil(Math.log2(count))) return false;
  let hash=await leafHash(index,bytes), position=index;
  for (const step of proof) {
    if (step.side !== (position%2?'left':'right') || !/^[0-9a-f]{64}$/.test(step.hash)) return false;
    hash=step.side==='left'?await branchHash(step.hash,hash):await branchHash(hash,step.hash);
    position=Math.floor(position/2);
  }
  return hash===root;
}
export function randomIndices(count, samples) {
  const selected=new Set();
  // Rejection sampling avoids modulo bias; challenges occur after the commitment.
  while(selected.size<Math.min(count,samples)) {
    const x=crypto.getRandomValues(new Uint32Array(1))[0], limit=Math.floor(4294967296/count)*count;
    if(x<limit) selected.add(x%count);
  }
  return [...selected];
}
export function joinBytes(chunks) {
  const result=new Uint8Array(chunks.reduce((sum,c)=>sum+c.length,0));
  let offset=0; for(const chunk of chunks) {result.set(chunk,offset);offset+=chunk.length;} return result;
}
export function energyCsv(result) {
  return 'node,exportable_wh\n'+result.rows.map(row=>row.node+','+row.exportable_wh).join('\n')+'\n';
}
