import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_CHAT_OPERATIONS, AgentChatClient, merge } from "../dist/index.js";

function fakeTransport() {
  let revision = 1;
  let entries = [];
  let listener;
  let resync;
  const queries = [];
  const view = (after) => ({
    id: "c1", title: "Pixel", providerId: "p", providerName: "Echo", reach: { kind: "workspace" },
    status: "idle", revision, pendingApprovals: 0, createdAt: 0,
    order: entries.map((entry) => entry.id), entries: entries.filter((entry) => entry.revision > after),
  });
  return {
    queries,
    add(entry) { revision += 1; entries.push({ ...entry, revision, createdAt: 0 }); listener?.({ payload: { chatId: "c1", revision } }); },
    edit(id, text) { revision += 1; entries = entries.map((entry) => entry.id === id ? { ...entry, text, revision } : entry); listener?.({ payload: { chatId: "c1", revision } }); },
    remove() { listener?.({ payload: { chatId: "c1", revision: revision + 1, removed: true } }); },
    resync() { resync?.(); },
    transport: {
      async query(operation, payload) {
        queries.push([operation, payload]);
        if (operation === AGENT_CHAT_OPERATIONS.get) return view(payload.afterRevision);
        throw new Error("unexpected");
      },
      async command() { return {}; },
      subscribe(event, onEvent, onResync) { assert.equal(event, "agentChat.changed"); listener = onEvent; resync = onResync; return () => { listener = undefined; }; },
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test("a mirror reads only what changed after its revision and keeps the server's order", async () => {
  const server = fakeTransport();
  server.add({ id: "e1", kind: "user", text: "hi" });
  const client = new AgentChatClient(server.transport);
  const seen = [];
  const stop = await client.mirror("c1", (chat) => seen.push(chat));
  server.add({ id: "e2", kind: "notice", tone: "info", text: "one" });
  await tick();
  server.edit("e2", "two");
  await tick();
  const latest = seen.at(-1);
  assert.deepEqual(latest.entries.map((entry) => [entry.id, entry.text]), [["e1", "hi"], ["e2", "two"]]);
  const afters = server.queries.map(([, payload]) => payload.afterRevision);
  assert.equal(afters[0], 0);
  assert.ok(afters.slice(1).every((after) => after > 0));
  stop();
});

test("a resync reads the whole chat and a removal clears it", async () => {
  const server = fakeTransport();
  const client = new AgentChatClient(server.transport);
  const seen = [];
  await client.mirror("c1", (chat) => seen.push(chat));
  server.resync();
  await tick();
  assert.equal(server.queries.at(-1)[1].afterRevision, 0);
  server.remove();
  assert.equal(seen.at(-1), undefined);
});

test("merge drops entries the server no longer lists", () => {
  const base = { id: "c1", revision: 3, order: ["a", "b"], entries: [{ id: "a", revision: 2 }, { id: "b", revision: 3 }] };
  const next = merge(base, { ...base, revision: 5, order: ["b", "c"], entries: [{ id: "c", revision: 5 }] }, 3);
  assert.deepEqual(next.entries.map((entry) => entry.id), ["b", "c"]);
});
