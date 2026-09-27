import assert from "node:assert/strict";
import test from "node:test";
import { McpApprovalClient, TerminayClient, TerminayClientFacade } from "@terminay/client-core";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import { FEATURE_CAPABILITIES } from "@terminay/protocol";
import {
  DEFAULT_MCP_PERMISSIONS,
  MCP_APPROVAL_EVENTS,
  McpApprovalService,
  ServerSettingsRepository,
  createServerCoreComposition,
  mcpPermissionsFromSettings,
} from "../dist/index.js";

function request(overrides = {}) {
  return {
    terminalSessionId: "session-1",
    projectId: "project-1",
    operation: "create_automation",
    group: "automationsManage",
    agent: "Claude Code",
    terminalTitle: "Terminal 1",
    summary: 'add the automation "Digest"',
    details: [{ label: "Runs", value: "mail-digest", code: true }],
    signal: new AbortController().signal,
    ...overrides,
  };
}

function journal() {
  const events = [];
  return {
    events,
    revision: 0,
    cursor: "0",
    append(event, payload) { events.push({ event, payload }); return { revision: events.length, cursor: String(events.length), event, payload }; },
    publishTransient() {},
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("defaults keep terminal tools frictionless and ask before managing automations", () => {
  assert.deepEqual({ ...DEFAULT_MCP_PERMISSIONS }, {
    terminalsRead: "allow",
    terminalsManage: "allow",
    automationsRead: "allow",
    automationsManage: "ask",
  });
  assert.deepEqual({ ...mcpPermissionsFromSettings({ terminayMcp: { enabled: true } }) }, { ...DEFAULT_MCP_PERMISSIONS });
  assert.deepEqual(
    { ...mcpPermissionsFromSettings({ terminayMcp: { permissions: { terminalsManage: "deny", automationsManage: "sometimes" } } }) },
    { ...DEFAULT_MCP_PERMISSIONS, terminalsManage: "deny" },
  );
});

test("allow runs at once and Never Allow refuses without a prompt", async () => {
  const events = journal();
  const service = new McpApprovalService({ eventJournal: events, policies: { ...DEFAULT_MCP_PERMISSIONS, automationsRead: "deny" } });
  assert.deepEqual(await service.authorize(request({ group: "terminalsManage" })), { ok: true });
  const denied = await service.authorize(request({ group: "automationsRead" }));
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, "permission_denied");
  assert.match(denied.error.message, /Read Automations.*Settings > AI > Terminay MCP/);
  assert.equal(service.list().length, 0);
  assert.equal(events.events.length, 0);
});

test("ask waits for a decision with no time limit, and the first decision wins", async () => {
  const events = journal();
  const service = new McpApprovalService({ eventJournal: events });
  let settled;
  const pending = service.authorize(request()).then((outcome) => { settled = outcome; });
  await tick();
  const [approval] = service.list();
  assert.equal(approval.summary, 'add the automation "Digest"');
  assert.equal(approval.groupLabel, "Full Automation Management");
  assert.equal(settled, undefined);
  // Journal events carry ids only; details are fetched with authority.
  assert.deepEqual(events.events.at(-1), {
    event: MCP_APPROVAL_EVENTS.changed,
    payload: { approvals: [{ id: approval.id, terminalSessionId: "session-1" }] },
  });
  assert.equal(service.decide(approval.id, "once"), true);
  assert.equal(service.decide(approval.id, "decline"), false);
  await pending;
  assert.deepEqual(settled, { ok: true });
  assert.equal(service.list().length, 0);
  // Allow One Time grants nothing: the next call asks again.
  service.authorize(request());
  await tick();
  assert.equal(service.list().length, 1);
});

test("decline refuses with permission_declined", async () => {
  const service = new McpApprovalService();
  const pending = service.authorize(request());
  await tick();
  service.decide(service.list()[0].id, "decline");
  const outcome = await pending;
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error.code, "permission_declined");
});

test("Allow This Session covers only the requesting terminal and never Never Allow", async () => {
  const service = new McpApprovalService();
  const first = service.authorize(request());
  await tick();
  service.decide(service.list()[0].id, "session");
  assert.deepEqual(await first, { ok: true });
  assert.equal(service.effectivePolicy("automationsManage", "session-1"), "allow");
  assert.deepEqual(await service.authorize(request()), { ok: true });
  // Another terminal still asks.
  assert.equal(service.effectivePolicy("automationsManage", "session-2"), "ask");
  service.authorize(request({ terminalSessionId: "session-2" }));
  await tick();
  assert.equal(service.list().length, 1);
  // A policy change ends the grant, and Never Allow always wins.
  service.setPolicies({ ...DEFAULT_MCP_PERMISSIONS, automationsManage: "deny" });
  assert.equal(service.effectivePolicy("automationsManage", "session-1"), "deny");
  service.setPolicies({ ...DEFAULT_MCP_PERMISSIONS });
  assert.equal(service.effectivePolicy("automationsManage", "session-1"), "ask");
});

test("a session grant releases the terminal's other pending approvals in that group", async () => {
  const service = new McpApprovalService();
  const first = service.authorize(request());
  const second = service.authorize(request({ summary: "delete it" }));
  await tick();
  assert.equal(service.list().length, 2);
  service.decide(service.list()[0].id, "session");
  assert.deepEqual(await first, { ok: true });
  assert.deepEqual(await second, { ok: true });
  assert.equal(service.list().length, 0);
});

test("cancellation, revocation, and shutdown end approvals without running them", async () => {
  const service = new McpApprovalService();
  const controller = new AbortController();
  const cancelled = service.authorize(request({ signal: controller.signal }));
  const revoked = service.authorize(request({ terminalSessionId: "session-2" }));
  const stopped = service.authorize(request({ terminalSessionId: "session-3" }));
  await tick();
  assert.equal(service.list().length, 3);
  controller.abort();
  assert.equal((await cancelled).error.code, "cancelled");
  // A decision after cancellation finds nothing to approve.
  assert.equal(service.list().some((entry) => entry.terminalSessionId === "session-1"), false);
  service.decide(service.list()[0].id, "session");
  service.revokeTerminal("session-2");
  assert.equal(service.effectivePolicy("automationsManage", "session-2"), "ask");
  assert.deepEqual(await revoked, { ok: true });
  service.revokeAll();
  assert.equal((await stopped).error.code, "cancelled");
  assert.equal(service.list().length, 0);
});

test("a revoked terminal loses its pending approvals and session grants", async () => {
  const service = new McpApprovalService();
  const pending = service.authorize(request());
  await tick();
  service.revokeTerminal("session-1");
  assert.equal((await pending).error.code, "cancelled");
  const granted = service.authorize(request());
  await tick();
  service.decide(service.list()[0].id, "session");
  await granted;
  service.revokeTerminal("session-1");
  assert.equal(service.effectivePolicy("automationsManage", "session-1"), "ask");
});

test("changing a group's policy re-decides its pending approvals", async () => {
  const service = new McpApprovalService({ policies: { ...DEFAULT_MCP_PERMISSIONS, terminalsManage: "ask" } });
  const toDeny = service.authorize(request());
  const otherGroup = service.authorize(request({ group: "terminalsManage", operation: "run_command" }));
  await tick();
  service.setPolicies({ ...DEFAULT_MCP_PERMISSIONS, terminalsManage: "ask", automationsManage: "deny" });
  assert.equal((await toDeny).error.code, "permission_denied");
  // An unchanged group's approval stays pending.
  assert.deepEqual(service.list().map((entry) => entry.group), ["terminalsManage"]);
  service.setPolicies({ ...DEFAULT_MCP_PERMISSIONS, automationsManage: "deny" });
  assert.deepEqual(await otherGroup, { ok: true });
});

test("each terminal holds a bounded queue of pending approvals", async () => {
  const service = new McpApprovalService({ maxPendingPerTerminal: 2 });
  service.authorize(request());
  service.authorize(request());
  const refused = await service.authorize(request());
  assert.equal(refused.error.code, "approval_queue_full");
  service.authorize(request({ terminalSessionId: "session-2" }));
  await tick();
  assert.equal(service.list().length, 3);
  service.revokeAll();
});

async function composed(settingsValue) {
  let persisted;
  const settings = new ServerSettingsRepository({
    load: async () => structuredClone(persisted),
    commit: async (state) => { persisted = structuredClone(state); },
  });
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: "approvals-server",
    serverVersion: "test",
    capabilities: [],
    ptyFactory: { spawn() { return { pid: 1, write() {}, resize() {}, kill() {}, onData() { return () => undefined; }, onExit() { return () => undefined; } }; } },
    authenticate: ({ hello }) => hello.clientId === "session-bound"
      ? { clientId: hello.clientId, authScope: "write", claims: { projectId: "p", sessionId: "s" } }
      : { clientId: hello.clientId, authScope: hello.clientId === "reader" ? "read" : "write" },
    settings,
    mcpApprovals: true,
  });
  const cleanups = [];
  const connect = async (clientId) => {
    const pair = createInMemoryTransportPair({ autoOpen: false });
    await pair.open();
    const connection = composition.core.accept(pair.server);
    const task = connection.start();
    const client = new TerminayClient({ transport: pair.client, clientId, capabilities: [FEATURE_CAPABILITIES.mcpApprovals] });
    await client.connect();
    cleanups.push(async () => {
      await client.close().catch(() => undefined);
      await connection.close().catch(() => undefined);
      await task.catch(() => undefined);
    });
    return { client, approvals: new McpApprovalClient(new TerminayClientFacade(client)) };
  };
  return {
    composition,
    settings,
    connect,
    close: async () => { for (const cleanup of cleanups) await cleanup(); await composition.shutdown(); },
    start: async () => {
      await composition.start();
      await settings.update(settingsValue);
    },
  };
}

test("clients with terminal-create authority read and decide approvals; others are refused", async () => {
  const server = await composed({ terminayMcp: { enabled: true } });
  try {
    await server.start();
    const service = server.composition.mcpApprovals;
    assert.ok(service instanceof McpApprovalService);
    const outcome = service.authorize(request());
    await tick();
    const writer = await server.connect("desktop");
    const [approval] = await writer.approvals.list();
    assert.equal(approval.agent, "Claude Code");
    assert.deepEqual(approval.details, [{ label: "Runs", value: "mail-digest", code: true }]);
    const reader = await server.connect("reader");
    await assert.rejects(reader.approvals.list());
    await assert.rejects(reader.approvals.decide(approval.id, "once"));
    const bound = await server.connect("session-bound");
    await assert.rejects(bound.approvals.decide(approval.id, "once"));
    await writer.approvals.decide(approval.id, "once");
    assert.deepEqual(await outcome, { ok: true });
    await assert.rejects(writer.approvals.decide(approval.id, "once"));
  } finally {
    await server.close();
  }
});

test("the composed service follows the stored policy as it changes", async () => {
  const server = await composed({ terminayMcp: { enabled: true, permissions: { terminalsManage: "ask" } } });
  try {
    await server.start();
    const service = server.composition.mcpApprovals;
    assert.equal(service.effectivePolicy("terminalsManage", "s"), "ask");
    const pending = service.authorize(request({ group: "terminalsManage", operation: "run_command" }));
    await tick();
    await server.settings.set("terminayMcp.permissions.terminalsManage", "deny");
    assert.equal((await pending).error.code, "permission_denied");
  } finally {
    await server.close();
  }
});
