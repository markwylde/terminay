import assert from "node:assert/strict";
import test from "node:test";
import { APP_WINDOW_EVENTS, APP_WINDOW_OPERATIONS, APP_WINDOWS_CAPABILITY, AppWindowClient } from "../dist/index.js";

const window = (overrides = {}) => ({
  id: "win_1",
  terminalSessionId: "session-a",
  projectId: "project-a",
  title: "Hello",
  source: { kind: "agent" },
  state: "open",
  contentRevision: 1,
  createdAt: 1000,
  ...overrides,
});

function transport(answers = {}) {
  const calls = [];
  const listeners = new Map();
  return {
    calls,
    emit: (event) => { for (const listener of listeners.get(event) ?? []) listener({}); },
    query: async (operation, payload) => { calls.push(["query", operation, payload]); return answers[operation]; },
    queryWithBody: async (operation, payload) => { calls.push(["queryWithBody", operation, payload]); return answers[operation]; },
    command: async (operation, payload) => { calls.push(["command", operation, payload]); return answers[operation] ?? {}; },
    commandWithBody: async (operation, payload, body) => { calls.push(["commandWithBody", operation, payload, JSON.parse(new TextDecoder().decode(body))]); return answers[operation] ?? {}; },
    subscribe: (event, listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return () => listeners.set(event, (listeners.get(event) ?? []).filter((entry) => entry !== listener));
    },
  };
}

test("the capability and operation names match the server's", () => {
  assert.equal(APP_WINDOWS_CAPABILITY, "app-windows.v1");
  assert.equal(APP_WINDOW_OPERATIONS.viewRequest, "app-windows.view-request");
  assert.equal(APP_WINDOW_EVENTS.changed, "app-windows.changed");
});

test("list validates and freezes windows of both sources", async () => {
  const app = window({ id: "win_2", title: "Draw", state: "minimised", source: { kind: "mcp-app", server: "diagrams", tool: "draw", resourceUri: "ui://diagrams/draw" } });
  const client = new AppWindowClient(transport({ [APP_WINDOW_OPERATIONS.list]: { windows: [window(), app] } }));
  const listed = await client.list();
  assert.deepEqual(listed.map((entry) => [entry.id, entry.state, entry.source.kind]), [["win_1", "open", "agent"], ["win_2", "minimised", "mcp-app"]]);
  assert.ok(Object.isFrozen(listed) && Object.isFrozen(listed[0]));
});

test("a malformed window is rejected rather than rendered", async () => {
  for (const bad of [
    window({ state: "floating" }),
    window({ id: "not an id" }),
    window({ title: "" }),
    window({ source: { kind: "mcp-app", server: "diagrams" } }),
    window({ contentRevision: 1.5 }),
    "junk",
  ]) {
    const client = new AppWindowClient(transport({ [APP_WINDOW_OPERATIONS.list]: { windows: [bad] } }));
    await assert.rejects(client.list(), TypeError);
  }
  await assert.rejects(new AppWindowClient(transport({ [APP_WINDOW_OPERATIONS.list]: {} })).list(), TypeError);
});

test("content decodes the document from the body and carries the tool data", async () => {
  const fake = transport({
    [APP_WINDOW_OPERATIONS.content]: {
      result: {
        window: window(),
        csp: { connectDomains: ["https://api.example"], resourceDomains: [] },
        permissions: { clipboardWrite: {} },
      },
      // The document and the tool data are the body: either may be larger than an envelope.
      body: new TextEncoder().encode(JSON.stringify({
        html: "<h1>héllo</h1>",
        tool: { name: "draw" },
        toolInput: { shape: "circle" },
        toolResult: { content: [{ type: "text", text: "drawn" }] },
      })),
    },
  });
  const content = await new AppWindowClient(fake).content("win_1");
  assert.equal(content.html, "<h1>héllo</h1>");
  assert.deepEqual(content.csp, { connectDomains: ["https://api.example"], resourceDomains: [] });
  assert.deepEqual(content.toolInput, { shape: "circle" });
  assert.deepEqual(content.toolResult, { content: [{ type: "text", text: "drawn" }] });
  assert.equal("toolCancelled" in content, false);
  // A window shown without data has none; one shown with data carries it, null included.
  assert.equal("data" in content, false);
  for (const data of [{ questions: ["Ship it?"] }, null, 0, ""]) {
    const withData = transport({ [APP_WINDOW_OPERATIONS.content]: { result: { window: window() }, body: new TextEncoder().encode(JSON.stringify({ html: "<p>q</p>", data })) } });
    assert.deepEqual((await new AppWindowClient(withData).content("win_1")).data, data);
  }
  assert.deepEqual(fake.calls, [["queryWithBody", APP_WINDOW_OPERATIONS.content, { windowId: "win_1" }]]);
  // A body that is not the expected document is refused, not rendered.
  for (const body of ["<h1>raw html</h1>", JSON.stringify({ tool: {} }), JSON.stringify({ html: 7 })]) {
    const bad = transport({ [APP_WINDOW_OPERATIONS.content]: { result: { window: window() }, body: new TextEncoder().encode(body) } });
    await assert.rejects(new AppWindowClient(bad).content("win_1"), TypeError);
  }
});

test("a csp that is not lists of origins is rejected", async () => {
  for (const csp of [{ connectDomains: "https://api.example" }, { resourceDomains: [7] }, "none"]) {
    const fake = transport({ [APP_WINDOW_OPERATIONS.content]: { result: { window: window(), csp }, body: new Uint8Array() } });
    await assert.rejects(new AppWindowClient(fake).content("win_1"), TypeError);
  }
});

test("state changes, close, messages, and context send bounded commands", async () => {
  const fake = transport();
  const client = new AppWindowClient(fake);
  await client.setState("win_1", "minimised");
  await client.close("win_1");
  await client.sendMessage("win_1", "Deploy api");
  await client.updateContext("win_1", "selection: blue");
  assert.deepEqual(fake.calls, [
    ["command", APP_WINDOW_OPERATIONS.setState, { windowId: "win_1", state: "minimised" }],
    ["command", APP_WINDOW_OPERATIONS.close, { windowId: "win_1" }],
    ["command", APP_WINDOW_OPERATIONS.message, { windowId: "win_1", text: "Deploy api" }],
    ["command", APP_WINDOW_OPERATIONS.context, { windowId: "win_1", text: "selection: blue" }],
  ]);
  await assert.rejects(client.setState("win_1", "floating"), TypeError);
  await assert.rejects(client.sendMessage("win_1", ""), TypeError);
  await assert.rejects(client.sendMessage("win_1", "x".repeat(16 * 1024 + 1)), TypeError);
  await assert.rejects(client.close("bad id"), TypeError);
  assert.equal(fake.calls.length, 4);
});

test("a view request returns the server's response and refuses other methods", async () => {
  const fake = transport({ [APP_WINDOW_OPERATIONS.viewRequest]: { response: { content: [] } } });
  const client = new AppWindowClient(fake);
  assert.deepEqual(await client.viewRequest("win_1", "tools/call", { name: "poll", arguments: {} }), { content: [] });
  await assert.rejects(client.viewRequest("win_1", "prompts/get", {}), TypeError);
  // The method is in the envelope and the parameters are the body.
  assert.deepEqual(fake.calls, [["commandWithBody", APP_WINDOW_OPERATIONS.viewRequest, { windowId: "win_1", method: "tools/call" }, { name: "poll", arguments: {} }]]);
});

test("a view response too large for a command result is fetched as a body", async () => {
  const large = { content: [{ type: "text", text: "v".repeat(100 * 1024) }] };
  const fake = transport({
    [APP_WINDOW_OPERATIONS.viewRequest]: { responseId: "res_1" },
    [APP_WINDOW_OPERATIONS.viewResponse]: { result: { windowId: "win_1" }, body: new TextEncoder().encode(JSON.stringify(large)) },
  });
  assert.deepEqual(await new AppWindowClient(fake).viewRequest("win_1", "tools/call", { name: "poll" }), large);
  assert.deepEqual(fake.calls.at(-1), ["queryWithBody", APP_WINDOW_OPERATIONS.viewResponse, { windowId: "win_1", responseId: "res_1" }]);
  // Neither a response nor a handle is not an answer.
  await assert.rejects(new AppWindowClient(transport({ [APP_WINDOW_OPERATIONS.viewRequest]: {} })).viewRequest("win_1", "tools/call", {}), TypeError);
});

test("onChanged follows the server event until unsubscribed", () => {
  const fake = transport();
  const client = new AppWindowClient(fake);
  let seen = 0;
  const stop = client.onChanged(() => { seen += 1; });
  fake.emit(APP_WINDOW_EVENTS.changed);
  fake.emit("mcp.approvals.changed");
  assert.equal(seen, 1);
  stop();
  fake.emit(APP_WINDOW_EVENTS.changed);
  assert.equal(seen, 1);
  const { subscribe: _subscribe, ...withoutSubscriptions } = fake;
  assert.throws(() => new AppWindowClient(withoutSubscriptions).onChanged(() => {}), /unavailable/);
});

test("a message with attachments is begun, sent in acknowledged parts, and finished; a failure cancels it", async () => {
  const PART = 256 * 1024;
  const calls = [];
  const fail = { at: undefined };
  const fake = {
    command: async (operation, payload) => {
      calls.push([operation, payload]);
      if (operation === fail.at) throw new Error("refused");
      return operation === APP_WINDOW_OPERATIONS.messageBegin ? { uploadId: "up_1" } : {};
    },
    commandWithBody: async (operation, payload, body) => {
      calls.push([operation, payload, body.byteLength]);
      if (operation === fail.at) throw new Error("refused");
      return {};
    },
  };
  const client = new AppWindowClient(fake);
  const files = [{ name: "photo.jpg", size: PART + 10 }, { name: "empty.txt", size: 0 }, { name: "note.txt", size: 3 }];
  const reads = [];
  const read = async (file, offset, length) => { reads.push([file, offset, length]); return new Uint8Array(length); };
  const progress = [];
  await client.sendMessageWithAttachments("win_1", "", files, read, { onProgress: (sent, total) => progress.push([sent, total]) });
  assert.deepEqual(reads, [[0, 0, PART], [0, PART, 10], [2, 0, 3]]);
  assert.deepEqual(calls, [
    [APP_WINDOW_OPERATIONS.messageBegin, { windowId: "win_1", text: "", attachments: files }],
    [APP_WINDOW_OPERATIONS.messagePart, { windowId: "win_1", uploadId: "up_1", file: 0, offset: 0 }, PART],
    [APP_WINDOW_OPERATIONS.messagePart, { windowId: "win_1", uploadId: "up_1", file: 0, offset: PART }, 10],
    [APP_WINDOW_OPERATIONS.messagePart, { windowId: "win_1", uploadId: "up_1", file: 2, offset: 0 }, 3],
    [APP_WINDOW_OPERATIONS.messageFinish, { windowId: "win_1", uploadId: "up_1" }],
  ]);
  assert.deepEqual(progress, [[PART, PART + 13], [PART + 10, PART + 13], [PART + 13, PART + 13]]);

  // A refused part, a view that returns the wrong bytes, and an abort each cancel the upload.
  for (const attempt of [
    () => { fail.at = APP_WINDOW_OPERATIONS.messagePart; return client.sendMessageWithAttachments("win_1", "hi", files, read); },
    () => { fail.at = undefined; return client.sendMessageWithAttachments("win_1", "hi", files, async () => new Uint8Array(PART + 1)); },
    () => { fail.at = undefined; const stop = new AbortController(); return client.sendMessageWithAttachments("win_1", "hi", files, async (_file, _offset, length) => { stop.abort(); return new Uint8Array(length); }, { signal: stop.signal }); },
  ]) {
    calls.length = 0;
    await assert.rejects(attempt());
    assert.deepEqual(calls.at(-1), [APP_WINDOW_OPERATIONS.messageCancel, { windowId: "win_1", uploadId: "up_1" }]);
    assert.ok(!calls.some(([operation]) => operation === APP_WINDOW_OPERATIONS.messageFinish));
  }

  // A refused begin uploads nothing and has nothing to cancel.
  calls.length = 0;
  fail.at = APP_WINDOW_OPERATIONS.messageBegin;
  await assert.rejects(client.sendMessageWithAttachments("win_1", "hi", files, read));
  assert.equal(calls.length, 1);

  // Nothing is sent for a list the server would refuse anyway.
  calls.length = 0;
  fail.at = undefined;
  await assert.rejects(client.sendMessageWithAttachments("win_1", "hi", [], read), TypeError);
  await assert.rejects(client.sendMessageWithAttachments("win_1", "hi", Array.from({ length: 17 }, () => files[2]), read), TypeError);
  await assert.rejects(client.sendMessageWithAttachments("win_1", "hi", [{ name: "", size: 1 }], read), TypeError);
  await assert.rejects(client.sendMessageWithAttachments("win_1", "hi", [{ name: "a", size: -1 }], read), TypeError);
  await assert.rejects(new AppWindowClient({ command: fake.command }).sendMessageWithAttachments("win_1", "hi", files, read), /unavailable/);
  assert.equal(calls.length, 0);
});
