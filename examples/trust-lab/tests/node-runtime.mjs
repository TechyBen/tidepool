import {Worker,MessageChannel} from 'node:worker_threads';
import {mkdir,readFile,writeFile,rename,rm,mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {serialize,deserialize} from 'node:v8';
import {RpcAgent} from '../dist/browser-runtime.mjs';
import {digest} from '../dist/engine.mjs';

class FileStore {
  constructor(base,namespace){this.base=base;this.namespace=namespace;this.reads=0;this.writes=0;}
  async path(id){return join(this.base,await digest(this.namespace+'/'+id));}
  async put(id,value){const path=await this.path(id);await writeFile(path+'.tmp',serialize(value));await rename(path+'.tmp',path);this.writes++;}
  async get(id){this.reads++;try{return deserialize(await readFile(await this.path(id)));}catch(e){if(e.code==='ENOENT')return undefined;throw e;}}
  async remove(id){await rm(await this.path(id),{force:true});}
  async reopen(){/* Every operation opens a new file handle. */}
}
export class NodeRuntime {
  constructor(base){this.base=base;this.kind='Node worker_threads + filesystem';this.agents=[];}
  static async create(){const root=new URL('../.qa/',import.meta.url);await mkdir(root,{recursive:true});return new NodeRuntime(await mkdtemp(join(root.pathname,'run-')));}
  async actor(name){const actor=new RpcAgent(new Worker(new URL('../dist/agent.mjs',import.meta.url)));this.agents.push(actor);actor.info=await actor.call('init',{name});return actor;}
  store(namespace){return new FileStore(this.base,namespace);}
  async deliver(relay,recipient,bytes,packet,strategy='honest'){
    const channel=new MessageChannel();await recipient.call('receive',{port:channel.port2},[channel.port2]);
    const copy=bytes.slice();return relay.call('forward',{bytes:copy,packet,strategy,port:channel.port1},[copy.buffer,channel.port1]);
  }
  async close(){this.agents.forEach(a=>a.close());await rm(this.base,{recursive:true,force:true});}
}
