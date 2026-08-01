import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { TerminayClient } from "@terminay/client-core";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import {
  AgentStatusService,
  AGENT_HOOK_SESSION_HEADER,
  AGENT_HOOK_TOKEN_HEADER,
  createServerCoreComposition,
  TERMINAY_AGENT_HOOK_ENDPOINT_ENV,
  TERMINAY_AGENT_HOOK_TOKEN_ENV,
  TERMINAY_SESSION_ID_ENV,
  TerminalActivityService,
  TerminalService,
  ServerSettingsRepository,
  WorkspaceStore,
  createInitialWorkspace,
} from "../dist/index.js";

function createPtyFactory() {
  const processes = [];
  return {
    processes,
    spawn(options) {
      const dataListeners = new Set();
      const exitListeners = new Set();
      const process = {
        pid: 7100 + processes.length,
        options,
        writes: [],
        resizes: [],
        kills: [],
        write(bytes) { this.writes.push(new Uint8Array(bytes)); },
        resize(dimensions) { this.resizes.push({ ...dimensions }); },
        kill(signal) { this.kills.push(signal ?? null); },
        onData(listener) { dataListeners.add(listener); return () => dataListeners.delete(listener); },
        onExit(listener) { exitListeners.add(listener); return () => exitListeners.delete(listener); },
        emitData(value) { for (const listener of dataListeners) listener(value); },
      };
      processes.push(process);
      return process;
    },
  };
}

test("composition owns TerminalService and exposes a complete merged registry", async () => {
  const pty = createPtyFactory();
  const composition = createServerCoreComposition({
    serverId: "embedded-server",
    serverVersion: "1.0.0",
    capabilities: ["workspace"],
    ptyFactory: pty,
    operations: {
      queries: { "workspace.ping": () => ({ ok: true }) },
      policies: { "workspace.ping": { scope: "read" } },
    },
  });

  assert.ok(composition.terminal instanceof TerminalService);
  assert.equal(composition.terminal.serverId, "embedded-server");
  assert.equal(composition.operations.queries.get("terminal.list") !== undefined, true);
  assert.equal(composition.operations.commands.get("terminal.attach") !== undefined, true);
  assert.equal(composition.operations.queries.get("workspace.ping") !== undefined, true);
  assert.deepEqual(composition.coreOptions.capabilities, ["workspace", "terminal"]);
  assert.equal(composition.coreOptions.commands.get("terminal.input") !== undefined, true);

  const identity = {
    serverId: "embedded-server",
    projectId: "project-a",
    sessionId: "session-a",
  };
  const session = await composition.terminal.createSession({
    projectId: identity.projectId,
    sessionId: identity.sessionId,
    cols: 80,
    rows: 24,
  });
  assert.equal(session.sessionId, identity.sessionId);

  await composition.shutdown();
  assert.equal(composition.terminal.getSession(identity).status, "interrupted");
});

test("composition enumerates every server-ready AI, Git, recording, and settings operation", async () => {
  const gitOperations = {
    queries: Object.fromEntries([
      "git.status", "git.branch", "git.diff", "git.worktrees.list",
    ].map((name) => [name, () => null])),
    commands: Object.fromEntries([
      "git.worktree.open-terminal", "git.worktree.switch-project",
      "git.worktree.rename", "git.worktree.reveal", "git.worktree.copy",
      "git.worktree.pull", "git.worktree.remove", "git.quick-push.propose",
      "git.quick-push.approve",
    ].map((name) => [name, () => null])),
  };
  gitOperations.policies = Object.fromEntries([
    ...Object.keys(gitOperations.queries).map((name) => [name, { scope: "read" }]),
    ...Object.keys(gitOperations.commands).map((name) => [name, { scope: "write" }]),
  ]);
  const recordingOperations = {
    queries: {
      "recordings.list": () => null,
      "recordings.replay": () => null,
    },
    commands: Object.fromEntries([
      "recordings.start", "recordings.stop", "recordings.delete", "recordings.reveal",
    ].map((name) => [name, () => null])),
  };
  recordingOperations.policies = Object.fromEntries([
    ...Object.keys(recordingOperations.queries).map((name) => [name, { scope: "read" }]),
    ...Object.keys(recordingOperations.commands).map((name) => [name, { scope: "write" }]),
  ]);
  const composition = createServerCoreComposition({
    serverId: "surface-server",
    serverVersion: "1.0.0",
    capabilities: [],
    ptyFactory: createPtyFactory(),
    ai: {
      listModels: async () => [],
      status: () => undefined,
      generate: async () => null,
      transcribe: async () => null,
      cancel: () => false,
    },
    git: { operations: () => gitOperations },
    recordings: {
      service: {
        appendOutput() {},
        finalize() {},
        shutdown() {},
      },
      operations: () => recordingOperations,
    },
    settings: new ServerSettingsRepository({
      load: async () => undefined,
      commit: async () => undefined,
    }),
  });
  try {
    const expectedQueries = [
      "ai.models.list", "ai.request.status",
      ...Object.keys(gitOperations.queries),
      ...Object.keys(recordingOperations.queries),
      "settings.get",
      "terminal.cwd", "terminal.list", "terminal.wait-inactivity",
    ];
    const expectedCommands = [
      "ai.metadata.generate", "ai.dictation.transcribe", "ai.request.cancel",
      ...Object.keys(gitOperations.commands),
      ...Object.keys(recordingOperations.commands),
      "settings.update", "settings.reset",
      "terminal.create", "terminal.attach", "terminal.resume", "terminal.ack",
      "terminal.input", "terminal.resize", "terminal.kill", "terminal.detach",
    ];
    assert.deepEqual([...composition.operations.queries.keys()].sort(), expectedQueries.sort());
    assert.deepEqual([...composition.operations.commands.keys()].sort(), expectedCommands.sort());
    for (const operation of [...expectedQueries, ...expectedCommands]) {
      assert.equal(composition.coreOptions.policies.get(operation) !== undefined, true, operation);
    }
    assert.deepEqual(
      composition.coreOptions.capabilities,
      ["terminal", "ai", "git", "recordings", "settings"],
    );
  } finally {
    await composition.shutdown();
  }
});

test("composition does not advertise optional authorities that are absent", async () => {
  const composition = createServerCoreComposition({
    serverId: "minimal-surface-server",
    serverVersion: "1.0.0",
    capabilities: [],
    ptyFactory: createPtyFactory(),
  });
  try {
    assert.deepEqual(composition.coreOptions.capabilities, ["terminal"]);
    for (const prefix of ["ai.", "git.", "recordings.", "settings.", "macros."]) {
      assert.equal(
        [...composition.operations.queries.keys(), ...composition.operations.commands.keys()]
          .some((operation) => operation.startsWith(prefix)),
        false,
        prefix,
      );
    }
  } finally {
    await composition.shutdown();
  }
});

test("the composed core serves terminal operations through its transport-neutral accept surface", async () => {
  const pty = createPtyFactory();
  const closedClients = [];
  const composition = createServerCoreComposition({
    serverId: "message-port-server",
    serverVersion: "1.0.0",
    capabilities: ["desktop"],
    ptyFactory: pty,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
    onConnectionClosed: (clientId) => closedClients.push(clientId),
  });
  const identity = {
    serverId: "message-port-server",
    projectId: "project-a",
    sessionId: "session-a",
  };
  await composition.terminal.createSession({
    projectId: identity.projectId,
    sessionId: identity.sessionId,
    cols: 80,
    rows: 24,
  });

  // This is the exact structural surface an Electron MessagePort adapter will
  // implement: a framed ByteTransport passed to ServerCore.accept().
  const pair = createInMemoryTransportPair();
  const connection = composition.core.accept(pair.server);
  const serverTask = connection.start();
  const client = new TerminayClient({
    transport: pair.client,
    clientId: "desktop-client",
    capabilities: ["desktop"],
  });

  try {
    await pair.open();
    const hello = await client.connect();
    assert.equal(hello.serverId, identity.serverId);
    assert.deepEqual(hello.capabilities, ["desktop", "terminal"]);

    const listed = await client.query("terminal.list", { projectId: identity.projectId });
    assert.equal(listed.result.sessions[0].sessionId, identity.sessionId);
    const attached = await client.command("terminal.attach", {
      clientId: "desktop-client",
      identity,
      fromPosition: 0,
    });
    assert.equal(typeof attached.result.attachmentId, "string");
    await client.command("terminal.detach", {
      clientId: "desktop-client",
      identity,
      attachmentId: attached.result.attachmentId,
    });
    assert.equal(composition.terminal.getSession(identity).status, "running");
  } finally {
    await client.close().catch(() => undefined);
    await serverTask.catch(() => undefined);
    await composition.shutdown();
  }

  assert.deepEqual(closedClients, ["desktop-client"]);
  assert.equal(composition.terminal.getSession(identity).status, "interrupted");
});

test("terminal.create commits a server-owned terminal panel before publishing workspace state", async () => {
  const workspace = new WorkspaceStore(createInitialWorkspace("workspace-terminal-server"));
  const viewId = workspace.state.viewOrder[0];
  assert.equal(
    workspace.apply({
      commandId: "project-a",
      command: {
        type: "project.create",
        projectId: "project-a",
        viewId,
        root: "/repo/a",
        name: "Project A",
      },
    }).ok,
    true,
  );
  const composition = createServerCoreComposition({
    serverId: "workspace-terminal-server",
    serverVersion: "1.0.0",
    capabilities: ["workspace"],
    ptyFactory: createPtyFactory(),
    workspace,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
  });
  const pair = createInMemoryTransportPair();
  const connection = composition.core.accept(pair.server);
  const serverTask = connection.start();
  const client = new TerminayClient({
    transport: pair.client,
    clientId: "workspace-terminal-client",
  });

  try {
    await pair.open();
    await client.connect();
    const created = await client.command("terminal.create", {
      projectId: "project-a",
      cwd: "/repo/a",
      cols: 80,
      rows: 24,
    });
    const sessionId = created.result.sessionId;
    const state = workspace.state;
    const panel = Object.values(state.panels).find((candidate) => candidate.sessionId === sessionId);
    assert.ok(panel);
    assert.equal(state.terminalSessions[sessionId].projectId, "project-a");
    assert.equal(panel.projectId, "project-a");
    assert.equal(panel.type, "terminal");
    assert.equal(panel.cwd, "/repo/a");
    assert.deepEqual(state.projects["project-a"].panelIds, [panel.id]);
    assert.equal(state.projects["project-a"].activePanelId, panel.id);
  } finally {
    await client.close().catch(() => undefined);
    await serverTask.catch(() => undefined);
    await composition.shutdown();
  }
});

test("project.close terminates project terminal sessions and removes their workspace records", async () => {
  const workspace = new WorkspaceStore(createInitialWorkspace("workspace-close-server"));
  const viewId = workspace.state.viewOrder[0];
  assert.equal(workspace.apply({ commandId: "project-a", command: { type: "project.create", projectId: "project-a", viewId, root: "/repo/a", name: "Project A" } }).ok, true);
  const pty = createPtyFactory();
  const composition = createServerCoreComposition({
    serverId: "workspace-close-server",
    serverVersion: "1.0.0",
    capabilities: ["workspace"],
    ptyFactory: pty,
    workspace,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
  });
  const pair = createInMemoryTransportPair();
  const connection = composition.core.accept(pair.server);
  const serverTask = connection.start();
  const client = new TerminayClient({
    transport: pair.client,
    clientId: "workspace-close-client",
  });

  try {
    await pair.open();
    await client.connect();
    const created = await client.command("terminal.create", {
      projectId: "project-a",
      cwd: "/repo/a",
      cols: 80,
      rows: 24,
    });
    const sessionId = created.result.sessionId;
    assert.equal(workspace.state.terminalSessions[sessionId].projectId, "project-a");

    await client.command("workspace.command", {
      command: { type: "project.close", projectId: "project-a" },
    });

    assert.deepEqual(pty.processes[0].kills, [null]);
    assert.equal(workspace.state.projects["project-a"], undefined);
    assert.equal(workspace.state.terminalSessions[sessionId], undefined);
    assert.deepEqual(Object.values(workspace.state.panels), []);
  } finally {
    await client.close().catch(() => undefined);
    await serverTask.catch(() => undefined);
    await composition.shutdown();
  }
});

test("panel.close terminates a terminal session and removes it from the workspace snapshot", async () => {
  const pty = createPtyFactory();
  const workspace = new WorkspaceStore(createInitialWorkspace("workspace-panel-close-server"));
  const viewId = workspace.state.viewOrder[0];
  assert.equal(workspace.apply({ commandId: "project-a", command: { type: "project.create", projectId: "project-a", viewId, root: "/repo/a", name: "A" } }).ok, true);
  const composition = createServerCoreComposition({
    serverId: "workspace-panel-close-server",
    serverVersion: "1.0.0",
    capabilities: ["workspace"],
    ptyFactory: pty,
    workspace,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
  });
  const pair = createInMemoryTransportPair();
  const connection = composition.core.accept(pair.server);
  const serverTask = connection.start();
  const client = new TerminayClient({
    transport: pair.client,
    clientId: "workspace-panel-close-client",
  });

  try {
    await pair.open();
    await client.connect();
    const created = await client.command("terminal.create", {
      projectId: "project-a",
      cwd: "/repo/a",
      cols: 80,
      rows: 24,
    });
    const { sessionId } = created.result;
    const panelId = Object.values(workspace.state.panels).find((panel) => panel.sessionId === sessionId)?.id;
    assert.equal(typeof panelId, "string");
    assert.equal(workspace.state.terminalSessions[sessionId].projectId, "project-a");
    assert.equal(workspace.state.panels[panelId].sessionId, sessionId);

    await client.command("workspace.command", {
      command: { type: "panel.close", panelId },
    });

    assert.deepEqual(pty.processes[0].kills, [null]);
    assert.equal(workspace.state.panels[panelId], undefined);
    assert.equal(workspace.state.terminalSessions[sessionId], undefined);
  } finally {
    await client.close().catch(() => undefined);
    await serverTask.catch(() => undefined);
    await composition.shutdown();
  }
});

test("composition feeds PTY bytes into the activity service and serves its snapshot through the same protocol", async () => {
  const pty = createPtyFactory();
  const activity = new TerminalActivityService({ serverId: "activity-server" });
  const composition = createServerCoreComposition({
    serverId: "activity-server",
    serverVersion: "1.0.0",
    capabilities: ["desktop"],
    ptyFactory: pty,
    activity,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
  });
  const identity = { serverId: "activity-server", projectId: "project-a", sessionId: "session-a" };
  await composition.terminal.createSession({ projectId: identity.projectId, sessionId: identity.sessionId, cols: 80, rows: 24 });
  await composition.terminal.input(identity, "\u001b[I");
  assert.equal(activity.get(identity).source, "init");
  await composition.terminal.input(identity, "echo activity\r");
  assert.equal(activity.get(identity).source, "structured:user-input");
  pty.processes[0].emitData("\u0007");
  assert.equal(activity.get(identity).attention, true);

  const pair = createInMemoryTransportPair();
  const connection = composition.core.accept(pair.server);
  const serverTask = connection.start();
  const client = new TerminayClient({ transport: pair.client, clientId: "desktop-client" });
  try {
    await pair.open();
    await client.connect();
    const snapshot = await client.query("activity.snapshot");
    assert.equal(snapshot.result.sessions[identity.sessionId].attention, true);
    await client.command("activity.acknowledge", { projectId: identity.projectId, sessionId: identity.sessionId });
    assert.equal(activity.get(identity).acknowledged, true);
  } finally {
    await client.close().catch(() => undefined);
    await serverTask.catch(() => undefined);
    await composition.shutdown();
  }
});

test("framed activity snapshots preserve OSC progress and command completion for the exact session", async () => {
  const pty = createPtyFactory();
  const activity = new TerminalActivityService({ serverId: "activity-completion-server" });
  const composition = createServerCoreComposition({
    serverId: "activity-completion-server",
    serverVersion: "1.0.0",
    capabilities: ["desktop"],
    ptyFactory: pty,
    activity,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
  });
  const identity = { serverId: "activity-completion-server", projectId: "project-a", sessionId: "session-a" };
  await composition.terminal.createSession({ projectId: identity.projectId, sessionId: identity.sessionId, cols: 80, rows: 24 });
  const pair = createInMemoryTransportPair();
  const serverTask = composition.core.accept(pair.server).start();
  const client = new TerminayClient({ transport: pair.client, clientId: "completion-client" });
  try {
    await pair.open();
    await client.connect();
    pty.processes[0].emitData("\u001b]9;4;0\u0007");
    let snapshot = await client.query("activity.snapshot");
    assert.equal(snapshot.result.sessions["session-a"].status, "idle");
    assert.equal(snapshot.result.sessions["session-a"].claimed, true);
    assert.equal(snapshot.result.sessions["session-a"].source, "structured:progress");

    pty.processes[0].emitData("\u001b]133;C\u0007");
    pty.processes[0].emitData("\u001b]133;D;0\u0007");
    snapshot = await client.query("activity.snapshot");
    assert.equal(snapshot.result.sessions["session-a"].status, "idle");
    assert.equal(snapshot.result.sessions["session-a"].exitCode, 0);
    assert.equal(snapshot.result.sessions["session-a"].source, "structured:command");
  } finally {
    await client.close().catch(() => undefined);
    await serverTask.catch(() => undefined);
    await composition.shutdown();
  }
});

test("composition is the single owner of agent and PTY lifecycle", async () => {
  const pty = createPtyFactory();
  const activity = new TerminalActivityService({ serverId: "agent-lifecycle-server" });
  const agents = new AgentStatusService({
    activity,
    receiver: { tokenFactory: () => "composition-agent-token" },
  });
  let stopCalls = 0;
  const stop = agents.stop.bind(agents);
  agents.stop = async () => {
    stopCalls += 1;
    await stop();
  };
  const composition = createServerCoreComposition({
    serverId: "agent-lifecycle-server",
    serverVersion: "1.0.0",
    capabilities: ["agents"],
    ptyFactory: pty,
    activity,
    agents,
  });

  await composition.start();
  const identity = { serverId: "agent-lifecycle-server", projectId: "project-a", sessionId: "session-a" };
  await composition.terminal.createSession({ projectId: identity.projectId, sessionId: identity.sessionId, cols: 80, rows: 24 });
  assert.equal(agents.listening, true);
  assert.equal(pty.processes[0].options.env.TERMINAY_AGENT_HOOK_TOKEN, "composition-agent-token");

  await composition.shutdown();
  assert.equal(composition.terminal.getSession(identity).status, "interrupted");
  assert.equal(agents.listening, false);
  assert.equal(stopCalls, 1);
});

test("composition coalesces concurrent lifecycle calls and cannot restart after shutdown", async () => {
  const activity = new TerminalActivityService({ serverId: "composition-lifecycle-server" });
  const agents = new AgentStatusService({ activity, receiver: { tokenFactory: () => "lifecycle-token" } });
  let starts = 0;
  let stops = 0;
  const start = agents.start.bind(agents);
  const stop = agents.stop.bind(agents);
  agents.start = async () => { starts += 1; await start(); };
  agents.stop = async () => { stops += 1; await stop(); };
  const composition = createServerCoreComposition({
    serverId: "composition-lifecycle-server", serverVersion: "1.0.0", capabilities: ["agents"],
    ptyFactory: createPtyFactory(), activity, agents,
  });
  await Promise.all([composition.start(), composition.start()]);
  assert.equal(starts, 1);
  await Promise.all([composition.shutdown(), composition.shutdown()]);
  assert.equal(stops, 1);
  await assert.rejects(() => composition.start(), /stopped/u);
});

test("activity acknowledgement survives a real client reconnect and remains project/session-bound", async () => {
  const pty = createPtyFactory();
  const activity = new TerminalActivityService({ serverId: "activity-reconnect-server" });
  const composition = createServerCoreComposition({
    serverId: "activity-reconnect-server",
    serverVersion: "1.0.0",
    capabilities: ["desktop"],
    ptyFactory: pty,
    activity,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
  });
  const projectA = { serverId: "activity-reconnect-server", projectId: "project-a", sessionId: "session-a" };
  const projectB = { serverId: "activity-reconnect-server", projectId: "project-b", sessionId: "session-b" };
  await composition.terminal.createSession({ projectId: projectA.projectId, sessionId: projectA.sessionId, cols: 80, rows: 24 });
  await composition.terminal.createSession({ projectId: projectB.projectId, sessionId: projectB.sessionId, cols: 80, rows: 24 });
  pty.processes[0].emitData("\u0007");

  const connect = async (clientId) => {
    const pair = createInMemoryTransportPair();
    const serverTask = composition.core.accept(pair.server).start();
    const client = new TerminayClient({ transport: pair.client, clientId });
    await pair.open();
    await client.connect();
    return { client, serverTask };
  };

  const first = await connect("activity-client-one");
  try {
    const beforeDisconnect = await first.client.query("activity.snapshot");
    assert.equal(beforeDisconnect.result.sessions[projectA.sessionId].attention, true);
    assert.equal(beforeDisconnect.result.sessions[projectA.sessionId].acknowledged, false);
  } finally {
    await first.client.close();
    await first.serverTask.catch(() => undefined);
  }

  const reconnected = await connect("activity-client-two");
  try {
    const afterReconnect = await reconnected.client.query("activity.snapshot");
    assert.equal(afterReconnect.result.sessions[projectA.sessionId].attention, true);
    assert.equal(afterReconnect.result.sessions[projectA.sessionId].acknowledged, false);

    await assert.rejects(
      () => reconnected.client.command("activity.acknowledge", { projectId: projectA.projectId, sessionId: projectB.sessionId }),
      (error) => error?.code === "internal",
    );
    const afterRejectedAcknowledgement = await reconnected.client.query("activity.snapshot");
    assert.equal(afterRejectedAcknowledgement.result.sessions[projectA.sessionId].acknowledged, false);
    await reconnected.client.command("activity.acknowledge", {
      projectId: projectA.projectId,
      sessionId: projectA.sessionId,
    });
    const afterAcknowledgement = await reconnected.client.query("activity.snapshot");
    assert.equal(afterAcknowledgement.result.sessions[projectA.sessionId].acknowledged, true);
  } finally {
    await reconnected.client.close();
    await reconnected.serverTask.catch(() => undefined);
    await composition.shutdown();
  }
});

test("two clients receive one canonical reduced agent sequence and reconnect to the live snapshot", async () => {
  const pty = createPtyFactory();
  const activity = new TerminalActivityService({ serverId: "agent-sequence-server", now: () => 100 });
  const agents = new AgentStatusService({ activity, now: () => 100, receiver: { tokenFactory: () => "agent-sequence-token" } });
  await agents.start();
  const composition = createServerCoreComposition({
    serverId: "agent-sequence-server",
    serverVersion: "1.0.0",
    capabilities: ["agents"],
    ptyFactory: pty,
    activity,
    agents,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
  });
  const identity = { serverId: "agent-sequence-server", projectId: "project-a", sessionId: "session-a" };
  await composition.terminal.createSession({ projectId: identity.projectId, sessionId: identity.sessionId, cols: 80, rows: 24 });

  const connect = async (clientId) => {
    const pair = createInMemoryTransportPair();
    const serverTask = composition.core.accept(pair.server).start();
    const client = new TerminayClient({ transport: pair.client, clientId });
    await pair.open();
    await client.connect();
    return { client, serverTask };
  };
  const first = await connect("agent-client-one");
  const second = await connect("agent-client-two");
  const firstEvents = [];
  const secondEvents = [];
  const firstSubscription = await first.client.subscribe("agent");
  const secondSubscription = await second.client.subscribe("agent");
  const removeFirst = firstSubscription.onEvent((event) => firstEvents.push(event.payload));
  const removeSecond = secondSubscription.onEvent((event) => secondEvents.push(event.payload));
  try {
    await agents.ingestHookPayload(identity, "codex", { hook_event_name: "SessionStart", session_id: "codex-session", private: "never-export" });
    await agents.ingestHookPayload(identity, "codex", { hook_event_name: "PermissionRequest", session_id: "codex-session", reason: "allow command" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(firstEvents.length, 2);
    assert.deepEqual(firstEvents, secondEvents);
    assert.doesNotMatch(JSON.stringify(firstEvents), /agent-sequence-token|never-export/);
    const firstSnapshot = await first.client.query("agent.snapshot");
    const secondSnapshot = await second.client.query("agent.snapshot");
    assert.deepEqual(firstSnapshot.result, secondSnapshot.result);

    await first.client.close();
    await first.serverTask.catch(() => undefined);
    const reconnected = await connect("agent-client-one-reconnected");
    try {
      const reconnectedSnapshot = await reconnected.client.query("agent.snapshot");
      assert.deepEqual(reconnectedSnapshot.result, secondSnapshot.result);
    } finally {
      await reconnected.client.close();
      await reconnected.serverTask.catch(() => undefined);
    }
  } finally {
    removeFirst();
    removeSecond();
    await firstSubscription.unsubscribe().catch(() => undefined);
    await secondSubscription.unsubscribe().catch(() => undefined);
    await second.client.close().catch(() => undefined);
    await second.serverTask.catch(() => undefined);
    await composition.shutdown();
  }
});

test("composed missing provider hooks leave agent state empty while terminal fallback activity remains available", async () => {
  const pty = createPtyFactory();
  const activity = new TerminalActivityService({ serverId: "agent-missing-hook-server", now: () => 100 });
  const agents = new AgentStatusService({ activity, now: () => 100, receiver: { tokenFactory: () => "missing-hook-token" } });
  const composition = createServerCoreComposition({
    serverId: "agent-missing-hook-server",
    serverVersion: "1.0.0",
    capabilities: ["agents"],
    ptyFactory: pty,
    activity,
    agents,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
  });
  const identity = { serverId: "agent-missing-hook-server", projectId: "project-a", sessionId: "session-a" };
  const pair = createInMemoryTransportPair();
  const serverTask = composition.core.accept(pair.server).start();
  const client = new TerminayClient({ transport: pair.client, clientId: "missing-hook-client" });
  try {
    await composition.start();
    await composition.terminal.createSession({ projectId: identity.projectId, sessionId: identity.sessionId, cols: 80, rows: 24 });
    pty.processes[0].emitData(new TextEncoder().encode("ordinary unmanaged output"));

    await pair.open();
    await client.connect();
    const agentSnapshot = await client.query("agent.snapshot");
    const activitySnapshot = await client.query("activity.snapshot");
    assert.deepEqual(agentSnapshot.result.entries, {});
    assert.equal(activitySnapshot.result.sessions[identity.sessionId].source, "raw:output");
    assert.equal(activitySnapshot.result.sessions[identity.sessionId].provider, undefined);

    const env = pty.processes[0].options.env;
    const response = await fetch(env[TERMINAY_AGENT_HOOK_ENDPOINT_ENV], {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [AGENT_HOOK_TOKEN_HEADER]: env[TERMINAY_AGENT_HOOK_TOKEN_ENV],
        [AGENT_HOOK_SESSION_HEADER]: env[TERMINAY_SESSION_ID_ENV],
        "x-terminay-agent-provider": "codex",
      },
      body: JSON.stringify({ hook_event_name: "SessionStart", session_id: "recovered-codex-session", private: "must-not-cross-transport" }),
    });
    assert.equal(response.status, 202);
    const recovered = await client.query("agent.snapshot");
    const entries = Object.values(recovered.result.entries);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].activationTerminalSessionId, identity.sessionId);
    assert.doesNotMatch(JSON.stringify(recovered.result), /missing-hook-token|must-not-cross-transport/);
  } finally {
    await client.close().catch(() => undefined);
    await serverTask.catch(() => undefined);
    await composition.shutdown();
  }
});

test("project-scoped clients receive only their own agent snapshots and live events", async () => {
  const pty = createPtyFactory();
  const activity = new TerminalActivityService({ serverId: "agent-scope-server", now: () => 100 });
  let token = 0;
  const agents = new AgentStatusService({ activity, now: () => 100, receiver: { tokenFactory: () => `scope-${++token}` } });
  await agents.start();
  const composition = createServerCoreComposition({
    serverId: "agent-scope-server",
    serverVersion: "1.0.0",
    capabilities: ["agents"],
    ptyFactory: pty,
    activity,
    agents,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "read", claims: { projectId: hello.clientId === "project-a-client" ? "project-a" : "project-b" } }),
  });
  const projectA = { serverId: "agent-scope-server", projectId: "project-a", sessionId: "session-a" };
  const projectB = { serverId: "agent-scope-server", projectId: "project-b", sessionId: "session-b" };
  await composition.terminal.createSession({ projectId: projectA.projectId, sessionId: projectA.sessionId, cols: 80, rows: 24 });
  await composition.terminal.createSession({ projectId: projectB.projectId, sessionId: projectB.sessionId, cols: 80, rows: 24 });
  const connect = async (clientId) => {
    const pair = createInMemoryTransportPair();
    const serverTask = composition.core.accept(pair.server).start();
    const client = new TerminayClient({ transport: pair.client, clientId });
    await pair.open();
    await client.connect();
    return { client, serverTask };
  };
  const a = await connect("project-a-client");
  const b = await connect("project-b-client");
  const aEvents = [];
  const bEvents = [];
  const aSubscription = await a.client.subscribe("agent");
  const bSubscription = await b.client.subscribe("agent");
  const removeA = aSubscription.onEvent((event) => aEvents.push(event.payload));
  const removeB = bSubscription.onEvent((event) => bEvents.push(event.payload));
  try {
    await agents.ingestHookPayload(projectA, "codex", { hook_event_name: "SessionStart", session_id: "agent-a" });
    await agents.ingestHookPayload(projectB, "codex", { hook_event_name: "SessionStart", session_id: "agent-b" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const snapshotA = await a.client.query("agent.snapshot");
    const snapshotB = await b.client.query("agent.snapshot");
    assert.deepEqual(Object.values(snapshotA.result.entries).map((entry) => entry.activationTerminalSessionId), ["session-a"]);
    assert.deepEqual(Object.values(snapshotB.result.entries).map((entry) => entry.activationTerminalSessionId), ["session-b"]);
    assert.ok(aEvents.length > 0);
    assert.ok(bEvents.length > 0);
    for (const payload of aEvents) assert.equal(Object.values(payload.entries).every((entry) => entry.activationTerminalSessionId === "session-a"), true);
    for (const payload of bEvents) assert.equal(Object.values(payload.entries).every((entry) => entry.activationTerminalSessionId === "session-b"), true);
    assert.equal(aEvents.some((payload) => Object.values(payload.entries).some((entry) => entry.activationTerminalSessionId === "session-a")), true);
    assert.equal(bEvents.some((payload) => Object.values(payload.entries).some((entry) => entry.activationTerminalSessionId === "session-b")), true);
  } finally {
    removeA(); removeB();
    await aSubscription.unsubscribe().catch(() => undefined);
    await bSubscription.unsubscribe().catch(() => undefined);
    await a.client.close().catch(() => undefined);
    await b.client.close().catch(() => undefined);
    await a.serverTask.catch(() => undefined);
    await b.serverTask.catch(() => undefined);
    await composition.shutdown();
  }
});

test("the composition modules have no Electron dependency", async () => {
  const coreSource = await readFile(new URL("../src/composition.ts", import.meta.url), "utf8");
  assert.doesNotMatch(coreSource, /(?:from|import\()\s*["']electron(?:["']|\/)/u);
});

test("duplicate operation names are rejected during composition", () => {
  assert.throws(
    () => createServerCoreComposition({
      serverId: "collision-server",
      serverVersion: "1.0.0",
      capabilities: [],
      ptyFactory: createPtyFactory(),
      operations: { queries: { "terminal.list": () => null } },
    }),
    /query operation is registered more than once: terminal\.list/u,
  );
});
