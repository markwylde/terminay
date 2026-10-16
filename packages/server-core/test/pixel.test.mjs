import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentChatService,
  DEFAULT_MCP_PERMISSIONS,
  DEFAULT_SERVER_SETTINGS,
  McpApprovalService,
  PIXEL_INSTRUCTION,
  PIXEL_OPERATIONS,
  PixelService,
  SETTING_AUTHORITY,
  bindAgentChatApprovals,
  pixelSettingsFrom,
} from "../dist/index.js";

const CLAUDE = "com.terminay.builtin-agents/claude-code";
const CODEX = "com.terminay.builtin-agents/codex";

async function setup(initial = { enabled: true, provider: CLAUDE }) {
  const opened = [];
  const closed = [];
  const providers = {
    providers: () => [{ id: CLAUDE, displayName: "Claude Code" }, { id: CODEX, displayName: "Codex" }],
    async availability() { return { available: true }; },
    async openSession(providerId, request, onEvent) {
      opened.push([providerId, request]);
      let release;
      return {
        async prompt() { await new Promise((resolve) => { release = resolve; }); },
        async cancel() { release?.(); },
        async close() { closed.push(providerId); release?.(); onEvent({ type: "exit", exit: { code: 0, signal: null } }); },
      };
    },
  };
  const approvals = new McpApprovalService({ policies: { ...DEFAULT_MCP_PERMISSIONS, terminalsManage: "ask" } });
  const revoked = [];
  const chats = new AgentChatService({
    providers,
    workRoot: await mkdtemp(join(tmpdir(), "terminay-pixel-")),
    changeCoalesceMs: 0,
    mcp: {
      mint: (chatId) => ({ token: `tok-${chatId}` }),
      revoke: (chatId) => { revoked.push(chatId); approvals.revokeTerminal(`chat:${chatId}`); },
      serverEntry: (token) => ({ command: "/bin/mcp", args: [], env: { TERMINAY_CONTROL_TOKEN: token } }),
      cancelPendingApprovals: (chatId) => approvals.cancelPending(`chat:${chatId}`),
    },
  });
  bindAgentChatApprovals(chats, approvals);
  let settings = initial;
  const events = [];
  const pixel = new PixelService({ chats, settings: () => settings, onChanged: (state) => events.push(state) });
  return { pixel, chats, approvals, opened, closed, revoked, events, set: (next) => { settings = next; return pixel.apply(next); } };
}

test("Pixel's settings are server settings, off by default with no agent", () => {
  assert.equal(SETTING_AUTHORITY.pixel, "server");
  assert.deepEqual(DEFAULT_SERVER_SETTINGS.pixel, { enabled: false, provider: "unset" });
  assert.deepEqual(pixelSettingsFrom(DEFAULT_SERVER_SETTINGS), { enabled: false, provider: "unset" });
  assert.deepEqual(pixelSettingsFrom({ pixel: { enabled: true, provider: CODEX } }), { enabled: true, provider: CODEX });
});

test("opening Pixel is refused while off or with no agent chosen", async () => {
  const off = await setup({ enabled: false, provider: CLAUDE });
  assert.throws(() => off.pixel.open(), (error) => error.code === "disabled");
  const unset = await setup({ enabled: true, provider: "unset" });
  assert.throws(() => unset.pixel.open(), (error) => error.code === "provider_unset");
});

test("the Pixel chat is one workspace chat with Pixel's instruction", async () => {
  const { pixel, chats, opened } = await setup();
  const chat = pixel.open();
  assert.equal(pixel.open().id, chat.id);
  assert.deepEqual(chat.reach, { kind: "workspace" });
  assert.equal(chat.title, "Pixel");
  assert.equal(chat.key, "pixel");
  chats.send(chat.id, "hi");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(opened[0][0], CLAUDE);
  assert.equal(opened[0][1].instruction, PIXEL_INSTRUCTION);
  assert.equal(opened[0][1].mcpServer.name, "terminay_chat");
  assert.equal(pixel.state().chatId, chat.id);
});

test("changing Pixel's agent closes its chat; the next one uses the new agent", async () => {
  const { pixel, closed, set } = await setup();
  const chat = pixel.open();
  await set({ enabled: true, provider: CODEX });
  assert.equal(pixel.state().chatId, undefined);
  const next = pixel.open();
  assert.notEqual(next.id, chat.id);
  assert.equal(next.providerId, CODEX);
  assert.deepEqual(closed, []); // no session had started
});

test("turning Pixel off mid-reply with an approval pending ends everything and runs nothing", async () => {
  const { pixel, chats, approvals, closed, revoked, events, set } = await setup();
  const chat = pixel.open();
  chats.send(chat.id, "run the tests");
  await new Promise((resolve) => setTimeout(resolve, 10));
  const pending = approvals.authorize({
    terminalSessionId: `chat:${chat.id}`, chatId: chat.id, projectId: "system:automations", operation: "run_command",
    group: "terminalsManage", agent: "Pixel (Claude Code)", terminalTitle: "", summary: "run `npm test` in api", details: [],
    signal: new AbortController().signal,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(approvals.list().length, 1);
  await set({ enabled: false, provider: CLAUDE });
  assert.equal((await pending).ok, false);
  assert.deepEqual(approvals.list(), []);
  assert.deepEqual(closed, [CLAUDE]);
  assert.ok(revoked.includes(chat.id));
  assert.deepEqual(chats.list(), []);
  assert.deepEqual(events.at(-1), { enabled: false, provider: CLAUDE });
  assert.throws(() => pixel.open(), (error) => error.code === "disabled");
});

test("Pixel operations need terminal-create authority", async () => {
  const { pixel } = await setup();
  const ops = pixel.operations();
  assert.throws(() => ops.queries[PIXEL_OPERATIONS.state]({ envelope: { payload: {} }, context: { authScope: "read" } }), (error) => error.code === "forbidden");
  const state = ops.queries[PIXEL_OPERATIONS.state]({ envelope: { payload: {} }, context: { authScope: "write" } });
  assert.equal(state.enabled, true);
});

test("Pixel stays off across a restart", async () => {
  // A fresh service reads the stored setting; nothing is created while off.
  const { pixel, chats } = await setup({ enabled: false, provider: CLAUDE });
  await pixel.apply({ enabled: false, provider: CLAUDE });
  assert.deepEqual(chats.list(), []);
  assert.equal(pixel.state().enabled, false);
});
