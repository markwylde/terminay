import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { ConnectionPool, RemoteTerminalManager } from "../dist/index.js";
import { parseProcessV1 } from "../dist/processObservation.js";

class FakeExecChannel extends EventEmitter {
  stderr = new EventEmitter();
  written = "";
  constructor(response) { super(); this.response = response; }
  write(data) { this.written += data; return true; }
  end() { queueMicrotask(() => { this.emit("data", this.response); this.emit("close", 0); }); }
}
class FakeClient extends EventEmitter {
  execCommand = "";
  execChannel;
  end() { this.emit("close"); }
  shell(options, callback) { this.options = options; this.channel = new FakePty(); callback(null, this.channel); }
  exec(command, callback) {
    this.execCommand = command;
    this.execChannel = new FakeExecChannel(this.processStdout ?? "unavailable\n");
    callback(null, this.execChannel);
  }
}
class FakePty extends EventEmitter {
  stderr = new EventEmitter();
  writes = [];
  write(value) { this.writes.push(value); return true; }
  setWindow() {}
  signal() {}
  end() { this.emit("close", 0, null); }
}

const profile = { id: "p", revision: 1, hostname: "host", port: 22, username: "u", auth: { mode: "agent" }, defaultRoot: "/home/u", hostVerification: "strict", timeouts: { connectMs: 1000, handshakeMs: 1000, keepaliveMs: 1000 } };
const store = { get: () => structuredClone(profile), setStatus: async () => {} };

test("proof-bound process observation returns the session-leader cwd", async () => {
  const client = new FakeClient();
  client.processStdout = "available\n/home/vms/test\n";
  const pool = new ConnectionPool({ store, trust: {}, broker: {}, connect: async () => client });
  const manager = new RemoteTerminalManager(pool);
  await manager.create({ sessionId: "s1", profileId: "p", revision: 1, root: "/home/vms" });
  const started = manager.observeProcess({ sessionId: "s1" });
  assert.equal(started.protocol, "terminay-target-helper/process-v1");
  assert.equal(started.version, 1);
  const polled = await manager.pollProcess({ observationId: started.observationId, sessionId: "s1" });
  assert.equal(polled.state, "available");
  assert.equal(polled.cwd, "/home/vms/test");
  assert.equal(polled.foregroundProcess, null);
  assert.match(client.execCommand, /\/bin\/sh -c /);
  assert.equal(client.execChannel.written, `${client.options.env.TERMINAY_SESSION_PROOF}\n`);
  assert.deepEqual(manager.stopProcess({ observationId: started.observationId, sessionId: "s1" }), {
    observationId: started.observationId,
    stopped: true,
  });
});

test("missing session proof is an explicit unavailable cwd", async () => {
  const client = new FakeClient();
  const pool = new ConnectionPool({ store, trust: {}, broker: {}, connect: async () => client });
  const manager = new RemoteTerminalManager(pool);
  await manager.create({ sessionId: "s1", profileId: "p", revision: 1, root: "/home/vms" });
  const started = manager.observeProcess({ sessionId: "s1" });
  const polled = await manager.pollProcess({ observationId: started.observationId, sessionId: "s1" });
  assert.equal(polled.state, "unavailable");
  assert.equal(polled.cwd, null);
});

test("process v1 parser admits only an absolute proven cwd", () => {
  assert.deepEqual(parseProcessV1("available\n/home/vms/test\n"), {
    state: "available",
    cwd: "/home/vms/test",
    foregroundProcess: null,
  });
  assert.equal(parseProcessV1("unavailable\n").state, "unavailable");
  assert.equal(parseProcessV1("available\nrelative\n").state, "unavailable");
});
