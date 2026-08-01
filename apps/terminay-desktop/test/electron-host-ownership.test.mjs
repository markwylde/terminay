import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const electronMain = new URL("../../../electron/main.ts", import.meta.url);
const desktopMainRoot = new URL("../src/main/", import.meta.url);

test("Electron remains the owner of native integration and Local supervision", async () => {
  const [main, localServer, credentialStore] = await Promise.all([
    readFile(electronMain, "utf8"),
    readFile(new URL("localServer.ts", desktopMainRoot), "utf8"),
    readFile(new URL("credentialStore.ts", desktopMainRoot), "utf8"),
  ]);

  // Native application integration is implemented in the privileged Electron
  // main process, not in a server bundle or renderer client.
  assert.match(main, /import\s+\{[^}]*\b(?:app|Menu|shell|safeStorage)\b[^}]*\}\s+from ['"]electron['"]/u);
  assert.match(main, /function createAppMenu\(/u);
  assert.match(main, /Menu\.setApplicationMenu\(/u);
  assert.match(main, /async function getAppUpdateStatus\(/u);
  assert.match(main, /createGracefulQuitHandler\(/u);
  assert.match(main, /app\.on\('before-quit'/u);

  // The Desktop host owns Local lifetime independently of any renderer or
  // workspace view, while credentials use an explicitly privileged backend.
  assert.match(localServer, /export class DesktopLocalServerSupervisor/u);
  assert.match(localServer, /async handleLifecycle\(/u);
  assert.match(localServer, /event\.type === "renderer-reload"\) return/u);
  assert.match(credentialStore, /Privileged Electron code adapts safeStorage/u);
  assert.match(credentialStore, /export class SecureCredentialStore/u);
});
