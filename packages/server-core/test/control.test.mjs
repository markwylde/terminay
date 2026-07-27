import test from "node:test";
import assert from "node:assert/strict";
import { ControlCapabilityRegistry } from "../dist/control/index.js";

test("control capabilities are opaque, scoped, expiring, and revocable", () => {
  let now = 100;
  const registry = new ControlCapabilityRegistry({ now: () => now, ttlMs: 10, tokenFactory: (() => { let n = 0; return () => `token-${++n}`; })() });
  const capability = registry.mint("session-a", "project-a", "write");
  assert.equal(capability.token.startsWith("session-a"), false);
  assert.equal(registry.authorize({ token: capability.token, terminalSessionId: "session-a", projectId: "project-a", requiredScope: "read" }).token, capability.token);
  assert.throws(() => registry.authorize({ token: capability.token, terminalSessionId: "session-b", projectId: "project-a" }), /scope mismatch/);
  now = 111;
  assert.throws(() => registry.authorize({ token: capability.token, terminalSessionId: "session-a", projectId: "project-a" }), /unavailable/);
});

test("rotation and terminal exit revoke all prior capabilities", () => {
  const registry = new ControlCapabilityRegistry({ tokenFactory: (() => { let n = 0; return () => `token-${++n}`; })() });
  const first = registry.mint("session-a", "project-a");
  const second = registry.rotate("session-a", "project-a");
  assert.notEqual(first.token, second.token);
  assert.throws(() => registry.authorize({ token: first.token, terminalSessionId: "session-a", projectId: "project-a" }), /unavailable/);
  assert.equal(registry.onTerminalExit("session-a"), 1);
  assert.throws(() => registry.authorize({ token: second.token, terminalSessionId: "session-a", projectId: "project-a" }), /unavailable/);
});
