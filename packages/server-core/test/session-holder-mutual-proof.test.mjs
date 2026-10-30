import test from "node:test";
import assert from "node:assert/strict";
import { connect, createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  encodeHolderFrame,
  HolderFrameDecoder,
  SessionHolder,
  SessionHolderClient,
  SessionHolderRefusedError,
} from "../dist/index.js";

// Version 2's handshake (ADR-0081 §3): each end proves it holds the holder
// credential, and the credential never crosses the channel. On Windows a pipe
// name can be taken by another user first, so the server must learn whether it
// is talking to its holder before it says anything that matters.

const GENERATION = "0123456789abcdef";
const settle = () => delay(50);
const idleTimers = { setTimeout: () => 1, clearTimeout: () => undefined };
const noPty = { spawn: () => assert.fail("no session is spawned in these tests") };

async function startHolder(t, overrides = {}) {
  const dataRoot = mkdtempSync(join(tmpdir(), "thp-"));
  const holder = await SessionHolder.start({
    dataRoot,
    generation: GENERATION,
    buildId: "build-a",
    nodePty: noPty,
    limitMs: 300_000,
    firstAttachTimeoutMs: 60_000,
    timers: idleTimers,
    ...overrides,
  });
  t.after(async () => {
    await holder.close("signal");
    rmSync(dataRoot, { recursive: true, force: true });
  });
  return holder;
}

const fullRecord = (holder, credential = holder.credential) => ({
  socketPath: holder.socketPath,
  credential,
  versions: [1, 2],
});

/** A listener that records every frame a connecting server sends it. */
async function impostor(t, answer) {
  const dataRoot = mkdtempSync(join(tmpdir(), "thi-"));
  const socketPath = join(dataRoot, "holder.sock");
  const received = [];
  const raw = [];
  let connections = 0;
  const server = createServer((socket) => {
    connections += 1;
    const frames = new HolderFrameDecoder();
    socket.on("data", (chunk) => {
      raw.push(chunk);
      for (const frame of frames.push(chunk)) {
        received.push(frame.message);
        answer(socket, frame.message);
      }
    });
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));
  t.after(() => {
    server.close();
    rmSync(dataRoot, { recursive: true, force: true });
  });
  return { socketPath, received, raw: () => Buffer.concat(raw).toString("utf8"), connections: () => connections };
}

test("a server and its holder that both hold the credential attach through the mutual proof", async (t) => {
  const holder = await startHolder(t);
  const client = await SessionHolderClient.connect(fullRecord(holder));
  assert.equal(client.version, 2);
  assert.equal(holder.isAttached, true);
  assert.deepEqual(await client.list(), []);
  await client.close();
});

test("a server with the wrong credential is refused before it proves anything", async (t) => {
  const holder = await startHolder(t);
  await assert.rejects(
    SessionHolderClient.connect(fullRecord(holder, "f".repeat(64))),
    (error) => error instanceof SessionHolderRefusedError && error.reason === "proof",
  );
  await settle();
  assert.equal(holder.isAttached, false);
});

test("an impostor holder receives no credential, no proof, and no request", async (t) => {
  const credential = "a".repeat(64);
  const fake = await impostor(t, (socket, message) => {
    if (message.type === "challenge")
      socket.write(encodeHolderFrame({ type: "proof", version: 2, nonce: "b".repeat(64), proof: "c".repeat(64) }));
  });
  await assert.rejects(
    SessionHolderClient.connect({ socketPath: fake.socketPath, credential, versions: [1, 2] }),
    (error) => error instanceof SessionHolderRefusedError && error.reason === "proof",
  );
  await settle();
  assert.deepEqual(fake.received.map((message) => message.type), ["challenge"]);
  assert.equal(fake.raw().includes(credential), false, "the credential never crosses the channel");
});

test("an impostor that answers a challenge with a hello-style welcome is not believed", async (t) => {
  const fake = await impostor(t, (socket) =>
    socket.write(encodeHolderFrame({ type: "welcome", version: 2, generation: GENERATION, buildId: "x", pid: 1, draining: false })),
  );
  await assert.rejects(
    SessionHolderClient.connect({ socketPath: fake.socketPath, credential: "a".repeat(64), versions: [1, 2] }),
    (error) => error instanceof SessionHolderRefusedError && error.reason === "proof",
  );
  assert.deepEqual(fake.received.map((message) => message.type), ["challenge"]);
});

test("a server that requires the proof never presents the credential to a holder that cannot give it", async (t) => {
  const fake = await impostor(t, () => undefined);
  await assert.rejects(
    SessionHolderClient.connect({ socketPath: fake.socketPath, credential: "a".repeat(64), versions: [1] }, { requireMutualProof: true }),
    (error) => error instanceof SessionHolderRefusedError && error.reason === "proof",
  );
  await settle();
  assert.equal(fake.connections(), 0);
});

test("a holder that requires the proof turns away a hello that presents the credential", async (t) => {
  const holder = await startHolder(t, { requireMutualProof: true });
  await assert.rejects(
    SessionHolderClient.connect({ socketPath: holder.socketPath, credential: holder.credential }),
    (error) => error instanceof SessionHolderRefusedError && error.reason === "credential",
  );
  assert.equal(holder.isAttached, false);
  const client = await SessionHolderClient.connect(fullRecord(holder), { requireMutualProof: true });
  assert.equal(client.version, 2);
  await client.close();
});

test("a peer that answers the holder's proof with a wrong one is closed and never attached", async (t) => {
  const holder = await startHolder(t);
  const received = [];
  await new Promise((resolve) => {
    const socket = connect(holder.socketPath);
    const frames = new HolderFrameDecoder();
    socket.on("data", (chunk) => {
      for (const frame of frames.push(chunk)) {
        received.push(frame.message);
        if (frame.message.type === "proof") {
          socket.write(encodeHolderFrame({ type: "prove", proof: "0".repeat(64) }));
          socket.write(encodeHolderFrame({ type: "list", id: 1 }));
        }
      }
    });
    socket.on("close", resolve);
    socket.on("connect", () =>
      socket.write(encodeHolderFrame({ type: "challenge", versions: [2], nonce: "d".repeat(64) })),
    );
  });
  assert.deepEqual(received.map((message) => message.type), ["proof"]);
  assert.equal(holder.isAttached, false);
});

test("a live version-1 holder is still reached by a server that speaks both", async (t) => {
  // A holder started by an earlier release keeps its protocol for the life of
  // its sessions (ADR-0035), so the server still greets it with a hello.
  const holder = await startHolder(t, { versions: [1] });
  const client = await SessionHolderClient.connect({ ...fullRecord(holder), versions: [1] });
  assert.equal(client.version, 1);
  assert.equal(holder.isAttached, true);
  await client.close();
});

test("a challenge never negotiates the version that presents the credential", async (t) => {
  const holder = await startHolder(t, { versions: [1] });
  await assert.rejects(
    SessionHolderClient.connect({ ...fullRecord(holder), versions: [1, 2] }),
    (error) => error instanceof SessionHolderRefusedError && error.reason === "version",
  );
});
