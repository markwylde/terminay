import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { transform } from "esbuild";
import {
  DesktopHostBridgeRouter,
  DesktopHostShellPolicy,
  normalizeExternalUrl,
  normalizePairingDeepLink,
  validateDesktopHostAction,
} from "../apps/terminay-desktop/dist/main/index.js";
import { createDesktopPresentationMetadata } from "../apps/terminay-desktop/dist/presentation.js";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const local = { connectionId: "local:server", origin: "http://127.0.0.1:4311" };

async function electronTypeScriptSources(directory = new URL("../electron/", import.meta.url)) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const location = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return electronTypeScriptSources(location);
    if (!entry.isFile() || !entry.name.endsWith(".ts")) return [];
    return [{ name: location.pathname, source: await readFile(location, "utf8") }];
  }));
  return nested.flat();
}

test("privileged Electron sources do not expose an unreviewed native dialog surface", async () => {
  const sources = await electronTypeScriptSources();
  assert.ok(sources.length > 0, "the Electron source tree must be audited");
  for (const { name, source } of sources) {
    assert.doesNotMatch(
      source,
      /import\s*\{[^}]*\bdialog\b[^}]*\}\s*from\s*["']electron["']/u,
      `${name} imports Electron's native dialog capability without a reviewed boundary`,
    );
    assert.doesNotMatch(
      source,
      /require\(\s*["']electron["']\s*\)\.dialog\b/u,
      `${name} accesses Electron's native dialog capability without a reviewed boundary`,
    );
  }
});

test("primary Electron windows use an explicit deny-by-default security policy", async () => {
  const main = await readFile(new URL("../electron/main.ts", import.meta.url), "utf8");
  const sessionPolicy = await readFile(new URL("../electron/sessionSecurity.ts", import.meta.url), "utf8");
  const policy = main.slice(main.indexOf("function securePrimaryWindow"), main.indexOf("function getBrandAssetPath"));

  assert.match(policy, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/u);
  assert.match(policy, /will-attach-webview/u);
  assert.match(policy, /will-frame-navigate/u);
  assert.match(policy, /will-navigate/u);
  assert.match(policy, /will-redirect/u);
  assert.match(policy, /secureSession\(contents\.session\)/u);
  assert.match(sessionPolicy, /setPermissionCheckHandler\(\(\) => false\)/u);
  assert.match(sessionPolicy, /setPermissionRequestHandler[\s\S]{0,120}callback\(false\)/u);
  assert.match(sessionPolicy, /will-download/u);
  assert.match(sessionPolicy, /item\.cancel\(\)/u);
  assert.doesNotMatch(main.slice(0, main.indexOf("function isAppNavigation")), /'file:'/u);

  const hardenedWindows = (main.match(/securePrimaryWindow\(/gu) ?? []).length;
  assert.ok(hardenedWindows >= 7, "all privileged primary windows install the shared policy");
  const isolatedWindows = (main.match(/contextIsolation:\s*true/g) ?? []).length;
  const noNodeIntegration = (main.match(/nodeIntegration:\s*false/g) ?? []).length;
  const sandboxedWindows = (main.match(/sandbox:\s*true/g) ?? []).length;
  const secureWebContents = (main.match(/webSecurity:\s*true/g) ?? []).length;
  const noWebviews = (main.match(/webviewTag:\s*false/g) ?? []).length;
  assert.ok(isolatedWindows >= 7, "primary renderer windows explicitly isolate their context");
  assert.ok(noNodeIntegration >= 7, "primary renderer windows explicitly disable Node integration");
  assert.ok(sandboxedWindows >= 7, "primary renderer windows explicitly enable sandboxing");
  assert.ok(secureWebContents >= 7, "primary renderer windows explicitly enable web security");
  assert.ok(noWebviews >= 7, "primary renderer windows explicitly disable webviews");

  const primaryWindow = main.slice(main.indexOf("function createWindow"), main.indexOf("function createSettingsWindow"));
  assert.match(primaryWindow, /did-create-window[\s\S]{0,120}securePrimaryWindow\(childWindow\)/u);
});

test("the unprivileged drag-preview window declares an inert renderer boundary", async () => {
  const main = await readFile(new URL("../electron/main.ts", import.meta.url), "utf8");
  const start = main.indexOf("function showTabGhostWindow");
  const end = main.indexOf("function moveTabGhostToCursor", start);
  assert.ok(start >= 0 && end > start, "tab drag preview window boundary is present");
  const ghostWindow = main.slice(start, end);

  assert.match(ghostWindow, /contextIsolation:\s*true/u);
  assert.match(ghostWindow, /nodeIntegration:\s*false/u);
  assert.match(ghostWindow, /sandbox:\s*true/u);
  assert.match(ghostWindow, /webSecurity:\s*true/u);
  assert.match(ghostWindow, /webviewTag:\s*false/u);
  assert.doesNotMatch(ghostWindow, /preload\s*:/u);
  assert.match(ghostWindow, /setIgnoreMouseEvents\(true\)/u);
});

test("legacy Electron external links are credential-free HTTPS URLs only", async () => {
  const directory = await mkdtemp(join(tmpdir(), "terminay-external-url-"));
  try {
    const output = join(directory, "externalUrl.mjs");
    await build({ bundle: true, entryPoints: ["electron/externalUrl.ts"], format: "esm", logLevel: "silent", outfile: output, platform: "node", target: "node20" });
    const policy = await import(pathToFileURL(output).href);
    assert.equal(policy.normalizeExternalHttpsUrl("https://docs.example.test/path?q=1#section"), "https://docs.example.test/path?q=1#section");
    assert.equal(policy.normalizeExternalHttpsUrl("https://docs.example.test:443/path"), "https://docs.example.test/path");
    for (const unsafe of ["http://docs.example.test", "file:///tmp/x", "javascript:alert(1)", "mailto:mark@example.test", "tel:+441234", "https://user:pass@docs.example.test", "https:docs.example.test/path", "https:\\docs.example.test/path", "https://docs.example.test\\@evil.example/path", "https://docs.example.test/\nunsafe"]) {
      assert.throws(() => policy.normalizeExternalHttpsUrl(unsafe), /HTTPS/u, unsafe);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  const main = await readFile(new URL("../electron/main.ts", import.meta.url), "utf8");
  assert.match(main, /normalizeExternalHttpsUrl/u);
  assert.match(main, /await shell\.openExternal\(normalizeExternalHttpsUrl\(url\)\)/u);
  assert.doesNotMatch(main.slice(0, main.indexOf("function isAppNavigation")), /mailto:|tel:/u);
  assert.match(main, /function assertTrustedAppSender/u);
  assert.match(main, /function isTrustedAppWindow[\s\S]{0,320}appWindows\.has\(window\)/u);
  for (const channel of ["desktop:project-edit-host:open", "app:open-terminal-edit", "remote:get-status", "remote:toggle-server", "remote:revoke-device", "remote:close-connection", "remote:set-pairing-address", "remote:set-pairing-pin", "desktop:recordings-host:open", "secrets:get", "secrets:save", "secrets:delete", "secrets:get-decrypted", "desktop:workspace-transfer-host:get-adopted-project", "desktop:workspace-transfer-host:popout-project", "desktop:workspace-transfer-host:merge-project", "desktop:window-lifecycle-host:close-current", "desktop:project-tab-host:publish-bar-rect", "desktop:project-tab-host:start-drag", "desktop:project-tab-host:end-drag", "test:get-mcp-control-environment", "test:send-app-command", "test:set-ai-tab-metadata-mock", "test:emit-agent-hook", "desktop:terminal-lifecycle-host:wait-for-inactivity", "desktop:mcp-install-host:get-status", "desktop:mcp-install-host:install", "desktop:mcp-install-host:uninstall"]) {
    const start = main.indexOf(`'${channel}'`);
    assert.ok(start >= 0, `${channel} is registered`);
    assert.match(main.slice(start, start + 360), /assertTrustedAppSender\(event\)/u, `${channel} validates sender provenance`);
  }
});

test("server UI CSP, permissions, sandbox, and navigation guards remain explicit", async () => {
  const host = await readFile(new URL("../electron/serverUiHost.ts", import.meta.url), "utf8");
  const remote = await readFile(new URL("../electron/remote/service.ts", import.meta.url), "utf8");

  assert.match(host, /contextIsolation:\s*true/u);
  assert.match(host, /nodeIntegration:\s*false/u);
  assert.match(host, /sandbox:\s*true/u);
  assert.match(host, /webSecurity:\s*true/u);
  assert.match(host, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/u);
  assert.match(host, /will-frame-navigate[\s\S]{0,240}isAllowedNavigation/u);
  assert.match(host, /will-navigate[\s\S]{0,240}isAllowedNavigation/u);
  assert.match(host, /will-redirect[\s\S]{0,240}isAllowedNavigation/u);
  assert.match(host, /setPermissionCheckHandler\(\(\) => false\)/u);
  assert.match(host, /callback\(false\)/u);
  assert.match(remote, /content-security-policy/u);
  assert.match(remote, /default-src 'self'/u);
  assert.match(remote, /script-src 'self'/u);
  assert.match(remote, /object-src 'none'/u);
  assert.match(remote, /frame-ancestors 'none'/u);
  assert.match(remote, /permissions-policy/u);
  assert.match(remote, /camera=\(\), microphone=\(\)/u);
  assert.match(remote, /referrer-policy/u);
});

test("server UI windows keep every selected server origin inside an isolated host session", async () => {
  const host = await readFile(new URL("../electron/serverUiHost.ts", import.meta.url), "utf8");
  const start = host.indexOf("export function createServerUiWindow");
  assert.ok(start >= 0, "server UI window boundary is present");
  const serverWindow = host.slice(start);

  assert.match(serverWindow, /contextIsolation:\s*true/u);
  assert.match(serverWindow, /nodeIntegration:\s*false/u);
  assert.match(serverWindow, /partition:\s*getServerUiPartitionName\(options\.hostPartitionKey\)/u);
  assert.match(serverWindow, /sandbox:\s*true/u);
  assert.match(serverWindow, /webSecurity:\s*true/u);
  assert.match(serverWindow, /webviewTag:\s*false/u);
  assert.match(serverWindow, /preload:\s*options\.preloadPath/u);
  assert.match(serverWindow, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/u);
  assert.match(serverWindow, /will-attach-webview/u);
  assert.match(serverWindow, /will-frame-navigate/u);
  assert.match(serverWindow, /will-navigate/u);
  assert.match(serverWindow, /will-redirect/u);
  assert.match(serverWindow, /isAllowedNavigation\([^,]+, expectedOrigin\)/u);
  assert.match(serverWindow, /session\.on\('will-download', denyDownload\)/u);
  assert.match(host, /item\.cancel\(\)/u);
  assert.match(serverWindow, /session\.setPermissionCheckHandler\(\(\) => false\)/u);
  assert.match(serverWindow, /session\.setPermissionRequestHandler/u);
  assert.match(serverWindow, /session\.off\('will-download', denyDownload\)/u);
});

test("remote connection navigation policy rejects origin and credential escapes", async () => {
  const source = await readFile(new URL("../electron/remote/connectionUrl.ts", import.meta.url), "utf8");
  const compiled = await transform(source, { format: "esm", loader: "ts", target: "es2022" });
  const policy = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString("base64")}`);
  const expectedOrigin = "https://remote.example.test";

  assert.equal(policy.isAllowedRemoteConnectionNavigation("https://remote.example.test/workspace", expectedOrigin), true);
  assert.equal(policy.isAllowedRemoteConnectionNavigation("https://remote.example.test/workspace?view=main", expectedOrigin), true);
  for (const url of [
    "https://attacker.example/workspace",
    "https://user:pass@remote.example.test/workspace",
    "file:///tmp/attacker.html",
    "javascript:alert(1)",
    "not a URL",
  ]) {
    assert.equal(policy.isAllowedRemoteConnectionNavigation(url, expectedOrigin), false, url);
  }
  assert.equal(policy.isAllowedRemoteConnectionNavigation("http://127.0.0.1:4311/workspace", "http://127.0.0.1:4311"), true);
});

test("selected desktop connection is the only navigation origin", () => {
  const policy = new DesktopHostShellPolicy();
  policy.selectConnection(local);

  assert.equal(policy.evaluate({ event: "navigation", connectionId: local.connectionId, url: "http://127.0.0.1:4311/workspace/index.html" }).action, "allow");
  assert.equal(policy.evaluate({ event: "navigation", connectionId: local.connectionId, url: "https://attacker.example/workspace" }).action, "deny");
  assert.equal(policy.evaluate({ event: "navigation", connectionId: local.connectionId, url: "file:///tmp/attacker.html" }).action, "deny");
  assert.equal(policy.evaluate({ event: "navigation", connectionId: local.connectionId, url: "http://127.0.0.1:4311/index.html?token=secret" }).action, "deny");
  assert.equal(policy.evaluate({ event: "new-window", connectionId: local.connectionId, url: "https://attacker.example" }).action, "deny");
  assert.equal(policy.evaluate({ event: "download", connectionId: local.connectionId, url: "https://attacker.example/file" }).action, "deny");
  assert.equal(policy.evaluate({ event: "permission", connectionId: local.connectionId, url: "https://attacker.example", permission: "microphone" }).action, "deny");
});

test("pairing deep links keep only the exact HTTPS origin and never accept query credentials", () => {
  const link = normalizePairingDeepLink("https://pair.example.test/session#one-time-pairing-secret");
  assert.deepEqual(link, { origin: "https://pair.example.test", path: "/session", fragmentLength: 23 });
  assert.equal(JSON.stringify(link).includes("one-time-pairing-secret"), false);

  assert.throws(() => normalizePairingDeepLink("http://pair.example.test/session#secret"), /HTTPS/u);
  assert.throws(() => normalizePairingDeepLink("https://user:pass@pair.example.test/session#secret"), /credentials/u);
  assert.throws(() => normalizePairingDeepLink("https://pair.example.test/session?secret=leaked#secret"), /query/u);
  assert.throws(() => normalizePairingDeepLink("https://pair.example.test/session#%ZZ"), /fragment/u);
  assert.throws(() => normalizePairingDeepLink("https://pair.example.test/session#%0A"), /fragment/u);
});

test("clipboard and external URL actions are bounded by the host bridge", async () => {
  const external = validateDesktopHostAction({ type: "external.open", url: "https://docs.example.test/help?q=1#overview" });
  assert.deepEqual(external, { type: "external.open", url: "https://docs.example.test/help?q=1#overview" });
  assert.equal(normalizeExternalUrl("https://docs.example.test:443/help"), "https://docs.example.test/help");
  for (const url of [
    "http://docs.example.test/help",
    "javascript:alert(1)",
    "https://user:pass@docs.example.test/help",
    "https://docs.example.test/\nhelp",
  ]) {
    assert.throws(() => validateDesktopHostAction({ type: "external.open", url }), /external\.open/u);
  }
  assert.throws(() => validateDesktopHostAction({ type: "clipboard.write", text: "x".repeat(1024 * 1024 + 1) }), /clipboard/u);
  assert.throws(() => validateDesktopHostAction({ type: "clipboard.write", text: "ok", extra: true }), /clipboard/u);

  const calls = [];
  const router = new DesktopHostBridgeRouter();
  router.register({
    sourceId: "source-a",
    context: {
      version: 1,
      windowId: "window-a",
      connectionId: "local:server",
      profileLabel: "Local",
      capabilities: { nativeWindows: true, clipboard: true, osIntegration: true },
      presentation: createDesktopPresentationMetadata(),
    },
    handlers: {
      clipboardWrite: (action) => calls.push(["clipboard", action.text]),
      externalOpen: (action) => calls.push(["external", action.url]),
    },
  });
  const request = (action, userGesture = true) => router.request({
    version: 1,
    sourceId: "source-a",
    windowId: "window-a",
    connectionId: "local:server",
    userGesture,
    action,
  });

  await request({ type: "clipboard.write", text: "safe" });
  await request({ type: "external.open", url: "https://docs.example.test/help" });
  await assert.rejects(request({ type: "clipboard.write", text: "blocked" }, false), /user gesture/u);
  await assert.rejects(request({ type: "external.open", url: "https://docs.example.test/help" }, false), /user gesture/u);
  await assert.rejects(router.request({ version: 1, sourceId: "source-a", windowId: "window-a", connectionId: "remote:other", userGesture: true, action: { type: "clipboard.write", text: "blocked" } }), /bound window or connection/u);
  assert.deepEqual(calls, [
    ["clipboard", "safe"],
    ["external", "https://docs.example.test/help"],
  ]);
});
