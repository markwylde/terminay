import assert from "node:assert/strict";
import test from "node:test";
import { AgentStatusService, TerminalActivityService } from "../dist/index.js";

const identity = Object.freeze({ serverId: "server-1", projectId: "project-1", sessionId: "terminal-1" });
const providerId = "example.agent/test";
const binding = Object.freeze({ providerSessionId: "provider-session-1", mappingVersion: "1", fingerprint: { kind: "test", process: { id: "process-1" }, metadata: { proof: "fixture" } } });

async function fixture() {
  const activity = new TerminalActivityService({ serverId: identity.serverId });
  activity.register(identity);
  const agents = new AgentStatusService({ activity, now: () => 1_000 });
  await agents.start(); agents.register(identity);
  assert.equal(agents.claimExtensionProvider(identity, providerId), true);
  return { agents };
}

test("agent status service projects only claimed extension lifecycle DTOs", async () => {
  const { agents } = await fixture();
  const result = await agents.ingestExtensionLifecycle(identity, providerId, "1", binding, [
    { kind: "session.started", title: "Provider session", model: { id: "model-1", displayName: "Model One" } },
    { kind: "turn.started", turnId: "turn-1", promptText: "A bounded prompt" },
    { kind: "wait.started", waitId: "wait-1", state: "waiting", reason: "approval" },
  ]);
  assert.deepEqual(result, { acceptedEventCount: 3, rejectedEventCount: 0 });
  const [entry] = Object.values(agents.getSnapshot().entries);
  assert.equal(entry.provider, providerId);
  assert.equal(entry.displayName, "Provider session");
  assert.equal(entry.promptText, "A bounded prompt");
  assert.equal(entry.state, "waiting");
  assert.equal(entry.model.id, "model-1");
  await agents.stop();
});

test("agent status service rejects unclaimed, invalid, and native-record input", async () => {
  const { agents } = await fixture();
  assert.equal(await agents.ingestJournalRecord(identity, providerId, { arbitrary: true }), false);
  assert.deepEqual(
    await agents.ingestExtensionLifecycle(identity, "example.agent/other", "1", binding, [{ kind: "session.started" }]),
    { acceptedEventCount: 0, rejectedEventCount: 1, failure: "extension agent provider does not own this terminal session" },
  );
  assert.deepEqual(
    await agents.ingestExtensionLifecycle(identity, providerId, "1", binding, [{ kind: "not-an-event" }]),
    { acceptedEventCount: 0, rejectedEventCount: 1, failure: "extension lifecycle event is invalid" },
  );
  await agents.stop();
});

test("provider release retires only its exact terminal lifecycle run", async () => {
  const { agents } = await fixture();
  await agents.ingestExtensionLifecycle(identity, providerId, "1", binding, [{ kind: "session.started" }]);
  assert.equal(agents.releaseExtensionProvider(identity, providerId), true);
  const [entry] = Object.values(agents.getSnapshot().entries);
  assert.equal(entry.active, false);
  assert.equal(entry.lastEventKind, "session.stopped");
  await agents.stop();
});

test("lifecycle publications reject invalid transitions atomically with sequence state unchanged", async () => {
  const { agents } = await fixture();
  const before = agents.getSnapshot();
  const rejected = await agents.ingestExtensionLifecycle(identity, providerId, "1", binding, [
    { kind: "session.started" },
    { kind: "tool.finished", toolId: "missing" },
  ]);
  assert.match(rejected.failure, /transition/);
  assert.strictEqual(agents.getSnapshot(), before);
  const accepted = await agents.ingestExtensionLifecycle(identity, providerId, "1", binding, [
    { kind: "session.started" }, { kind: "turn.started", turnId: "turn-1" }, { kind: "tool.started", toolId: "tool-1", name: "shell" },
  ]);
  assert.deepEqual(accepted, { acceptedEventCount: 3, rejectedEventCount: 0 });
  const [entry] = Object.values(agents.getSnapshot().entries);
  assert.equal(entry.lastEventSequence, 3);
  const revision = agents.getSnapshot().revision;
  for (const events of [
    [{ kind: "session.started" }],
    [{ kind: "tool.started", toolId: "tool-1", name: "duplicate" }],
    [{ kind: "tool.finished", toolId: "wrong" }],
    [{ kind: "wait.finished" }],
    [{ kind: "subagent.done", subagentId: "unknown", outcome: "success" }],
  ]) {
    const result = await agents.ingestExtensionLifecycle(identity, providerId, "1", undefined, events);
    assert.match(result.failure, /(transition|event is invalid)/);
    assert.equal(agents.getSnapshot().revision, revision);
  }
  await agents.stop();
});

test("publication bounds and retirement reject late events without touching unrelated providers",async()=>{
  const activity=new TerminalActivityService({serverId:identity.serverId});const other={...identity,sessionId:"terminal-2"};activity.register(identity);activity.register(other);
  const agents=new AgentStatusService({activity,now:()=>1000});await agents.start();agents.register(identity);agents.register(other);
  const otherProvider="example.other/test";agents.claimExtensionProvider(identity,providerId);agents.claimExtensionProvider(other,otherProvider);
  const otherBinding={...binding,providerSessionId:"other-session"};
  await agents.ingestExtensionLifecycle(identity,providerId,"1",binding,[{kind:"session.started"}]);
  await agents.ingestExtensionLifecycle(other,otherProvider,"1",otherBinding,[{kind:"session.started",title:"Healthy"}]);
  const before=agents.getSnapshot();const oversized=await agents.ingestExtensionLifecycle(identity,providerId,"1",undefined,Array.from({length:65},(_,index)=>({kind:"turn.started",turnId:`turn-${index}`})));
  assert.match(oversized.failure,/publication is invalid/);assert.strictEqual(agents.getSnapshot(),before);
  assert.equal(agents.releaseExtensionProvider(identity,providerId),true);const retired=agents.getSnapshot();
  const late=await agents.ingestExtensionLifecycle(identity,providerId,"1",undefined,[{kind:"turn.started",turnId:"late"}]);assert.match(late.failure,/does not own/);assert.strictEqual(agents.getSnapshot(),retired);
  const healthy=Object.values(agents.getSnapshot().entries).find((entry)=>entry.provider===otherProvider);assert.equal(healthy.active,true);assert.equal(healthy.displayName,"Healthy");await agents.stop();
});
