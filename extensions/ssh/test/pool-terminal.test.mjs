import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { ConnectionPool, RemoteTerminalManager } from "../dist/index.js";

class FakeClient extends EventEmitter { end() { this.emit("close"); } shell(options, callback) { this.options = options; this.channel = new FakeChannel(); callback(null, this.channel); } }
class FakeChannel extends EventEmitter { constructor() { super(); this.stderr = new EventEmitter(); this.writes = []; this.windows = []; this.pauses = 0; this.resumes = 0; } write(value) { this.writes.push(value); return true; } setWindow(...args) { this.windows.push(args); } signal(value) { this.lastSignal = value; } pause() { this.pauses++; } resume() { this.resumes++; } end() { this.emit("close", 0, null); } }
const profile = { id: "p", revision: 1, hostname: "host", port: 22, username: "u", auth: { mode: "agent" }, defaultRoot: "/home/u", hostVerification: "strict", timeouts: { connectMs: 1000, handshakeMs: 1000, keepaliveMs: 1000 } };
const store = { get: () => structuredClone(profile), setStatus: async () => {} };

test("pool shares only exact revision, bounds channels, and exposes reconnect state", async () => {
  let connections = 0; const clients = [];
  const pool = new ConnectionPool({ store, trust: {}, broker: {}, maxChannels: 2, connect: async () => { connections++; const c = new FakeClient(); clients.push(c); return c; } });
  const a = await pool.acquire("p", 1), b = await pool.acquire("p", 1); assert.equal(connections, 1);
  await assert.rejects(() => pool.acquire("p", 1), (e) => e.code === "conflict");
  a.release(); clients[0].emit("close"); assert.equal(pool.status("p", 1).status, "reconnecting"); b.release();
  const c = await pool.acquire("p", 1); assert.equal(connections, 2); c.release(); await pool.close();
});

test("profile revisions never share a transport and retry remains explicit", async () => {
  let connections = 0; const revisionStore = { ...store, get: (id, revision) => ({ ...profile, revision }) };
  const pool = new ConnectionPool({ store: revisionStore, trust: {}, broker: {}, connect: async () => { connections++; return new FakeClient(); } });
  const one = await pool.acquire("p", 1), two = await pool.acquire("p", 2); assert.equal(connections, 2); one.release(); two.release();
});

test("PTY launch uses canonical quoted root, filters environment, and adapts bytes/resize/exit", async () => {
  const client = new FakeClient(); const pool = new ConnectionPool({ store, trust: {}, broker: {}, connect: async () => client }); const manager = new RemoteTerminalManager(pool, { maxBufferedBytes: 16 });
  const created = await manager.create({ sessionId: "s1", profileId: "p", revision: 1, root: "/home/u/it's here", rows: 30, cols: 100, environment: { TERM: "xterm", TERMINAY_MCP_SOCKET: "/local/secret", HOME: "/local" } });
  assert.equal(created.capabilities.cwd, false); assert.equal(created.capabilities.agentJournal, true); assert.equal(client.options.env.TERM, "xterm"); assert.match(client.options.env.TERMINAY_SESSION_PROOF, /^[A-Za-z0-9_-]{43}$/u); assert.match(client.channel.writes[0], /cd -- '\/home\/u\/it'\\''s here'/); assert.match(client.channel.writes[0], /exec "\$\{SHELL:-\/bin\/sh\}" -l/);
  client.channel.emit("data", Buffer.from("hello")); assert.equal(Buffer.from(manager.read({ sessionId: "s1" }).data, "base64").toString(), "hello");
  client.channel.emit("data", Buffer.from("0123456789abcdef")); assert.equal(client.channel.pauses, 1); manager.read({ sessionId: "s1", maxBytes: 16 }); assert.equal(client.channel.resumes, 1);
  manager.resize({ sessionId: "s1", cols: 120, rows: 40 }); assert.deepEqual(client.channel.windows[0], [40, 120, 0, 0]);
  client.emit("close"); const exit = manager.read({ sessionId: "s1" }).exit; assert.equal(exit.interrupted, true); assert.equal(exit.reason, "transport-lost");
  client.emit("close"); assert.equal(manager.read({ sessionId: "s1" }).exit, exit);
});

test("no replacement terminal is manufactured after transport loss", async () => {
  let connections = 0; const client = new FakeClient(); const pool = new ConnectionPool({ store, trust: {}, broker: {}, connect: async () => { connections++; return client; } }); const manager = new RemoteTerminalManager(pool);
  await manager.create({ sessionId: "old", profileId: "p", revision: 1, root: "/home/u" }); client.emit("close");
  await assert.rejects(async () => manager.input({ sessionId: "old", data: "x" }), (e) => e.code === "transport-lost"); assert.equal(connections, 1);
});
