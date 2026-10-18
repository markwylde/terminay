import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_CHAT_LIMITS,
  AgentChatService,
  DEFAULT_MCP_PERMISSIONS,
  McpApprovalService,
  bindAgentChatApprovals,
} from "../dist/index.js";

/** A provider that replies in words and can be told to misbehave. */
function fakeProviders(options = {}) {
  const log = [];
  const sessions = [];
  const promptWaiters = new Set();
  let availability = options.availability ?? { available: true };
  return {
    log,
    sessions,
    /** Settles once a prompt with this text has reached the provider. */
    prompted: (text) =>
      sessions.some((session) => session.prompts.includes(text))
        ? Promise.resolve()
        : new Promise((resolve) => promptWaiters.add({ text, resolve })),
    setAvailability(value) { availability = value; },
    bridge: {
      providers: () => [{ id: "ext/echo", displayName: "Echo" }],
      async availability() { return availability; },
      async openSession(_providerId, request, onEvent) {
        log.push(["open", request]);
        const session = { request, onEvent, prompts: [], cancelled: 0, closed: false };
        sessions.push(session);
        let release;
        return {
          async prompt(text) {
            session.prompts.push(text);
            for (const waiter of [...promptWaiters]) {
              if (waiter.text !== text) continue;
              promptWaiters.delete(waiter);
              waiter.resolve();
            }
            if (text === "fail") {
              onEvent({ type: "failure", failure: { reason: "not_signed_in", detail: "Run `echo login`." } });
              throw new Error("not signed in");
            }
            if (text === "crash") {
              onEvent({ type: "text", delta: "half" });
              onEvent({ type: "exit", exit: { code: 1, signal: null } });
              throw new Error("exited");
            }
            onEvent({ type: "tool", tool: { callId: "t1", name: "command", state: "running" } });
            onEvent({ type: "text", delta: "you said " });
            if (text === "wait") await new Promise((resolve) => { release = resolve; });
            onEvent({ type: "text", delta: text });
            onEvent({ type: "tool", tool: { callId: "t1", name: "command", state: "completed" } });
          },
          async cancel() { session.cancelled += 1; release?.(); },
          async close() { session.closed = true; onEvent({ type: "exit", exit: { code: 0, signal: null } }); },
        };
      },
    },
  };
}

function fakeMcp() {
  const calls = [];
  return {
    calls,
    bridge: {
      mint(chatId, reach) { calls.push(["mint", chatId, reach.kind]); return { token: `tok-${chatId}` }; },
      revoke(chatId) { calls.push(["revoke", chatId]); },
      serverEntry(token) { return { command: "/usr/bin/terminay-mcp", args: [], env: { TERMINAY_CONTROL_TOKEN: token } }; },
      cancelPendingApprovals(chatId) { calls.push(["cancel", chatId]); },
    },
  };
}

// Re-checked on every change the service reports.
const changeWaiters = new Set();

async function service(overrides = {}) {
  const workRoot = await mkdtemp(join(tmpdir(), "terminay-chat-work-"));
  const providers = overrides.providers ?? fakeProviders();
  const mcp = overrides.mcp ?? fakeMcp();
  const changes = [];
  const diagnostics = [];
  const chats = new AgentChatService({
    providers: providers.bridge,
    mcp: mcp.bridge,
    workRoot,
    changeCoalesceMs: 0,
    onChanged: (change) => {
      changes.push(change);
      for (const waiter of [...changeWaiters]) waiter();
    },
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    ...(overrides.inactivityMs === undefined ? {} : { inactivityMs: overrides.inactivityMs }),
  });
  return { chats, providers, mcp, changes, diagnostics, workRoot };
}

/** Settles once the chat's turn has ended, as the service reports it. */
function settled(chats, chatId) {
  const idle = () => chats.get(chatId).status === "idle";
  if (idle()) return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (!idle()) return;
      changeWaiters.delete(check);
      resolve();
    };
    changeWaiters.add(check);
  });
}

const textOf = (view) =>
  view.entries.filter((entry) => entry.kind === "assistant").flatMap((entry) => entry.parts).filter((part) => part.type === "text").map((part) => part.text).join("");

test("creating and opening by key", async () => {
  const { chats, changes } = await service();
  const created = chats.create({ providerId: "ext/echo", title: "Helper", reach: { kind: "none" }, key: "helper" });
  assert.equal(created.status, "idle");
  assert.equal(chats.open({ providerId: "ext/echo", title: "Other", reach: { kind: "none" }, key: "helper" }).id, created.id);
  assert.equal(chats.list().length, 1);
  assert.deepEqual(Object.keys(changes[0]).sort(), ["chatId", "revision"]);
});

test("the reserved pixel key needs the Pixel feature", async () => {
  const { chats } = await service();
  assert.throws(() => chats.create({ providerId: "ext/echo", title: "Pixel", reach: { kind: "workspace" }, key: "pixel" }), /reserved/);
  assert.doesNotThrow(() => chats.create({ providerId: "ext/echo", title: "Pixel", reach: { kind: "workspace" }, key: "pixel", allowReservedKey: true }));
});

test("the open-chat limit is enforced", async () => {
  const { chats } = await service();
  for (let i = 0; i < AGENT_CHAT_LIMITS.chats; i += 1) chats.create({ providerId: "ext/echo", title: `c${i}`, reach: { kind: "none" } });
  assert.throws(() => chats.create({ providerId: "ext/echo", title: "one more", reach: { kind: "none" } }), (error) => error.code === "chat_limit_reached");
});

test("a turn opens a session in an empty private directory with the MCP entry and streams the reply", async () => {
  const { chats, providers, mcp, workRoot } = await service();
  const chat = chats.create({ providerId: "ext/echo", title: "Helper", reach: { kind: "workspace" }, instruction: "Be brief." });
  chats.send(chat.id, "hello");
  assert.equal(chats.get(chat.id).status, "thinking");
  await settled(chats, chat.id);
  const view = chats.get(chat.id);
  assert.equal(textOf(view), "you said hello");
  const [, request] = providers.log[0];
  assert.equal(request.mcpServer.name, "terminay_chat");
  assert.equal(request.mcpServer.env.TERMINAY_CONTROL_TOKEN, `tok-${chat.id}`);
  assert.equal(request.instruction, "Be brief.");
  assert.ok(request.workingDirectory.startsWith(workRoot));
  assert.deepEqual(await readdir(request.workingDirectory), []);
  assert.deepEqual(mcp.calls[0], ["mint", chat.id, "workspace"]);
  const activity = view.entries.find((entry) => entry.kind === "assistant").parts.find((part) => part.type === "activity");
  assert.deepEqual([activity.text, activity.state], ["Running a command", "completed"]);
  // The second turn reuses the session.
  chats.send(chat.id, "again");
  await settled(chats, chat.id);
  assert.equal(providers.log.length, 1);
});

test("a chat with no reach gets no MCP entry and no capability", async () => {
  const { chats, providers, mcp } = await service();
  const chat = chats.create({ providerId: "ext/echo", title: "Talk", reach: { kind: "none" } });
  chats.send(chat.id, "hi");
  await settled(chats, chat.id);
  assert.equal(providers.log[0][1].mcpServer, null);
  assert.deepEqual(mcp.calls.filter(([kind]) => kind === "mint"), []);
});

test("a message while busy is refused and stop ends the turn", async () => {
  const { chats, providers, mcp } = await service();
  const chat = chats.create({ providerId: "ext/echo", title: "Helper", reach: { kind: "workspace" } });
  chats.send(chat.id, "wait");
  await providers.prompted("wait");
  assert.throws(() => chats.send(chat.id, "more"), (error) => error.code === "chat_busy");
  await chats.stop(chat.id);
  assert.equal(chats.get(chat.id).status, "idle");
  assert.equal(providers.sessions[0].cancelled, 1);
  assert.ok(mcp.calls.some(([kind]) => kind === "cancel"));
  assert.equal(textOf(chats.get(chat.id)), "you said ");
});

test("clear ends the session, revokes, and empties; the next message opens a new session", async () => {
  const { chats, providers, mcp } = await service();
  const chat = chats.create({ providerId: "ext/echo", title: "Helper", reach: { kind: "workspace" } });
  chats.send(chat.id, "hello");
  await settled(chats, chat.id);
  await chats.clear(chat.id);
  assert.deepEqual(chats.get(chat.id).order, []);
  assert.equal(providers.sessions[0].closed, true);
  assert.ok(mcp.calls.some(([kind, id]) => kind === "revoke" && id === chat.id));
  chats.send(chat.id, "again");
  await settled(chats, chat.id);
  assert.equal(providers.log.length, 2);
  // A deliberate end is not a lost memory.
  assert.equal(chats.get(chat.id).entries.some((entry) => entry.kind === "notice"), false);
});

test("a provider failure becomes a notice naming the fix", async () => {
  const { chats, diagnostics } = await service();
  const chat = chats.create({ providerId: "ext/echo", title: "Helper", reach: { kind: "none" } });
  chats.send(chat.id, "fail");
  await settled(chats, chat.id);
  const notices = chats.get(chat.id).entries.filter((entry) => entry.kind === "notice");
  assert.equal(notices.length, 1);
  assert.match(notices[0].text, /Echo is not signed in\. Run `echo login`\./);
  assert.ok(diagnostics.some((d) => d.event === "turn-failed" && d.reason === "not_signed_in"));
});

test("an unavailable provider stops the turn before any session opens", async () => {
  const providers = fakeProviders({ availability: { available: false, reason: "not_installed", detail: "Install it with `npm i -g echo`." } });
  const { chats } = await service({ providers });
  const chat = chats.create({ providerId: "ext/echo", title: "Helper", reach: { kind: "none" } });
  chats.send(chat.id, "hi");
  await settled(chats, chat.id);
  assert.equal(providers.log.length, 0);
  const notices = chats.get(chat.id).entries.filter((entry) => entry.kind === "notice");
  assert.deepEqual(notices.map((n) => n.text), ["Echo is not installed on this server. Install it with `npm i -g echo`."]);
});

test("an agent that exits mid-turn is reported, and the next session says it has no memory", async () => {
  const { chats, providers, mcp, diagnostics } = await service();
  const chat = chats.create({ providerId: "ext/echo", title: "Helper", reach: { kind: "workspace" } });
  chats.send(chat.id, "crash");
  await settled(chats, chat.id);
  let notices = chats.get(chat.id).entries.filter((entry) => entry.kind === "notice");
  assert.match(notices.at(-1).text, /Echo stopped/);
  assert.ok(mcp.calls.some(([kind]) => kind === "revoke"));
  assert.ok(diagnostics.some((d) => d.event === "session-ended" && d.exitCode === 1 && d.deliberate === false));
  chats.send(chat.id, "hello");
  await settled(chats, chat.id);
  notices = chats.get(chat.id).entries.filter((entry) => entry.kind === "notice");
  assert.match(notices.at(-1).text, /does not remember/);
  assert.equal(providers.log.length, 2);
});

test("a silent turn fails after the inactivity limit", async () => {
  const { chats } = await service({ inactivityMs: 30 });
  const chat = chats.create({ providerId: "ext/echo", title: "Helper", reach: { kind: "none" } });
  chats.send(chat.id, "wait");
  await settled(chats, chat.id);
  assert.match(chats.get(chat.id).entries.at(-1).text, /stopped waiting/);
});

test("reads after a revision return only what changed", async () => {
  const { chats } = await service();
  const chat = chats.create({ providerId: "ext/echo", title: "Helper", reach: { kind: "none" } });
  chats.send(chat.id, "one");
  await settled(chats, chat.id);
  const first = chats.get(chat.id);
  chats.send(chat.id, "two");
  await settled(chats, chat.id);
  const delta = chats.get(chat.id, first.revision);
  assert.equal(delta.order.length, 4);
  assert.equal(delta.entries.length, 2);
  assert.ok(delta.entries.every((entry) => entry.revision > first.revision));
});

test("old entries are dropped beyond the bound", async () => {
  const { chats } = await service();
  const chat = chats.create({ providerId: "ext/echo", title: "Helper", reach: { kind: "none" } });
  for (let i = 0; i < AGENT_CHAT_LIMITS.entries / 2 + 5; i += 1) {
    chats.send(chat.id, `m${i}`);
    await settled(chats, chat.id);
  }
  assert.equal(chats.get(chat.id).order.length, AGENT_CHAT_LIMITS.entries);
});

test("a chat's approvals appear in it, decide through the approval service, and record the outcome", async () => {
  const { chats } = await service();
  const approvals = new McpApprovalService({ policies: { ...DEFAULT_MCP_PERMISSIONS, terminalsManage: "ask" } });
  const unbind = bindAgentChatApprovals(chats, approvals);
  const chat = chats.create({ providerId: "ext/echo", title: "Pixel", reach: { kind: "workspace" } });
  const pending = approvals.authorize({
    terminalSessionId: `chat:${chat.id}`, chatId: chat.id, projectId: "system:automations", operation: "run_command",
    group: "terminalsManage", agent: "Pixel (Echo)", terminalTitle: "", summary: "run `npm test` in api",
    details: [{ label: "Command", value: "npm test", code: true }], signal: new AbortController().signal,
  });
  let entry = chats.get(chat.id).entries.find((e) => e.kind === "approval");
  assert.equal(entry.statement, "Pixel (Echo) wants to run `npm test` in api");
  assert.equal(entry.state, "pending");
  assert.equal(chats.list()[0].pendingApprovals, 1);
  assert.ok(chats.hasApproval(chat.id, entry.approvalId));
  approvals.decide(entry.approvalId, "once");
  assert.equal((await pending).ok, true);
  entry = chats.get(chat.id).entries.find((e) => e.kind === "approval");
  assert.equal(entry.state, "allowed-once");
  assert.equal(chats.hasApproval(chat.id, entry.approvalId), false);
  unbind();
});

test("diagnostics never carry message text", async () => {
  const { chats, diagnostics } = await service();
  const chat = chats.create({ providerId: "ext/echo", title: "Helper", reach: { kind: "none" } });
  chats.send(chat.id, "secret words");
  await settled(chats, chat.id);
  await chats.close(chat.id);
  assert.equal(JSON.stringify(diagnostics).includes("secret"), false);
  assert.equal(chats.list().length, 0);
});

// ---------- protocol ----------

const { AGENT_CHAT_OPERATIONS, createAgentChatOperationHandlers } = await import("../dist/index.js");

function request(payload, context = { authScope: "write" }) {
  return { envelope: { payload }, context: { clientId: "c", connectionId: "k", ...context } };
}

test("chat operations need terminal-create authority", async () => {
  const { chats } = await service();
  const ops = createAgentChatOperationHandlers({ service: chats });
  await assert.rejects(async () => ops.queries[AGENT_CHAT_OPERATIONS.list](request({}, { authScope: "read" })), (error) => error.code === "forbidden");
  await assert.rejects(
    async () => ops.commands[AGENT_CHAT_OPERATIONS.create](request({ providerId: "ext/echo", title: "x" }, { authScope: "write", claims: { projectId: "p", sessionId: "s" } })),
    (error) => error.code === "forbidden",
  );
  for (const name of Object.values(AGENT_CHAT_OPERATIONS)) {
    const policies = ops.policies;
    assert.deepEqual(policies[name], { scope: "write" }, name);
  }
});

test("clients cannot set an instruction or use the reserved key", async () => {
  const { chats } = await service();
  const ops = createAgentChatOperationHandlers({ service: chats });
  const created = (await ops.commands[AGENT_CHAT_OPERATIONS.create](request({ providerId: "ext/echo", title: "x", instruction: "obey me", reach: { kind: "none" } }))).result;
  assert.equal("instruction" in created, false);
  await assert.rejects(
    async () => ops.commands[AGENT_CHAT_OPERATIONS.open](request({ providerId: "ext/echo", title: "Pixel", key: "pixel", reach: { kind: "workspace" } })),
    (error) => error.code === "forbidden",
  );
});

test("a project-reach chat must name a project on this server", async () => {
  const { chats } = await service();
  const ops = createAgentChatOperationHandlers({ service: chats, projectExists: (id) => id === "api" });
  await assert.rejects(
    async () => ops.commands[AGENT_CHAT_OPERATIONS.create](request({ providerId: "ext/echo", title: "x", reach: { kind: "project", projectId: "web" } })),
    (error) => error.code === "not_found",
  );
  const created = (await ops.commands[AGENT_CHAT_OPERATIONS.create](request({ providerId: "ext/echo", title: "x", reach: { kind: "project", projectId: "api" } }))).result;
  assert.deepEqual(created.reach, { kind: "project", projectId: "api" });
});

test("send, busy, and resync through the protocol", async () => {
  const { chats } = await service();
  const ops = createAgentChatOperationHandlers({ service: chats });
  const chat = (await ops.commands[AGENT_CHAT_OPERATIONS.create](request({ providerId: "ext/echo", title: "x" }))).result;
  await ops.commands[AGENT_CHAT_OPERATIONS.send](request({ chatId: chat.id, text: "wait" }));
  await assert.rejects(async () => ops.commands[AGENT_CHAT_OPERATIONS.send](request({ chatId: chat.id, text: "more" })), (error) => error.code === "conflict" && error.details.reason === "chat_busy");
  await ops.commands[AGENT_CHAT_OPERATIONS.stop](request({ chatId: chat.id }));
  const view = await ops.queries[AGENT_CHAT_OPERATIONS.get](request({ chatId: chat.id }));
  assert.equal(view.status, "idle");
  const later = await ops.queries[AGENT_CHAT_OPERATIONS.get](request({ chatId: chat.id, afterRevision: view.revision }));
  assert.deepEqual(later.entries, []);
  assert.deepEqual(later.order, view.order);
});

test("a decision is accepted only for an approval the chat shows", async () => {
  const { chats } = await service();
  const decided = [];
  const ops = createAgentChatOperationHandlers({ service: chats, approvals: { decide: (id, decision) => { decided.push([id, decision]); return true; } } });
  const chat = (await ops.commands[AGENT_CHAT_OPERATIONS.create](request({ providerId: "ext/echo", title: "x" }))).result;
  await assert.rejects(
    async () => ops.commands[AGENT_CHAT_OPERATIONS.decideApproval](request({ chatId: chat.id, approvalId: "apr_other", decision: "once" })),
    (error) => error.code === "not_found",
  );
  chats.approvalPending({ approvalId: "apr_1", chatId: chat.id, summary: "run x", groupLabel: "Full Terminal Management", details: [] });
  await ops.commands[AGENT_CHAT_OPERATIONS.decideApproval](request({ chatId: chat.id, approvalId: "apr_1", decision: "decline" }));
  assert.deepEqual(decided, [["apr_1", "decline"]]);
});

test("nothing of a conversation is left on disk once a chat closes", async () => {
  const { chats, workRoot } = await service();
  const chat = chats.create({ providerId: "ext/echo", title: "Helper", reach: { kind: "workspace" } });
  chats.send(chat.id, "remember this sentence");
  await settled(chats, chat.id);
  await chats.close(chat.id);
  assert.deepEqual(await readdir(workRoot), []);
});

test("activity notes for Terminay calls use titles and the agent's own input", async () => {
  const { describeChatMcpCall } = await import("../dist/index.js");
  const titles = (reference) => (reference === "t_build" ? "build" : undefined);
  assert.equal(describeChatMcpCall("read_terminal", { terminal: "t_build" }, titles), "Reading build");
  assert.equal(describeChatMcpCall("run_command", { terminal: "t_build", command: "npm test" }, titles), "Running `npm test` in build");
  assert.equal(describeChatMcpCall("write_terminal", { terminal: "t_unknown", text: "yes" }, titles), "Typing into a terminal");
  assert.equal(describeChatMcpCall("get_mcp_capabilities", {}, titles), undefined);
  assert.equal(describeChatMcpCall("create_automation", { name: "Digest" }, titles), "Creating the automation “Digest”");
});

test("every chat and Pixel operation and event name is one the protocol accepts", async () => {
  const { AGENT_CHAT_EVENTS, PIXEL_EVENTS, PIXEL_OPERATIONS } = await import("../dist/index.js");
  const names = [...Object.values(AGENT_CHAT_OPERATIONS), ...Object.values(AGENT_CHAT_EVENTS), ...Object.values(PIXEL_OPERATIONS), ...Object.values(PIXEL_EVENTS)];
  for (const name of names) assert.match(name, /^[a-z][a-z0-9._:-]{0,255}$/, name);
});

test("a chat's viewer is the connection that sent its latest message, forgotten when that connection closes", async () => {
  const { chats } = await service();
  const chat = chats.create({ providerId: "ext/echo", title: "Helper", reach: { kind: "workspace" } });
  assert.equal(chats.viewerOf(chat.id), undefined);
  chats.send(chat.id, "hello", { clientId: "window-a", connectionId: "conn-a" });
  assert.deepEqual(chats.viewerOf(chat.id), { clientId: "window-a", connectionId: "conn-a" });
  await settled(chats, chat.id);
  chats.send(chat.id, "again", { clientId: "window-b", connectionId: "conn-b" });
  assert.deepEqual(chats.viewerOf(chat.id), { clientId: "window-b", connectionId: "conn-b" });
  await settled(chats, chat.id);
  chats.forgetViewerConnection("conn-a");
  assert.deepEqual(chats.viewerOf(chat.id), { clientId: "window-b", connectionId: "conn-b" });
  chats.forgetViewerConnection("conn-b");
  assert.equal(chats.viewerOf(chat.id), undefined);
});
