import assert from "node:assert/strict";
import test from "node:test";
import {
  FEATURE_CAPABILITIES,
} from "@terminay/protocol";
import {
  OrderedEventJournal,
  TerminalLauncherRegistry,
  WorkspaceStore,
  createInitialWorkspace,
  createServerCoreComposition,
} from "../dist/index.js";

const LAUNCHER = "com.terminay.builtin-agents/launch-claude-code";

function createPtyFactory() {
  const processes = [];
  return {
    processes,
    spawn(options) {
      const writes = [];
      const process = {
        pid: 7200 + processes.length,
        options,
        writes,
        write(data) {
          writes.push(typeof data === "string" ? data : new TextDecoder().decode(data));
        },
        resize() {},
        kill() {},
        onData() {
          return () => {};
        },
        onExit() {
          return () => {};
        },
      };
      processes.push(process);
      return process;
    },
  };
}

const system = { id: "system", name: "System default", target: { kind: "executable", executable: "/bin/zsh" }, args: [], startupMode: "default", environment: {}, kind: "system", readOnly: true, source: "system", availability: { available: true } };
const profiles = {
  catalogue: async () => ({ settingsRevision: 1, defaultProfileId: "system", cwdPolicy: "current", entries: [system], projectReferences: {} }),
  resolveProfile: async (_id, catalogue) => ({ profile: system, definition: system, settingsRevision: catalogue.settingsRevision, target: system.target }),
};
const unwrap = (answer) => answer.result ?? answer;
const pathAuthority = { canonicalDirectory: async (value) => (value === "/project" || value === "/home" ? value : null), homeDirectory: async () => "/home", isRoot: (value) => value === "/" };

function launcherSource({ installed = true } = {}) {
  const listeners = new Set();
  const state = { installed };
  return {
    state,
    terminalLauncherContributions: () => [
      { extensionId: "com.terminay.builtin-agents", contribution: { id: LAUNCHER, displayName: "Claude Code", icon: "agent-claude-code" } },
    ],
    async resolveTerminalLauncher() {
      return state.installed
        ? { available: true, executable: "/Users/me/.local/bin/claude" }
        : { available: false, reason: "not_installed" };
    },
    onContributionsChanged(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async changed() {
      for (const listener of listeners) await listener();
    },
  };
}

function fixture(options = {}) {
  const workspace = new WorkspaceStore(createInitialWorkspace("server-a"));
  const pty = createPtyFactory();
  const eventJournal = new OrderedEventJournal();
  const source = launcherSource(options);
  const launchers = new TerminalLauncherRegistry({ platform: "darwin", maxResolutionAgeMs: 0 });
  launchers.attach(source);
  const composition = createServerCoreComposition({
    serverId: "server-a",
    serverVersion: "1.0.0",
    capabilities: [],
    ptyFactory: pty,
    workspace,
    eventJournal,
    terminalProfiles: profiles,
    terminalLaunchPathAuthority: pathAuthority,
    terminalLaunchers: launchers,
  });
  composition.workspaceOperations.applyHostCommand("h0", { type: "project.create", projectId: "project-a", viewId: workspace.state.viewOrder[0], root: "/project", name: "A" });
  let serial = 0;
  const context = { authScope: "write", clientId: "client-a", connectionId: "connection-a", signal: new AbortController().signal };
  const create = (payload) =>
    composition.operations.commands.get("terminal.create")({
      body: new Uint8Array(),
      context,
      envelope: { commandId: `create-${++serial}`, operation: "terminal.create", payload: { projectId: "project-a", cols: 80, rows: 24, ...payload } },
    });
  const list = () =>
    composition.operations.queries.get("terminal.launchers")({
      body: new Uint8Array(),
      context: { ...context, authScope: "read" },
      envelope: { queryId: "q", operation: "terminal.launchers", payload: {} },
    });
  const panelOf = (sessionId) => Object.values(workspace.state.panels).find((panel) => panel.type === "terminal" && panel.sessionId === sessionId);
  return { composition, workspace, pty, eventJournal, source, launchers, create, list, panelOf };
}

test("the server lists its launchers without a path and says it offers them", async () => {
  const { composition, list } = fixture();
  try {
    assert.deepEqual(await list(), { launchers: [{ id: LAUNCHER, displayName: "Claude Code", icon: "agent-claude-code" }] });
    assert.ok(composition.coreOptions.capabilities.includes(FEATURE_CAPABILITIES.terminalLaunchers));
  } finally {
    await composition.shutdown?.();
  }
});

test("a launched terminal starts with the default profile and types the agent's path, alone", async () => {
  const { composition, pty, create, panelOf } = fixture();
  try {
    const made = unwrap(await create({ launcherId: LAUNCHER }));
    const spawned = pty.processes.at(-1);
    assert.equal(spawned.options.shellPath, "/bin/zsh");
    assert.equal(spawned.options.cwd, "/project");
    assert.deepEqual(spawned.writes, ["'/Users/me/.local/bin/claude'\r"]);
    assert.equal(panelOf(made.sessionId).title, "Claude Code");
    assert.equal(JSON.stringify(panelOf(made.sessionId)).includes(LAUNCHER), false, "the launcher id is not stored with the terminal");
  } finally {
    await composition.shutdown?.();
  }
});

test("a terminal without a launcher types nothing and keeps its usual title", async () => {
  const { composition, pty, create, panelOf } = fixture();
  try {
    const made = unwrap(await create({}));
    assert.deepEqual(pty.processes.at(-1).writes, []);
    assert.match(panelOf(made.sessionId).title, /^Terminal \d+$/);
  } finally {
    await composition.shutdown?.();
  }
});

test("an unknown or unavailable launcher is refused before anything is spawned", async () => {
  const { composition, pty, create, workspace } = fixture({ installed: false });
  try {
    await assert.rejects(create({ launcherId: LAUNCHER }), /launcher/);
    await assert.rejects(create({ launcherId: "com.terminay.builtin-agents/launch-nope" }), /launcher/);
    await assert.rejects(create({ launcherId: "claude; rm -rf ~" }), /invalid/);
    assert.equal(pty.processes.length, 0);
    assert.equal(Object.keys(workspace.state.panels).length, 0);
  } finally {
    await composition.shutdown?.();
  }
});

test("clients hear when the launchers change", async () => {
  const { composition, eventJournal, source, launchers } = fixture();
  try {
    await launchers.refresh();
    const heard = [];
    eventJournal.subscribe((event) => heard.push(event.event));
    source.state.installed = false;
    await source.changed();
    assert.ok(heard.includes("terminal.launchers.changed"));
  } finally {
    await composition.shutdown?.();
  }
});
