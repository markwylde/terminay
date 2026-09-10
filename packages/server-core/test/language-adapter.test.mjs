import test from "node:test";
import assert from "node:assert/strict";
import {
  CanonicalProjectPathResolver,
  LanguageSessionManager,
  OrderedEventJournal,
  ServerLanguageAdapter,
} from "../dist/index.js";
import { LANGUAGE_OPERATIONS } from "@terminay/protocol";

const FILES = new Set(["/project", "/project/main.ts", "/project/notes.md", "/project/lib"]);
const storage = {
  realpath(path) {
    // A symlink out of the project canonicalizes to its target, which is how a
    // path escape reaches the resolver in the first place.
    if (path === "/project/escape.ts") return "/elsewhere/escape.ts";
    if (!FILES.has(path)) throw Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" });
    return path;
  },
  stat(path) {
    if (path === "/project" || path === "/project/lib") return { isDirectory: true, isFile: false, size: 0 };
    return { isDirectory: false, isFile: true, size: 8 };
  },
};

function harness(options = {}) {
  const invocations = [];
  const provider = {
    extensionId: "example.language",
    languageServerId: "example.language:stub",
    contribution: { id: "stub", displayName: "Stub", languageIds: ["typescript"], fileExtensions: [".ts"] },
  };
  const extensions = {
    languageServersFor: (selector) => (selector === ".ts" || selector === "typescript" ? [provider] : []),
    async invokeLanguage(_extensionId, invocation) {
      invocations.push(invocation);
      return options.result?.(invocation) ?? { ok: true };
    },
    onLanguageDiagnostics: (listener) => {
      diagnosticsListener = listener;
      return () => undefined;
    },
    onLanguageSessionExit: () => () => undefined,
    onHostStateChanged: () => () => undefined,
  };
  let diagnosticsListener;
  const journal = new OrderedEventJournal();
  let adapter;
  const sessions = new LanguageSessionManager({
    extensions,
    projectRoot: async () => "/project",
    onDiagnostics: (event) => adapter.publishDiagnostics(event),
  });
  adapter = new ServerLanguageAdapter({
    serverId: "server-a",
    sessions,
    projects: { default: { projectId: "default", resolver: new CanonicalProjectPathResolver("/project", storage) } },
    eventJournal: journal,
    diagnosticsDebounceMs: 5,
  });
  return {
    adapter,
    sessions,
    journal,
    invocations,
    operations: adapter.operations(),
    emitDiagnostics: (notification) => diagnosticsListener?.(notification),
  };
}

const context = () => ({
  connectionId: "connection-a",
  clientId: "client-a",
  authScope: "admin",
  claims: { projectId: "default" },
  signal: new AbortController().signal,
});

const query = (operation, payload) => ({
  envelope: { type: "query", queryId: "q1", operation, payload },
  body: new Uint8Array(),
  context: context(),
});
const command = (operation, payload) => ({
  envelope: { type: "command", commandId: "c1", operation, payload },
  body: new Uint8Array(),
  context: context(),
});

test("capabilities report no provider for an unserved file without an error", async () => {
  const { operations } = harness();
  const result = await operations.queries[LANGUAGE_OPERATIONS.capabilities](
    query(LANGUAGE_OPERATIONS.capabilities, { projectId: "default", path: "notes.md" }),
  );
  assert.equal(result.state, "none");
  assert.equal(result.languageServerId, undefined);
  assert.deepEqual(result.features, { completion: false, hover: false, definition: false, diagnostics: false });
});

test("a path that escapes the project root is rejected before any session is consulted", async () => {
  const { operations, invocations } = harness();
  await assert.rejects(
    operations.queries[LANGUAGE_OPERATIONS.completion](
      query(LANGUAGE_OPERATIONS.completion, {
        projectId: "default",
        path: "escape.ts",
        revision: 1,
        position: { line: 0, character: 0 },
      }),
    ),
    (error) => error.code === "path_escape",
  );
  await assert.rejects(
    operations.queries[LANGUAGE_OPERATIONS.completion](
      query(LANGUAGE_OPERATIONS.completion, {
        projectId: "default",
        path: "/etc/hosts",
        revision: 1,
        position: { line: 0, character: 0 },
      }),
    ),
  );
  await assert.rejects(
    operations.queries[LANGUAGE_OPERATIONS.completion](
      query(LANGUAGE_OPERATIONS.completion, {
        projectId: "default",
        path: "../secrets.ts",
        revision: 1,
        position: { line: 0, character: 0 },
      }),
    ),
  );
  assert.deepEqual(invocations, []);
});

test("an oversized completion result is truncated and marked", async () => {
  const documentation = "x".repeat(2_000);
  const { operations } = harness({
    result: (invocation) =>
      invocation.method === "language.completion"
        ? {
            isIncomplete: false,
            isTruncated: false,
            items: Array.from({ length: 200 }, (_value, index) => ({
              label: `item-${index}`,
              kind: "function",
              documentation,
            })),
          }
        : { ok: true },
  });
  const result = await operations.queries[LANGUAGE_OPERATIONS.completion](
    query(LANGUAGE_OPERATIONS.completion, {
      projectId: "default",
      path: "main.ts",
      revision: 4,
      position: { line: 0, character: 0 },
    }),
  );
  assert.equal(result.revision, 4);
  assert.equal(result.isTruncated, true);
  assert.ok(result.items.length < 200);
  assert.ok(JSON.stringify(result).length <= 256 * 1024);
});

test("document commands reach the session and diagnostics reach the journal debounced", async () => {
  const harnessed = harness();
  const opened = await harnessed.operations.commands[LANGUAGE_OPERATIONS.documentOpen](
    command(LANGUAGE_OPERATIONS.documentOpen, {
      projectId: "default",
      path: "main.ts",
      revision: 2,
      languageId: "typescript",
      text: "const a = 1;",
    }),
  );
  assert.deepEqual(opened, { projectId: "default", path: "main.ts", revision: 2 });
  const sessionId = harnessed.invocations[0].input.sessionId;
  const diagnostic = {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    severity: "error",
    message: "bad",
  };
  harnessed.emitDiagnostics({ sessionId, path: "main.ts", diagnostics: [diagnostic], isTruncated: false });
  harnessed.emitDiagnostics({ sessionId, path: "main.ts", diagnostics: [diagnostic, diagnostic], isTruncated: false });
  await new Promise((resolve) => setTimeout(resolve, 40));
  const replay = await harnessed.journal.replay(0);
  const events = replay.events.filter((event) => event.event === LANGUAGE_OPERATIONS.diagnosticsEvent);
  // A burst of publishes for one file becomes one journal event.
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.serverId, "server-a");
  assert.equal(events[0].payload.projectId, "default");
  assert.equal(events[0].payload.revision, 2);
  assert.equal(events[0].payload.diagnostics.length, 2);
  harnessed.adapter.dispose();
  await harnessed.sessions.shutdown();
});

test("language operations declare read and write scopes", () => {
  const { operations } = harness();
  assert.equal(operations.policies[LANGUAGE_OPERATIONS.completion].scope, "read");
  assert.equal(operations.policies[LANGUAGE_OPERATIONS.capabilities].scope, "read");
  assert.equal(operations.policies[LANGUAGE_OPERATIONS.documentOpen].scope, "write");
});
