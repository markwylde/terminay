import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_OPERATIONS,
  AgentStatusService,
  OrderedEventJournal,
  TerminalActivityService,
  createAgentOperationRegistry,
  createAgentEventProjector,
  createAgentDriverRegistry,
} from "../dist/index.js";

const identity = Object.freeze({ serverId: "server-a", projectId: "project-a", sessionId: "session-a" });
const context = Object.freeze({ connectionId: "connection-a", clientId: "client-a", authScope: "admin", signal: new AbortController().signal });
const query = (operation, payload = {}) => ({ envelope: { operation, payload }, body: new Uint8Array(), context });
const command = (operation, payload, claims) => ({ envelope: { operation, commandId: "command-a", correlationId: "correlation-a", payload }, body: new Uint8Array(), context: claims === undefined ? context : { ...context, claims } });

test("agent protocol exposes only reduced snapshots, publishes ordered changes, and scopes acknowledgement", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId, now: () => 100 });
  const agents = new AgentStatusService({
    activity,
    now: () => 100,
    receiver: { tokenFactory: () => "private-hook-token" },
  });
  const journal = new OrderedEventJournal();
  await agents.start();
  const registry = createAgentOperationRegistry({ service: agents, eventJournal: journal });
  try {
    agents.register(identity);
    await agents.ingestHookPayload(identity, "codex", {
      hook_event_name: "SessionStart",
      session_id: "codex-session",
      rawProviderSecret: "must-not-leak",
    });
    await agents.ingestHookPayload(identity, "codex", {
      hook_event_name: "PermissionRequest",
      session_id: "codex-session",
      reason: "approve command",
    });

    const snapshot = registry.operations.queries[AGENT_OPERATIONS.snapshot](query(AGENT_OPERATIONS.snapshot));
    assert.equal(snapshot.cursor, String(snapshot.revision));
    const entry = Object.values(snapshot.entries)[0];
    assert.equal(entry.activationTerminalSessionId, identity.sessionId);
    assert.doesNotMatch(JSON.stringify(snapshot), /private-hook-token|rawProviderSecret/);
    assert.equal(journal.replay(0).events.at(-1).event, AGENT_OPERATIONS.event);

    const acknowledged = registry.operations.commands[AGENT_OPERATIONS.acknowledge](command(
      AGENT_OPERATIONS.acknowledge,
      { projectId: identity.projectId, sessionId: identity.sessionId, entryId: entry.entryId },
    ));
    assert.equal(acknowledged.acknowledged, true);
    assert.equal(agents.getSnapshot().entries[entry.entryId].unread, false);
    assert.throws(
      () => registry.operations.commands[AGENT_OPERATIONS.acknowledge](command(
        AGENT_OPERATIONS.acknowledge,
        { projectId: identity.projectId, sessionId: identity.sessionId, entryId: entry.entryId },
        { projectId: "project-b" },
      )),
      (error) => error?.code === "forbidden",
    );
  } finally {
    registry.close();
    await agents.stop();
  }
});

test("project claims receive only their canonical agent entries in snapshots and journal projection", async () => {
  const activity = new TerminalActivityService({ serverId: "scope-server", now: () => 100 });
  let tokenCounter = 0;
  const agents = new AgentStatusService({ activity, now: () => 100, receiver: { tokenFactory: () => `scope-token-${++tokenCounter}` } });
  const journal = new OrderedEventJournal();
  await agents.start();
  const registry = createAgentOperationRegistry({ service: agents, eventJournal: journal });
  const projectA = { serverId: "scope-server", projectId: "project-a", sessionId: "session-a" };
  const projectB = { serverId: "scope-server", projectId: "project-b", sessionId: "session-b" };
  try {
    agents.register(projectA);
    agents.register(projectB);
    await agents.ingestHookPayload(projectA, "codex", { hook_event_name: "SessionStart", session_id: "codex-a" });
    await agents.ingestHookPayload(projectB, "codex", { hook_event_name: "SessionStart", session_id: "codex-b" });
    const scopedContext = { ...context, claims: { projectId: "project-a" } };
    const scoped = registry.operations.queries[AGENT_OPERATIONS.snapshot]({ envelope: { operation: AGENT_OPERATIONS.snapshot, payload: {} }, body: new Uint8Array(), context: scopedContext });
    assert.equal(Object.values(scoped.entries).length, 1);
    assert.equal(Object.values(scoped.entries)[0].activationTerminalSessionId, "session-a");
    const event = journal.replay(0).events.at(-1);
    const projected = createAgentEventProjector(agents)(event, { clientId: "project-a-client", authScope: "read", claims: { projectId: "project-a" } });
    assert.ok(projected);
    assert.equal(Object.values(projected.payload.entries).length, 1);
    assert.equal(Object.values(projected.payload.entries)[0].activationTerminalSessionId, "session-a");
  } finally {
    registry.close();
    await agents.stop();
  }
});

test("admin clients reconcile managed hooks through the composed server authority without client-selected paths", async () => {
  const activity = new TerminalActivityService({ serverId: "hook-command-server" });
  const calls = [];
  const registry = createAgentDriverRegistry([
    {
      provider: "codex",
      displayName: "Codex",
      hooks: {
        paths: () => ({ homeDir: "/server-home", configPath: "/server-home/.codex/hooks.json", scriptPath: "/server-home/hooks.sh" }),
        status: async () => ({ provider: "codex", state: "not-installed", configPath: "/server-home/.codex/hooks.json", scriptPath: "/server-home/hooks.sh", managedHooksPresent: false, installedEvents: [], missingEvents: [] }),
        install: async () => { calls.push("install"); return { provider: "codex", state: "installed", configPath: "/server-home/.codex/hooks.json", scriptPath: "/server-home/hooks.sh", managedHooksPresent: true, installedEvents: [], missingEvents: [] }; },
        uninstall: async () => ({ provider: "codex", state: "not-installed", configPath: "/server-home/.codex/hooks.json", scriptPath: "/server-home/hooks.sh", managedHooksPresent: false, installedEvents: [], missingEvents: [] }),
      },
      normalize: () => null,
    },
  ]);
  const agents = new AgentStatusService({ activity, driverRegistry: registry });
  const operations = createAgentOperationRegistry({ service: agents, eventJournal: new OrderedEventJournal() });
  const adminRequest = command(AGENT_OPERATIONS.reconcileHooks, { action: "install", provider: "codex", homeDir: "/attacker-controlled" });
  const result = await operations.operations.commands[AGENT_OPERATIONS.reconcileHooks](adminRequest);
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["install"]);
  assert.equal(operations.operations.policies[AGENT_OPERATIONS.reconcileHooks].scope, "admin");
  await assert.rejects(
    () => operations.operations.commands[AGENT_OPERATIONS.reconcileHooks](command(AGENT_OPERATIONS.reconcileHooks, { action: "install", provider: "unknown" })),
    (error) => error?.code === "validation",
  );
  operations.close();
});

test("a composed Codex provider runtime remains authoritative for asynchronous hook normalization", async () => {
  const calls = [];
  const registry = createAgentDriverRegistry([
    {
      provider: "codex",
      displayName: "Packed Codex",
      hooks: {
        paths: () => ({ homeDir: "/server-home", configPath: "/server-home/.codex/hooks.json", scriptPath: "/server-home/hooks.sh" }),
        status: async () => ({ provider: "codex", state: "not-installed", configPath: "/server-home/.codex/hooks.json", scriptPath: "/server-home/hooks.sh", managedHooksPresent: false, installedEvents: [], missingEvents: [] }),
        install: async () => ({ provider: "codex", state: "installed", configPath: "/server-home/.codex/hooks.json", scriptPath: "/server-home/hooks.sh", managedHooksPresent: true, installedEvents: [], missingEvents: [] }),
        uninstall: async () => ({ provider: "codex", state: "not-installed", configPath: "/server-home/.codex/hooks.json", scriptPath: "/server-home/hooks.sh", managedHooksPresent: false, installedEvents: [], missingEvents: [] }),
      },
      normalize: (payload, driverContext) => {
        calls.push(payload);
        return {
          provider: "codex",
          kind: "session.started",
          sessionId: "packed-provider-session",
          activationTerminalSessionId: driverContext.activationTerminalSessionId,
          sequence: driverContext.sequence,
          occurredAt: driverContext.occurredAt ?? 0,
          displayName: "Packed provider",
        };
      },
    },
  ]);

  const payload = Object.freeze({ hook_event_name: "ignored-by-custom-driver", transcript_path: "/not/read" });
  const event = await registry.normalizeAsync("codex", payload, {
    activationTerminalSessionId: "terminal-a",
    sequence: 7,
    occurredAt: 9,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0], payload);
  assert.deepEqual(event, {
    provider: "codex",
    kind: "session.started",
    sessionId: "packed-provider-session",
    activationTerminalSessionId: "terminal-a",
    sequence: 7,
    occurredAt: 9,
    displayName: "Packed provider",
  });
});
