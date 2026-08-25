import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { observeCodexJournal } from "../dist/agentJournal.js";
import { readProvenCodexJournal } from "../dist/targetHelper.js";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

class Channel extends EventEmitter {
  stderr=new EventEmitter(); written="";
  constructor(response){super();this.response=response;}
  write(data){this.written+=data;return true;}
  end(){const request=JSON.parse(this.written);const response=typeof this.response==="function"?this.response(request):this.response;queueMicrotask(()=>{if(response!==undefined)this.emit("data",JSON.stringify(response));this.emit("close",0);});}
}
function client(response){return{exec(command,callback){assert.equal(command,"terminay-target-helper agent-journal-v1");callback(null,new Channel(response));}};}
const request={sessionId:"session-1",proof:"a".repeat(43),cursor:0,maxRecords:32,maxBytes:262144};

test("Codex helper response requires exact session proof and remains bounded",async()=>{
  const result=await observeCodexJournal(client((input)=>({protocol:1,provider:"codex",sessionId:input.sessionId,proof:input.proof,cursor:1,records:[{type:"session_meta",payload:{id:"remote"}}]})),request);
  assert.equal(result.sessionId,"session-1");assert.equal(result.cursor,1);assert.equal(result.records.length,1);
});

test("forged cross-session helper evidence fails closed",async()=>{
  await assert.rejects(observeCodexJournal(client((input)=>({protocol:1,provider:"codex",sessionId:"other",proof:input.proof,cursor:1,records:[]})),request),/prove the exact terminal/u);
  await assert.rejects(observeCodexJournal(client((input)=>({protocol:1,provider:"codex",sessionId:input.sessionId,proof:"b".repeat(43),cursor:1,records:[]})),request),/prove the exact terminal/u);
});

test("missing or incompatible helper is an explicit unavailable state",async()=>{
  const unavailable={exec(_command,callback){const channel=new Channel(undefined);channel.end=()=>queueMicrotask(()=>channel.emit("close",127));callback(null,channel);}};
  await assert.rejects(observeCodexJournal(unavailable,request),/unavailable/u);
});

test("raw helper responses are rejected above the privacy boundary bound",async()=>{
  const oversized={exec(_command,callback){const channel=new Channel(undefined);channel.end=()=>queueMicrotask(()=>{channel.emit("data","x".repeat(262145));channel.emit("close",0);});callback(null,channel);}};
  await assert.rejects(observeCodexJournal(oversized,request),/exceeded/u);
});

test("bundled target helper reads only an exact proof-bearing writable Codex root journal",async()=>{
  const root=await mkdtemp(join(tmpdir(),"terminay-target-helper-"));const home=join(root,"home");const proc=join(root,"proc");const sessions=join(home,".codex","sessions");const pid=join(proc,"123");
  await mkdir(join(pid,"fd"),{recursive:true});await mkdir(join(pid,"fdinfo"),{recursive:true});await mkdir(sessions,{recursive:true});
  const journal=join(sessions,"rollout.jsonl");await writeFile(journal,[JSON.stringify({type:"session_meta",payload:{id:"remote-root"}}),JSON.stringify({type:"event_msg",payload:{type:"task_started"}}),""].join("\n"));
  await writeFile(join(pid,"environ"),`PATH=/bin\0TERMINAY_SESSION_PROOF=${request.proof}\0`);await writeFile(join(pid,"fdinfo","9"),"flags:\t0100001\n");await symlink(journal,join(pid,"fd","9"));
  const helperRequest={protocol:1,provider:"codex",...request};const result=await readProvenCodexJournal(helperRequest,{procRoot:proc,home});assert.equal(result.sessionId,request.sessionId);assert.equal(result.state,undefined);assert.equal(result.records.length,2);assert.ok(result.cursor>0);
  const forged=await readProvenCodexJournal({...helperRequest,proof:"z".repeat(43)},{procRoot:proc,home});assert.equal(forged.state,"unavailable");assert.deepEqual(forged.records,[]);
});
