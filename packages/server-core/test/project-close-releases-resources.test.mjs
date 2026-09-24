import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { TerminayClient } from "@terminay/client-core";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import {
  createInitialWorkspace,
  createServerCoreComposition,
  WorkspaceStore,
} from "../dist/index.js";
import {
  GitService,
  NodeGitCommandRunner,
  ServerGitAdapter,
} from "../dist/gitService/index.js";
import {
  createCountingRunner,
  createFakeWatcher,
  createRepository,
  eventually,
  settle,
} from "./fixtures/git-observation.mjs";

const SERVER_ID = "project-close-server";
const TERMINALS = 5;

function createPtyFactory() {
  const processes = [];
  return {
    processes,
    spawn(options) {
      const process = {
        pid: 8100 + processes.length,
        options,
        kills: [],
        write() {},
        resize() {},
        kill(signal) { this.kills.push(signal ?? null); },
        onData() { return () => {}; },
        onExit() { return () => {}; },
      };
      processes.push(process);
      return process;
    },
  };
}

/**
 * A composed server with a real Git repository behind project-a, a counting
 * runner, and a fake watcher, so what closing a project leaves running is an
 * exact count rather than a timing guess.
 */
async function composedServer(t, { released = [] } = {}) {
  const fixture = await createRepository("terminay-project-close-");
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const workspace = new WorkspaceStore(createInitialWorkspace(SERVER_ID));
  const viewId = workspace.state.viewOrder[0];
  assert.equal(workspace.apply({ commandId: "project-a", command: { type: "project.create", projectId: "project-a", viewId, root: fixture.main, name: "A" } }).ok, true);

  const runner = createCountingRunner(NodeGitCommandRunner);
  const watcher = createFakeWatcher();
  const git = new GitService({ runner, watcher, refreshRampMs: [0] });
  // The embedded Electron authority binds every project it opens.
  await git.bindProject("project-a", fixture.main);
  await eventually(() => watcher.isWatching(fixture.gitDir), "Git directory watch was not established");
  const adapter = new ServerGitAdapter({
    serverId: SERVER_ID,
    git,
    resolveProjectRoot: (projectId) => workspace.state.projects[projectId]?.root ?? null,
  });
  const pty = createPtyFactory();
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: SERVER_ID,
    serverVersion: "1.0.0",
    capabilities: ["workspace"],
    ptyFactory: pty,
    workspace,
    git: adapter,
    workspaceOperations: { releaseProject: (projectId) => { released.push(projectId); } },
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
  });
  const pair = createInMemoryTransportPair();
  const serverTask = composition.core.accept(pair.server).start();
  const client = new TerminayClient({ transport: pair.client, clientId: "project-close-client" });
  await pair.open();
  await client.connect();
  t.after(async () => {
    await client.close().catch(() => undefined);
    await serverTask.catch(() => undefined);
    await composition.shutdown();
    git.close();
  });
  return { fixture, workspace, runner, watcher, git, adapter, pty, client };
}

test("closing a project kills its terminals and stops all Git for it", async (t) => {
  const server = await composedServer(t);
  for (let index = 0; index < TERMINALS; index += 1)
    await server.client.command("terminal.create", { projectId: "project-a", cwd: server.fixture.main, cols: 80, rows: 24 });
  assert.equal(server.pty.processes.length, TERMINALS);

  // While open and idle, nothing runs once the first listing is cached.
  await server.git.worktrees({ projectId: "project-a" });
  server.runner.calls.length = 0;
  await settle();
  assert.deepEqual(server.runner.calls, [], "an open idle project runs no Git");

  await server.client.command("workspace.command", {
    command: { type: "project.close", projectId: "project-a" },
  });

  // Every shell is killed, not just its tab removed.
  for (const process of server.pty.processes) assert.deepEqual(process.kills, [null]);
  assert.equal(server.workspace.state.projects["project-a"], undefined);

  assert.equal(server.git.getBinding("project-a"), undefined, "the Git binding is released");
  assert.deepEqual(server.watcher.openPaths(), [], "every watch is closed");
  server.runner.calls.length = 0;
  await settle();
  assert.deepEqual(server.runner.calls, [], "Git kept running for a closed project");
});

test("closing a project with no terminals still releases its resources", async (t) => {
  const released = [];
  const server = await composedServer(t, { released });
  await server.client.command("workspace.command", {
    command: { type: "project.close", projectId: "project-a" },
  });
  assert.deepEqual(released, ["project-a"], "the host releases its per-project state");
  assert.equal(server.git.getBinding("project-a"), undefined);
  assert.deepEqual(server.watcher.openPaths(), []);
});

test("a Git request for a closed project is refused and binds nothing", async (t) => {
  const server = await composedServer(t);
  await server.client.command("workspace.command", {
    command: { type: "project.close", projectId: "project-a" },
  });
  server.runner.calls.length = 0;
  await assert.rejects(
    server.adapter.list({ authorization: { serverId: SERVER_ID, projectId: "project-a", scope: "read" }, projectId: "project-a" }),
    (error) => /invalid-project|not bound/u.test(`${error?.code} ${error?.message}`),
  );
  assert.equal(server.git.getBinding("project-a"), undefined, "the request did not re-bind the project");
  assert.deepEqual(server.watcher.openPaths(), []);
  assert.deepEqual(server.runner.calls, []);
});

test("moving a project to another view releases nothing", async (t) => {
  const released = [];
  const server = await composedServer(t, { released });
  await server.client.command("workspace.command", {
    command: { type: "view.create", viewId: "view-b", name: "B" },
  });
  const watched = server.watcher.openPaths();
  await server.client.command("workspace.command", {
    command: { type: "project.move", projectId: "project-a", targetViewId: "view-b" },
  });
  assert.deepEqual(released, []);
  assert.notEqual(server.git.getBinding("project-a"), undefined);
  assert.deepEqual(server.watcher.openPaths(), watched);
});
