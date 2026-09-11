import assert from "node:assert/strict";
import test from "node:test";
import { FEATURE_CAPABILITIES, LANGUAGE_OPERATIONS } from "@terminay/protocol";
import {
  ACTIVITY_OPERATIONS,
  AGENT_OPERATIONS,
  AI_SERVER_OPERATIONS,
  AgentStatusService,
  CONNECTION_MECHANICS,
  DOCUMENTATION_OPERATIONS,
  FILE_CATALOG_OPERATIONS,
  FILE_CONTENT_OPERATIONS,
  FILE_OBSERVATION_OPERATIONS,
  FILE_OPERATIONS,
  GIT_OPERATIONS,
  MACRO_OPERATIONS,
  MDX_RUNTIME_OPERATIONS,
  MacroRepository,
  RECORDING_OPERATIONS,
  SETTINGS_OPERATIONS,
  SHELL_PROFILE_OPERATIONS,
  ServerSettingsRepository,
  TerminalActivityService,
  WORKSPACE_OPERATIONS,
  WorkspaceStore,
  capabilityOf,
  createInitialWorkspace,
  createServerCoreComposition,
} from "../dist/index.js";

function createPtyFactory() {
  return {
    spawn() {
      return {
        pid: 4242,
        write() {},
        resize() {},
        kill() {},
        onData() { return () => {}; },
        onExit() { return () => {}; },
      };
    },
  };
}

function createMemoryMacroBackend() {
  let state;
  return {
    load: async () => state,
    commit: async (next) => { state = structuredClone(next); },
  };
}

/** A composition with every service this test can construct for real. Any
 * operation it registers must belong to exactly one declared capability. */
function composeServer() {
  const workspace = new WorkspaceStore(createInitialWorkspace("capability-server"));
  const activity = new TerminalActivityService({ serverId: "capability-server" });
  let persisted;
  return createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: "capability-server",
    serverVersion: "1.0.0",
    capabilities: [FEATURE_CAPABILITIES.health],
    ptyFactory: createPtyFactory(),
    workspace,
    activity,
    agents: new AgentStatusService({ activity }),
    settings: new ServerSettingsRepository({
      load: async () => persisted,
      commit: async (state) => { persisted = structuredClone(state); },
    }),
    macros: {
      repository: new MacroRepository(createMemoryMacroBackend()),
      environmentFor: (_request, target) => ({ target, write() {} }),
    },
    operations: { queries: { "server.health": () => ({ ok: true }) } },
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
  });
}

test("every operation a composed server registers belongs to exactly one declared capability", async () => {
  const composition = composeServer();
  try {
    const advertised = new Set(composition.coreOptions.capabilities);
    const operations = new Set([
      ...composition.operations.queries.keys(),
      ...composition.operations.commands.keys(),
      ...composition.operations.policies.keys(),
    ]);
    assert.ok(operations.size > 20, "the composition registered no operations");
    const unclassified = [...operations].filter(
      (operation) => capabilityOf(operation) === undefined,
    );
    assert.deepEqual(
      unclassified,
      [],
      `extend the capability table for: ${unclassified.join(", ")}`,
    );
    // Classification is total, but it is only meaningful if the server also
    // says it serves that capability.
    const undeclared = [...operations].filter((operation) => {
      const capability = capabilityOf(operation);
      return capability !== CONNECTION_MECHANICS && !advertised.has(capability);
    });
    assert.deepEqual(
      undeclared,
      [],
      `operations registered without an advertised capability: ${undeclared.join(", ")}`,
    );
  } finally {
    await composition.shutdown();
  }
});

test("a composed server advertises the versioned capability of every service it owns", async () => {
  const composition = composeServer();
  try {
    assert.deepEqual(
      [...composition.coreOptions.capabilities].sort(),
      [
        FEATURE_CAPABILITIES.agents,
        FEATURE_CAPABILITIES.health,
        FEATURE_CAPABILITIES.macros,
        FEATURE_CAPABILITIES.settings,
        FEATURE_CAPABILITIES.terminal,
        FEATURE_CAPABILITIES.workspace,
      ].sort(),
    );
  } finally {
    await composition.shutdown();
  }
});

test("every stable operation name in the protocol surface maps to its own capability", () => {
  const groups = [
    [WORKSPACE_OPERATIONS, FEATURE_CAPABILITIES.workspace],
    [FILE_OPERATIONS, FEATURE_CAPABILITIES.files],
    [FILE_CATALOG_OPERATIONS, FEATURE_CAPABILITIES.files],
    [FILE_CONTENT_OPERATIONS, FEATURE_CAPABILITIES.files],
    [FILE_OBSERVATION_OPERATIONS, FEATURE_CAPABILITIES.files],
    [DOCUMENTATION_OPERATIONS, FEATURE_CAPABILITIES.files],
    [MDX_RUNTIME_OPERATIONS, FEATURE_CAPABILITIES.files],
    [GIT_OPERATIONS, FEATURE_CAPABILITIES.git],
    [ACTIVITY_OPERATIONS, FEATURE_CAPABILITIES.agents],
    [AGENT_OPERATIONS, FEATURE_CAPABILITIES.agents],
    [SETTINGS_OPERATIONS, FEATURE_CAPABILITIES.settings],
    [SHELL_PROFILE_OPERATIONS, FEATURE_CAPABILITIES.settings],
    [MACRO_OPERATIONS, FEATURE_CAPABILITIES.macros],
    [RECORDING_OPERATIONS, FEATURE_CAPABILITIES.recording],
    [AI_SERVER_OPERATIONS, FEATURE_CAPABILITIES.dictation],
    [LANGUAGE_OPERATIONS, FEATURE_CAPABILITIES.language],
  ];
  for (const [operations, capability] of groups) {
    for (const operation of Object.values(operations)) {
      if (typeof operation !== "string") continue;
      assert.equal(capabilityOf(operation), capability, operation);
    }
  }
  for (const operation of [
    "extensions.list",
    "extensions.install",
    "extensions.rollback",
  ])
    assert.equal(capabilityOf(operation), FEATURE_CAPABILITIES.extensions);
  for (const operation of [
    "server.health",
    "events.subscribe",
    "events.unsubscribe",
    "connection.ping",
  ])
    assert.equal(capabilityOf(operation), CONNECTION_MECHANICS);
  assert.equal(capabilityOf("nonsense.operation"), undefined);
});
