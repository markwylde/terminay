import assert from "node:assert/strict";
import test from "node:test";
import { FEATURE_CAPABILITIES, LANGUAGE_OPERATIONS, PROJECT_START_OPERATIONS, SERVER_UPGRADE_OPERATIONS } from "@terminay/protocol";
import {
  ACTIVITY_OPERATIONS,
  NOTIFICATION_OPERATIONS,
  PUSH_OPERATIONS,
  TERMINAL_TITLE_OPERATIONS,
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
  FORGE_OPERATIONS,
  ForgeService,
  ServerForgeAdapter,
  MACRO_OPERATIONS,
  AUTOMATION_OPERATIONS,
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
        FEATURE_CAPABILITIES.appWindowAttachments,
        FEATURE_CAPABILITIES.appWindowMirror,
        FEATURE_CAPABILITIES.appWindows,
        FEATURE_CAPABILITIES.health,
        FEATURE_CAPABILITIES.macros,
        FEATURE_CAPABILITIES.mcpApprovals,
        FEATURE_CAPABILITIES.notifications,
        FEATURE_CAPABILITIES.projectStartChoice,
        FEATURE_CAPABILITIES.serverUpgrade,
        FEATURE_CAPABILITIES.settings,
        FEATURE_CAPABILITIES.terminal,
        FEATURE_CAPABILITIES.terminalTitles,
        FEATURE_CAPABILITIES.workspace,
        FEATURE_CAPABILITIES.workspaceChanges,
        FEATURE_CAPABILITIES.workspaceView,
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
    [FORGE_OPERATIONS, FEATURE_CAPABILITIES.forge],
    [ACTIVITY_OPERATIONS, FEATURE_CAPABILITIES.agents],
    [NOTIFICATION_OPERATIONS, FEATURE_CAPABILITIES.notifications],
    [PUSH_OPERATIONS, FEATURE_CAPABILITIES.push],
    [TERMINAL_TITLE_OPERATIONS, FEATURE_CAPABILITIES.terminalTitles],
    [SERVER_UPGRADE_OPERATIONS, FEATURE_CAPABILITIES.serverUpgrade],
    [AGENT_OPERATIONS, FEATURE_CAPABILITIES.agents],
    [SETTINGS_OPERATIONS, FEATURE_CAPABILITIES.settings],
    [SHELL_PROFILE_OPERATIONS, FEATURE_CAPABILITIES.settings],
    [MACRO_OPERATIONS, FEATURE_CAPABILITIES.macros],
    [AUTOMATION_OPERATIONS, FEATURE_CAPABILITIES.automations],
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
  // Starting a project is a workspace command; its recent folders and the
  // server folder browser exist only where the start choice does.
  assert.equal(capabilityOf(PROJECT_START_OPERATIONS.start), FEATURE_CAPABILITIES.workspace);
  for (const operation of [
    PROJECT_START_OPERATIONS.recentList,
    PROJECT_START_OPERATIONS.recentForget,
    PROJECT_START_OPERATIONS.browseRootFolders,
  ])
    assert.equal(capabilityOf(operation), FEATURE_CAPABILITIES.projectStartChoice, operation);
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

test("a server composed with forge sources advertises forge.v1 and answers forge.claims", async () => {
  const workspace = new WorkspaceStore(createInitialWorkspace("forge-server"));
  const hosts = {
    forgeSourceContributions: () => [
      { extensionId: "gitea", contribution: { id: "gitea/forge", displayName: "Gitea", kinds: ["pullRequest", "issue"], allReach: "readable" } },
    ],
    forgeSourceAccounts: async () => [],
    claimForgeRemote: async () => ({ origin: "https://git.example.net", owner: "acme", name: "app" }),
    queryForgeSource: async () => ({ page: { items: [] }, dropped: 0 }),
    forgeSourceDetail: async () => { throw new Error("unused"); },
    onContributionsChanged: () => () => {},
    onForgeSourceEvent: () => () => {},
  };
  const projects = {
    repositoryContexts: () => [{
      projectId: "p1",
      context: { id: "c", repositoryRoot: "/src/app", remotes: [{ name: "origin", url: "ssh://example/acme/app" }], worktrees: [] },
    }],
    onContextsChanged: () => () => {},
  };
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: "forge-server",
    serverVersion: "1.0.0",
    capabilities: [FEATURE_CAPABILITIES.health],
    ptyFactory: createPtyFactory(),
    workspace,
    forge: new ServerForgeAdapter(new ForgeService({ hosts, projects })),
    operations: { queries: { "server.health": () => ({ ok: true }) } },
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "read" }),
  });
  try {
    assert.ok(composition.coreOptions.capabilities.includes(FEATURE_CAPABILITIES.forge));
    const handler = composition.operations.queries.get(FORGE_OPERATIONS.claims);
    const result = await handler({
      envelope: { payload: { projectId: "p1" } },
      body: new Uint8Array(),
      context: { authScope: "read", clientId: "c" },
    });
    assert.equal(result.claims[0].sourceId, "gitea/forge");
    assert.equal(result.claims[0].owner, "acme");
  } finally {
    await composition.shutdown();
  }
});
