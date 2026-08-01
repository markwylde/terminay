import assert from "node:assert/strict";
import test from "node:test";
import { createServerHealthServer, parseServerCliOptions } from "../dist/index.js";

test("health server separates liveness from readiness and never returns diagnostics", async () => {
  let snapshot = { phase: "created", serverId: "docker-server", version: "1.0.0", ready: false };
  const server = createServerHealthServer({ host: "127.0.0.1", port: 0, health: () => snapshot });
  const address = await server.start();
  try {
    assert.equal(address.host, "127.0.0.1");
    const live = await fetch(`${address.origin}/healthz`);
    assert.equal(live.status, 200);
    assertHealthSecurityHeaders(live);
    assert.deepEqual(await live.json(), { status: "ok", ready: false, phase: "created", serverId: "docker-server", version: "1.0.0" });

    const notReady = await fetch(`${address.origin}/readyz`);
    assert.equal(notReady.status, 503);
    assertHealthSecurityHeaders(notReady);
    assert.equal((await notReady.json()).ready, false);

    snapshot = { ...snapshot, phase: "ready", ready: true };
    const ready = await fetch(`${address.origin}/readyz`);
    assert.equal(ready.status, 200);
    const body = await ready.json();
    assert.equal(body.ready, true);
    assert.equal("dataRoot" in body, false);
    assert.equal("credential" in body, false);

    const head = await fetch(`${address.origin}/readyz`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assertHealthSecurityHeaders(head);
    assert.equal(await head.text(), "");
    const unknown = await fetch(`${address.origin}/unknown`);
    assert.equal(unknown.status, 404);
    assertHealthSecurityHeaders(unknown);
    const disallowedMethod = await fetch(`${address.origin}/readyz`, { method: "POST" });
    assert.equal(disallowedMethod.status, 405);
    assertHealthSecurityHeaders(disallowedMethod);
  } finally {
    await server.stop();
  }
});

function assertHealthSecurityHeaders(response) {
  assert.equal(
    response.headers.get("content-security-policy"),
    "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("permissions-policy"), "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("cache-control"), "no-store");
}

test("health options are opt-in and parse a bounded port", () => {
  const defaults = parseServerCliOptions([], {});
  assert.equal(defaults.healthPort, undefined);
  const options = parseServerCliOptions(["--health-host", "0.0.0.0", "--health-port", "8080"], {});
  assert.deepEqual({ healthHost: options.healthHost, healthPort: options.healthPort }, { healthHost: "0.0.0.0", healthPort: 8080 });
  assert.throws(() => parseServerCliOptions(["--health-port", "70000"], {}), /out of range/);
});

test("health server fails closed when a lifecycle callback yields an invalid snapshot", async () => {
  let snapshot = null;
  const server = createServerHealthServer({ host: "127.0.0.1", port: 0, health: () => snapshot });
  const address = await server.start();
  try {
    const invalid = await fetch(`${address.origin}/readyz`);
    assert.equal(invalid.status, 503);
    assertHealthSecurityHeaders(invalid);
    assert.deepEqual(await invalid.json(), { status: "unavailable", ready: false });

    snapshot = {
      phase: "ready",
      serverId: "server",
      version: "1.0.0",
      // A callback must not be able to surface oversized arbitrary data via
      // this unauthenticated probe.
      ready: "yes",
      diagnostic: "must-not-leak",
    };
    const malformed = await fetch(`${address.origin}/healthz`);
    assert.equal(malformed.status, 503);
    assert.deepEqual(await malformed.json(), { status: "unavailable", ready: false });

    snapshot = { phase: "ready", serverId: "server", version: "1.0.0", ready: true };
    const recovered = await fetch(`${address.origin}/readyz`);
    assert.equal(recovered.status, 200);
    assert.deepEqual(await recovered.json(), {
      status: "ok", ready: true, phase: "ready", serverId: "server", version: "1.0.0",
    });
  } finally {
    await server.stop();
  }
});
