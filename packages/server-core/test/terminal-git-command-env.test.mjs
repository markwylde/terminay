import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createServerCoreComposition, GitCommandStream, WorkspaceStore, createInitialWorkspace } from "../dist/index.js";

const system = { id: "system", name: "System default", target: { kind: "executable", executable: "/bin/sh" }, args: [], startupMode: "default", environment: {}, kind: "system", readOnly: true, source: "system", availability: { available: true } };
const profiles = {
  catalogue: async () => ({ settingsRevision: 1, defaultProfileId: "system", cwdPolicy: "project", entries: [system], projectReferences: {} }),
  resolveProfile: async (_id, catalogue) => ({ profile: system, definition: system, settingsRevision: catalogue.settingsRevision, target: system.target }),
};
const pathAuthority = { canonicalDirectory: async (value) => value, homeDirectory: async () => "/home", isRoot: (value) => value === "/" };

async function fixture({ environment = { PATH: "/bin" }, hostEnvironment } = {}) {
  const exits = [];
  const pty = {
    processes: [],
    spawn(options) {
      const process = { pid: 7100 + this.processes.length, options, write() {}, resize() {}, kill() {}, onData() { return () => {}; }, onExit(listener) { exits.push(listener); return () => {}; } };
      this.processes.push(process);
      return process;
    },
  };
  let token = 0;
  const commands = new GitCommandStream({ socketPath: join(tmpdir(), `tmy-env-${process.pid}-${Math.random().toString(36).slice(2, 8)}.sock`), onWorktreeAdd: () => {}, createToken: () => `tok-${++token}` });
  assert.equal(await commands.listen(), true);
  const workspace = new WorkspaceStore(createInitialWorkspace("server-a"));
  const composition = createServerCoreComposition({
    serverId: "server-a",
    serverVersion: "1.0.0",
    capabilities: [],
    ptyFactory: pty,
    workspace,
    terminalProfiles: profiles,
    terminalLaunchPathAuthority: pathAuthority,
    terminalLaunchEnvironment: environment,
    ...(hostEnvironment === undefined ? {} : { terminalLaunchEnvironmentFor: hostEnvironment }),
    gitCommands: commands,
  });
  composition.workspaceOperations.applyHostCommand("p", { type: "project.create", projectId: "project-a", viewId: workspace.state.viewOrder[0], root: "/project", name: "A" });
  let serial = 0;
  const create = () =>
    composition.operations.commands.get("terminal.create")({
      body: new Uint8Array(),
      context: { authScope: "write", clientId: "client-a", connectionId: "connection-a", signal: new AbortController().signal },
      envelope: { commandId: `create-${++serial}`, operation: "terminal.create", payload: { projectId: "project-a", cols: 80, rows: 24 } },
    });
  return { composition, commands, pty, create, exits };
}

test("a launched terminal carries Git's reporting variables with a token of its own", async () => {
  const { composition, commands, pty, create } = await fixture({ hostEnvironment: () => ({ TERMINAY_CAPABILITY: "host" }) });
  try {
    await create();
    await create();
    const [first, second] = pty.processes.map((process) => process.options.env);
    for (const env of [first, second]) {
      assert.match(env.GIT_TRACE2_EVENT, /^af_unix:stream:/);
      assert.equal(env.GIT_TRACE2_EVENT_BRIEF, "1");
      assert.equal(env.GIT_TRACE2_EVENT_NESTING, "1");
      // The host's own per-session environment is still there.
      assert.equal(env.TERMINAY_CAPABILITY, "host");
    }
    assert.notEqual(first.GIT_TRACE2_PARENT_SID, second.GIT_TRACE2_PARENT_SID);
    assert.equal(commands.sessionCount, 2);
  } finally {
    commands.close();
    await composition.shutdown?.();
  }
});

test("a server whose environment already traces Git leaves its terminals alone", async () => {
  const { composition, commands, pty, create } = await fixture({ environment: { PATH: "/bin", GIT_TRACE2_EVENT: "/var/log/git-trace" } });
  try {
    await create();
    const env = pty.processes[0].options.env;
    assert.equal(env.GIT_TRACE2_EVENT, "/var/log/git-trace");
    assert.equal(env.GIT_TRACE2_PARENT_SID, undefined);
    assert.equal(commands.sessionCount, 0);
  } finally {
    commands.close();
    await composition.shutdown?.();
  }
});

test("a terminal that ends gives up its token", async () => {
  const { composition, commands, create, exits } = await fixture();
  try {
    await create();
    await create();
    assert.equal(commands.sessionCount, 2);
    exits[0]({ exitCode: 0 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(commands.sessionCount, 1);
  } finally {
    commands.close();
    await composition.shutdown?.();
  }
});
