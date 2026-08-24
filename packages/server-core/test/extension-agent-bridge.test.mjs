import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionAgentBroker } from "../dist/index.js";

const terminal = Object.freeze({ contextId:"context-1",serverId:"server-1",projectId:"project-1",projectEnvironmentId:"terminay.this-server",terminalSessionId:"terminal-1",terminalIncarnationId:"1",providerId:"example.agent/test" });
const request = Object.freeze({ extensionId:"example.agent",providerId:"example.agent/test",terminal,publicationId:"publication-1",mappingVersion:"1",events:[] });

test("publication queue coalesces concurrent idempotent retries and caches acknowledgements", async () => {
  let calls=0; let release; const service={ async ingestExtensionLifecycle(){calls++;await new Promise((resolve)=>{release=resolve;});return {acceptedEventCount:0,rejectedEventCount:0};}, releaseExtensionProvider(){} };
  const broker=createExtensionAgentBroker(service,{acknowledgementDeadlineMs:1000});
  const one=broker.publish(request,new AbortController().signal); const two=broker.publish(request,new AbortController().signal);
  await new Promise((resolve)=>setImmediate(resolve)); assert.equal(calls,1); release();
  assert.deepEqual(await one,await two); assert.equal(calls,1);
  assert.deepEqual(await broker.publish(request,new AbortController().signal),await one); assert.equal(calls,1);
});

test("cancelled and timed-out queued publications never call the canonical store", async () => {
  let calls=0; let release; const service={ async ingestExtensionLifecycle(){calls++;await new Promise((resolve)=>{release=resolve;});return {acceptedEventCount:0,rejectedEventCount:0};}, releaseExtensionProvider(){} };
  const broker=createExtensionAgentBroker(service,{acknowledgementDeadlineMs:20});
  const first=broker.publish({...request,publicationId:"one"},new AbortController().signal);
  const controller=new AbortController(); const second=broker.publish({...request,publicationId:"two"},controller.signal); controller.abort();
  assert.match((await second).failure,/cancelled/); assert.equal(calls,1); release(); await first;
});

test("host retirement is forwarded once to the runtime context callback",()=>{
  const retired=[];let releases=0;const broker=createExtensionAgentBroker({releaseExtensionProvider(){releases++;},async ingestExtensionLifecycle(){throw new Error("unused");}},{onTerminalCancelled:(contextId,providerId)=>retired.push([contextId,providerId])});
  broker.terminalCancelled({extensionId:"example.agent",providerId:terminal.providerId,terminal,reason:"extension-stopped"});
  broker.terminalCancelled({extensionId:"example.agent",providerId:terminal.providerId,terminal,reason:"extension-stopped"});
  assert.equal(releases,1);assert.deepEqual(retired,[[terminal.contextId,terminal.providerId]]);
});

test("bounded queue rejects excess publications without calling the store",async()=>{
  let calls=0;let release;const service={async ingestExtensionLifecycle(){calls++;await new Promise((resolve)=>{release=resolve;});return {acceptedEventCount:0,rejectedEventCount:0};},releaseExtensionProvider(){}};
  const broker=createExtensionAgentBroker(service,{maximumQueuedPublications:1,acknowledgementDeadlineMs:1000});
  const first=broker.publish({...request,publicationId:"first"},new AbortController().signal);await new Promise((resolve)=>setImmediate(resolve));
  const excess=await broker.publish({...request,publicationId:"excess"},new AbortController().signal);
  assert.match(excess.failure,/queue is full/);assert.equal(calls,1);release();await first;
});

test("a queued publication reaches its deadline while the prior child publication remains stalled",async()=>{
  let calls=0;const service={async ingestExtensionLifecycle(){calls++;return new Promise(()=>{});},releaseExtensionProvider(){}};
  const broker=createExtensionAgentBroker(service,{maximumQueuedPublications:2,acknowledgementDeadlineMs:10});
  const first=broker.publish({...request,publicationId:"stalled"},new AbortController().signal);
  const second=broker.publish({...request,publicationId:"waiting"},new AbortController().signal);
  assert.match((await second).failure,/timed out/);assert.match((await first).failure,/timed out/);assert.equal(calls,1);
});

test("a late retry after retirement is rejected without reaching the canonical store",async()=>{
  let calls=0;const service={async ingestExtensionLifecycle(){calls++;return {acceptedEventCount:0,rejectedEventCount:0};},releaseExtensionProvider(){}};
  const broker=createExtensionAgentBroker(service);broker.terminalCancelled({extensionId:"example.agent",providerId:terminal.providerId,terminal,reason:"extension-stopped"});
  const result=await broker.publish({...request,events:[{kind:"session.started"}]},new AbortController().signal);
  assert.match(result.failure,/scope is retired/);assert.equal(result.acceptedEventCount,0);assert.equal(result.rejectedEventCount,1);assert.equal(calls,0);
});
