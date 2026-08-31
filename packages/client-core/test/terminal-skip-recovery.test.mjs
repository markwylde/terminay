import test from "node:test";
import assert from "node:assert/strict";
import { isRecoverableSkip } from "../dist/index.js";

const identity = { serverId: "server-a", projectId: "project-a", sessionId: "session-a" };
const skip = (reason) => ({ ...identity, type: "skip", fromPosition: 10, toPosition: 20, reason });

/**
 * Which gaps a display must re-hydrate for.
 *
 * This is the rule that keeps hydration from re-arming its own recovery. A
 * fresh presentation whose checkpoint trails the live head is delivered with a
 * gap describing the difference; recovering from that gap re-runs the same
 * attach, whose checkpoint trails by the same amount, forever. The terminal
 * then paints once and never again while its connection stays busy - which is
 * indistinguishable from a dead terminal.
 */

test("a gap established during hydration is not a recovery trigger", () => {
  assert.equal(isRecoverableSkip(skip("hydration")), false);
});

test("a live display that fell behind must re-hydrate", () => {
  assert.equal(isRecoverableSkip(skip("congestion")), true);
  assert.equal(isRecoverableSkip(skip("attachment_closed")), true);
});

test("only skips are recovery triggers", () => {
  assert.equal(isRecoverableSkip({ ...identity, type: "output", position: 0, nextPosition: 3, bytes: new Uint8Array(3), replay: false }), false);
  assert.equal(isRecoverableSkip({ ...identity, type: "exit", exitCode: 0, signal: null }), false);
});
