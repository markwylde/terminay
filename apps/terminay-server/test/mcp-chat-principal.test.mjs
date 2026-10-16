import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MCP_PERMISSIONS, McpApprovalService } from "@terminay/server-core";

const {
  CALLING_TERMINAL_OPERATIONS,
  ControlCapabilityStore,
  chatCallerKey,
  createMcpPermissionGate,
  createServerControlDispatcher,
} = await import("../dist/index.js");

function chatContext(overrides = {}) {
  return {
    terminalSessionId: chatCallerKey("c1"),
    projectId: "system:automations",
    scope: "write",
    reach: "workspace",
    chat: { chatId: "c1" },
    connectionId: "connection-a",
    requestId: "request-a",
    signal: new AbortController().signal,
    ...overrides,
  };
}

test("a workspace chat capability resolves to the chat with workspace reach and no terminal", () => {
  const store = new ControlCapabilityStore();
  const lease = store.mintChat("c1", { kind: "workspace" });
  const resolved = store.resolve(lease.token);
  assert.deepEqual(resolved, {
    terminalSessionId: "chat:c1",
    projectId: "system:automations",
    scope: "write",
    reach: "workspace",
    chat: { chatId: "c1" },
  });
});

test("a project chat capability reaches only its project", () => {
  const store = new ControlCapabilityStore();
  const lease = store.mintChat("c2", { kind: "project", projectId: "project-a" });
  const resolved = store.resolve(lease.token);
  assert.equal(resolved.projectId, "project-a");
  assert.equal(resolved.reach, undefined);
  assert.throws(() => store.mintChat("c3", { kind: "project", projectId: "system:automations" }), /invalid chat reach/);
});

test("revoking a chat ends its capability, and minting again replaces the old one", () => {
  const store = new ControlCapabilityStore();
  const first = store.mintChat("c1", { kind: "workspace" });
  const second = store.mintChat("c1", { kind: "workspace" });
  assert.equal(store.resolve(first.token), null);
  assert.notEqual(store.resolve(second.token), null);
  assert.equal(store.revokeChat("c1"), 1);
  assert.equal(store.resolve(second.token), null);
});

test("chat capabilities are never pruned as dead terminals, never saved, and never restored", () => {
  let now = 0;
  const store = new ControlCapabilityStore({ now: () => now });
  const lease = store.mintChat("c1", { kind: "workspace" });
  now = 10 * 60_000;
  assert.equal(store.prune(new Set()), 0);
  assert.notEqual(store.resolve(lease.token), null);
  assert.deepEqual(store.snapshot(), []);
  const restored = store.restore(
    [{ digest: "a".repeat(64), terminalSessionId: "chat:c9", projectId: "project-a", scope: "write", reach: "project", issuedAt: 1 }],
    new Set(["chat:c9"]),
  );
  assert.equal(restored, 0);
});

test("no terminal can be minted under the reserved chat key", () => {
  const store = new ControlCapabilityStore();
  assert.throws(() => store.mint("chat:c1", "project-a"), /invalid terminal session id/);
});

test("disabling MCP revokes chat capabilities and refuses new ones", () => {
  const store = new ControlCapabilityStore();
  const lease = store.mintChat("c1", { kind: "workspace" });
  store.setEnabled(false);
  assert.equal(store.resolve(lease.token), null);
  assert.throws(() => store.mintChat("c1", { kind: "workspace" }), /disabled/);
});

test("tools that need a calling terminal are unsupported for a chat and reported unavailable", async () => {
  const shown = [];
  const dispatch = createServerControlDispatcher({
    handlers: {
      showWindow: (params) => {
        shown.push(params);
        return { window: "w1" };
      },
      getMcpCapabilities: () => ({
        tools: [
          { tool: "list_terminals", available: true, permission: "allow" },
          { tool: "show_window", available: true, permission: "allow" },
          { tool: "send_notification", available: true, permission: "allow" },
        ],
      }),
    },
  });
  const refused = await dispatch({ id: "1", version: 1, op: "show_window", params: { title: "x", html: "<p>x</p>" } }, chatContext());
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "unsupported_op");
  assert.deepEqual(shown, []);
  const reported = await dispatch({ id: "2", version: 1, op: "get_mcp_capabilities", params: {} }, chatContext());
  const tools = (reported.result ?? reported).tools;
  assert.deepEqual(
    tools.map(({ tool, available }) => [tool, available]),
    [["list_terminals", true], ["show_window", false], ["send_notification", false]],
  );
  assert.ok(CALLING_TERMINAL_OPERATIONS.has("dismiss_notification"));
});

test("a chat's approval names the chat, carries its id, and reports how it ended", async () => {
  const approvals = new McpApprovalService({ policies: approvalsAsk() });
  const settled = [];
  approvals.onSettled((view, outcome) => settled.push([view.chatId, outcome]));
  const gate = createMcpPermissionGate({
    approvals,
    describe: async () => ({ agent: "Claude", terminalTitle: "a terminal", summary: "run `npm test` in api", details: [] }),
    chatAgentName: (chatId) => (chatId === "c1" ? "Pixel (Claude Code)" : undefined),
  });
  const pending = gate.authorize({ op: "run_command", group: "terminalsManage", params: {}, context: chatContext() });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const [view] = approvals.list();
  assert.equal(view.chatId, "c1");
  assert.equal(view.agent, "Pixel (Claude Code)");
  assert.equal(view.terminalTitle, "");
  assert.equal(view.terminalSessionId, "chat:c1");
  approvals.decide(view.id, "session");
  assert.equal(await pending, undefined);
  assert.deepEqual(settled, [["c1", "allowed-session"]]);
  // The chat's grant covers only the chat.
  assert.equal(approvals.effectivePolicy("terminalsManage", "chat:c1"), "allow");
  assert.equal(approvals.effectivePolicy("terminalsManage", "terminal-1"), "ask");
  // Revoking the chat's capability ends its grant.
  approvals.revokeTerminal("chat:c1");
  assert.equal(approvals.effectivePolicy("terminalsManage", "chat:c1"), "ask");
});

test("a chat approval ended by cancellation reports ended and runs nothing", async () => {
  const approvals = new McpApprovalService({ policies: approvalsAsk() });
  const settled = [];
  approvals.onSettled((_view, outcome) => settled.push(outcome));
  const controller = new AbortController();
  const gate = createMcpPermissionGate({ approvals, describe: async () => ({ agent: "x", terminalTitle: "", summary: "s", details: [] }) });
  const pending = gate.authorize({ op: "write_terminal", group: "terminalsManage", params: {}, context: chatContext({ signal: controller.signal }) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  const refusal = await pending;
  assert.equal(refusal.ok, false);
  assert.deepEqual(settled, ["ended"]);
});

function approvalsAsk() {
  return { ...DEFAULT_MCP_PERMISSIONS, terminalsManage: "ask" };
}

test("through the real endpoint, a chat keeps its identity: window tools are refused and handlers see the chat", async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { connect } = await import("node:net");
  const { createControlEndpoint, encodeControlMessage, CONTROL_PROTOCOL_VERSION } = await import("../dist/index.js");
  const capabilities = new ControlCapabilityStore();
  const lease = capabilities.mintChat("c7", { kind: "workspace" });
  const seen = [];
  const dispatch = createServerControlDispatcher({
    handlers: {
      listTerminals: (context) => { seen.push(context.chat); return { terminals: [] }; },
      showWindow: () => ({ window: "w" }),
    },
  });
  const socketPath = join(await mkdtemp(join(tmpdir(), "tc-")), "s.sock");
  const endpoint = createControlEndpoint({ socketPath, capabilities, dispatch });
  await endpoint.start();
  const call = (op, params) => new Promise((resolve) => {
    const socket = connect(socketPath);
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const end = buffer.indexOf("\n");
      if (end !== -1) { resolve(JSON.parse(buffer.slice(0, end))); socket.end(); }
    });
    socket.write(encodeControlMessage({ id: `r-${op}`, token: lease.token, version: CONTROL_PROTOCOL_VERSION, op, params }));
  });
  try {
    const listed = await call("list_terminals", {});
    assert.equal(listed.ok, true);
    assert.deepEqual(seen, [{ chatId: "c7" }]);
    const shown = await call("show_window", { title: "x", html: "<p>x</p>" });
    assert.equal(shown.ok, false);
    assert.equal(shown.error.code, "unsupported_op");
  } finally {
    await endpoint.stop();
  }
});
