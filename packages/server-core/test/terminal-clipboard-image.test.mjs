import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createOperationDispatcher,
  createTerminalOperationRegistry,
  OrderedEventJournal,
  TerminalService,
  TERMINAL_MATERIALIZE_CLIPBOARD_IMAGE_OPERATION,
  MAX_CLIPBOARD_IMAGE_BYTES,
} from "../dist/index.js";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

function createPtyFactory() {
  const processes = [];
  return {
    processes,
    spawn(options) {
      const process = {
        pid: 9000 + processes.length,
        options,
        writes: [],
        resizes: [],
        write() {},
        resize() {},
        kill() {},
        onData() {
          return () => {};
        },
        onExit() {
          return () => {};
        },
      };
      processes.push(process);
      return process;
    },
  };
}

function request(operation, payload, commandId, body = new Uint8Array(), authScope = "write") {
  return {
    envelope: {
      type: "command",
      commandId,
      correlationId: `${commandId}-correlation`,
      operation,
      payload,
    },
    body,
    context: {
      connectionId: "connection-client-a",
      clientId: "client-a",
      authScope,
      signal: new AbortController().signal,
    },
  };
}

async function withRegistry(run) {
  const directory = await mkdtemp(join(tmpdir(), "terminay-clipboard-image-"));
  const pty = createPtyFactory();
  const service = new TerminalService({
    serverId: "server-a",
    ptyFactory: pty,
    generateSessionId: () => "session-a",
  });
  const session = await service.createSession({ projectId: "project-a", cols: 80, rows: 24 });
  const journal = new OrderedEventJournal();
  const registry = createTerminalOperationRegistry({
    service,
    eventJournal: journal,
    allowUnresolvedTestSessions: true,
    clipboardScratchDirectory: directory,
  });
  const dispatcher = createOperationDispatcher(registry.operations);
  const identity = {
    serverId: "server-a",
    projectId: "project-a",
    sessionId: session.sessionId,
  };
  try {
    return await run({ dispatcher, identity, directory, service });
  } finally {
    registry.closeConnection("connection-client-a");
    await rm(directory, { recursive: true, force: true });
  }
}

test("materializes a PNG into the server-owned clipboard directory", async () => {
  await withRegistry(async ({ dispatcher, identity, directory }) => {
    const result = await dispatcher.command(
      request(
        TERMINAL_MATERIALIZE_CLIPBOARD_IMAGE_OPERATION,
        { identity, mimeType: "image/png" },
        "clip-1",
        PNG,
      ),
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(typeof result.result.path, "string");
    assert.equal(result.result.path.startsWith(directory), true);
    assert.match(result.result.path, /clipboard-[0-9a-f-]+\.png$/u);
    assert.deepEqual(Uint8Array.from(await readFile(result.result.path)), PNG);
  });
});

test("rejects a client-supplied destination path", async () => {
  await withRegistry(async ({ dispatcher, identity }) => {
    const result = await dispatcher.command(
      request(
        TERMINAL_MATERIALIZE_CLIPBOARD_IMAGE_OPERATION,
        { identity, mimeType: "image/png", path: "/etc/passwd" },
        "clip-path",
        PNG,
      ),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation");
  });
});

test("rejects an oversized clipboard image", async () => {
  await withRegistry(async ({ dispatcher, identity }) => {
    const body = new Uint8Array(MAX_CLIPBOARD_IMAGE_BYTES + 1);
    body.set(PNG.subarray(0, 8));
    const result = await dispatcher.command(
      request(
        TERMINAL_MATERIALIZE_CLIPBOARD_IMAGE_OPERATION,
        { identity, mimeType: "image/png" },
        "clip-large",
        body,
      ),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code === "resource" || result.error.code === "validation", true);
  });
});

test("rejects an unsupported MIME type", async () => {
  await withRegistry(async ({ dispatcher, identity }) => {
    const result = await dispatcher.command(
      request(
        TERMINAL_MATERIALIZE_CLIPBOARD_IMAGE_OPERATION,
        { identity, mimeType: "image/heic" },
        "clip-heic",
        PNG,
      ),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation");
  });
});

test("rejects a missing session", async () => {
  await withRegistry(async ({ dispatcher }) => {
    const result = await dispatcher.command(
      request(
        TERMINAL_MATERIALIZE_CLIPBOARD_IMAGE_OPERATION,
        {
          identity: {
            serverId: "server-a",
            projectId: "project-a",
            sessionId: "missing-session",
          },
          mimeType: "image/png",
        },
        "clip-missing",
        PNG,
      ),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "not_found");
  });
});

test("rejects a read-only client", async () => {
  await withRegistry(async ({ dispatcher, identity }) => {
    const result = await dispatcher.command(
      request(
        TERMINAL_MATERIALIZE_CLIPBOARD_IMAGE_OPERATION,
        { identity, mimeType: "image/png" },
        "clip-read",
        PNG,
        "read",
      ),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "forbidden");
  });
});
