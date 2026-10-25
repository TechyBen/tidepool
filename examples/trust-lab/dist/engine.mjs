// Lab primitives, not a production protocol or a general canonical-JSON standard.
export const VERSION = 'tidepool-lab-1';
export const enc = new TextEncoder();
export const dec = new TextDecoder();
export const clone = value => structuredClone(value);
export const hex = bytes => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
export function unhex(value) {
  if (typeof value !== 'string' || value.length % 2 || !/^[a-f0-9]*$/.test(value)) throw Error('Invalid hex');
  return Uint8Array.from(value.match(/../g) || [], x => parseInt(x, 16));
}
export function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }
  throw Error('Lab encoding requires JSON objects and safe integer numbers');
}
export async function digest(value) {
  return hex(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? enc.encode(value) : value));
}
export const objectHash = (domain, value) => digest(domain + '\n' + canonical(value));
export const nonce = () => hex(crypto.getRandomValues(new Uint8Array(16)));
export async function createIdentity(name) {
  const pair = await crypto.subtle.generateKey({name:'ECDSA', namedCurve:'P-256'}, false, ['sign', 'verify']);
  const raw = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const jwk = {kty:raw.kty, crv:raw.crv, x:raw.x, y:raw.y};
  return {name, pair, publicInfo:{name, keyId:await objectHash('tidepool.lab.key', jwk), jwk}};
}
export async function seal(identity, body) {
  const eventId = await objectHash('tidepool.lab.event', body);
  const signature = hex(await crypto.subtle.sign({name:'ECDSA', hash:'SHA-256'}, identity.pair.privateKey,
    enc.encode('tidepool.lab.signature\n' + eventId)));
  return {body, eventId, signature};
}
export async function verifyEnvelope(event, trustedKeys) {
  try {
    const b = event.body;
    if (b.v !== VERSION || !Number.isSafeInteger(b.seq) || b.seq < 0 || !Array.isArray(b.dependsOn)) return false;
    const key = trustedKeys[b.author];
    if (!key || b.keyId !== key.keyId || await objectHash('tidepool.lab.key', key.jwk) !== key.keyId) return false;
    if (await objectHash('tidepool.lab.event', b) !== event.eventId) return false;
    const publicKey = await crypto.subtle.importKey('jwk', key.jwk, {name:'ECDSA', namedCurve:'P-256'}, false, ['verify']);
    return await crypto.subtle.verify({name:'ECDSA', hash:'SHA-256'}, publicKey,
      unhex(event.signature), enc.encode('tidepool.lab.signature\n' + event.eventId));
  } catch { return false; }
}
export class Journal {
  constructor(actor, contract) { this.actor = actor; this.contract = contract; this.events = []; }
  async append(kind, payload, dependsOn = []) {
    const previous = this.events.at(-1);
    const body = {v:VERSION, author:this.actor.info.name, keyId:this.actor.info.keyId,
      journal:this.actor.info.name + '/' + this.contract, seq:this.events.length,
      prev:previous?.eventId ?? null, contract:this.contract, kind, dependsOn, payload};
    const event = await this.actor.sign(body);
    this.events.push(event);
    return event;
  }
}
export async function validateBundle(objects, policy) {
  const stats = {fetched:objects.length, checked:0, bytes:0};
  const out = (status, reason) => ({status, reason, ...stats});
  try {
    stats.bytes = enc.encode(canonical(objects)).length;
    if (objects.length > (policy.maxObjects ?? 256) || stats.bytes > (policy.maxBytes ?? 2097152)) {
      return out('INCOMPLETE', 'Evidence exceeds the requester’s fetch budget.');
    }
    const byId = new Map(), slots = new Map();
    for (const event of objects) {
      if (!await verifyEnvelope(event, policy.keys)) return out('INVALID', 'Hash, signature, schema, or pinned author key failed.');
      stats.checked++;
      if (event.body.contract !== policy.contract) return out('INVALID', 'Object belongs to a different contract.');
      const slot = canonical([event.body.author, event.body.journal, event.body.seq]);
      if (slots.has(slot) && slots.get(slot) !== event.eventId) return out('CONFLICT', 'Two valid signatures commit different events at the same journal position.');
      slots.set(slot, event.eventId); byId.set(event.eventId, event);
    }
    const visited = new Set();
    const walk = (id, depth) => {
      if (depth > (policy.maxDepth ?? 64)) throw Error('INCOMPLETE:Dependency depth exceeds the requester’s budget.');
      if (visited.has(id)) return;
      const event = byId.get(id);
      if (!event) throw Error('INCOMPLETE:A required root, dependency, or journal predecessor is missing.');
      visited.add(id);
      const b = event.body;
      if (b.seq === 0 && b.prev !== null) throw Error('INVALID:Journal origin has an invalid predecessor.');
      if (b.seq > 0) {
        const prior = byId.get(b.prev);
        if (!prior) throw Error('INCOMPLETE:A required journal predecessor is missing.');
        if (prior.body.author !== b.author || prior.body.journal !== b.journal || prior.body.seq !== b.seq - 1) {
          throw Error('INVALID:Journal sequence does not follow its predecessor.');
        }
        walk(b.prev, depth + 1);
      }
      for (const dependency of b.dependsOn) walk(dependency, depth + 1);
    };
    for (const root of policy.roots) walk(root, 0);
    return out('SUPPORTED_AS_OF', 'Required signed objects and their declared dependencies are present. Service correctness is checked separately.');
  } catch (error) {
    const [code, ...reason] = error.message.split(':');
    return out(['INVALID','INCOMPLETE'].includes(code) ? code : 'INVALID', reason.join(':') || 'Malformed evidence.');
  }
}
// One live in-memory authority. Synchronous state mutation is the serialization point.
// No claim of crash durability, distributed consensus, or protection against a dishonest issuer.
export class Authority {
  constructor(capacity, scope = 'trial-pool') {
    if (!Number.isSafeInteger(capacity) || capacity < 0) throw Error('Invalid capacity');
    this.capacity = capacity; this.scope = scope; this.used = 0; this.entries = new Map();
  }
  async reserve(request) {
    if (request.scope !== this.scope || !Number.isSafeInteger(request.units) || request.units <= 0 ||
        !request.id || !request.contract || !request.holder) return {status:'INVALID', reason:'Invalid scope, binding, or units.'};
    const existing = this.entries.get(request.id);
    if (existing) return canonical(existing.request) === canonical(request)
      ? {status:'REPLAY', certificate:existing, used:this.used}
      : {status:'CONFLICT', reason:'Reservation ID was reused for different terms.', used:this.used};
    if (this.used + request.units > this.capacity) return {status:'REJECTED', reason:'Scope has insufficient unallocated capacity.', used:this.used};
    this.used += request.units;
    const certificate = {request:clone(request), position:this.entries.size + 1};
    this.entries.set(request.id, certificate);
    return {status:'RESERVED', certificate, used:this.used};
  }
}
export function sponsorDecision({validService, requester, provider, registeredAsk}, operatorRegistry) {
  if (!validService) return {status:'REJECTED', reason:'The service did not meet its verification policy.'};
  if (!registeredAsk || !operatorRegistry[requester] || !operatorRegistry[provider] ||
      operatorRegistry[requester] === operatorRegistry[provider]) {
    return {status:'LOCAL_ONLY', reason:'Useful local work is allowed; this evidence does not establish independent sponsored demand.'};
  }
  return {status:'ELIGIBLE', reason:'Eligible under the lab’s pinned operator registry and registered-ask assumption; funding is still separately bounded.'};
}
export class FraudBounties {
  constructor(budget = 2) { this.budget = budget; this.paid = new Set(); }
  async report(pair, keys) {
    if (pair.length !== 2 || !await verifyEnvelope(pair[0], keys) || !await verifyEnvelope(pair[1], keys)) {
      return {status:'INVALID', reward:0, reason:'A claim without two valid signed conflicting events is not a proof.'};
    }
    const [a,b] = pair.map(e => e.body);
    if (a.author !== b.author || a.journal !== b.journal || a.seq !== b.seq || pair[0].eventId === pair[1].eventId) {
      return {status:'INVALID', reward:0, reason:'The supplied events do not prove same-position equivocation.'};
    }
    // Pay once per offending author/journal/position, not once per reporter or pair.
    const offense = canonical([a.author, a.journal, a.seq]);
    if (this.paid.has(offense)) return {status:'DUPLICATE', reward:0, reason:'This offense has already been rewarded.'};
    if (!this.budget) return {status:'UNFUNDED', reward:0, reason:'Valid evidence retained; bounty budget exhausted.'};
    this.paid.add(offense); this.budget--;
    return {status:'CORROBORATED', reward:1, reason:'Both pinned signatures verify and conflict at the same journal position.'};
  }
}
