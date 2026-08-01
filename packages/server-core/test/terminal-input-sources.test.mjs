import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRecordingInputCapture,
  RecordingService,
  TerminalInputSourceAdapter,
  TerminalService,
  TerminalServiceError,
} from "../dist/index.js";

const identity = { serverId: "server-input", projectId: "project-input", sessionId: "session-input" };

function fakePty(options = {}) {
  const processes = [];
  return {
    processes,
    spawn() {
      const data = new Set();
      const exits = new Set();
      const process = {
        writes: [],
        resizes: [],
        releases: [],
        write(value) {
          this.writes.push(new Uint8Array(value));
          if (options.slow) return new Promise((resolve) => this.releases.push(resolve));
        },
        resize(dimensions) { this.resizes.push({ ...dimensions }); },
        kill() {},
        onData(listener) { data.add(listener); return () => data.delete(listener); },
        onExit(listener) { exits.add(listener); return () => exits.delete(listener); },
      };
      processes.push(process);
      return process;
    },
  };
}

function authorization(clientId, scope = "write") {
  return { ...identity, clientId, scope };
}

test("input sources serialize keyboard, paste, macro, dictation, MCP, and remote writes", async () => {
  const pty = fakePty();
  const service = new TerminalService({ serverId: identity.serverId, ptyFactory: pty });
  await service.createSession({ projectId: identity.projectId, sessionId: identity.sessionId, cols: 80, rows: 24 });
  const adapter = new TerminalInputSourceAdapter(service, { maxQueuedInputBytes: 128 });
  const sources = ["keyboard", "paste", "macro", "dictation", "mcp", "remote"];
  const results = await Promise.all(sources.map((source, index) => adapter.write({
    identity,
    clientId: `client-${index}`,
    source,
    data: `${source}-${index}`,
    sequence: 1,
    authorization: authorization(`client-${index}`),
  })));

  assert.deepEqual(results.map((result) => result.source), sources);
  assert.deepEqual(pty.processes[0].writes.map((bytes) => new TextDecoder().decode(bytes)), sources.map((source, index) => `${source}-${index}`));
  assert.throws(
    () => adapter.write({ identity, clientId: "keyboard-client", source: "keyboard", data: "spoofed", authorization: authorization("other-client") }),
    (error) => error instanceof TerminalServiceError && error.code === "forbidden",
  );
  assert.throws(
    () => adapter.write({ identity, clientId: "client-0", source: "keyboard", data: "duplicate", sequence: 1, authorization: authorization("client-0") }),
    (error) => error instanceof TerminalServiceError && error.code === "invalid_position",
  );
  await service.shutdown();
});

test("one recording boundary applies input consent to every accepted input source", async () => {
  const home = await mkdtemp(join(tmpdir(), "terminay-input-capture-"));
  const pty = fakePty();
  const service = new TerminalService({ serverId: identity.serverId, ptyFactory: pty });
  const recording = new RecordingService({ homeDirectory: home, recordingRoot: join(home, "recordings") });
  try {
    await service.createSession({ projectId: identity.projectId, sessionId: identity.sessionId, cols: 80, rows: 24 });
    const started = recording.start(identity.sessionId, { projectId: identity.projectId, captureInput: true });
    const adapter = new TerminalInputSourceAdapter(service, { onInputAccepted: createRecordingInputCapture(recording) });
    const sources = ["keyboard", "paste", "macro", "dictation", "mcp", "remote"];
    for (const source of sources) {
      await adapter.write({
        identity,
        clientId: `${source}-client`,
        source,
        data: `${source}-input`,
        authorization: authorization(`${source}-client`),
      });
    }
    recording.finalize(identity.sessionId);
    const replay = recording.readRecordingChunk({ recordingId: started.recordingId, start: 0, maxBytes: 64 * 1024 });
    const inputRecords = replay.content.split("\n").filter((line) => line.includes('"i"'));
    assert.equal(inputRecords.length, sources.length);
    for (const source of sources) assert.equal(inputRecords.some((line) => line.includes(`${source}-input`)), true);
    assert.deepEqual(pty.processes[0].writes.map((bytes) => new TextDecoder().decode(bytes)), sources.map((source) => `${source}-input`));
  } finally {
    await service.shutdown();
    await rm(home, { recursive: true, force: true });
  }
});

test("input source queue applies bounded backpressure while preserving write order", async () => {
  const pty = fakePty({ slow: true });
  const service = new TerminalService({ serverId: identity.serverId, ptyFactory: pty });
  await service.createSession({ projectId: identity.projectId, sessionId: identity.sessionId, cols: 80, rows: 24 });
  const adapter = new TerminalInputSourceAdapter(service, { maxQueuedInputBytes: 3 });
  const first = adapter.write({ identity, clientId: "client-a", source: "keyboard", data: "a", authorization: authorization("client-a") });
  const second = adapter.write({ identity, clientId: "client-b", source: "paste", data: "bc", authorization: authorization("client-b") });
  assert.throws(
    () => adapter.write({ identity, clientId: "client-c", source: "remote", data: "d", authorization: authorization("client-c") }),
    (error) => error instanceof TerminalServiceError && error.code === "queue_overflow",
  );
  assert.deepEqual(pty.processes[0].writes.map((bytes) => new TextDecoder().decode(bytes)), ["a"]);
  pty.processes[0].releases.shift()();
  await first;
  pty.processes[0].releases.shift()();
  await second;
  assert.deepEqual(pty.processes[0].writes.map((bytes) => new TextDecoder().decode(bytes)), ["a", "bc"]);
  await service.shutdown();
});

test("resize ownership is explicit, leases expire stale clients, and mobile viewers can claim", async () => {
  const pty = fakePty();
  const service = new TerminalService({ serverId: identity.serverId, ptyFactory: pty });
  await service.createSession({ projectId: identity.projectId, sessionId: identity.sessionId, cols: 80, rows: 24 });
  let now = 100;
  const adapter = new TerminalInputSourceAdapter(service, { now: () => now, resizeLeaseMs: 50, maxResizeLeaseMs: 100 });
  const claimA = await adapter.resize({ identity, clientId: "desktop", source: "keyboard", viewport: "wide", mode: "claim", cols: 100, rows: 30, authorization: authorization("desktop") });
  assert.equal(claimA.ownership?.clientId, "desktop");
  assert.equal(claimA.ownership?.leaseExpiresAt, 150);
  await assert.rejects(
    () => adapter.resize({ identity, clientId: "mobile", source: "remote", viewport: "mobile", mode: "claim", cols: 40, rows: 16, authorization: authorization("mobile") }),
    (error) => error instanceof TerminalServiceError && error.code === "forbidden" && error.details?.reason === "resize_owner",
  );
  await adapter.resize({ identity, clientId: "desktop", source: "keyboard", viewport: "wide", mode: "update", cols: 120, rows: 40, authorization: authorization("desktop") });
  await assert.rejects(
    () => adapter.resize({ identity, clientId: "mobile", source: "remote", viewport: "narrow", mode: "update", cols: 60, rows: 20, authorization: authorization("mobile") }),
    (error) => error instanceof TerminalServiceError && error.code === "forbidden",
  );

  now = 150;
  const mobileClaim = await adapter.resize({ identity, clientId: "mobile", source: "remote", viewport: "mobile", mode: "claim", cols: 40, rows: 16, leaseMs: 25, authorization: authorization("mobile") });
  assert.equal(mobileClaim.ownership?.viewport, "mobile");
  assert.equal(adapter.releaseClient(identity, "mobile"), true);
  assert.equal(adapter.getResizeOwnership(identity), undefined);
  const narrowClaim = await adapter.resize({ identity, clientId: "narrow", source: "remote", viewport: "narrow", mode: "claim", cols: 60, rows: 20, authorization: authorization("narrow") });
  assert.equal(narrowClaim.ownership?.clientId, "narrow");
  assert.deepEqual(await adapter.resize({ identity, clientId: "narrow", source: "remote", viewport: "narrow", mode: "release", authorization: authorization("narrow") }), { mode: "release" });
  assert.equal(adapter.getResizeOwnership(identity), undefined);
  assert.deepEqual(pty.processes[0].resizes, [{ cols: 100, rows: 30 }, { cols: 120, rows: 40 }, { cols: 40, rows: 16 }, { cols: 60, rows: 20 }]);
  await service.shutdown();
});
