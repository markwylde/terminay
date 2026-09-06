import assert from "node:assert/strict";
import test from "node:test";
import { fixtureTerminal } from "../dist/testing.js";

const root = "/home/test/.claude/projects/-workspace";
const before = `${root}/00000000-0000-4000-8000-000000000000.jsonl`;
const after = `${root}/11111111-1111-4111-8111-111111111111.jsonl`;

function terminal(extra = {}) {
  return fixtureTerminal({
    foregroundExecutable: "claude",
    cwd: "/workspace",
    startedAt: "2026-09-06T11:00:00.000Z",
    files: { [before]: [{ sessionId: "before" }], [after]: [{ sessionId: "after" }] },
    fileCreatedAt: {
      [before]: "2026-09-06T10:00:00.000Z",
      [after]: "2026-09-06T11:00:05.000Z",
    },
    ...extra,
  });
}

test("a discovered file carries the creation time the environment proved", async () => {
  const context = terminal();
  const directory = await context.observation.files.resolveHomeDirectory(".claude/projects/-workspace");
  assert.ok(directory);
  const listing = await context.observation.files.listDirectory(directory, {
    extensions: [".jsonl"], maxDepth: 0, maxEntries: 16, maxBytes: 1_000_000,
  });
  const created = Object.fromEntries(listing.entries.map((entry) => [entry.relativePath, entry.createdAt]));
  assert.equal(created["00000000-0000-4000-8000-000000000000.jsonl"], "2026-09-06T10:00:00.000Z");
  assert.equal(created["11111111-1111-4111-8111-111111111111.jsonl"], "2026-09-06T11:00:05.000Z");
});

test("a file created before the process starts is listed but excluded by a post-start filter", async () => {
  const context = terminal();
  const [process] = await context.observation.processes.descendants();
  assert.equal(process.startedAt, "2026-09-06T11:00:00.000Z");
  const directory = await context.observation.files.resolveHomeDirectory(".claude/projects/-workspace");
  const listing = await context.observation.files.listDirectory(directory, {
    extensions: [".jsonl"], maxDepth: 0, maxEntries: 16, maxBytes: 1_000_000,
  });
  assert.equal(listing.entries.length, 2);
  const started = Date.parse(process.startedAt);
  const postStart = listing.entries.filter((entry) => Date.parse(entry.createdAt ?? "") > started);
  assert.deepEqual(postStart.map((entry) => entry.relativePath), ["11111111-1111-4111-8111-111111111111.jsonl"]);
});

test("stat reports a proven creation time", async () => {
  const context = terminal();
  const directory = await context.observation.files.resolveHomeDirectory(".claude/projects/-workspace");
  const listing = await context.observation.files.listDirectory(directory, {
    extensions: [".jsonl"], maxDepth: 0, maxEntries: 16, maxBytes: 1_000_000,
  });
  const entry = listing.entries.find((candidate) => candidate.relativePath.startsWith("1111"));
  const stat = await context.observation.files.stat(entry.handle);
  assert.equal(stat.createdAt, "2026-09-06T11:00:05.000Z");
});

test("a fixture can present a CLI that holds no writable handle", async () => {
  const context = terminal({ openFilePaths: [] });
  const descendants = await context.observation.processes.descendants();
  const open = await context.observation.processes.openFiles(descendants, { access: "writable" });
  assert.deepEqual(open, []);
});

test("a fixture can present extra descendants with their own start times", async () => {
  const context = terminal({
    descendants: [{ executableName: "node", cwd: "/workspace", pid: 99, startedAt: "2026-09-06T11:00:02.000Z" }],
  });
  const descendants = await context.observation.processes.descendants();
  assert.deepEqual(descendants.map((process) => process.executableName), ["claude", "node"]);
  assert.equal(descendants[1].startedAt, "2026-09-06T11:00:02.000Z");
  assert.notEqual(descendants[0].handle.id, descendants[1].handle.id);
});
