import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExtensionHost } from "../dist/index.js";

const PROVIDER = "example.channel-loss/cli";
const CONTEXT = "extension-agent:test-context:1";

/**
 * A child that speaks the protocol directly, so the exact shape that
 * quarantined Claude Code can be reproduced: several lifecycle publications
 * still awaiting the host when the child process dies.
 */
const FAKE_CHILD = `
process.on('message', (frame) => {
  if (frame.kind === 'activate') {
    process.send({ protocolVersion: 1, kind: 'ready', id: frame.id, payload: {
      methods: [], providers: [], agentProviders: ['${PROVIDER}'], dependencyProviders: [],
    } });
    return;
  }
  if (frame.kind === 'agent.terminal.admit') {
    process.send({ protocolVersion: 1, kind: 'agent.terminal.admitted', id: frame.id,
      payload: { contextId: frame.payload.context.contextId, state: 'bound' } });
    // Publish more than the crash threshold, then die with them all in flight.
    for (let index = 0; index < 10; index += 1) {
      process.send({ protocolVersion: 1, kind: 'agent.lifecycle.publish', id: 'publication-' + index, payload: {
        contextId: frame.payload.context.contextId,
        providerId: '${PROVIDER}',
        publicationId: 'publication-' + index,
        mappingVersion: '0.1',
        events: [{ kind: 'session.started', title: 'Publication ' + index, occurredAt: '2026-09-09T14:41:46.000Z' }],
      } });
    }
    setTimeout(() => process.exit(9), 30);
    return;
  }
});
`;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "terminay-channel-loss-"));
  await writeFile(join(root, "extension.js"), "export function activate() { return {}; }", { mode: 0o600 });
  await writeFile(join(root, "child.mjs"), FAKE_CHILD, { mode: 0o600 });
  for (const name of ["config", "data", "cache"]) await mkdir(join(root, name));
  return {
    childEntrypoint: join(root, "child.mjs"),
    descriptor: {
      extensionId: "example.channel-loss",
      packageRoot: root,
      entrypoint: "extension.js",
      configDirectory: join(root, "config"),
      dataDirectory: join(root, "data"),
      cacheDirectory: join(root, "cache"),
      permissions: ["agent-observation"],
      agentProviders: [{
        id: PROVIDER,
        displayName: "Channel loss",
        requiredEnvironmentCapabilities: ["process-observation"],
      }],
    },
  };
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(message);
}

test("a child dying with publications in flight counts one death, not one per acknowledgement", async () => {
  const value = await fixture();
  const records = [];
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const host = new ExtensionHost(value.descriptor.extensionId, {
    broker: { async request() {} },
    childEntrypoint: value.childEntrypoint,
    onDiagnostic: (record) => records.push(record),
    limits: { maxCrashesInWindow: 5 },
    // Hold every publication open, so all ten acknowledgements are still owed
    // when the child dies — the recorded incident's exact shape.
    agents: {
      async observe() { return {}; },
      async publish() { await held; return { acceptedEventCount: 1 }; },
    },
  });

  await host.start(value.descriptor);
  await host.admitAgentTerminal({
    context: {
      contextId: CONTEXT,
      serverId: "server-1",
      projectId: "project-1",
      projectEnvironmentId: "terminay.this-server",
      terminalSessionId: "terminal-1",
      terminalIncarnationId: "1",
      providerId: PROVIDER,
    },
    observationCapabilities: ["process-observation"],
  });

  await waitFor(
    () => records.some((record) => record.transition === "child-exited"),
    "the child never died",
  );
  release();
  await new Promise((resolve) => setTimeout(resolve, 100));

  const counted = records.filter(
    (record) => record.transition === "failed" && record.afterChildGone !== true,
  );
  assert.equal(counted.length, 1, "one death is one crash, however many acknowledgements discover it");
  assert.equal(host.status().consecutiveCrashes, 1);
  assert.notEqual(host.status().state, "quarantined", "ten pending acknowledgements must not quarantine an extension");

  const exited = records.find((record) => record.transition === "child-exited");
  assert.equal(exited.exitCode, 9, "the real exit code survives, rather than a synthetic SIGKILL");

  const closed = records.filter((record) => record.transition === "channel-closed");
  assert.ok(closed.length > 0, "writing to the dead child is recorded as a closed channel");
  assert.equal(
    records.some((record) => /exceeds IPC limit/u.test(record.error?.message ?? "")),
    false,
    "and never reported as a size limit it did not hit",
  );
  await host.stop();
});
