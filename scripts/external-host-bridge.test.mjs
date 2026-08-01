import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [app, terminalPanel, quickPush, markdownPreview, preload, main, declarations] = await Promise.all([
  readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/TerminalPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/QuickPushModal.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/file-viewer/preview/MarkdownPreview.tsx", import.meta.url), "utf8"),
  readFile(new URL("../electron/preload.ts", import.meta.url), "utf8"),
  readFile(new URL("../electron/main.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/vite-env.d.ts", import.meta.url), "utf8"),
]);

test("production workspace links use only the narrow external host capability", () => {
  assert.match(app, /window\.terminayExternalHost\?\.open\(\s*appUpdateStatus\.releaseUrl/u);
  assert.doesNotMatch(app, /window\.terminay\.openExternal\(\s*appUpdateStatus\.releaseUrl/u);
  assert.match(terminalPanel, /openExternal:\s*\(uri\)\s*=>\s*window\.terminayExternalHost\?\.open\(uri\)/u);
  assert.doesNotMatch(terminalPanel, /openExternal:\s*\(uri\)\s*=>\s*window\.terminay\.openExternal\(uri\)/u);
  assert.match(quickPush, /window\.terminayExternalHost\?\.open\(result\.pullRequestUrl/u);
  assert.match(markdownPreview, /window\.terminayExternalHost\?\.open\(href\)/u);
  assert.doesNotMatch(quickPush, /window\.terminay\.openExternal/u);
  assert.doesNotMatch(markdownPreview, /window\.terminay\.openExternal/u);
  assert.match(declarations, /terminayExternalHost\?:/u);
});

test("Electron validates a versioned external-host envelope before shell access", () => {
  assert.match(preload, /exposeInMainWorld\('terminayExternalHost'/u);
  assert.match(preload, /desktop:external-host:open/u);
  assert.match(preload, /DESKTOP_EXTERNAL_HOST_BRIDGE_VERSION = 1/u);
  assert.match(main, /ipcMain\.handle\('desktop:external-host:open'/u);
  assert.match(main, /assertTrustedAppSender\(event\)/u);
  assert.match(main, /Object\.keys\(request\)\.length !== 2/u);
  assert.match(main, /request\.version !== 1/u);
  assert.match(main, /await openInBrowser\(request\.url\)/u);
});

test("the retired broad shell IPC and preload method cannot return", () => {
  assert.doesNotMatch(preload, /openExternal:\s*\(url/u);
  assert.doesNotMatch(main, /ipcMain\.handle\('shell:open-external'/u);
});
