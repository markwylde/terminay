import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("terminal zoom uses the narrow read-only presentation bridge", async () => {
  const [panel, preload, main, declarations, compatibility] = await Promise.all([
    readFile(new URL("src/components/TerminalPanel.tsx", root), "utf8"),
    readFile(new URL("electron/preload.ts", root), "utf8"),
    readFile(new URL("electron/main.ts", root), "utf8"),
    readFile(new URL("src/vite-env.d.ts", root), "utf8"),
    readFile(new URL("src/types/terminay.ts", root), "utf8"),
  ]);

  assert.match(panel, /window\.terminayTerminalPresentationHost\?\.getZoom\(\)/u);
  assert.match(panel, /window\.terminayTerminalPresentationHost\?\.subscribeZoom\(/u);
  assert.match(panel, /window\.terminayTerminalPresentationHost\?\.subscribeRemoteSizeOverride\(/u);
  assert.doesNotMatch(panel, /window\.terminay\.onTerminalZoomChanged\(/u);
  assert.doesNotMatch(panel, /window\.terminay\.onTerminalRemoteSizeOverrideChanged\(/u);
  assert.doesNotMatch(panel, /window\.terminay\.getTerminalZoom\(/u);
  assert.match(preload, /exposeInMainWorld\(\s*['"]terminayTerminalPresentationHost['"]/u);
  assert.match(preload, /desktop:terminal-presentation-host:get-zoom/u);
  assert.match(preload, /subscribeZoom:/u);
  assert.match(preload, /subscribeRemoteSizeOverride:/u);
  assert.doesNotMatch(preload, /onTerminalZoomChanged:/u);
  assert.doesNotMatch(preload, /onTerminalRemoteSizeOverrideChanged:/u);
  assert.doesNotMatch(preload, /terminal:get-zoom/u);
  assert.match(main, /ipcMain\.handle\('desktop:terminal-presentation-host:get-zoom'/u);
  assert.doesNotMatch(main, /ipcMain\.handle\('terminal:get-zoom'/u);
  assert.match(main, /desktop:terminal-presentation-host:get-zoom'[\s\S]{0,160}assertTrustedAppSender/u);
  assert.match(declarations, /terminayTerminalPresentationHost\?:/u);
  assert.match(declarations, /subscribeZoom\(/u);
  assert.match(declarations, /subscribeRemoteSizeOverride\(/u);
  assert.doesNotMatch(compatibility, /onTerminalZoomChanged:/u);
  assert.doesNotMatch(compatibility, /onTerminalRemoteSizeOverrideChanged:/u);
  assert.doesNotMatch(compatibility, /getTerminalZoom/u);
});

test("terminal metadata uses the versioned presentation bridge, not broad application IPC", async () => {
  const [app, panel, host, preload, main, compatibility] = await Promise.all([
    readFile(new URL("src/App.tsx", root), "utf8"),
    readFile(new URL("src/components/TerminalPanel.tsx", root), "utf8"),
    readFile(new URL("src/components/terminalPresentationHost.ts", root), "utf8"),
    readFile(new URL("electron/preload.ts", root), "utf8"),
    readFile(new URL("electron/main.ts", root), "utf8"),
    readFile(new URL("src/types/terminay.ts", root), "utf8"),
  ]);

  assert.match(app, /publishTerminalPresentationMetadata\(/u);
  assert.match(panel, /publishTerminalPresentationMetadata\(/u);
  assert.match(host, /terminayTerminalPresentationHost\?\.updateMetadata/u);
  assert.match(preload, /desktop:terminal-presentation-host:update-metadata/u);
  assert.match(
    main,
    /ipcMain\.on\(\s*'desktop:terminal-presentation-host:update-metadata'/u,
  );
  assert.match(main, /request\.version !== 1/u);
  assert.match(preload, /terminalPresentationProjectIds\.get\(sessionId\)/u);
  assert.match(preload, /projectId,\s*serverId,\s*sessionId,/u);
  assert.match(main, /typeof request\.serverId !== 'string'/u);
  assert.match(main, /request\.serverId !== serverTerminalAuthority\?\.service\.serverId/u);
  assert.match(
    main,
    /request\.serverId !== serverTerminalAuthority\?\.service\.serverId[\s\S]{0,80}return;/u,
  );
  assert.match(main, /serverSession\.projectId !== request\.projectId/u);
  assert.match(main, /assertTrustedAppSender\(event\)/u);
  assert.doesNotMatch(preload, /terminal:update-remote-metadata/u);
  assert.doesNotMatch(main, /terminal:update-remote-metadata/u);
  assert.doesNotMatch(compatibility, /updateTerminalRemoteMetadata/u);
});
