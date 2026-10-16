import assert from "node:assert/strict";
import test from "node:test";
import {
  EXTENSION_API_VERSION,
  EXTENSION_LIMITS,
  createAgentExtensionHarness,
  defineChatProvider,
  defineExtension,
  fixtureChatSessionRequest,
  validManifestFixture,
  validateAgentChatAvailability,
  validateAgentChatEvent,
  validateAgentChatProviderContribution,
  validateAgentChatSessionRequest,
  validateExtensionManifest,
} from "../dist/index.js";

const providerId = `${validManifestFixture.id}/echo`;
const chatManifest = Object.freeze({
  ...validManifestFixture,
  permissions: ["agent-chat"],
  contributes: { agentChatProviders: [{ id: providerId, displayName: "Echo" }] },
});

test("the API version is 3.2.0", () => {
  assert.equal(EXTENSION_API_VERSION, "3.2.0");
});

test("a chat-provider-only package passes contribution validation", () => {
  assert.equal(validateExtensionManifest(chatManifest).ok, true);
});

test("chat providers require agent-chat", () => {
  const result = validateExtensionManifest({ ...chatManifest, permissions: [] });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "missing_permission" && /agent-chat/.test(issue.message)));
});

test("chat provider declarations are namespaced and closed", () => {
  const id = validManifestFixture.id;
  assert.equal(validateAgentChatProviderContribution({ id: `${id}/echo`, displayName: "Echo", platforms: ["darwin"] }, id).ok, true);
  assert.equal(validateAgentChatProviderContribution({ id: "other.ext/echo", displayName: "Echo" }, id).ok, false);
  assert.equal(validateAgentChatProviderContribution({ id: `${id}/echo`, displayName: "Echo", command: "x" }, id).ok, false);
});

test("availability reports are closed and bounded", () => {
  assert.deepEqual(validateAgentChatAvailability({ available: true }).value, { available: true });
  const long = validateAgentChatAvailability({ available: false, reason: "not_installed", detail: "x".repeat(5000) });
  assert.equal(long.ok, true);
  assert.equal(long.value.detail.length, EXTENSION_LIMITS.chatDetailLength);
  assert.equal(validateAgentChatAvailability({ available: false, reason: "busy" }).ok, false);
});

test("events keep only known fields and refuse overlong text", () => {
  assert.deepEqual(validateAgentChatEvent({ type: "text", delta: "hi", extra: 1 }).value, { type: "text", delta: "hi" });
  assert.equal(validateAgentChatEvent({ type: "text", delta: "x".repeat(EXTENSION_LIMITS.chatTextDeltaLength + 1) }).ok, false);
  assert.deepEqual(
    validateAgentChatEvent({ type: "tool", tool: { callId: "t1", name: "read_terminal", server: "terminay_chat", state: "running", input: { secret: 1 } } }).value,
    { type: "tool", tool: { callId: "t1", name: "read_terminal", server: "terminay_chat", state: "running" } },
  );
  assert.equal(validateAgentChatEvent({ type: "tool", tool: { callId: "t1", name: "x", state: "done" } }).ok, false);
  assert.equal(validateAgentChatEvent({ type: "failure", failure: { reason: "nope" } }).ok, false);
  assert.deepEqual(validateAgentChatEvent({ type: "exit", exit: { code: 1, signal: "rm -rf" } }).value, { type: "exit", exit: { code: 1, signal: null } });
  assert.equal(validateAgentChatEvent({ type: "transcript" }).ok, false);
});

test("session requests need an absolute directory and a well-formed MCP entry", () => {
  assert.equal(validateAgentChatSessionRequest(fixtureChatSessionRequest).ok, true);
  assert.equal(validateAgentChatSessionRequest({ ...fixtureChatSessionRequest, mcpServer: null }).ok, true);
  assert.equal(validateAgentChatSessionRequest({ ...fixtureChatSessionRequest, workingDirectory: "relative" }).ok, false);
  assert.equal(validateAgentChatSessionRequest({ ...fixtureChatSessionRequest, mcpServer: { ...fixtureChatSessionRequest.mcpServer, name: "Bad Name" } }).ok, false);
});

function echoExtension(log) {
  return defineExtension({
    activate(context) {
      context.subscriptions.add(
        context.agents.registerChatProvider(
          providerId,
          defineChatProvider({
            async availability() {
              return { available: true };
            },
            async openSession(request, events) {
              log.push(["open", request.sessionId, request.mcpServer?.name ?? null]);
              let cancelled = false;
              return {
                async prompt(text) {
                  cancelled = false;
                  events.tool({ callId: "c1", name: "read_terminal", server: "terminay_chat", state: "running" });
                  for (const word of `you said ${text}`.split(" ")) {
                    if (cancelled) return;
                    events.text(`${word} `);
                  }
                  events.tool({ callId: "c1", name: "read_terminal", server: "terminay_chat", state: "completed" });
                },
                cancel() {
                  cancelled = true;
                },
                close() {
                  log.push(["close", request.sessionId]);
                  events.exit({ code: 0, signal: null });
                },
              };
            },
          }),
        ),
      );
    },
  });
}

test("the harness drives a chat provider through a session", async () => {
  const log = [];
  const harness = await createAgentExtensionHarness(echoExtension(log), { manifest: chatManifest });
  assert.deepEqual(harness.registeredChatProviderIds(), [providerId]);
  assert.deepEqual(await harness.chatAvailability(providerId), { available: true });
  const chat = await harness.openChatSession(providerId);
  await chat.prompt("hello");
  assert.equal(chat.text(), "you said hello ");
  assert.deepEqual(chat.violations(), []);
  assert.deepEqual(log[0], ["open", "chat-session-1", "terminay_chat"]);
  await harness.dispose();
  assert.deepEqual(log.at(-1), ["close", "chat-session-1"]);
  assert.equal(chat.events().at(-1).type, "exit");
});

test("undeclared and duplicate chat providers are refused", async () => {
  const extension = defineExtension({
    activate(context) {
      const runtime = defineChatProvider({ availability: async () => ({ available: true }), openSession: async () => ({}) });
      assert.throws(() => context.agents.registerChatProvider(`${validManifestFixture.id}/other`, runtime), /undeclared/);
      context.agents.registerChatProvider(providerId, runtime);
      assert.throws(() => context.agents.registerChatProvider(providerId, runtime), /Duplicate/);
    },
  });
  const harness = await createAgentExtensionHarness(extension, { manifest: chatManifest });
  await harness.release("disable");
  assert.deepEqual(harness.registeredChatProviderIds(), []);
});
