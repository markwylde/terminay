import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionAgentObservationRouter } from "../dist/index.js";

const remote={contextId:"context-1",serverId:"server-1",projectId:"project-1",projectEnvironmentId:"remote-1",terminalSessionId:"terminal-1",terminalIncarnationId:"7",providerId:"example.agent/test"};
const binding={serverId:"server-1",projectId:"project-1",projectEnvironmentId:"remote-1",environmentRevision:3};

test("remote observation uses its immutable routed capability and never local APIs",async()=>{
  let local=0; const calls=[];
  const observe=createExtensionAgentObservationRouter({bindingFor:()=>binding,local:{async observe(){local++;return null;}},router:{async invokeBound(...args){calls.push(args);return {handle:{id:"opaque"}};}}});
  assert.deepEqual(await observe({terminal:remote,operation:"process.descendants",payload:{}},new AbortController().signal),{handle:{id:"opaque"}});
  assert.equal(local,0); assert.strictEqual(calls[0][0],binding); assert.equal(calls[0][1],"process-observation");
  assert.equal(calls[0][3].terminal.terminalIncarnationId,"7");
});

test("missing and stale remote bindings fail explicitly without local fallback",async()=>{
  let local=0; let routed=0; const base={local:{async observe(){local++;return null;}},router:{async invokeBound(){routed++;return null;}}};
  await assert.rejects(createExtensionAgentObservationRouter({...base,bindingFor:()=>undefined})({terminal:remote,operation:"filesystem.read",payload:{}},new AbortController().signal),/binding is unavailable/);
  await assert.rejects(createExtensionAgentObservationRouter({...base,bindingFor:()=>({...binding,environmentRevision:4,projectEnvironmentId:"wrong"})})({terminal:remote,operation:"filesystem.read",payload:{}},new AbortController().signal),/binding is unavailable/);
  assert.equal(local,0);assert.equal(routed,0);
});
