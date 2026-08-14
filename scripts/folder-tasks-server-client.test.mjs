import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("FolderPanel task aggregation uses the connected server file client", async () => {
  const source = await readFile(new URL("../src/components/folder-viewer/FolderPanel.tsx", import.meta.url), "utf8");
  const scanStart = source.indexOf("async function scanFolderTasks(");
  assert.notEqual(scanStart, -1, "scanFolderTasks must exist");
  const scanEnd = source.indexOf("\nfunction toFileUrl(", scanStart);
  assert.notEqual(scanEnd, -1, "scanFolderTasks boundary marker must exist");
  const scanSource = source.slice(scanStart, scanEnd);

  assert.match(scanSource, /fileViewerClient\.getFolderMarkdownTasks\(/);
  assert.match(scanSource, /serverTaskIgnoredDirectories\(ignoredPatterns\)/);
  assert.match(scanSource, /deadlineMs: FOLDER_TASK_SCAN_DEADLINE_MS/u);
  assert.match(scanSource, /withDeadline\(/u);
  assert.match(source, /const FOLDER_TASK_SCAN_DEADLINE_MS = 8000/u);
  assert.match(source, /controller\.abort\(\)/u);
  assert.match(source, /const MAX_SERVER_TASK_IGNORED_DIRECTORIES = 128/u);
  assert.match(source, /seen\.size >= MAX_SERVER_TASK_IGNORED_DIRECTORIES/u);
  assert.doesNotMatch(scanSource, /registerServerProjectRoot|server:register-project-root/u);
  assert.doesNotMatch(scanSource, /window\.terminay\.listDirectory\(/);
  assert.doesNotMatch(scanSource, /terminayFileGateway\.readFileText\(/);
  assert.doesNotMatch(scanSource, /parseTasks\(/);
});

test("FolderPanel lists and expands directories through the connected server catalog", async () => {
  const source = await readFile(new URL("../src/components/folder-viewer/FolderPanel.tsx", import.meta.url), "utf8");
  const listStart = source.indexOf("async function listDirectoryNodes(");
  const listEnd = source.indexOf("\nfunction upsertDirectoryNode(", listStart);
  assert.notEqual(listStart, -1, "listDirectoryNodes must exist");
  assert.notEqual(listEnd, -1, "listDirectoryNodes boundary marker must exist");
  const listSource = source.slice(listStart, listEnd);
  assert.match(listSource, /fileViewerClient\.listFolder\(/);
  assert.match(listSource, /toRelativePath\(rootPath, targetPath\)/);
  assert.match(source, /TerminalPanelClientContext/);
	assert.match(source, /const fileViewerClient = terminalClientContext\.fileViewerClient/);
	assert.doesNotMatch(source, /useOptionalDisconnectedFileCompatibility|disconnectedFolderCompatibility/);
  assert.match(
    source,
    /listDirectoryNodes\(\s*projectRootPath \?\? folderPath,\s*directoryPath,\s*fileViewerClient,\s*projectId,\s*\)/,
  );
  assert.match(
    source,
    /listDirectoryNodes\(\s*projectRootPath \?\? folderPath,\s*folderPath,\s*fileViewerClient,\s*projectId,\s*\)/,
  );
  assert.doesNotMatch(source, /window\.terminay\.listDirectory/);
  assert.doesNotMatch(source, /registerServerProjectRoot|server:register-project-root/u);
});

test("canonical file viewer gateway bounds folder task protocol queries", async () => {
  const serverGatewaySource = await readFile(new URL("../src/services/fileViewer/serverFileGateway.ts", import.meta.url), "utf8");

  assert.match(serverGatewaySource, /const FOLDER_TASK_QUERY_DEADLINE_MS = 8000/u);
  assert.match(serverGatewaySource, /getFolderMarkdownTasks\(relative\(path\), options\.projectId, taskOptions, \{ deadlineMs: FOLDER_TASK_QUERY_DEADLINE_MS \}\)/u);
	assert.doesNotMatch(serverGatewaySource, /compatibilityGateway|terminayFileGateway/u);
});
