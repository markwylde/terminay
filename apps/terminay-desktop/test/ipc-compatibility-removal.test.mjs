import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import test from "node:test";

const compatibilityRoot = new URL("../src/compatibility/", import.meta.url);

test("Desktop no longer ships the obsolete renderer IPC client bridge", async () => {
  await assert.rejects(access(new URL("index.ts", compatibilityRoot)));
  await assert.rejects(access(new URL("framedIpcTransport.ts", compatibilityRoot)));
  await assert.rejects(access(new URL("scopedIpcClient.ts", compatibilityRoot)));
});

test("Desktop no longer ships the unused legacy renderer workspace seed adapter", async () => {
  await assert.rejects(access(new URL("workspaceSeed.ts", compatibilityRoot)));
});

test("Desktop removes the compatibility barrel and native workspace adapters", async () => {
  const publicApi = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

  assert.doesNotMatch(publicApi, /compatibility\/index/u);
  await assert.rejects(access(new URL("index.ts", compatibilityRoot)));
  await assert.rejects(access(new URL("workspaceAdoption.ts", compatibilityRoot)));
  await assert.rejects(access(new URL("workspaceViewCommands.ts", compatibilityRoot)));
});

async function productionSourceFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) return productionSourceFiles(path);
    return entry.isFile() && path.endsWith(".ts") ? [path] : [];
  }));
  return files.flat();
}

test("workspace commands and feature clients stay out of the protocol-blind Desktop host", async () => {
  const sourceRoot = resolve(new URL("../src/", import.meta.url).pathname);
  const sourceFiles = await productionSourceFiles(sourceRoot);

  for (const path of sourceFiles) {
    const source = await readFile(path, "utf8");
    assert.doesNotMatch(source, /compatibility\/workspace(?:Adoption|ViewCommands)/u, relative(sourceRoot, path));
  }

  const host = await readFile(new URL("../src/main/connectionHost.ts", import.meta.url), "utf8");
  assert.doesNotMatch(host, /@terminay\/client-core|WorkspaceClient|TerminayClient|moveProject|createView|closeView/u);
  assert.match(host, /DesktopConnectionEndpoint/u);
});

test("Desktop no longer ships the legacy agent-status application IPC bridge", async () => {
  const preload = await readFile(new URL("../../../electron/preload.ts", import.meta.url), "utf8");
  const main = await readFile(new URL("../../../electron/main.ts", import.meta.url), "utf8");
  assert.doesNotMatch(preload, /agent-status:(?:get-snapshot|acknowledge|acknowledge-terminal)|getAgentStatusSnapshot|acknowledgeAgentStatus|onAgentStatusSnapshot/u);
  assert.doesNotMatch(main, /registerAgentStatusIpcHandlers|AGENT_STATUS_SNAPSHOT_CHANNEL/u);
  await assert.rejects(access(new URL("../../../electron/agentStatus/ipc.ts", import.meta.url)));
});

test("Desktop registers project file roots inside the server authority, not through renderer IPC", async () => {
  const preload = await readFile(new URL("../../../electron/preload.ts", import.meta.url), "utf8");
  const main = await readFile(new URL("../../../electron/main.ts", import.meta.url), "utf8");
  const authority = await readFile(new URL("../../../electron/serverTerminalAuthority.ts", import.meta.url), "utf8");
  const folder = await readFile(new URL("../../../src/components/folder-viewer/FolderPanel.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(preload, /registerServerProjectRoot|server:register-project-root/u);
  assert.doesNotMatch(main, /server:register-project-root/u);
  assert.doesNotMatch(folder, /registerServerProjectRoot|server:register-project-root/u);
  assert.match(authority, /await this\.registerProjectRoot\(options\.projectId, project\.root\)/u);
});

test("Folder panels do not require Desktop disconnected file compatibility in connected web mode", async () => {
  const folder = await readFile(new URL("../../../src/components/folder-viewer/FolderPanel.tsx", import.meta.url), "utf8");
  const throwLines = folder.split("\n").filter((line) => line.includes("throw new Error"));

  assert.doesNotMatch(folder, /useDisconnectedFolderCompatibility/u);
  assert.doesNotMatch(folder, /useDisconnectedFileCompatibility\(/u);
  assert.equal(throwLines.some((line) => /disconnected file compatibility|Disconnected folder compatibility/u.test(line)), false);
  assert.match(folder, /useOptionalDisconnectedFileCompatibility/u);
});

test("Desktop does not expose legacy terminal creation through production IPC", async () => {
  const [preload, main, renderer] = await Promise.all([
    readFile(new URL("../../../electron/preload.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../electron/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../src/App.tsx", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(preload, /createTerminal:\s*\(/u);
  assert.doesNotMatch(main, /['"]terminal:create['"]/u);
  assert.doesNotMatch(renderer, /window\.terminay\.createTerminal/u);
  assert.match(preload, /test:create-server-terminal/u);
  assert.match(main, /test:create-server-terminal/u);
});

test("Desktop does not expose an unused renderer app-quit capability", async () => {
  const [preload, main, types] = await Promise.all([
    readFile(new URL("../../../electron/preload.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../electron/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../src/types/terminay.ts", import.meta.url), "utf8"),
  ]);

  for (const source of [preload, main, types]) {
    assert.doesNotMatch(source, /quitApp|app:quit/u);
  }
});
