import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, symlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  createAgentLifecyclePublisher,
  defineAgentProvider,
  defineExtension,
  jsonlSession,
  validAgentManifestFixture,
} from "../dist/index.js";
import {
  createAgentExtensionHarness,
  createObservationCancellation,
  fixtureTerminal,
} from "../dist/testing.js";

const here = dirname(fileURLToPath(import.meta.url));
const sdkRoot = resolve(here, "..");
const exampleRoot = resolve(here, "../examples/agent-provider");
const bytes = (value) => new TextEncoder().encode(value);

function declaredManifest(providerId = "com.example.agent/cli") {
  return {
    ...validAgentManifestFixture,
    id: "com.example.agent",
    contributes: {
      agentProviders: [{
        id: providerId,
        displayName: "Example Agent",
        requiredEnvironmentCapabilities: ["filesystem-observation", "agent-journal"],
      }],
    },
  };
}

test("1.1 default-exported activate(context) runs and a global Terminay singleton fails to compile", async () => {
  let activated = false;
  const extension = defineExtension({
    activate(context) {
      activated = true;
      assert.equal(typeof context.agents.registerProvider, "function");
      assert.equal("terminay" in globalThis, false);
    },
  });
  const harness = await createAgentExtensionHarness(extension);
  assert.equal(activated, true);
  await harness.dispose();

  const dts = `${await readFile(join(sdkRoot, "dist/index.d.ts"), "utf8")}\n${await readFile(join(sdkRoot, "dist/types.d.ts"), "utf8")}`;
  assert.match(dts, /export declare function defineExtension/);
  assert.doesNotMatch(dts, /declare (?:const|var|let|function) terminay\b/);
  assert.doesNotMatch(dts, /interface GlobalThis[\s\S]*terminay/);

  const denied = await readFile(join(here, "types/no-global.ts"), "utf8");
  assert.match(denied, /@ts-expect-error There is no global Terminay singleton/);
  assert.match(denied, /\bterminay\b/);
});

test("1.2 registerProvider accepts a declared id and refuses an undeclared id", async () => {
  const manifest = declaredManifest();
  const accepted = defineExtension({
    activate(context) {
      context.subscriptions.add(context.agents.registerProvider("com.example.agent/cli", defineAgentProvider({
        mappingVersion: "0.1",
        matchesForeground: () => true,
        async observe() { return { state: "not-bound" }; },
      })));
    },
  });
  const ok = await createAgentExtensionHarness(accepted, { manifest });
  await ok.dispose();

  const rejected = defineExtension({
    activate(context) {
      context.agents.registerProvider("com.example.agent/other", defineAgentProvider({
        mappingVersion: "0.1",
        matchesForeground: () => true,
        async observe() { return { state: "not-bound" }; },
      }));
    },
  });
  await assert.rejects(() => createAgentExtensionHarness(rejected, { manifest }), /undeclared or invalid/);
});

test("1.3 disable, update, shutdown, and host failure all release the registration", async () => {
  for (const reason of ["disabled", "updated", "shutdown", "extension-host-failure"]) {
    let observations = 0;
    const harness = await createAgentExtensionHarness(defineExtension({
      activate(context) {
        context.subscriptions.add(context.agents.registerProvider("com.example.agent/cli", defineAgentProvider({
          mappingVersion: "0.1",
          matchesForeground: () => true,
          async observe() {
            observations += 1;
            return { state: "not-bound" };
          },
        })));
      },
    }), { manifest: declaredManifest() });
    await harness.observe(fixtureTerminal({ foregroundExecutable: "example-agent" }));
    assert.equal(observations, 1, reason);
    await harness.release(reason);
    await harness.observe(fixtureTerminal({ foregroundExecutable: "example-agent" }));
    assert.equal(observations, 1, `${reason} must dispose the registration`);
  }
});

test("2.1 a foreground match starts observation and does not bind by itself", async () => {
  let observed = false;
  const harness = await createAgentExtensionHarness(defineExtension({
    activate(context) {
      context.subscriptions.add(context.agents.registerProvider("com.example.agent/cli", defineAgentProvider({
        mappingVersion: "0.1",
        matchesForeground(process) { return process.executableName === "example-agent"; },
        async observe() {
          observed = true;
          return { state: "not-bound" };
        },
      })));
    },
  }));
  await harness.observe(fixtureTerminal({ foregroundExecutable: "zsh" }));
  assert.equal(observed, false);
  await harness.observe(fixtureTerminal({ foregroundExecutable: "example-agent" }));
  assert.equal(observed, true);
  assert.deepEqual(harness.observation(), { state: "not-bound" });
  assert.deepEqual(harness.events(), []);
  await harness.dispose();
});

test("2.2 process exit, terminal close, environment change, and disable cancel in-flight observation", async () => {
  for (const reason of ["process-exit", "terminal-close", "environment-change", "extension-disable"]) {
    const cancellation = createObservationCancellation();
    let mapped = 0;
    const harness = await createAgentExtensionHarness(defineExtension({
      activate(context) {
        context.subscriptions.add(context.agents.registerProvider("test/cancel", defineAgentProvider({
          mappingVersion: "0.1",
          matchesForeground: () => true,
          async observe(terminal) {
            const binding = await terminal.bindSession({
              providerSessionId: "s", mappingVersion: "0.1", fingerprint: { kind: "test", process: terminal.process },
            });
            return jsonlSession({
              binding,
              source: {
                async *[Symbol.asyncIterator]() {
                  yield { type: "append", bytes: bytes('{"n":1}\n') };
                  cancellation.cancel(reason);
                  yield { type: "append", bytes: bytes('{"n":2}\n') };
                },
                async dispose() {},
              },
              mapRecord() { mapped += 1; },
            });
          },
        })));
      },
    }));
    const terminal = fixtureTerminal({ foregroundExecutable: "test", signal: cancellation.signal });
    await assert.rejects(() => harness.observe(terminal), new RegExp(reason));
    assert.equal(mapped, 1, reason);
    await harness.dispose();
  }
});

test("2.3 missing environment capability is a typed unavailable outcome, not a raw error", async () => {
  const harness = await createAgentExtensionHarness(defineExtension({
    activate(context) {
      context.subscriptions.add(context.agents.registerProvider("com.example.agent/cli", defineAgentProvider({
        mappingVersion: "0.1",
        matchesForeground: () => true,
        async observe(terminal) {
          if (!terminal.capabilities.has("agent-journal")) {
            return { state: "unavailable", reason: "environment-capability-missing" };
          }
          throw new Error("ENOENT: ssh journal /home/other/.secrets");
        },
      })));
    },
  }));
  await harness.observe(fixtureTerminal({
    foregroundExecutable: "example-agent",
    capabilities: ["process-observation"],
    environmentKind: "ssh",
  }));
  assert.deepEqual(harness.observation(), { state: "unavailable", reason: "environment-capability-missing" });
  assert.deepEqual(harness.events(), []);
  await harness.dispose();
});

test("3.1 a handle issued for one terminal is refused by another", async () => {
  const first = fixtureTerminal({
    foregroundExecutable: "example-agent",
    files: { "/home/test/.example-agent/sessions/current.jsonl": [{ id: "one" }] },
  });
  const second = fixtureTerminal({
    foregroundExecutable: "example-agent",
    files: { "/home/test/.example-agent/sessions/current.jsonl": [{ id: "two" }] },
  });
  const descendants = await first.observation.processes.descendants();
  await assert.rejects(() => second.observation.processes.openFiles(descendants, { access: "writable" }), /process handle is unavailable/);
  const journal = await first.observation.files.resolveHomeRelative(".example-agent/sessions/current.jsonl");
  await assert.rejects(() => second.observation.files.read(journal, { maxBytes: 32 }), /file handle is unavailable/);
  await assert.rejects(() => second.bindSession({
    providerSessionId: "stolen",
    mappingVersion: "0.1",
    journal,
    fingerprint: { kind: "stolen", file: journal },
  }), /file handle is unavailable/);
});

test("3.2 descendants, open-file, canonicalisation, JSON, JSONL, and follow are environment-routed", async () => {
  for (const environmentKind of ["this-server", "ssh"]) {
    const terminal = fixtureTerminal({
      foregroundExecutable: "example-agent",
      environmentKind,
      files: {
        "/home/test/.example-agent/sessions/current.jsonl": [{ type: "session", id: "sess-1" }, { ok: true }],
        "/home/test/.example-agent/sessions/meta.json": [{ id: "meta-1" }],
      },
    });
    const descendants = await terminal.observation.processes.descendants();
    assert.equal(descendants.length, 1);
    const opened = await terminal.observation.processes.openFiles(descendants, { access: "writable" });
    assert.equal(opened.length, 2);
    const journal = await terminal.observation.files.resolveHomeRelative(".example-agent/sessions/current.jsonl");
    const meta = await terminal.observation.files.resolveHomeRelative(".example-agent/sessions/meta.json");
    assert.ok(await terminal.observation.files.canonicalFile(journal));
    const line = await terminal.observation.files.readJsonLine(journal, { maxBytes: 4096, position: "first" });
    assert.equal(line.id, "sess-1");
    const json = await terminal.observation.files.readJson(meta, { maxBytes: 4096 });
    assert.equal(json.id, "meta-1");
    const watcher = await terminal.observation.files.follow(journal);
    const chunks = [];
    for await (const chunk of watcher) chunks.push(chunk);
    assert.equal(chunks.length, 1);
    await watcher.dispose();
    void opened;
  }

  const sshMissing = fixtureTerminal({
    foregroundExecutable: "example-agent",
    environmentKind: "ssh",
    capabilities: ["process-observation"],
    files: { "/home/test/.example-agent/sessions/current.jsonl": [{ type: "session", id: "sess-1" }] },
  });
  await assert.rejects(
    () => sshMissing.observation.files.resolveHomeRelative(".example-agent/sessions/current.jsonl"),
    /not advertised/,
  );
});

test("3.3 watchers are asynchronously disposable and idempotent, and a cancelled signal stops iteration", async () => {
  const cancellation = createObservationCancellation();
  const terminal = fixtureTerminal({
    foregroundExecutable: "example-agent",
    signal: cancellation.signal,
    files: { "/home/test/.example-agent/sessions/current.jsonl": [{ n: 1 }] },
  });
  const handle = await terminal.observation.files.resolveHomeRelative(".example-agent/sessions/current.jsonl");
  const watcher = await terminal.observation.files.follow(handle);
  await watcher.dispose();
  await watcher.dispose();
  cancellation.cancel("process-exit");
  await assert.rejects(async () => {
    const live = await terminal.observation.files.follow(handle);
    for await (const _chunk of live) { /* drain */ }
  }, /process-exit/);
});

test("4.1 the publisher has named methods and no unrestricted emit path", () => {
  const publisher = createAgentLifecyclePublisher(() => {});
  assert.equal("publish" in publisher, false);
  assert.equal("emit" in publisher, false);
  for (const name of [
    "sessionStarted", "turnStarted", "toolStarted", "waitStarted", "done",
    "metadataChanged", "subagentStarted", "subagentDone", "sessionStopped",
  ]) {
    assert.equal(typeof publisher[name], "function", name);
  }
});

test("4.2 invalid events are rejected at the publisher before the sink", () => {
  let sinked = 0;
  const publisher = createAgentLifecyclePublisher(() => { sinked += 1; });
  assert.throws(() => publisher.turnStarted({}), /turnId/);
  assert.throws(() => publisher.sessionStarted({ title: "x".repeat(513) }), /title/);
  assert.throws(() => publisher.waitStarted({ waitId: "w", state: "running" }), /state/);
  assert.throws(() => publisher.done({ outcome: "success", sessionId: "other" }), /unknown|sessionId|not allowed/i);
  assert.equal(sinked, 0);
});

test("4.3 metadata change mid-turn with an active tool preserves lifecycle state", async () => {
  const events = [];
  const publisher = createAgentLifecyclePublisher((event) => events.push(event));
  const harness = await createAgentExtensionHarness(defineExtension({
    activate(context) {
      context.subscriptions.add(context.agents.registerProvider("test/meta", defineAgentProvider({
        mappingVersion: "0.1",
        matchesForeground: () => true,
        async observe(terminal) {
          const binding = await terminal.bindSession({
            providerSessionId: "s", mappingVersion: "0.1", fingerprint: { kind: "test", process: terminal.process },
          });
          return jsonlSession({
            binding,
            source: {
              async *[Symbol.asyncIterator]() {
                yield { type: "append", bytes: bytes('{"k":1}\n{"k":2}\n{"k":3}\n{"k":4}\n') };
              },
              async dispose() {},
            },
            async mapRecord(record, session) {
              if (record.k === 1) await session.publish.sessionStarted({ title: "Original" });
              if (record.k === 2) await session.publish.turnStarted({ turnId: "turn-1" });
              if (record.k === 3) await session.publish.toolStarted({ toolId: "tool-1", name: "read" });
              if (record.k === 4) await session.publish.metadataChanged({ title: "Renamed", model: { id: "m1" } });
            },
          });
        },
      })));
    },
  }));
  await harness.observe(fixtureTerminal({ foregroundExecutable: "test" }));
  const projection = harness.projection();
  assert.equal(projection.sessionStarted, true);
  assert.equal(projection.working, true);
  assert.equal(projection.waiting, false);
  assert.equal(projection.done, false);
  assert.deepEqual(projection.activeToolIds, ["tool-1"]);
  assert.equal(projection.title, "Renamed");
  assert.equal(projection.model.id, "m1");
  assert.equal(harness.events().filter((event) => event.kind === "session.started").length, 1);
  assert.equal(harness.events().filter((event) => event.kind === "turn.started").length, 1);
  await harness.dispose();
  void publisher;
  void events;
});

test("4.4 a child without a stable native id is not published", async () => {
  assert.throws(() => jsonlSession({
    binding: { providerSessionId: "s", mappingVersion: "0.1" },
    source: { async *[Symbol.asyncIterator]() {}, async dispose() {} },
    childSources: [{ childId: "", journal: { id: "j" }, source: { async *[Symbol.asyncIterator]() {}, async dispose() {} } }],
    mapRecord() {},
  }), /childId/);

  const harness = await createAgentExtensionHarness(defineExtension({
    activate(context) {
      context.subscriptions.add(context.agents.registerProvider("test/child", defineAgentProvider({
        mappingVersion: "0.1",
        matchesForeground: () => true,
        async observe(terminal) {
          const binding = await terminal.bindSession({
            providerSessionId: "s", mappingVersion: "0.1", fingerprint: { kind: "test", process: terminal.process },
          });
          return jsonlSession({
            binding,
            source: {
              async *[Symbol.asyncIterator]() {
                yield { type: "append", bytes: bytes('{"type":"session"}\n{"type":"child","index":0,"title":"Nope"}\n{"type":"child","childId":"child-1"}\n') };
              },
              async dispose() {},
            },
            mapRecord(record, session) {
              if (record.type === "session") session.publish.sessionStarted({ title: "Root" });
              if (record.type === "child") {
                if (typeof record.childId !== "string" || record.childId.length === 0) return;
                session.publish.subagentStarted({ subagentId: record.childId });
              }
            },
          });
        },
      })));
    },
  }));
  await harness.observe(fixtureTerminal({ foregroundExecutable: "test" }));
  assert.deepEqual(harness.events().map((event) => event.kind), ["session.started", "subagent.started"]);
  assert.equal(harness.events()[1].subagentId, "child-1");
  await harness.dispose();
});

test("5.1 a Node filesystem provider fails on a non-local fixture that observation can still read", async () => {
  const { readFile } = await import("node:fs/promises");
  const remote = fixtureTerminal({
    foregroundExecutable: "example-agent",
    environmentKind: "ssh",
    files: { "/home/test/.example-agent/sessions/current.jsonl": [{ type: "session", id: "sess-1", title: "Remote" }] },
  });

  const nodeProvider = await createAgentExtensionHarness(defineExtension({
    activate(context) {
      context.subscriptions.add(context.agents.registerProvider("test/node", defineAgentProvider({
        mappingVersion: "0.1",
        matchesForeground: () => true,
        async observe() {
          try {
            await readFile("/home/test/.example-agent/sessions/current.jsonl");
            return { state: "not-bound" };
          } catch {
            return { state: "unavailable", reason: "environment-capability-missing" };
          }
        },
      })));
    },
  }));
  await nodeProvider.observe(remote);
  assert.deepEqual(nodeProvider.observation(), { state: "unavailable", reason: "environment-capability-missing" });
  await nodeProvider.dispose();

  const observationProvider = await createAgentExtensionHarness(defineExtension({
    activate(context) {
      context.subscriptions.add(context.agents.registerProvider("test/obs", defineAgentProvider({
        mappingVersion: "0.1",
        matchesForeground: () => true,
        async observe(terminal) {
          const journal = await terminal.observation.files.resolveHomeRelative(".example-agent/sessions/current.jsonl");
          if (!journal) return { state: "not-bound" };
          const binding = await terminal.bindSession({
            providerSessionId: "sess-1", mappingVersion: "0.1", journal, fingerprint: { kind: "journal", file: journal },
          });
          return jsonlSession({
            binding,
            source: terminal.observation.files.follow(journal),
            mapRecord(record, session) {
              if (record.type === "session") session.publish.sessionStarted({ title: record.title });
            },
          });
        },
      })));
    },
  }));
  await observationProvider.observe(remote);
  assert.deepEqual(observationProvider.events().map((event) => event.kind), ["session.started"]);
  await observationProvider.dispose();
});

test("5.2 the public API exposes no host-owned behaviour", async () => {
  const api = await import("../dist/index.js");
  const names = Object.keys(api);
  for (const forbidden of [
    "renderSidebar", "navigate", "subscribeClients", "acknowledge",
    "orderCanonical", "enableExtension", "disableExtension", "packExtension",
    "spawnExtensionHost",
  ]) {
    assert.equal(names.includes(forbidden), false, forbidden);
  }
  assert.equal(typeof api.defineExtension, "function");
  assert.equal(typeof api.defineAgentProvider, "function");
  assert.equal(typeof api.createAgentLifecyclePublisher, "function");
  const publisher = api.createAgentLifecyclePublisher(() => {});
  assert.equal(Object.getOwnPropertyNames(publisher).includes("publish"), false);
});

test("6.1 the public testing entry maps a package without private Terminay imports", async () => {
  const source = [
    await readFile(join(exampleRoot, "extension.js"), "utf8"),
    await readFile(join(exampleRoot, "example-agent.js"), "utf8"),
    await readFile(join(exampleRoot, "test.mjs"), "utf8"),
  ].join("\n");
  assert.match(source, /@terminay\/extension-api/);
  assert.equal(/@terminay\/(?!extension-api)/.test(source), false);
  assert.doesNotMatch(source, /server-core|electron\/|apps\/terminay-server/);
});

test("6.2 a non-conforming fixture fails manifest, bounds, cancellation, scope, lifecycle, and privacy checks", async () => {
  const manifest = declaredManifest();
  await assert.rejects(() => createAgentExtensionHarness(defineExtension({
    activate(context) {
      context.agents.registerProvider("not-declared/cli", defineAgentProvider({
        mappingVersion: "0.1", matchesForeground: () => true, async observe() { return { state: "not-bound" }; },
      }));
    },
  }), { manifest }), /undeclared/);

  const publisher = createAgentLifecyclePublisher(() => {});
  assert.throws(() => publisher.sessionStarted({ title: "x".repeat(513) }), /title/);
  assert.throws(() => publisher.done({ outcome: "success", terminalId: "t-1" }), /unknown|terminalId/i);

  const cancellation = createObservationCancellation();
  cancellation.cancel("terminal-close");
  const cancelledHarness = await createAgentExtensionHarness(defineExtension({
    activate(context) {
      context.subscriptions.add(context.agents.registerProvider("com.example.agent/cli", defineAgentProvider({
        mappingVersion: "0.1",
        matchesForeground: () => true,
        async observe(terminal) {
          const binding = await terminal.bindSession({
            providerSessionId: "s", mappingVersion: "0.1", fingerprint: { kind: "test", process: terminal.process },
          });
          return jsonlSession({
            binding,
            source: { async *[Symbol.asyncIterator]() { yield { type: "append", bytes: bytes("{}\n") }; }, async dispose() {} },
            mapRecord() {},
          });
        },
      })));
    },
  }), { manifest });
  await assert.rejects(() => cancelledHarness.observe(fixtureTerminal({
    foregroundExecutable: "example-agent",
    signal: cancellation.signal,
  })), /terminal-close/);
  await cancelledHarness.dispose();

  const first = fixtureTerminal({ foregroundExecutable: "example-agent", files: { "/home/test/a.jsonl": [{}] } });
  const second = fixtureTerminal({ foregroundExecutable: "example-agent", files: { "/home/test/a.jsonl": [{}] } });
  const stolen = await first.observation.files.resolveHomeRelative("a.jsonl");
  await assert.rejects(() => second.observation.files.read(stolen, { maxBytes: 8 }), /file handle is unavailable/);

  const lifecycle = await createAgentExtensionHarness(defineExtension({
    activate(context) {
      context.subscriptions.add(context.agents.registerProvider("com.example.agent/cli", defineAgentProvider({
        mappingVersion: "0.1",
        matchesForeground: () => true,
        async observe(terminal) {
          const binding = await terminal.bindSession({
            providerSessionId: "s", mappingVersion: "0.1", fingerprint: { kind: "test", process: terminal.process },
          });
          return jsonlSession({
            binding,
            source: { async *[Symbol.asyncIterator]() { yield { type: "append", bytes: bytes('{"x":1}\n') }; }, async dispose() {} },
            mapRecord(_record, session) { session.publish.metadataChanged({ title: "orphan" }); },
          });
        },
      })));
    },
  }), { manifest });
  await assert.rejects(() => lifecycle.observe(fixtureTerminal({ foregroundExecutable: "example-agent" })), /not a new session/);
  await lifecycle.dispose();
});

test("7.1 example package tests pass against the published SDK with no private imports", async (t) => {
  const modules = join(exampleRoot, "node_modules", "@terminay");
  await mkdir(modules, { recursive: true });
  const link = join(modules, "extension-api");
  await rm(link, { recursive: true, force: true }).catch(() => undefined);
  await symlink(sdkRoot, link, "dir");
  t.after(() => rm(join(exampleRoot, "node_modules"), { recursive: true, force: true }));
  const result = spawnSync(process.execPath, ["--test", "test.mjs"], { cwd: exampleRoot, encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("7.2 harness asserts no events when a declared required capability is missing", async () => {
  const manifest = declaredManifest();
  const dishonest = defineExtension({
    activate(context) {
      context.subscriptions.add(context.agents.registerProvider("com.example.agent/cli", defineAgentProvider({
        mappingVersion: "0.1",
        matchesForeground: () => true,
        async observe(terminal) {
          const binding = await terminal.bindSession({
            providerSessionId: "s", mappingVersion: "0.1", fingerprint: { kind: "test", process: terminal.process },
          });
          return jsonlSession({
            binding,
            source: { async *[Symbol.asyncIterator]() { yield { type: "append", bytes: bytes('{"type":"session"}\n') }; }, async dispose() {} },
            mapRecord(_record, session) { session.publish.sessionStarted({ title: "should not publish" }); },
          });
        },
      })));
    },
  });
  const harness = await createAgentExtensionHarness(dishonest, { manifest });
  await assert.rejects(() => harness.observe(fixtureTerminal({
    foregroundExecutable: "example-agent",
    capabilities: ["process-observation"],
  })), /required environment capabilities/);
  await harness.dispose();
});
