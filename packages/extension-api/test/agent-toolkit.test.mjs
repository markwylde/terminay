import assert from "node:assert/strict";
import test from "node:test";
import {
  createAgentLifecyclePublisher,
  createJsonlRecordDecoder,
  selectAgentMapping,
  validateAgentDirectoryListOptions,
} from "../dist/index.js";
import { createAgentExtensionHarness, fixtureTerminal } from "../dist/testing.js";
import { defineAgentProvider, defineExtension, jsonlSession } from "../dist/index.js";

const bytes = (value) => new TextEncoder().encode(value);

test("JSONL decoder preserves split UTF-8 and partial records", () => {
  const decoder = createJsonlRecordDecoder(64);
  const encoded = bytes('{"title":"café"}\n{"n":2}\n');
  assert.deepEqual(decoder.push(encoded.slice(0, 15)), []);
  assert.deepEqual(decoder.push(encoded.slice(15, 18)), [{ title: "café" }]);
  assert.deepEqual(decoder.push(encoded.slice(18)), [{ n: 2 }]);
});

test("JSONL decoder discards an over-limit record through its newline", () => {
  const decoder = createJsonlRecordDecoder(12);
  assert.deepEqual(decoder.push(bytes('{"too":"long')), []);
  assert.deepEqual(decoder.push(bytes(' indeed"}\n{"ok":1}\n')), [{ ok: 1 }]);
});

test("JSONL decoder resets partial state on truncate, replacement, and explicit reset", () => {
  const decoder = createJsonlRecordDecoder();
  decoder.push(bytes('{"stale":'));
  assert.deepEqual(decoder.push(bytes('{"truncate":1}\n'), true), [{ truncate: 1 }]);
  decoder.push(bytes('{"stale":'));
  decoder.reset();
  assert.deepEqual(decoder.push(bytes('{"replacement":1}\n')), [{ replacement: 1 }]);
});

test("mapping selection uses the greatest compatible mapping and deterministic fallbacks", () => {
  const mappings = [
    { providerVersion: "2.0.0", value: "v2" },
    { providerVersion: "1.1.0", value: "v1.1" },
    { providerVersion: "1.0.0", value: "v1" },
  ];
  assert.equal(selectAgentMapping(mappings, "1.4.2"), "v1.1");
  assert.equal(selectAgentMapping(mappings, "0.9.0"), "v1");
  assert.equal(selectAgentMapping(mappings, "future-dev"), "v2");
  assert.equal(selectAgentMapping([], "1.0.0"), undefined);
});

test("terminal-scoped opaque directory discovery enforces suffix and resource bounds", async () => {
  assert.equal(validateAgentDirectoryListOptions({ extensions: [".jsonl"], maxDepth: 2, maxEntries: 8, maxBytes: 4096 }).ok, true);
  assert.equal(validateAgentDirectoryListOptions({ extensions: [], maxDepth: 2, maxEntries: 8, maxBytes: 4096 }).ok, false);
  assert.equal(validateAgentDirectoryListOptions({ extensions: ["jsonl"], maxDepth: 2, maxEntries: 8, maxBytes: 4096 }).ok, false);
  assert.equal(validateAgentDirectoryListOptions({ extensions: [".jsonl"], maxDepth: 99, maxEntries: 8, maxBytes: 4096 }).ok, false);
  const terminal = fixtureTerminal({ foregroundExecutable: "codex", files: {
    "/home/test/.codex/sessions/root.jsonl": [{ id: "root" }],
    "/home/test/.codex/sessions/child/one.jsonl": [{ id: "child" }],
    "/home/test/.codex/sessions/child/ignored.txt": [{ id: "ignored" }],
  } });
  const root = await terminal.observation.files.resolveHomeDirectory(".codex/sessions", { beneath: { homeRelative: ".codex" } });
  assert.ok(root);
  const listing = await terminal.observation.files.listDirectory(root, { extensions: [".jsonl"], maxDepth: 1, maxEntries: 2, maxBytes: 4096 });
  assert.deepEqual(listing.entries.map((entry) => entry.relativePath), ["child/one.jsonl", "root.jsonl"]);
});

test("lifecycle publisher builds and validates canonical events", async () => {
  const events = [];
  const publisher = createAgentLifecyclePublisher((event) => events.push(event));
  await publisher.sessionStarted({ title: "Task", model: { id: "model-1" } });
  await publisher.toolStarted({ toolId: "tool-1", name: "read" });
  await publisher.done({ outcome: "success" });
  assert.deepEqual(events.map(({ kind }) => kind), ["session.started", "tool.started", "agent.done"]);
  assert.throws(() => publisher.sessionStarted({ title: "x".repeat(513) }), /title/);
});

test("agent harness checks cancellation before mapping followed records", async () => {
  let disposed = false;
  let mapped = false;
  const cancelled = { aborted: true, throwIfAborted() { throw new Error("cancelled"); } };
  const extension = defineExtension({ activate(context) {
    context.subscriptions.add(context.agents.registerProvider("test/cancel", defineAgentProvider({
      mappingVersion: "0.1",
      matchesForeground: () => true,
      async observe(terminal) {
        const binding = await terminal.bindSession({ providerSessionId: "s", mappingVersion: "0.1", fingerprint: { kind: "test" } });
        return jsonlSession({ binding, source: { async *[Symbol.asyncIterator]() { yield { type: "append", bytes: bytes('{"ok":1}\n') }; }, dispose() { disposed = true; } }, mapRecord() { mapped = true; } });
      },
    })));
  } });
  const harness = await createAgentExtensionHarness(extension);
  const terminal = fixtureTerminal({ foregroundExecutable: "test" });
  terminal.signal = cancelled;
  await assert.rejects(() => harness.observe(terminal), /cancelled/);
  assert.equal(mapped, false);
  assert.equal(disposed, false, "cancellation before watcher acquisition does not own a watcher");
  await harness.dispose();
});

test("agent harness stops between chunks and disposes an acquired watcher", async () => {
  let disposed = false;
  let mapped = 0;
  const signal = { aborted: false, throwIfAborted() { if (this.aborted) throw new Error("cancelled"); } };
  const extension = defineExtension({ activate(context) {
    context.subscriptions.add(context.agents.registerProvider("test/cancel-follow", defineAgentProvider({
      mappingVersion: "0.1",
      matchesForeground: () => true,
      async observe(terminal) {
        const binding = await terminal.bindSession({ providerSessionId: "s", mappingVersion: "0.1", fingerprint: { kind: "test" } });
        return jsonlSession({
          binding,
          source: {
            async *[Symbol.asyncIterator]() {
              yield { type: "append", bytes: bytes('{"n":1}\n') };
              signal.aborted = true;
              yield { type: "append", bytes: bytes('{"n":2}\n') };
            },
            dispose() { disposed = true; },
          },
          mapRecord() { mapped += 1; },
        });
      },
    })));
  } });
  const harness = await createAgentExtensionHarness(extension);
  const terminal = fixtureTerminal({ foregroundExecutable: "test" });
  terminal.signal = signal;
  await assert.rejects(() => harness.observe(terminal), /cancelled/);
  assert.equal(mapped, 1);
  assert.equal(disposed, true);
  await harness.dispose();
});
