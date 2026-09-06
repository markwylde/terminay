import assert from "node:assert/strict";
import test from "node:test";
import extension from "../dist/index.js";
import { createAgentExtensionHarness, fixtureTerminal } from "@terminay/extension-api/testing";

const sessionId = "5f2aff08-eab3-4852-96eb-48235fc7f471";
const other = "bf0b34e1-4afc-4b93-8389-80caa0b589a4";
const projects = "/home/test/.claude/projects/-workspace";
const startedAt = "2026-09-06T11:00:00.000Z";

const header = (id) => ({ type: "permission-mode", permissionMode: "default", sessionId: id, version: "2.1.201" });

/**
 * A terminal shaped like the real Claude Code CLI: the journal exists on disk
 * and the process holds no writable handle on it, because Claude Code appends
 * and closes.
 */
function claudeTerminal(options) {
  return fixtureTerminal({
    foregroundExecutable: "claude",
    cwd: "/workspace",
    startedAt,
    openFilePaths: [],
    ...options,
  });
}

test("binds a journal the running process wrote after it started, holding no writable handle", async () => {
  const harness = await createAgentExtensionHarness(extension);
  try {
    await harness.observe(claudeTerminal({
      files: { [`${projects}/${sessionId}.jsonl`]: [header(sessionId)] },
      fileCreatedAt: { [`${projects}/${sessionId}.jsonl`]: "2026-09-06T11:00:04.000Z" },
    }));
    assert.deepEqual(harness.events(), [{ kind: "session.started", title: "Claude Code" }]);
  } finally { await harness.dispose(); }
});

test("ignores a journal that predates the process", async () => {
  const harness = await createAgentExtensionHarness(extension);
  try {
    await harness.observe(claudeTerminal({
      files: { [`${projects}/${sessionId}.jsonl`]: [header(sessionId)] },
      fileCreatedAt: { [`${projects}/${sessionId}.jsonl`]: "2026-09-06T10:00:00.000Z" },
    }));
    assert.deepEqual(harness.events(), []);
  } finally { await harness.dispose(); }
});

test("one process with several conversations binds the journal receiving appends", async () => {
  const harness = await createAgentExtensionHarness(extension);
  try {
    // Taken from a live host: one `claude` process, two post-start journals,
    // the dormant one created later than the one still being written.
    await harness.observe(claudeTerminal({
      files: {
        [`${projects}/${sessionId}.jsonl`]: [header(sessionId), { type: "ai-title", aiTitle: "Live conversation" }],
        [`${projects}/${other}.jsonl`]: [header(other)],
      },
      fileCreatedAt: {
        [`${projects}/${sessionId}.jsonl`]: "2026-09-06T11:00:04.000Z",
        [`${projects}/${other}.jsonl`]: "2026-09-06T11:42:00.000Z",
      },
      fileModifiedAt: {
        [`${projects}/${sessionId}.jsonl`]: "2026-09-06T12:49:34.000Z",
        [`${projects}/${other}.jsonl`]: "2026-09-06T12:01:22.000Z",
      },
    }));
    assert.deepEqual(harness.events(), [
      { kind: "session.started", title: "Claude Code" },
      { kind: "agent.metadata", title: "Live conversation" },
    ]);
  } finally { await harness.dispose(); }
});

test("two journals appended at the same instant are genuinely concurrent and bind nothing", async () => {
  const harness = await createAgentExtensionHarness(extension);
  try {
    await harness.observe(claudeTerminal({
      files: {
        [`${projects}/${sessionId}.jsonl`]: [header(sessionId)],
        [`${projects}/${other}.jsonl`]: [header(other)],
      },
      fileCreatedAt: {
        [`${projects}/${sessionId}.jsonl`]: "2026-09-06T11:00:04.000Z",
        [`${projects}/${other}.jsonl`]: "2026-09-06T11:00:05.000Z",
      },
      fileModifiedAt: {
        [`${projects}/${sessionId}.jsonl`]: "2026-09-06T12:00:00.000Z",
        [`${projects}/${other}.jsonl`]: "2026-09-06T12:00:00.000Z",
      },
    }));
    assert.deepEqual(harness.events(), []);
  } finally { await harness.dispose(); }
});

test("a sidechain journal is never an eligible root", async () => {
  const harness = await createAgentExtensionHarness(extension);
  try {
    await harness.observe(claudeTerminal({
      files: { [`${projects}/${sessionId}.jsonl`]: [{ ...header(sessionId), isSidechain: true }] },
      fileCreatedAt: { [`${projects}/${sessionId}.jsonl`]: "2026-09-06T11:00:04.000Z" },
    }));
    assert.deepEqual(harness.events(), []);
  } finally { await harness.dispose(); }
});

test("a subagents journal below the root session is not a root candidate", async () => {
  const harness = await createAgentExtensionHarness(extension);
  try {
    const child = `${projects}/${sessionId}/subagents/agent-a94c3c95918d29dc8.jsonl`;
    await harness.observe(claudeTerminal({
      files: { [child]: [{ ...header(sessionId), isSidechain: true, agentId: "a94c3c95918d29dc8" }] },
      fileCreatedAt: { [child]: "2026-09-06T11:00:20.000Z" },
    }));
    assert.deepEqual(harness.events(), []);
  } finally { await harness.dispose(); }
});

test("the open-writable fallback still binds where a handle is genuinely held", async () => {
  const harness = await createAgentExtensionHarness(extension);
  try {
    const journal = `${projects}/${sessionId}.jsonl`;
    await harness.observe(fixtureTerminal({
      foregroundExecutable: "claude",
      cwd: "/workspace",
      // No startedAt, so the project-directory rule cannot apply and the
      // fallback is the only path left.
      files: { [journal]: [header(sessionId)] },
      openFilePaths: [journal],
    }));
    assert.deepEqual(harness.events(), [{ kind: "session.started", title: "Claude Code" }]);
  } finally { await harness.dispose(); }
});

test("a journal in another project directory is not admitted", async () => {
  const harness = await createAgentExtensionHarness(extension);
  try {
    const elsewhere = `/home/test/.claude/projects/-other/${sessionId}.jsonl`;
    await harness.observe(claudeTerminal({
      files: { [elsewhere]: [header(sessionId)] },
      fileCreatedAt: { [elsewhere]: "2026-09-06T11:00:04.000Z" },
    }));
    assert.deepEqual(harness.events(), []);
  } finally { await harness.dispose(); }
});

test("a journal written after a first unbound observation binds on the next one", async () => {
  // The host retries `not-bound` through its discovery window and then keeps
  // discovery armed by topology polling, so a `claude` process that has not yet
  // written its journal binds on a later sample rather than on the next
  // foreground change. The provider stays a single bounded sample.
  const harness = await createAgentExtensionHarness(extension);
  try {
    await harness.observe(claudeTerminal({ files: {} }));
    assert.deepEqual(harness.events(), [], "no journal yet, so nothing binds");
    await harness.observe(claudeTerminal({
      files: { [`${projects}/${sessionId}.jsonl`]: [header(sessionId)] },
      fileCreatedAt: { [`${projects}/${sessionId}.jsonl`]: "2026-09-06T11:00:04.000Z" },
    }));
    assert.deepEqual(harness.events(), [{ kind: "session.started", title: "Claude Code" }]);
  } finally { await harness.dispose(); }
});
