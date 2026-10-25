// Same-origin workers model actors; they are NOT independently administered machines.
export class RpcAgent {
  constructor(worker) {
    this.worker=worker; this.pending=new Map(); this.next=0;
    const receive=data=> {
      const request=this.pending.get(data.id); if(!request)return;
      clearTimeout(request.timer);this.pending.delete(data.id);
      data.error?request.reject(Error(data.error)):request.resolve(data.value);
    };
    if(worker.addEventListener) {
      worker.addEventListener('message',e=>receive(e.data));
      worker.addEventListener('error',e=>this.fail(Error(e.message||'Worker failed')));
    } else {worker.on('message',receive);worker.on('error',e=>this.fail(e));}
  }
  fail(error) {for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();}
  call(op,args={},transfer=[]) {
    const id=++this.next;
    return new Promise((resolve,reject)=> {
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Worker operation timed out.'));},15000);
      this.pending.set(id,{resolve,reject,timer});this.worker.postMessage({id,op,args},transfer);
    });
  }
  sign(body) {return this.call('sign',{body});}
  close(){this.fail(Error('Worker closed.'));this.worker.terminate();}
}
export class IdbStore {
  constructor(namespace) {this.namespace=namespace;this.reads=0;this.writes=0;}
  async open(){
    if(this.db)return this.db;
    this.db=await new Promise((resolve,reject)=>{
      const req=indexedDB.open('tidepool-lab-v1',1);
      req.onupgradeneeded=()=>req.result.createObjectStore('objects');
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    });return this.db;
  }
  async operation(mode,fn) {
    const db=await this.open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('objects',mode), store=tx.objectStore('objects');let result;
      const request=fn(store);
      if(request) request.onsuccess=()=>{result=request.result;};
      tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Storage transaction aborted.'));
    });
  }
  key(id){return this.namespace+'/'+id;}
  async put(id,value){await this.operation('readwrite',s=>s.put(value,this.key(id)));this.writes++;}
  async get(id){this.reads++;return this.operation('readonly',s=>s.get(this.key(id)));}
  async remove(id){await this.operation('readwrite',s=>s.delete(this.key(id)));}
  async clear(){
    const prefix=this.namespace+'/';
    await this.operation('readwrite',s=>{
      const cursor=s.openCursor(IDBKeyRange.bound(prefix,prefix+'\uffff'));
      cursor.onsuccess=()=>{const item=cursor.result;if(item){item.delete();item.continue();}};
    });
    this.db?.close();this.db=null;
  }
  async reopen(){this.db?.close();this.db=null;await this.open();}
}
export class BrowserRuntime {
  constructor(){this.kind='Browser Workers + IndexedDB';this.agents=[];this.stores=[];}
  async actor(name){
    const actor=new RpcAgent(new Worker(new URL('./agent.mjs',import.meta.url),{type:'module'}));
    this.agents.push(actor);actor.info=await actor.call('init',{name});return actor;
  }
  store(namespace){const store=new IdbStore(namespace);this.stores.push(store);return store;}
  async deliver(relay,recipient,bytes,packet,strategy='honest'){
    const channel=new MessageChannel();
    await recipient.call('receive',{port:channel.port2},[channel.port2]);
    const copy=bytes.slice();return relay.call('forward',{bytes:copy,packet,strategy,port:channel.port1},[copy.buffer,channel.port1]);
  }
  async close(){this.agents.forEach(a=>a.close());await Promise.all(this.stores.map(s=>s.clear()));}
}
