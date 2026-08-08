import test from "node:test";
import assert from "node:assert/strict";
import {
  TerminalPresentationLeaseAuthority,
  TerminalServiceError,
} from "../dist/index.js";

const identity = { serverId: "server-a", projectId: "project-a", sessionId: "session-a" };
const desktop = { ...identity, clientId: "desktop", attachmentId: "attachment-desktop" };
const browser = { ...identity, clientId: "browser", attachmentId: "attachment-browser" };

test("presentation ownership requires explicit acquire and exact attachment identity", () => {
  let now = 100;
  const changes = [];
  const authority = new TerminalPresentationLeaseAuthority({ now: () => now, leaseMs: 50, maxLeaseMs: 100, onChanged: (state, action) => changes.push({ state, action }) });

  assert.equal(authority.state(identity).holder, undefined);
  assert.throws(() => authority.assertHolder(desktop), (error) => error instanceof TerminalServiceError && error.details?.reason === "presentation_owner");

  const acquired = authority.change("acquire", desktop);
  assert.equal(acquired.holder?.attachmentId, desktop.attachmentId);
  assert.equal(acquired.holder?.leaseExpiresAt, 150);
  assert.doesNotThrow(() => authority.assertHolder(desktop));
  assert.throws(() => authority.assertHolder({ ...desktop, attachmentId: "attachment-spoof" }), TerminalServiceError);
  assert.throws(() => authority.change("acquire", browser), TerminalServiceError);

  now = 120;
  assert.equal(authority.change("renew", desktop).holder?.leaseExpiresAt, 170);
  assert.equal(authority.change("takeover", browser).holder?.clientId, "browser");
  assert.throws(() => authority.assertHolder(desktop), TerminalServiceError);
  assert.doesNotThrow(() => authority.assertHolder(browser));
  assert.deepEqual(changes.map((entry) => entry.action), ["acquire", "renew", "takeover"]);
});

test("presentation lease expires, disconnect releases it, and revocation is admin-only", () => {
  let now = 1_000;
  const authority = new TerminalPresentationLeaseAuthority({ now: () => now, leaseMs: 25 });
  authority.change("acquire", desktop);
  now = 1_025;
  assert.equal(authority.state(identity).holder, undefined);
  assert.equal(authority.change("acquire", browser).holder?.clientId, "browser");
  assert.equal(authority.releaseClient(identity, "browser"), true);
  assert.equal(authority.state(identity).holder, undefined);

  authority.change("acquire", desktop);
  assert.throws(() => authority.change("revoke", browser), (error) => error instanceof TerminalServiceError && error.details?.reason === "presentation_admin");
  assert.equal(authority.change("revoke", browser, { admin: true }).holder, undefined);
});

test("a still-attached controller can renew after the host wakes from sleep", () => {
  let now = 1_000;
  const authority = new TerminalPresentationLeaseAuthority({ now: () => now, leaseMs: 15_000 });

  const acquired = authority.change("acquire", desktop);
  assert.equal(acquired.holder?.attachmentId, desktop.attachmentId);

  // Renderer timers are suspended while macOS sleeps. The attachment and PTY
  // remain live, but the next five-second renewal runs after the wall-clock
  // lease deadline has passed.
  now += 60 * 60 * 1_000;

  const renewed = authority.change("renew", desktop);
  assert.equal(renewed.holder?.attachmentId, desktop.attachmentId);
});

test("a delayed renewal after sleep cannot displace a new controller", () => {
  let now = 1_000;
  const authority = new TerminalPresentationLeaseAuthority({ now: () => now, leaseMs: 15_000 });
  authority.change("acquire", desktop);

  now += 60 * 60 * 1_000;
  authority.change("acquire", browser);

  assert.throws(
    () => authority.change("renew", desktop),
    (error) => error instanceof TerminalServiceError && error.details?.reason === "presentation_owner",
  );
  assert.equal(authority.state(identity).holder?.attachmentId, browser.attachmentId);
});

test("server command order deterministically resolves simultaneous takeovers", () => {
  const authority = new TerminalPresentationLeaseAuthority();
  authority.change("acquire", desktop);
  authority.change("takeover", browser);
  authority.change("takeover", desktop);
  const state = authority.state(identity);
  assert.equal(state.holder?.clientId, "desktop");
  assert.equal(state.revision, 3);
});
