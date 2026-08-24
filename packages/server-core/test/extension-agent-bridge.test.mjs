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
