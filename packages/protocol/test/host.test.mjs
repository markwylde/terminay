import assert from "node:assert/strict";
import test from "node:test";
import {
  createTerminayHostBytePacket,
  evaluateTerminayHostCompatibility,
  parseTerminayHostAction,
  parseTerminayHostActionRequest,
  parseTerminayHostBytePacket,
  parseTerminayHostCompatibilityRequirements,
  parseTerminayHostContext,
} from "../dist/index.js";

const requirements = {
  bootstrap: { minimum: 1, maximum: 1 },
  bundleFormat: { minimum: 1, maximum: 1 },
  hostBridge: { minimum: 1, maximum: 2 },
  byteEndpoint: { minimum: 1, maximum: 1 },
  executionRuntime: { minimum: 120, maximum: 140 },
  requiredCapabilities: { clipboardWrite: { minimum: 1, maximum: 1 } },
  optionalCapabilities: { nativeWindows: { minimum: 1, maximum: 2 } },
};

test("host context is closed, immutable, and cannot select Electron mode", () => {
  const context = parseTerminayHostContext({
    schemaVersion: 1,
    sourceId: "source-a",
    windowId: "window-a",
    serverId: "server-a",
    profileId: "profile-a",
    bundleId: "bundle_12345678",
    hostKind: "desktop",
    hostBridgeVersion: 1,
    byteEndpointVersion: 1,
    capabilities: { nativeWindows: 1, clipboardWrite: 1 },
  });
  assert.equal(context.hostKind, "desktop");
  assert.equal(context.capabilities.nativeWindows, 1);
  assert.equal(Object.isFrozen(context), true);
  assert.equal(Object.isFrozen(context.capabilities), true);
  assert.throws(
    () => parseTerminayHostContext({ ...context, mode: "electron" }),
    /fields are invalid/u,
  );
  assert.throws(
    () =>
      parseTerminayHostContext({ ...context, capabilities: { rootShell: 1 } }),
    /unknown capability/u,
  );
});

test("host compatibility separates required failures from optional degradation", () => {
  const compatible = evaluateTerminayHostCompatibility(requirements, {
    bootstrapVersion: 1,
    bundleFormatVersion: 1,
    hostBridgeVersion: 1,
    byteEndpointVersion: 1,
    executionRuntimeVersion: 125,
    capabilities: { clipboardWrite: 1 },
  });
  assert.deepEqual(compatible, {
    compatible: true,
    unavailableOptionalCapabilities: ["nativeWindows"],
  });

  const missing = evaluateTerminayHostCompatibility(requirements, {
    bootstrapVersion: 1,
    bundleFormatVersion: 1,
    hostBridgeVersion: 1,
    byteEndpointVersion: 1,
    executionRuntimeVersion: 125,
    capabilities: {},
  });
  assert.deepEqual(missing, {
    compatible: false,
    component: "host-capability",
    code: "missing-capability",
    capability: "clipboardWrite",
    required: { minimum: 1, maximum: 1 },
  });

  const runtime = evaluateTerminayHostCompatibility(requirements, {
    bootstrapVersion: 1,
    bundleFormatVersion: 1,
    hostBridgeVersion: 1,
    byteEndpointVersion: 1,
    executionRuntimeVersion: 119,
    capabilities: { clipboardWrite: 1 },
  });
  assert.equal(runtime.compatible, false);
  assert.equal(runtime.component, "execution-runtime");
  assert.equal(runtime.code, "below-minimum");
});

test("semantic host actions are closed and exact-binding/gesture checked", () => {
  const context = parseTerminayHostContext({
    schemaVersion: 1,
    sourceId: "source-a",
    windowId: "window-a",
    serverId: "server-a",
    profileId: "profile-a",
    bundleId: "bundle_12345678",
    hostKind: "desktop",
    hostBridgeVersion: 1,
    byteEndpointVersion: 1,
    capabilities: { nativeWindows: 1, clipboardWrite: 1 },
  });
  const request = parseTerminayHostActionRequest(
    {
      schemaVersion: 1,
      bridgeVersion: 1,
      sourceId: "source-a",
      windowId: "window-a",
      profileId: "profile-a",
      serverId: "server-a",
      userGesture: true,
      action: {
        type: "route.present",
        route: "/settings?section=terminal",
        disposition: "native-window",
      },
    },
    context,
  );
  assert.equal(request.action.type, "route.present");
  assert.throws(
    () => parseTerminayHostAction({ type: "clipboard.read" }),
    /not allowed/u,
  );
  assert.throws(
    () =>
      parseTerminayHostAction({
        type: "route.present",
        route: "/settings",
        disposition: "native-window",
        browserWindow: {},
      }),
    /fields are invalid/u,
  );
  assert.throws(
    () =>
      parseTerminayHostActionRequest(
        { ...request, userGesture: false },
        context,
      ),
    /user gesture/u,
  );
  assert.throws(
    () =>
      parseTerminayHostActionRequest(
        { ...request, serverId: "server-b" },
        context,
      ),
    /outside its binding/u,
  );
});

test("host compatibility rejects ambiguous and unknown capability requirements", () => {
  assert.throws(
    () =>
      parseTerminayHostCompatibilityRequirements({
        ...requirements,
        optionalCapabilities: { clipboardWrite: { minimum: 1, maximum: 1 } },
      }),
    /both required and optional/u,
  );
  assert.throws(
    () =>
      parseTerminayHostCompatibilityRequirements({
        ...requirements,
        requiredCapabilities: { arbitraryIpc: { minimum: 1, maximum: 1 } },
      }),
    /unknown capability/u,
  );
});

test("opaque host byte packets bind immutable bytes to one exact server", () => {
  const source = new Uint8Array([1, 2, 3]);
  const packet = createTerminayHostBytePacket("server-a", source);
  source[0] = 9;
  assert.deepEqual([...packet.frame], [1, 2, 3]);
  const parsed = parseTerminayHostBytePacket(packet, "server-a");
  packet.frame[1] = 8;
  assert.deepEqual([...parsed.frame], [1, 2, 3]);
  assert.throws(
    () => parseTerminayHostBytePacket(packet, "server-b"),
    /another server/u,
  );
  assert.throws(
    () =>
      parseTerminayHostBytePacket(
        { ...packet, operation: "workspace.create" },
        "server-a",
      ),
    /fields are invalid/u,
  );
});
