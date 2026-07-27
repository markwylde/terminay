import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_HOOK_PATH,
  AGENT_HOOK_PROJECT_HEADER,
  AGENT_HOOK_SERVER_HEADER,
  AGENT_HOOK_SESSION_HEADER,
  AGENT_HOOK_TOKEN_HEADER,
  TERMINAY_AGENT_HOOK_ENDPOINT_ENV,
  TERMINAY_AGENT_HOOK_TOKEN_ENV,
  TERMINAY_SESSION_ID_ENV,
  TerminalActivityService,
  createAgentHookEnvironment,
  createAgentHookReceiver,
} from "../dist/activity/index.js";

const identity = (projectId = "project-a", sessionId = "session-a") => ({
  serverId: "server-a",
  projectId,
  sessionId,
});

function request(lease, body, overrides = {}) {
  const headers = {
    [AGENT_HOOK_TOKEN_HEADER]: lease.token,
    [AGENT_HOOK_SESSION_HEADER]: lease.sessionId,
    [AGENT_HOOK_PROJECT_HEADER]: lease.projectId,
    [AGENT_HOOK_SERVER_HEADER]: lease.serverId,
    "x-terminay-agent-provider": "codex",
    ...overrides.headers,
};

  return {
    method: "POST",
    path: AGENT_HOOK_PATH,
    remoteAddress: "127.0.0.1",
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(body),
    ...overrides,
    headers,
  };
}

test("agent hook environment is exact-scope, bounded, and rejects control characters", () => {
  assert.deepEqual(createAgentHookEnvironment("session-a", "http://127.0.0.1:1/v1/agent-events", "hook-token"), {
    [TERMINAY_SESSION_ID_ENV]: "session-a",
    [TERMINAY_AGENT_HOOK_ENDPOINT_ENV]: "http://127.0.0.1:1/v1/agent-events",
    [TERMINAY_AGENT_HOOK_TOKEN_ENV]: "hook-token",
  });
  assert.throws(() => createAgentHookEnvironment("session\n", "endpoint", "token"), /valid TERMINAY_SESSION_ID/);
});

test("loopback hook receiver authenticates exact session scope and publishes canonical fields only", async () => {
  const now = 100;
  let captured;
  const service = new TerminalActivityService({ serverId: "server-a", now: () => now });
  const receiver = createAgentHookReceiver({
    service,
    now: () => now,
    tokenFactory: () => "hook-token-a",
    normalize(payload, context) {
      captured = { payload, context };
      return {
        provider: context.provider,
        state: payload.state,
        sequence: payload.sequence,
        agentId: payload.agentId,
      };
    },
  });
  const lease = receiver.register(identity());
  const result = await receiver.handle(request(lease, {
    state: "working",
    sequence: 1,
    agentId: "agent-a",
    rawProviderSecret: "must-not-reach-snapshots",
  }));
  assert.equal(result.statusCode, 202);
  assert.equal(result.body.accepted, true);
  assert.equal(result.body.revision, 1);
  assert.equal(captured.payload.rawProviderSecret, "must-not-reach-snapshots");
  assert.deepEqual(captured.context.identity, identity());
  const snapshot = service.snapshot();
  assert.equal(snapshot.sessions["session-a"].providerState, "working");
  assert.equal(snapshot.sessions["session-a"].source, "hook:codex");
  assert.doesNotMatch(JSON.stringify(snapshot), /must-not-reach-snapshots/);
  assert.doesNotMatch(JSON.stringify(snapshot), /rawProviderSecret/);

  const wrongProject = await receiver.handle(request(lease, { state: "waiting", sequence: 2, agentId: "agent-a" }, {
    headers: { [AGENT_HOOK_PROJECT_HEADER]: "project-b" },
  }));
  assert.equal(wrongProject.statusCode, 403);
  assert.equal(service.revision, 1);

  const wrongToken = await receiver.handle(request({ ...lease, token: "copied-token" }, { state: "waiting", sequence: 2, agentId: "agent-a" }));
  assert.equal(wrongToken.statusCode, 401);
  assert.equal(service.revision, 1);

  const wrongSession = await receiver.handle(request(lease, { state: "waiting", sequence: 2, agentId: "agent-a" }, {
    headers: { [AGENT_HOOK_SESSION_HEADER]: "session-other" },
  }));
  assert.equal(wrongSession.statusCode, 401);
  assert.equal(service.revision, 1);
});

test("hook receiver bounds, validates, and fences malformed or reordered events", async () => {
  let now = 100;
  const service = new TerminalActivityService({ serverId: "server-a", now: () => now });
  const receiver = createAgentHookReceiver({
    service,
    now: () => now,
    maxBodyBytes: 128,
    tokenTtlMs: 1,
    tokenFactory: () => "hook-token-b",
  });
  const lease = receiver.register(identity());
  const first = await receiver.handle(request(lease, { state: "working", sequence: 4, agentId: "agent-a" }));
  assert.equal(first.statusCode, 202);
  assert.equal(service.revision, 1);

  const stale = await receiver.handle(request(lease, { state: "waiting", sequence: 3, agentId: "agent-a" }));
  assert.equal(stale.statusCode, 202);
  assert.equal(stale.body.ignored, true);
  assert.equal(service.revision, 1);
  assert.equal(service.snapshot().sessions["session-a"].providerState, "working");

  const missingSequence = await receiver.handle(request(lease, { state: "waiting", agentId: "agent-a" }));
  assert.equal(missingSequence.statusCode, 422);
  assert.equal(service.revision, 1);

  const oversized = await receiver.handle(request(lease, { state: "waiting", sequence: 5, agentId: "agent-a", padding: "x".repeat(200) }));
  assert.equal(oversized.statusCode, 413);
  const malformed = await receiver.handle(request(lease, "not-json"));
  assert.equal(malformed.statusCode, 400);
  const wrongContentType = await receiver.handle({ ...request(lease, { state: "waiting", sequence: 5, agentId: "agent-a" }), contentType: "text/plain" });
  assert.equal(wrongContentType.statusCode, 415);
  const remote = await receiver.handle({ ...request(lease, { state: "waiting", sequence: 5, agentId: "agent-a" }), remoteAddress: "192.0.2.10" });
  assert.equal(remote.statusCode, 403);
  assert.equal(service.revision, 1);

  now = 101;
  const expired = await receiver.handle(request(lease, { state: "waiting", sequence: 5, agentId: "agent-a" }));
  assert.equal(expired.statusCode, 401);
});

test("receiver binds a real HTTP endpoint to loopback and revokes exited sessions", async () => {
  const service = new TerminalActivityService({ serverId: "server-a" });
  const receiver = createAgentHookReceiver({ service, tokenFactory: () => "hook-token-c" });
  const lease = receiver.register(identity());
  await receiver.start();
  try {
    const response = await fetch(receiver.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [AGENT_HOOK_TOKEN_HEADER]: lease.token,
        [AGENT_HOOK_SESSION_HEADER]: lease.sessionId,
        "x-terminay-agent-provider": "claude-code",
      },
      body: JSON.stringify({ state: "waiting", sequence: 1, agentId: "agent-c" }),
    });
    assert.equal(response.status, 202);
    assert.equal((await response.json()).accepted, true);
    assert.equal(service.snapshot().sessions["session-a"].provider, "claude-code");
  } finally {
    assert.equal(receiver.revoke(identity()), true);
    const revoked = await receiver.handle(request(lease, { state: "done", sequence: 2, agentId: "agent-c" }));
    assert.equal(revoked.statusCode, 401);
    await receiver.stop();
  }
});

test("missing hooks recover, terminal exit is scoped, and a restarted receiver requires a new lease", async () => {
  let now = 100;
  let hooksAvailable = false;
  let tokenCounter = 0;
  const service = new TerminalActivityService({ serverId: "server-a", now: () => now });
  const receiver = createAgentHookReceiver({
    service,
    now: () => now,
    tokenFactory: () => `hook-token-recovery-${++tokenCounter}`,
    normalize(payload, context) {
      if (!hooksAvailable) return null;
      return { provider: context.provider, state: payload.state, sequence: payload.sequence, agentId: payload.agentId };
    },
  });
  const first = receiver.register(identity("project-a", "session-a"));
  const second = receiver.register(identity("project-a", "session-b"));
  service.ingestPtyOutput(identity("project-a", "session-a"), "unmanaged shell output");
  const missing = await receiver.handle(request(first, { state: "working", sequence: 1, agentId: "agent-a" }));
  assert.equal(missing.statusCode, 202);
  assert.equal(missing.body.ignored, true);
  assert.equal(service.get(identity("project-a", "session-a"))?.provider, undefined);

  hooksAvailable = true;
  const recovered = await receiver.handle(request(first, { state: "working", sequence: 2, agentId: "agent-a" }));
  assert.equal(recovered.statusCode, 202);
  assert.equal(service.get(identity("project-a", "session-a"))?.provider, "codex");
  service.ingestProvider(identity("project-a", "session-b"), { provider: "claude-code", state: "waiting", sequence: 1, agentId: "agent-b" });

  assert.equal(receiver.revoke(identity("project-a", "session-a")), true);
  assert.equal(service.get(identity("project-a", "session-a")), undefined);
  assert.equal(service.get(identity("project-a", "session-b"))?.provider, "claude-code");
  assert.equal((await receiver.handle(request(first, { state: "done", sequence: 3, agentId: "agent-a" }))).statusCode, 401);
  await receiver.stop();

  const restartedService = new TerminalActivityService({ serverId: "server-a", now: () => now });
  const restarted = createAgentHookReceiver({ service: restartedService, now: () => now, tokenFactory: () => "hook-token-recovery-b" });
  assert.equal((await restarted.handle(request(first, { state: "working", sequence: 4, agentId: "agent-a" }))).statusCode, 401);
  const replacement = restarted.register(identity("project-a", "session-c"));
  assert.equal((await restarted.handle(request(replacement, { state: "working", sequence: 1, agentId: "agent-c" }))).statusCode, 202);
  assert.equal(restartedService.get(identity("project-a", "session-c"))?.provider, "codex");
  await restarted.stop();
  void second;
});
