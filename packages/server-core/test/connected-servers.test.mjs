import assert from "node:assert/strict";
import test from "node:test";
import { CONNECTED_SERVER_EVENTS, CONNECTED_SERVER_OPERATIONS, ConnectedServerRegistry } from "../dist/index.js";

function setup(stored) {
  let persisted = stored;
  const secrets = new Map();
  const events = [];
  const vault = {
    secrets,
    put: async ({ id, value }) => { if (secrets.has(id)) throw new Error("exists"); secrets.set(id, new TextDecoder().decode(value)); },
    replace: async ({ id, value }) => { if (!secrets.has(id)) throw new Error("missing"); secrets.set(id, new TextDecoder().decode(value)); },
    remove: async (id) => secrets.delete(id),
    withSecret: async (id, callback) => { if (!secrets.has(id)) throw new Error("missing"); return callback(new TextEncoder().encode(secrets.get(id))); },
  };
  const backend = { load: async () => structuredClone(persisted), commit: async (state) => { persisted = structuredClone(state); } };
  const registry = new ConnectedServerRegistry({ backend, vault, eventJournal: { append: (event, payload) => events.push({ event, payload }) } });
  return { registry, vault, events, backend, persisted: () => persisted };
}

const local = (overrides = {}) => ({ name: "diagrams", enabled: true, transport: "stdio", command: "npx", args: ["-y", "diagrams-mcp"], ...overrides });
const context = (overrides = {}) => ({ clientId: "desktop", connectionId: "c", authScope: "write", signal: new AbortController().signal, ...overrides });
const request = (payload, ctx) => ({ envelope: { payload }, body: new Uint8Array(), context: context(ctx) });

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (error) => { assert.equal(error.code, code); return true; });
}

test("a local server is added, persisted, and announced; its credentials go to the vault, not to the list", async () => {
  const { registry, vault, events, persisted } = setup();
  const saved = await registry.save(local({ env: { API_TOKEN: "s3cret", REGION: "eu" } }));
  assert.deepEqual(saved, { name: "diagrams", enabled: true, transport: "stdio", command: "npx", args: ["-y", "diagrams-mcp"], envNames: ["API_TOKEN", "REGION"], headerNames: [] });
  assert.deepEqual(registry.list(), [saved]);
  assert.deepEqual(persisted().servers, [saved]);
  // Neither the list nor what is persisted carries a value.
  assert.equal(JSON.stringify(persisted()).includes("s3cret"), false);
  assert.deepEqual([...vault.secrets.values()].sort(), ["eu", "s3cret"]);
  assert.equal(events.at(-1).event, CONNECTED_SERVER_EVENTS.changed);
});

test("the privileged server resolves entries with their credentials", async () => {
  const { registry } = setup();
  await registry.save(local({ env: { API_TOKEN: "s3cret" } }));
  await registry.save({ name: "remote", enabled: false, transport: "http", url: "https://mcp.example/mcp", headers: { Authorization: "Bearer abc" } });
  assert.deepEqual(await registry.resolved(), [
    { name: "diagrams", enabled: true, transport: "stdio", command: "npx", args: ["-y", "diagrams-mcp"], env: { API_TOKEN: "s3cret" } },
    { name: "remote", enabled: false, transport: "http", url: "https://mcp.example/mcp", headers: { Authorization: "Bearer abc" } },
  ]);
});

test("an edit keeps credentials it does not mention, replaces those it sets, and removes those set to null", async () => {
  const { registry, vault } = setup();
  await registry.save(local({ env: { KEEP: "kept", CHANGE: "old", DROP: "gone" } }));
  const edited = await registry.save(local({ previousName: "diagrams", command: "node", args: [], env: { CHANGE: "new", DROP: null, ADD: "added" } }));
  assert.deepEqual(edited.envNames, ["ADD", "CHANGE", "KEEP"]);
  assert.equal(edited.command, "node");
  assert.deepEqual((await registry.resolved())[0].env, { ADD: "added", CHANGE: "new", KEEP: "kept" });
  assert.equal(vault.secrets.size, 3);
});

test("renaming an entry moves its credentials and leaves none behind", async () => {
  const { registry, vault } = setup();
  await registry.save(local({ env: { TOKEN: "abc" } }));
  const before = [...vault.secrets.keys()];
  const renamed = await registry.save(local({ previousName: "diagrams", name: "drawings" }));
  assert.equal(renamed.name, "drawings");
  assert.deepEqual(renamed.envNames, ["TOKEN"]);
  assert.deepEqual((await registry.resolved())[0].env, { TOKEN: "abc" });
  assert.equal(vault.secrets.size, 1);
  assert.notDeepEqual([...vault.secrets.keys()], before);
});

test("changing a local server into a remote one drops its environment credentials", async () => {
  const { registry, vault } = setup();
  await registry.save(local({ env: { TOKEN: "abc" } }));
  const remote = await registry.save({ previousName: "diagrams", name: "diagrams", enabled: true, transport: "http", url: "https://mcp.example/mcp", headers: { "X-Key": "k" } });
  assert.deepEqual([remote.envNames, remote.headerNames], [[], ["X-Key"]]);
  assert.deepEqual([...vault.secrets.values()], ["k"]);
});

test("removing an entry removes its credentials", async () => {
  const { registry, vault } = setup();
  await registry.save(local({ env: { TOKEN: "abc" } }));
  assert.equal(await registry.remove("diagrams"), true);
  assert.deepEqual(registry.list(), []);
  assert.equal(vault.secrets.size, 0);
  assert.equal(await registry.remove("diagrams"), false);
});

test("a duplicate name is rejected and the list is unchanged", async () => {
  const { registry } = setup();
  await registry.save(local());
  await rejectsWith(registry.save(local({ command: "other" })), "conflict");
  await registry.save(local({ name: "second" }));
  await rejectsWith(registry.save(local({ previousName: "second", name: "diagrams" })), "conflict");
  assert.deepEqual(registry.list().map((server) => [server.name, server.command]), [["diagrams", "npx"], ["second", "npx"]]);
  await rejectsWith(registry.save(local({ previousName: "missing" })), "not_found");
});

test("invalid definitions are rejected before anything is stored", async () => {
  const { registry, vault } = setup();
  for (const bad of [
    local({ name: "Has Spaces" }),
    local({ name: "UPPER" }),
    local({ name: "" }),
    local({ name: "a".repeat(64) }),
    local({ command: "   " }),
    local({ args: "not-a-list" }),
    local({ env: { "bad name": "x" } }),
    local({ env: { OK: 7 } }),
    { name: "remote", enabled: true, transport: "http", url: "ftp://example.com" },
    { name: "remote", enabled: true, transport: "http", url: "https://user:pass@example.com/mcp" },
    { name: "remote", enabled: true, transport: "http", url: "not a url" },
    { name: "remote", enabled: true, transport: "http", url: "https://example.com", headers: { "Bad Header": "x" } },
    { name: "odd", enabled: true, transport: "carrier-pigeon" },
  ])
    await rejectsWith(registry.save(bad), "validation");
  assert.deepEqual(registry.list(), []);
  assert.equal(vault.secrets.size, 0);
});

test("stored entries are loaded, and a damaged one is dropped without losing the rest", async () => {
  const { registry } = setup({
    version: 1,
    servers: [
      { name: "ok", enabled: false, transport: "stdio", command: "node", args: ["a.js"], envNames: ["TOKEN", "bad name"], headerNames: [] },
      { name: "Broken Name", transport: "stdio", command: "node" },
      "junk",
    ],
  });
  await registry.load();
  assert.deepEqual(registry.list(), [{ name: "ok", enabled: false, transport: "stdio", command: "node", args: ["a.js"], envNames: ["TOKEN"], headerNames: [] }]);
});

test("clients list entries with live status and never receive a credential", async () => {
  const { registry } = setup();
  registry.bindStatus(() => [{ name: "diagrams", state: "connected", tools: 4 }]);
  const { queries, commands, policies } = registry.operations();
  await commands[CONNECTED_SERVER_OPERATIONS.save](request(local({ env: { API_TOKEN: "s3cret" } })));
  const listed = await queries[CONNECTED_SERVER_OPERATIONS.list](request({}));
  assert.deepEqual(listed.status, [{ name: "diagrams", state: "connected", tools: 4 }]);
  assert.deepEqual(listed.servers[0].envNames, ["API_TOKEN"]);
  assert.equal(JSON.stringify(listed).includes("s3cret"), false);
  for (const operation of Object.values(CONNECTED_SERVER_OPERATIONS)) assert.deepEqual(policies[operation], { scope: "write" });
});

test("managing servers needs the authority that managing MCP permissions needs", async () => {
  const { registry } = setup();
  const { queries, commands } = registry.operations();
  for (const ctx of [{ authScope: "read" }, { claims: { projectId: "p", sessionId: "s" } }]) {
    await rejectsWith(queries[CONNECTED_SERVER_OPERATIONS.list](request({}, ctx)), "forbidden");
    await rejectsWith(commands[CONNECTED_SERVER_OPERATIONS.save](request(local(), ctx)), "forbidden");
    await rejectsWith(commands[CONNECTED_SERVER_OPERATIONS.remove](request({ name: "diagrams" }, ctx)), "forbidden");
  }
  assert.deepEqual(registry.list(), []);
});

test("protocol saves report validation, conflict, and missing entries as such", async () => {
  const { registry } = setup();
  const { commands } = registry.operations();
  await commands[CONNECTED_SERVER_OPERATIONS.save](request(local()));
  await rejectsWith(commands[CONNECTED_SERVER_OPERATIONS.save](request(local())), "conflict");
  await rejectsWith(commands[CONNECTED_SERVER_OPERATIONS.save](request(local({ name: "Bad Name" }))), "validation");
  await rejectsWith(commands[CONNECTED_SERVER_OPERATIONS.remove](request({ name: "nope" })), "not_found");
  await rejectsWith(commands[CONNECTED_SERVER_OPERATIONS.remove](request({ name: "Bad Name" })), "validation");
  assert.deepEqual(await commands[CONNECTED_SERVER_OPERATIONS.remove](request({ name: "diagrams" })), { name: "diagrams" });
});

test("no more than 32 servers can be connected", async () => {
  const { registry } = setup();
  for (let index = 0; index < 32; index += 1) await registry.save(local({ name: `server-${index}` }));
  await rejectsWith(registry.save(local({ name: "one-too-many" })), "resource");
  assert.equal(registry.list().length, 32);
});
