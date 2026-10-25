import {createIdentity, seal, digest, VERSION} from './engine.mjs';
import {applyComputeStrategy} from './work.mjs';

let channel = globalThis;
if (typeof process !== 'undefined' && process.versions?.node) {
  channel = (await import('node:worker_threads')).parentPort;
}
const listen=(target, fn)=>target.addEventListener ? target.addEventListener('message',e=>fn(e.data)) : target.on('message',fn);
let identity;
listen(channel, async ({id,op,args={}}) => {
  try {
    let value;
    if(op==='init') { identity=await createIdentity(args.name); value=identity.publicInfo; }
    else if(op==='sign') value=await seal(identity,args.body);
    else if(op==='compute') value=applyComputeStrategy(args.csv,args.strategy);
    else if(op==='receive') {
      const port=args.port;
      listen(port, async packet=> {
        try {
          const bytes=new Uint8Array(packet.bytes), hash=await digest(bytes);
          const body={v:VERSION,author:identity.name,keyId:identity.publicInfo.keyId,
            journal:identity.name+'/'+packet.contract,seq:0,prev:null,contract:packet.contract,
            kind:'delivery.ack',dependsOn:[packet.acceptId],
            payload:{nonce:packet.nonce,digest:hash,bytes:bytes.length}};
          port.postMessage({receipt:await seal(identity,body),bytes});
        } catch(error) {port.postMessage({error:error.message});}
      });
      port.start?.(); value=true;
    } else if(op==='forward') {
      const bytes=new Uint8Array(args.bytes), port=args.port;
      if(args.strategy==='corrupt' && bytes.length) bytes[0]^=1;
      value=await new Promise((resolve,reject)=> {
        const timer=setTimeout(()=>{port.close();resolve({receipt:null,bytes:new Uint8Array(),timedOut:true});},1500);
        listen(port,result=>{clearTimeout(timer);port.close();result.error?reject(Error(result.error)):resolve(result);});
        port.start?.();
        if(args.strategy!=='drop') port.postMessage({...args.packet,bytes},[bytes.buffer]);
      });
    } else throw Error('Unknown worker operation');
    channel.postMessage({id,value});
  } catch(error) {channel.postMessage({id,error:error.message});}
});
