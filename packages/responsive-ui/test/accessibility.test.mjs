import assert from "node:assert/strict";
import test from "node:test";
import {
  boundTerminalGeometry,
  createAccessibilityPreferenceModel,
  createFocusRestorationPlan,
  createTerminalSafetyModel,
  validateTerminalAccessoryInput,
} from "../dist/index.js";

test("accessibility preferences make reduced motion and announcement policy explicit", () => {
  const reduced = createAccessibilityPreferenceModel({
    reducedMotion: true,
    colorScheme: "dark",
    forcedColors: true,
    highContrast: true,
    screenReader: true,
  });
  assert.deepEqual(reduced.motion, { transition: "none", durationScale: 0, preserveKeyboardAccess: true });
  assert.equal(reduced.colorScheme, "dark");
  assert.equal(reduced.forcedColors, true);
  assert.equal(reduced.highContrast, true);
  assert.equal(reduced.screenReader, true);
  assert.deepEqual(reduced.announcements, { statusLive: "polite", terminalLive: "off", terminalAtomic: false });
  assert.equal(Object.isFrozen(reduced), true);
  assert.equal(Object.isFrozen(reduced.motion), true);
});

test("focus restoration moves into a drawer and returns to the trigger without a focus jump", () => {
  const opening = createFocusRestorationPlan({ open: true, initialFocusId: "projects-close", restoreFocusId: "projects-trigger" });
  assert.deepEqual({ open: opening.open, openTarget: opening.openFocusTarget, closeTarget: opening.closeFocusTarget, preserve: opening.preserveFocus }, {
    open: true,
    openTarget: "projects-close",
    closeTarget: null,
    preserve: true,
  });

  const closing = createFocusRestorationPlan({ open: false, initialFocusId: "projects-close", restoreFocusId: "projects-trigger" });
  assert.equal(closing.closeFocusTarget, "projects-trigger");
  assert.equal(closing.missingTargetPolicy, "leave-focus-unchanged");
  assert.equal(createFocusRestorationPlan({ open: false }).closeFocusTarget, null);
  assert.throws(() => createFocusRestorationPlan({ open: true, initialFocusId: "bad id" }), /focus id is invalid/);
});

test("terminal safety keeps physical keyboard input while bounding accessory input and geometry", () => {
  const safety = createTerminalSafetyModel();
  assert.deepEqual({
    maxInputBytes: safety.maxInputBytes,
    maxCols: safety.maxCols,
    maxRows: safety.maxRows,
    keyboard: safety.preservesPhysicalKeyboardInput,
    input: safety.accessoryInput,
    outputLive: safety.terminalOutputLive,
  }, {
    maxInputBytes: 65536,
    maxCols: 500,
    maxRows: 200,
    keyboard: true,
    input: "allowlist-only",
    outputLive: "off",
  });

  const allowed = validateTerminalAccessoryInput("\u001b[A", ["\u001b[A", "\r"], safety);
  assert.deepEqual(allowed, { accepted: true, bytes: 3, value: "\u001b[A" });
  assert.equal(validateTerminalAccessoryInput("rm -rf /", ["\u001b[A"], safety).denial, "not-allowlisted");
  assert.equal(validateTerminalAccessoryInput("\u001b[A", [], safety).accepted, false);

  assert.deepEqual(boundTerminalGeometry({ cols: 900.8, rows: 0.5 }, safety), { cols: 500, rows: 1, clamped: true });
  assert.throws(() => boundTerminalGeometry({ cols: 0, rows: 24 }, safety), /must be positive/);
});

test("preference and terminal safety inputs fail closed when malformed", () => {
  assert.throws(() => createAccessibilityPreferenceModel({ reducedMotion: "yes" }), /reducedMotion must be boolean/);
  assert.throws(() => createAccessibilityPreferenceModel({ colorScheme: "sepia" }), /colorScheme is invalid/);
  assert.throws(() => createFocusRestorationPlan({ open: "yes" }), /open must be boolean/);
  assert.throws(() => createTerminalSafetyModel({ maxRows: 0 }), /maxRows must be a positive integer/);
  assert.throws(() => boundTerminalGeometry({ cols: Number.NaN, rows: 24 }), /must be finite/);
});
