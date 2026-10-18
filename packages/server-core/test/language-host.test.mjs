import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ExtensionHost, ExtensionHostManager } from "../dist/index.js";

const STUB = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "stub-language-server.mjs");

async function projectFixture() {
  const root = await mkdtemp(join(tmpdir(), "terminay-language-project-"));
  await mkdir(join(root, "lib"));
  await writeFile(join(root, "lib", "target.ts"), "export const target = 1;\n");
  await writeFile(join(root, "main.ts"), "export const main = target;\n");
  return root;
}

async function extensionFixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), "terminay-language-extension-"));
  const args = options.crashOnHover ? `["${STUB}", "--crash-on-hover"]` : `["${STUB}"]`;
  await writeFile(
    join(root, "extension.js"),
    `export function activate(context) {
       context.registerLanguageServerProvider({
         id: ${JSON.stringify(options.registerId ?? "stub")},
         runtime: { async launch(request) {
           return { command: process.execPath, args: ${args}, description: "stub language server" };
         } },
       });
       return { methods: {} };
     }`,
    { mode: 0o600 },
  );
  for (const name of ["config", "data", "cache"]) await mkdir(join(root, name));
  return {
    extensionId: "example.language",
    packageRoot: root,
    entrypoint: "extension.js",
    configDirectory: join(root, "config"),
    dataDirectory: join(root, "data"),
    cacheDirectory: join(root, "cache"),
    permissions: [],
    languageServers: [
      {
        id: "stub",
        displayName: "Stub",
        languageIds: ["typescript"],
        fileExtensions: [".ts"],
        runtimeNotes: "a stub",
      },
    ],
  };
}

const broker = { async request() {} };

/** Re-checks every waiter whenever `changed` is called by a host callback. */
function changes() {
  const waiters = new Set();
  return {
    changed: () => { for (const waiter of [...waiters]) waiter(); },
    until(check) {
      if (check()) return Promise.resolve();
      return new Promise((resolve) => {
        const waiter = () => {
          if (!check()) return;
          waiters.delete(waiter);
          resolve();
        };
        waiters.add(waiter);
      });
    },
  };
}

test("a language session starts, opens a document, and answers requests", async () => {
  const projectRoot = await projectFixture();
  const descriptor = await extensionFixture();
  const diagnostics = [];
  const observed = changes();
  const host = new ExtensionHost(descriptor.extensionId, {
    broker,
    onLanguageDiagnostics: (notification) => { diagnostics.push(notification); observed.changed(); },
  });
  await host.start(descriptor);
  assert.deepEqual(
    host.status().languageServers.map((contribution) => contribution.id),
    ["stub"],
  );
  const started = await host.invokeLanguage({
    method: "language.session.start",
    input: { sessionId: "s1", languageServerId: "stub", projectRoot },
  });
  assert.equal(started.state, "ready");
  assert.equal(started.description, "stub language server");
  await host.invokeLanguage({
    method: "language.document.open",
    input: { sessionId: "s1", path: "main.ts", languageId: "typescript", text: "const a = 1;", revision: 3 },
  });
  const completion = await host.invokeLanguage({
    method: "language.completion",
    input: { sessionId: "s1", path: "main.ts", position: { line: 0, character: 1 } },
  });
  assert.equal(completion.items[0].label, "greet");
  assert.equal(completion.items[0].kind, "function");
  assert.equal(completion.items[0].documentation, "Greets");
  const hover = await host.invokeLanguage({
    method: "language.hover",
    input: { sessionId: "s1", path: "main.ts", position: { line: 0, character: 1 } },
  });
  assert.equal(hover.contents, "**greet**");
  const definition = await host.invokeLanguage({
    method: "language.definition",
    input: { sessionId: "s1", path: "main.ts", position: { line: 0, character: 1 } },
  });
  // The target outside the project root is dropped rather than exposed.
  assert.deepEqual(definition.locations.map((location) => location.path), ["lib/target.ts"]);
  await observed.until(() => diagnostics.length > 0);
  assert.equal(diagnostics[0].path, "main.ts");
  assert.equal(diagnostics[0].revision, 3);
  assert.equal(diagnostics[0].diagnostics[0].severity, "error");
  assert.equal(diagnostics[0].diagnostics[0].code, "2304");
  await host.invokeLanguage({ method: "language.session.stop", input: { sessionId: "s1" } });
  await host.stop();
});

test("a language server that dies fails its session and counts once, then quarantines", async () => {
  const projectRoot = await projectFixture();
  const descriptor = await extensionFixture({ crashOnHover: true });
  const exits = [];
  const transitions = [];
  const observed = changes();
  const host = new ExtensionHost(descriptor.extensionId, {
    broker,
    limits: { maxCrashesInWindow: 2 },
    onLanguageSessionExit: (exit) => { exits.push(exit); observed.changed(); },
    onDiagnostic: (diagnostic) => { transitions.push(diagnostic.transition); observed.changed(); },
  });
  await host.start(descriptor);
  await host.invokeLanguage({
    method: "language.session.start",
    input: { sessionId: "s1", languageServerId: "stub", projectRoot },
  });
  await assert.rejects(
    host.invokeLanguage({
      method: "language.hover",
      input: { sessionId: "s1", path: "main.ts", position: { line: 0, character: 0 } },
    }),
  );
  // The host counts the crash in the same pass that reports the exit.
  await observed.until(() => exits.length >= 1);
  assert.equal(exits[0].reason, "exited");
  assert.equal(exits[0].exitCode, 3);
  assert.equal(host.status().state, "running");
  assert.equal(transitions.filter((value) => value === "failed").length, 1);
  await host.invokeLanguage({
    method: "language.session.start",
    input: { sessionId: "s2", languageServerId: "stub", projectRoot },
  });
  await assert.rejects(
    host.invokeLanguage({
      method: "language.hover",
      input: { sessionId: "s2", path: "main.ts", position: { line: 0, character: 0 } },
    }),
  );
  await observed.until(() => transitions.includes("quarantined"));
  assert.equal(host.status().state, "quarantined");
  await host.stop();
});

test("a child cannot register a language server its manifest did not contribute", async () => {
  const descriptor = await extensionFixture({ registerId: "undeclared" });
  const host = new ExtensionHost(descriptor.extensionId, { broker });
  await assert.rejects(host.start(descriptor), /undeclared or invalid|language server/u);
  await host.stop();
});

test("the manager indexes contributed language servers by extension and language id", async () => {
  const projectRoot = await projectFixture();
  const descriptor = await extensionFixture();
  const manager = new ExtensionHostManager({ broker });
  await manager.start(descriptor);
  const byExtension = manager.languageServersFor(".ts");
  assert.equal(byExtension.length, 1);
  assert.equal(byExtension[0].languageServerId, "example.language:stub");
  assert.equal(manager.languageServersFor("typescript").length, 1);
  assert.equal(manager.languageServersFor(".rs").length, 0);
  const started = await manager.invokeLanguage(descriptor.extensionId, {
    method: "language.session.start",
    input: { sessionId: "m1", languageServerId: "stub", projectRoot },
  });
  assert.equal(started.state, "ready");
  await manager.shutdown();
  assert.equal(manager.languageServersFor(".ts").length, 0);
});
