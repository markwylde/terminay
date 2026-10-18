import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExtensionHost, ExtensionHostManager } from "../dist/index.js";

const PROVIDER_ID = "example.chat/echo";

async function fixture(source, permissions = ["agent-chat"]) {
  const root = await mkdtemp(join(tmpdir(), "terminay-agent-chat-"));
  await writeFile(join(root, "extension.js"), source, { mode: 0o600 });
  for (const name of ["config", "data", "cache"]) await mkdir(join(root, name));
  return {
    extensionId: "example.chat",
    packageRoot: root,
    entrypoint: "extension.js",
    configDirectory: join(root, "config"),
    dataDirectory: join(root, "data"),
    cacheDirectory: join(root, "cache"),
    permissions,
    agentChatProviders: [{ id: PROVIDER_ID, displayName: "Echo" }],
  };
}

const EXTENSION = `
export function activate(context) {
  context.agents.registerChatProvider("${PROVIDER_ID}", {
    async availability() { return { available: true, detail: "echo 1.0" }; },
    async openSession(request, events) {
      let cancelled = false;
      let release;
      return {
        async prompt(text) {
          cancelled = false;
          if (text === "crash") process.exit(9);
          events.tool({ callId: "t1", server: request.mcpServer?.name, name: "read_terminal", state: "running", input: "secret" });
          events.text("you said ");
          if (text === "wait") await new Promise((resolve) => { release = resolve; });
          if (cancelled) return;
          events.text(text);
          events.tool({ callId: "t1", server: request.mcpServer?.name, name: "read_terminal", state: "completed" });
        },
        cancel() { cancelled = true; release?.(); },
        close() { events.exit({ code: 0, signal: null }); },
      };
    },
  });
}`;

const REQUEST = {
  sessionId: "s-1",
  workingDirectory: "/tmp/terminay-chat/s-1",
  instruction: "Be brief.",
  mcpServer: { name: "terminay_chat", command: "/usr/bin/true", args: [], env: { TERMINAY_CONTROL_TOKEN: "t" } },
};

/** Records a session's events; `until` settles once they satisfy a check, re-checked as each arrives. */
function recorder() {
  const events = [];
  const waiters = new Set();
  return {
    events,
    push(event) {
      events.push(event);
      for (const waiter of [...waiters]) waiter();
    },
    until(check) {
      if (check(events)) return Promise.resolve();
      return new Promise((resolve) => {
        const waiter = () => {
          if (!check(events)) return;
          waiters.delete(waiter);
          resolve();
        };
        waiters.add(waiter);
      });
    },
  };
}

test("a chat provider reports availability and streams a turn's validated events", async (t) => {
  const host = new ExtensionHost("example.chat", { broker: { async request() {} } });
  t.after(() => host.stop());
  await host.start(await fixture(EXTENSION));
  assert.deepEqual(host.status().agentChatProviders.map((provider) => provider.id), [PROVIDER_ID]);
  assert.deepEqual(await host.chatAvailability(PROVIDER_ID), { available: true, detail: "echo 1.0" });
  const { events, push, until } = recorder();
  await host.openChatSession(PROVIDER_ID, REQUEST, push);
  await host.promptChat("s-1", "hello");
  await until(() => events.length >= 4);
  assert.deepEqual(events, [
    { type: "tool", tool: { callId: "t1", server: "terminay_chat", name: "read_terminal", state: "running" } },
    { type: "text", delta: "you said " },
    { type: "text", delta: "hello" },
    { type: "tool", tool: { callId: "t1", server: "terminay_chat", name: "read_terminal", state: "completed" } },
  ]);
  await host.closeChat("s-1");
  assert.equal(events.at(-1).type, "exit");
});

test("cancel ends a waiting turn without a deadline firing", async (t) => {
  const host = new ExtensionHost("example.chat", { broker: { async request() {} } });
  t.after(() => host.stop());
  await host.start(await fixture(EXTENSION));
  const { events, push, until } = recorder();
  await host.openChatSession(PROVIDER_ID, REQUEST, push);
  const turn = host.promptChat("s-1", "wait");
  await until(() => events.some((event) => event.type === "text"));
  await host.cancelChat("s-1");
  await turn;
  assert.equal(events.filter((event) => event.type === "text").length, 1);
});

test("a child that dies mid-turn ends its sessions with an exit", async (t) => {
  const host = new ExtensionHost("example.chat", { broker: { async request() {} }, limits: { initialBackoffMs: 60_000 } });
  t.after(() => host.stop());
  await host.start(await fixture(EXTENSION));
  const { events, push, until } = recorder();
  await host.openChatSession(PROVIDER_ID, REQUEST, push);
  await assert.rejects(host.promptChat("s-1", "crash"));
  await until(() => events.some((event) => event.type === "exit"));
  await assert.rejects(host.promptChat("s-1", "again"), /not open|unavailable/);
});

test("a chat provider registered without agent-chat is refused", async () => {
  const host = new ExtensionHost("example.chat", { broker: { async request() {} } });
  await assert.rejects(host.start(await fixture(EXTENSION, [])), /invalid chat provider registrations/);
});

test("an undeclared chat provider registration fails activation", async () => {
  const host = new ExtensionHost("example.chat", { broker: { async request() {} } });
  await assert.rejects(
    host.start(await fixture(`export function activate(context) { context.agents.registerChatProvider("example.chat/other", { availability() {}, openSession() {} }); }`)),
    /undeclared or invalid/,
  );
});

test("the manager lists chat providers and binds sessions to their owner", async () => {
  const manager = new ExtensionHostManager({ broker: { async request() {} } });
  await manager.start(await fixture(EXTENSION));
  assert.deepEqual(manager.chatProviderContributions().map(({ contribution }) => contribution.id), [PROVIDER_ID]);
  const { events, push, until } = recorder();
  const session = await manager.openChatSession(PROVIDER_ID, REQUEST, push);
  await session.prompt("hi");
  await until(() => events.filter((event) => event.type === "text").length === 2);
  await manager.shutdown();
  assert.equal(events.at(-1).type, "exit");
});
