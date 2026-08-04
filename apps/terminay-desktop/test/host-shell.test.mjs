import test from "node:test";
import assert from "node:assert/strict";
import { DesktopHostShellPolicy } from "../dist/main/index.js";

const local = { connectionId: "local:server", origin: "http://127.0.0.1:4311" };

test("selected connection loads only its server bundle origin", async () => {
  const policy = new DesktopHostShellPolicy();
  policy.selectConnection(local);
  const requested = [];
  const loaded = await policy.loadSelectedBundle(async (url) => {
    requested.push(url);
    return { status: 200, contentType: "application/json", finalUrl: url, bytes: new TextEncoder().encode('{"entry":"/remote-app/test/index.html"}') };
  });
  assert.deepEqual(requested, ["http://127.0.0.1:4311/manifest.json"]);
  assert.equal(loaded.connectionId, local.connectionId);
  assert.equal(loaded.origin, local.origin);
  assert.equal(loaded.url, "http://127.0.0.1:4311/manifest.json");
  assert.equal(loaded.finalUrl, loaded.url);
  assert.equal(Object.isFrozen(loaded), true);
  assert.throws(() => policy.bundleUrl("https://other.example/evil"), /asset path/);
  assert.throws(() => policy.bundleUrl("/remote-app/../outside"), /asset path/);
  await assert.rejects(policy.loadSelectedBundle(async () => ({ status: 503, bytes: new Uint8Array() })), /request failed/);
});

test("bundle responses must prove same-origin final URL and remain bounded", async () => {
  const policy = new DesktopHostShellPolicy();
  policy.selectConnection(local);
  await assert.rejects(policy.loadSelectedBundle(async () => ({ status: 200, finalUrl: "https://evil.example/manifest.json", bytes: new Uint8Array() })), /left the selected origin/);
  await assert.rejects(policy.loadSelectedBundle(async () => ({ status: 200, finalUrl: "http://127.0.0.1:4311/manifest.json?credential=secret", bytes: new Uint8Array() })), /left the selected origin/);
  await assert.rejects(policy.loadSelectedBundle(async () => ({ status: 200, finalUrl: "http://127.0.0.1:4311/manifest.json", bytes: new Uint8Array(32 * 1024 * 1024 + 1) })), /size limit/);
  await assert.rejects(policy.loadSelectedBundle(async () => ({ status: 200, bytes: new Uint8Array() })), /response URL/);
});

test("navigation is scoped to the selected connection and rejects unsafe URL state", () => {
  const policy = new DesktopHostShellPolicy();
  policy.selectConnection(local);
  assert.equal(policy.evaluate({ event: "navigation", connectionId: local.connectionId, url: "http://127.0.0.1:4311/remote-app/test/index.html" }).action, "allow");
  assert.equal(policy.evaluate({ event: "navigation", connectionId: local.connectionId, url: "https://other.example/index.html" }).action, "deny");
  assert.equal(policy.evaluate({ event: "navigation", connectionId: "remote:other", url: "http://127.0.0.1:4311/index.html" }).action, "deny");
  assert.equal(policy.evaluate({ event: "navigation", connectionId: local.connectionId, url: "http://127.0.0.1:4311/index.html?token=secret" }).action, "deny");
  assert.equal(policy.evaluate({ event: "navigation", connectionId: local.connectionId, url: "file:///tmp/evil.html" }).action, "deny");
});

test("new windows, downloads, permissions, and protocols are denied by default", () => {
  const policy = new DesktopHostShellPolicy();
  policy.selectConnection(local);
  for (const event of ["new-window", "download", "permission", "protocol"]) {
    const decision = policy.evaluate({ event, connectionId: local.connectionId, url: "https://docs.example/help", permission: event === "permission" ? "notifications" : undefined });
    assert.equal(decision.action, "deny", event);
  }
  assert.equal(policy.evaluate({ event: "protocol", connectionId: local.connectionId, url: "mailto:user@example.com" }).action, "deny");
});

test("privileged host callbacks explicitly opt in to one guarded request", () => {
  const policy = new DesktopHostShellPolicy({
    allowNewWindow: (request) => request.userGesture === true && request.url === "https://docs.example/help",
    allowDownload: (request) => request.url === "https://downloads.example/approved.zip",
    allowPermission: (request) => request.permission === "microphone" && request.url === `${local.origin}/dictation`,
    allowProtocol: (request) => request.url.startsWith("mailto:"),
  });
  policy.selectConnection(local);
  assert.equal(policy.evaluate({ event: "new-window", connectionId: local.connectionId, url: "https://docs.example/help", userGesture: true }).action, "allow");
  assert.equal(policy.evaluate({ event: "new-window", connectionId: local.connectionId, url: "https://docs.example/help", userGesture: false }).action, "deny");
  assert.equal(policy.evaluate({ event: "download", connectionId: local.connectionId, url: "https://downloads.example/approved.zip" }).action, "allow");
  assert.equal(policy.evaluate({ event: "permission", connectionId: local.connectionId, url: `${local.origin}/dictation`, permission: "microphone" }).action, "allow");
  assert.equal(policy.evaluate({ event: "protocol", connectionId: local.connectionId, url: "mailto:user@example.com" }).action, "allow");
});

test("selected HTTP origins are loopback-only", () => {
  const policy = new DesktopHostShellPolicy();
  assert.throws(() => policy.selectConnection({ connectionId: "remote:http", origin: "http://remote.example" }), /loopback/);
  assert.doesNotThrow(() => policy.selectConnection({ connectionId: "local:ipv6", origin: "http://[::1]:4311" }));
});
