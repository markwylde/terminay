import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExtensionProviderVault, ServerVaultService } from "../dist/index.js";

function service() {
  const values=new Map();
  return new ServerVaultService({backend:"custom",status:()=>"unlocked",unlock:async()=>{},lock(){},list:()=>[...values.keys()].map(id=>({id,configured:true})),async put({id,value}){if(values.has(id))throw Error("exists");values.set(id,new Uint8Array(value));return{id,configured:true};},async replace({id,value}){if(!values.has(id))throw Error("missing");values.set(id,new Uint8Array(value));return{id,configured:true};},async test(id){if(!values.has(id))throw Error("missing");},async remove(id){return values.delete(id);},async rotate(){},async withSecret(id,use){const value=values.get(id);if(!value)throw Error("missing");const copy=new Uint8Array(value);try{return await use(copy);}finally{copy.fill(0);}}});
}

async function principal(extensionId="example.target",providerId="example.target/main") { return {extensionId,providerId,dataDirectory:await mkdtemp(join(tmpdir(),"terminay-provider-vault-"))}; }

test("private provider vault is idempotent, revisioned, opaque, and installation scoped",async()=>{
  const vault=new ExtensionProviderVault(service()); const owner=await principal(); const signal=new AbortController().signal;
  const source=new Uint8Array([1,2,3]); const first=await vault.put(owner,{bindingKey:"primary",purpose:"authentication",value:source,idempotencyKey:"put-1"},signal);
  assert.deepEqual(source,new Uint8Array([0,0,0])); assert.match(first.binding.bindingRef,/^pvb_/);
  const replay=await vault.put(owner,{bindingKey:"primary",purpose:"authentication",value:new Uint8Array([9]),idempotencyKey:"put-1"},signal); assert.deepEqual(replay,first);
  await assert.rejects(vault.put(owner,{bindingKey:"primary",purpose:"authentication",value:new Uint8Array([4]),idempotencyKey:"put-2",expectedRevision:99},signal),/revision conflict/);
  assert.equal(await vault.withSecret(owner,{binding:first.binding,purpose:"authentication"},signal,bytes=>bytes.join(",")),"1,2,3");
  await assert.rejects(vault.withSecret({...owner,providerId:"example.target/other"},{binding:first.binding,purpose:"authentication"},signal,()=>null),/unavailable/);
});

test("pending removal denies new leases and cleanup completes interrupted target work",async()=>{
  const vault=new ExtensionProviderVault(service()); const owner=await principal(); const signal=new AbortController().signal;
  const stored=await vault.put(owner,{bindingKey:"primary",purpose:"authentication",value:new Uint8Array([7]),idempotencyKey:"put-1"},signal);
  let release; const active=vault.withSecret(owner,{binding:stored.binding,purpose:"authentication"},signal,()=>new Promise(resolve=>{release=resolve;}));
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(await vault.remove(owner,{binding:stored.binding,idempotencyKey:"remove-1",expectedRevision:stored.revision},signal),{state:"pending"});
  await assert.rejects(vault.withSecret(owner,{binding:stored.binding,purpose:"authentication"},signal,()=>null),/unavailable/);
  release(); await active; await assert.rejects(vault.withSecret(owner,{binding:stored.binding,purpose:"authentication"},signal,()=>null),/unavailable/);
  await vault.cleanup(owner);
});
