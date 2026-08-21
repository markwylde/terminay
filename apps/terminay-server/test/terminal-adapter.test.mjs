import assert from "node:assert/strict";
import test from "node:test";
import {
  TerminalActivityService,
  TerminalPresentationCheckpointAuthority,
  TerminalService,
  WorkspaceRepository,
} from "@terminay/server-core";
import { createServerTerminalControlAdapter, createTerminalControlAdapter } from "../dist/index.js";

function createPtyFactory() {
  const processes = [];
  return {
    processes,
    spawn(options) {
      const dataListeners = new Set();
      const exitListeners = new Set();
      const process = {
        pid: 9000 + processes.length,
        options,
        writes: [],
        kills: [],
        write(bytes) {
          this.writes.push(new Uint8Array(bytes));
        },
        resize() {},
        kill(signal) {
          this.kills.push(signal);
        },
        onData(listener) {
          dataListeners.add(listener);
          return () => dataListeners.delete(listener);
        },
        onExit(listener) {
          exitListeners.add(listener);
          return () => exitListeners.delete(listener);
        },
        emitData(value) {
          const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
          for (const listener of dataListeners) listener(bytes);
        },
        emitExit(exit = {}) {
          for (const listener of exitListeners) listener(exit);
        },
      };
      processes.push(process);
      return process;
    },
  };
}

function context() {
  return {
    terminalSessionId: "caller",
    projectId: "project-a",
    scope: "write",
    connectionId: "local",
    requestId: "request",
    signal: new AbortController().signal,
  };
}

function createLaunchResolver(options = {}) {
  const intents = [];
  return {
    intents,
    async resolve(intent) {
      intents.push(intent);
      return {
        identity: intent.identity,
        workspaceRevision: 1,
        settingsRevision: 1,
        profile: {
          id: "system",
          revision: 1,
          name: "System default",
          targetSummary: "/bin/test-shell",
        },
        shellPath: "/bin/test-shell",
        args: ["--login"],
        cwd: options.cwd ?? intent.explicitCwd ?? "/resolved/project",
        env: { TERM: "xterm-256color" },
        cols: intent.cols,
        rows: intent.rows,
        createdAt: 123,
      };
    },
  };
}

test("server terminal adapter wires bounded PTY operations to implicit project scope", async () => {
  const pty = createPtyFactory();
  const ids = ["caller", "sibling", "opened"];
  const terminal = new TerminalService({
    serverId: "server-a",
    ptyFactory: pty,
    generateSessionId: () => ids.shift(),
  });
  const activity = new TerminalActivityService({ serverId: "server-a" });
  const caller = await terminal.createSession({
    projectId: "project-a",
    cols: 80,
    rows: 24,
  });
  const sibling = await terminal.createSession({
    projectId: "project-a",
    cols: 80,
    rows: 24,
  });
  activity.register({
    serverId: "server-a",
    projectId: "project-a",
    sessionId: caller.sessionId,
  });
  activity.register({
    serverId: "server-a",
    projectId: "project-a",
    sessionId: sibling.sessionId,
  });
  const layoutCalls = [];
  const adapter = createServerTerminalControlAdapter({
    terminal,
    launchResolver: createLaunchResolver(),
    activity,
    focusTerminal: (params) => {
      layoutCalls.push(["focus", params]);
      return { focused: params.terminal };
    },
    renameTerminal: (params) => {
      layoutCalls.push(["rename", params]);
      return { renamed: params.name };
    },
    splitTerminal: (params) => {
      layoutCalls.push(["split", params]);
      return { split: params.direction };
    },
  });
  const dispatch = createTerminalControlAdapter({ adapter });
  const request = (id, op, params) => dispatch({ id, version: 1, op, params }, { ...context(), requestId: id });

  const listed = await request("list", "list_terminals", {});
  assert.equal(listed.terminals.length, 2);
  assert.deepEqual(Object.keys(listed.terminals[0]).filter((key) => ["terminal", "status", "output_position", "replay_from"].includes(key)).sort(), ["output_position", "replay_from", "status", "terminal"]);
  pty.processes[1].emitData("line one\nline two\n");
  assert.deepEqual(await request("read", "read_terminal", { terminal: "sibling", format: "raw", max_bytes: 64 }), {
    terminal: "sibling",
    format: "raw",
    encoding: "base64",
    output: Buffer.from("line one\nline two\n").toString("base64"),
    from: 0,
    next: 18,
    replay_from: 0,
    output_position: 18,
    history_lost: false,
    truncated_tail: false,
  });

  const written = await request("write", "write_terminal", {
    terminal: "sibling",
    text: "echo ok",
    submit: true,
  });
  assert.equal(written.submitted, true);
  assert.equal(new TextDecoder().decode(pty.processes[1].writes[0]), "echo ok\r");
  assert.deepEqual(await request("run", "run_command", {
    terminal: "sibling",
    command: "printf ok",
  }), {
    terminal: "sibling",
    command_id: "run",
    from: 18,
    submitted_bytes: Buffer.byteLength("\u001b[200~printf ok\u001b[201~\r", "utf8"),
    submitted: true,
  });
  assert.match(new TextDecoder().decode(pty.processes[1].writes[1]), /printf ok/);
  const status = await request("status", "get_terminal_status", { terminal: "sibling" });
  assert.equal(status.status, "running");
  assert.equal(status.output_position, 18);
  assert.equal(status.replay_from, 0);
  assert.deepEqual(await request("focus", "focus_terminal", { terminal: "sibling" }), { focused: "sibling" });
  assert.deepEqual(
    await request("rename", "rename_terminal", {
      terminal: "sibling",
      name: "Worker",
    }),
    { renamed: "Worker" },
  );
  assert.deepEqual(
    await request("split", "split_terminal", {
      terminal: "sibling",
      direction: "below",
    }),
    { split: "below" },
  );
  assert.equal(layoutCalls.length, 3);
  assert.deepEqual(await request("open", "open_terminal", { name: "New" }), {
    terminal: "opened",
    projectId: "project-a",
    status: "running",
  });
  assert.deepEqual(await request("close", "close_terminal", { terminal: "sibling" }), { terminal: "sibling", closed: true });
  assert.deepEqual(pty.processes[1].kills, [undefined]);

  const otherProject = await terminal.createSession({
    projectId: "project-b",
    cols: 80,
    rows: 24,
    sessionId: "other",
  });
  assert.equal(otherProject.projectId, "project-b");
  const denied = await request("cross", "read_terminal", { terminal: "other" });
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, "terminal_not_found");
});

test("server terminal adapter returns lossless Base64 raw pages and truthful retention metadata", async () => {
  const pty = createPtyFactory();
  const terminal = new TerminalService({
    serverId: "server-a",
    ptyFactory: pty,
    maxReplayBytes: 64,
    generateSessionId: (() => {
      const ids = ["caller", "sibling"];
      return () => ids.shift();
    })(),
  });
  await terminal.createSession({ projectId: "project-a", cols: 8, rows: 3 });
  await terminal.createSession({ projectId: "project-a", cols: 8, rows: 3 });
  const dispatch = createTerminalControlAdapter({
    adapter: createServerTerminalControlAdapter({ terminal, launchResolver: createLaunchResolver(), maxReadBytes: 8 }),
  });
  const request = (id, params) => dispatch(
    { id, version: 1, op: "read_terminal", params },
    { ...context(), requestId: id },
  );
  const bytes = new Uint8Array([0, 255, 0x1b, 0x5b, 0x33, 0x31, 0x6d, 0xce, 0xb1]);
  pty.processes[1].emitData(bytes);

  const first = await request("raw-one", { terminal: "sibling", format: "raw", max_bytes: 8 });
  assert.equal(first.encoding, "base64");
  assert.deepEqual([...Buffer.from(first.output, "base64")], [...bytes.slice(0, 6)]);
  assert.deepEqual(
    { from: first.from, next: first.next, truncated: first.truncated_tail, lost: first.history_lost },
    { from: 0, next: 6, truncated: true, lost: false },
  );
  const second = await request("raw-two", { terminal: "sibling", format: "raw", max_bytes: 8, after: first.next });
  assert.deepEqual([...Buffer.from(second.output, "base64")], [...bytes.slice(6)]);
  assert.deepEqual(
    { from: second.from, next: second.next, truncated: second.truncated_tail },
    { from: 6, next: bytes.byteLength, truncated: false },
  );

  // A one-byte representation budget cannot contain a complete Base64
  // quantum. It remains a valid, empty, forward-pageable response.
  const tooSmall = await request("raw-small", { terminal: "sibling", format: "raw", max_bytes: 1, after: 0 });
  assert.deepEqual(
    { output: tooSmall.output, from: tooSmall.from, next: tooSmall.next, truncated: tooSmall.truncated_tail },
    { output: "", from: 0, next: 0, truncated: true },
  );
});

test("server terminal adapter distinguishes raw history loss from tail pagination", async () => {
  const pty = createPtyFactory();
  const terminal = new TerminalService({
    serverId: "server-a",
    ptyFactory: pty,
    maxReplayBytes: 6,
    generateSessionId: () => "caller",
  });
  await terminal.createSession({ projectId: "project-a", sessionId: "caller", cols: 8, rows: 3 });
  pty.processes[0].emitData("first");
  pty.processes[0].emitData("second");
  const dispatch = createTerminalControlAdapter({
    adapter: createServerTerminalControlAdapter({ terminal, launchResolver: createLaunchResolver(), maxReadBytes: 8 }),
  });
  const result = await dispatch(
    { id: "stale", version: 1, op: "read_terminal", params: { terminal: "caller", format: "raw", max_bytes: 64, after: 0 } },
    context(),
  );
  assert.deepEqual(
    {
      output: Buffer.from(result.output, "base64").toString("utf8"),
      from: result.from,
      next: result.next,
      replayFrom: result.replay_from,
      lost: result.history_lost,
      truncated: result.truncated_tail,
    },
    { output: "second", from: 5, next: 11, replayFrom: 5, lost: true, truncated: false },
  );
});

test("server terminal adapter serves current emulated text and ANSI snapshots", async () => {
  const pty = createPtyFactory();
  const terminal = new TerminalService({
    serverId: "server-a",
    ptyFactory: pty,
    presentationCheckpoints: new TerminalPresentationCheckpointAuthority({
      maxScrollback: 32,
      checkpointIntervalBytes: 1_000_000,
      checkpointIntervalMs: 1_000_000,
    }),
    generateSessionId: () => "caller",
  });
  await terminal.createSession({ projectId: "project-a", sessionId: "caller", cols: 5, rows: 3 });
  pty.processes[0].emitData("\x1b[31mabcde\x1b[0mfghij\rX  ");
  const dispatch = createTerminalControlAdapter({
    adapter: createServerTerminalControlAdapter({ terminal, launchResolver: createLaunchResolver() }),
  });
  const request = (id, params) => dispatch(
    { id, version: 1, op: "read_terminal", params },
    { ...context(), requestId: id },
  );
  const text = await request("text", { terminal: "caller", format: "text", lines: 2, max_bytes: 128 });
  assert.equal(text.output, "abcde\nX  ij");
  assert.equal(text.output.includes("\x1b"), false);
  assert.deepEqual(text.dimensions, { cols: 5, rows: 3 });
  assert.equal(text.presentation_truncated, false);

  const ansi = await request("ansi", { terminal: "caller", format: "ansi", max_bytes: 128 });
  assert.match(ansi.output, /abcde/u);
  assert.ok(ansi.output.includes(`${String.fromCharCode(27)}[31m`));
  assert.equal(ansi.format, "ansi");
  assert.equal(ansi.output_position, text.output_position);
});

test("server terminal adapter reports adapter-global availability before optional waits", async () => {
  const pty = createPtyFactory();
  const terminal = new TerminalService({
    serverId: "server-a",
    ptyFactory: pty,
    generateSessionId: () => "caller",
  });
  await terminal.createSession({ projectId: "project-a", sessionId: "caller", cols: 8, rows: 3 });
  const dispatch = createTerminalControlAdapter({
    adapter: createServerTerminalControlAdapter({ terminal, launchResolver: createLaunchResolver() }),
  });
  const capabilities = await dispatch(
    { id: "capabilities", version: 1, op: "get_mcp_capabilities", params: {} },
    context(),
  );
  const available = Object.fromEntries(capabilities.tools.map((entry) => [entry.tool, entry.available]));
  assert.equal(available.read_terminal, true);
  assert.equal(available.search_terminal, true);
  assert.equal(available.wait_for_idle, false);
  assert.equal(available.wait_for_command, false);
  assert.equal(available.wait_for_attention, false);
});

test("server terminal adapter searches literal presentation rows with bounded ordered context", async () => {
  const pty = createPtyFactory();
  const terminal = new TerminalService({
    serverId: "server-a",
    ptyFactory: pty,
    presentationCheckpoints: new TerminalPresentationCheckpointAuthority({
      maxScrollback: 32,
      checkpointIntervalBytes: 1_000_000,
      checkpointIntervalMs: 1_000_000,
    }),
    generateSessionId: () => "caller",
  });
  await terminal.createSession({ projectId: "project-a", sessionId: "caller", cols: 20, rows: 4 });
  pty.processes[0].emitData("first\r\na.b\r\nlast");
  const dispatch = createTerminalControlAdapter({
    adapter: createServerTerminalControlAdapter({ terminal, launchResolver: createLaunchResolver() }),
  });
  const result = await dispatch(
    {
      id: "search",
      version: 1,
      op: "search_terminal",
      params: {
        terminal: "caller",
        query: ".",
        case_sensitive: true,
        context_lines: 1,
        max_matches: 20,
        max_bytes: 512,
      },
    },
    context(),
  );
  assert.deepEqual(result.matches.map((match) => match.text), ["a.b"]);
  assert.deepEqual(result.matches[0].before, ["first"]);
  assert.deepEqual(result.matches[0].after, ["last"]);
  assert.equal(result.matches_truncated, false);
  assert.equal(result.presentation_truncated, false);
  assert.equal(Buffer.byteLength(JSON.stringify(result), "utf8") <= 512, true);
});

test("open_terminal resolves a canonical launch before spawn and reconciles its panel", async () => {
  const pty = createPtyFactory();
  const ids = ["caller", "opened"];
  const terminal = new TerminalService({
    serverId: "server-a",
    ptyFactory: pty,
    generateSessionId: () => ids.shift(),
  });
  const caller = await terminal.createSession({
    projectId: "project-a",
    cols: 80,
    rows: 24,
  });
  let persisted;
  const workspace = new WorkspaceRepository(
    {
      async load() {
        return persisted;
      },
      async commit(state) {
        persisted = state;
      },
    },
    "server-a",
  );
  const initial = await workspace.load();
  const viewId = initial.viewOrder[0];
  await workspace.apply({
    commandId: "project",
    command: {
      type: "project.create",
      projectId: "project-a",
      viewId,
      root: "/workspace",
      name: "Project",
    },
  });
  await workspace.apply({
    commandId: "caller-panel",
    command: {
      type: "terminal.createPanel",
      sessionId: caller.sessionId,
      projectId: "project-a",
      panelId: "panel-caller",
      title: "Caller",
      cwd: "/workspace",
      createdAt: 1,
    },
  });
  const launchResolver = createLaunchResolver({ cwd: "/canonical/worktree" });
  const dispatch = createTerminalControlAdapter({
    adapter: createServerTerminalControlAdapter({
      terminal,
      workspace,
      launchResolver,
    }),
  });

  const opened = await dispatch(
    {
      id: "open-canonical",
      version: 1,
      op: "open_terminal",
      params: { name: "Worker", cwd: "/requested" },
    },
    { ...context(), requestId: "open-canonical" },
  );

  assert.deepEqual(opened, {
    terminal: "opened",
    projectId: "project-a",
    status: "running",
  });
  assert.equal(launchResolver.intents.length, 1);
  assert.equal(launchResolver.intents[0].explicitCwd, "/requested");
  assert.equal(launchResolver.intents[0].activePanelId, "panel-caller");
  assert.deepEqual(pty.processes[1].options, {
    projectId: "project-a",
    projectEnvironmentId: undefined,
    environmentRevision: undefined,
    shellPath: "/bin/test-shell",
    shell: "/bin/test-shell",
    args: ["--login"],
    cwd: "/canonical/worktree",
    env: { TERM: "xterm-256color" },
    cols: 80,
    rows: 24,
  });
  const state = await workspace.load();
  assert.equal(state.panels["p:opened"].title, "Worker");
  assert.equal(state.panels["p:opened"].cwd, "/canonical/worktree");
  assert.equal(state.terminalSessions.opened.projectId, "project-a");
});

test("open_terminal spawn failure leaves no terminal session or durable panel", async () => {
  const terminal = new TerminalService({
    serverId: "server-a",
    ptyFactory: { spawn() { throw new Error("sensitive provider failure"); } },
    generateSessionId: () => "failed-open",
  });
  let persisted;
  const workspace = new WorkspaceRepository({
    async load() { return persisted; },
    async commit(state) { persisted = state; },
  }, "server-a");
  const initial = await workspace.load();
  await workspace.apply({ commandId: "project", command: { type: "project.create", projectId: "project-a", viewId: initial.viewOrder[0], root: "/workspace", name: "Project" } });
  const dispatch = createTerminalControlAdapter({
    adapter: createServerTerminalControlAdapter({ terminal, workspace, launchResolver: createLaunchResolver() }),
  });

  const result = await dispatch(
    { id: "failed-open", version: 1, op: "open_terminal", params: {} },
    { ...context(), requestId: "failed-open" },
  );

  assert.equal(result.ok, false);
  assert.equal(terminal.getSession("failed-open"), undefined);
  const state = await workspace.load();
  assert.equal(state.terminalSessions["failed-open"], undefined);
  assert.equal(state.panels["p:failed-open"], undefined);
  assert.doesNotMatch(JSON.stringify(result), /sensitive provider failure/u);
});

test("server terminal adapter binds layout operations to the canonical workspace repository", async () => {
  const pty = createPtyFactory();
  const ids = ["caller", "sibling"];
  const terminal = new TerminalService({
    serverId: "server-a",
    ptyFactory: pty,
    generateSessionId: () => ids.shift(),
  });
  const caller = await terminal.createSession({
    projectId: "project-a",
    cols: 80,
    rows: 24,
  });
  const sibling = await terminal.createSession({
    projectId: "project-a",
    cols: 80,
    rows: 24,
  });
  let persisted;
  const workspace = new WorkspaceRepository(
    {
      async load() {
        return persisted;
      },
      async commit(state) {
        persisted = state;
      },
    },
    "server-a",
  );
  const initial = await workspace.load();
  const viewId = initial.viewOrder[0];
  await workspace.apply({
    commandId: "project",
    command: {
      type: "project.create",
      projectId: "project-a",
      viewId,
      root: "/workspace",
      name: "Project",
    },
  });
  await workspace.apply({
    commandId: "caller",
    command: {
      type: "terminal.create",
      sessionId: caller.sessionId,
      projectId: "project-a",
      createdAt: 1,
    },
  });
  await workspace.apply({
    commandId: "sibling",
    command: {
      type: "terminal.create",
      sessionId: sibling.sessionId,
      projectId: "project-a",
      createdAt: 2,
    },
  });
  await workspace.apply({
    commandId: "caller-panel",
    command: {
      type: "panel.create",
      panel: {
        id: "panel-caller",
        projectId: "project-a",
        type: "terminal",
        sessionId: caller.sessionId,
        createdAt: 1,
      },
    },
  });
  await workspace.apply({
    commandId: "sibling-panel",
    command: {
      type: "panel.create",
      panel: {
        id: "panel-sibling",
        projectId: "project-a",
        type: "terminal",
        sessionId: sibling.sessionId,
        createdAt: 2,
      },
    },
  });

  const adapter = createServerTerminalControlAdapter({
    terminal,
    launchResolver: createLaunchResolver(),
    workspace,
    focusTerminal: () => {
      throw new Error("renderer focus callback must not run");
    },
    renameTerminal: () => {
      throw new Error("renderer rename callback must not run");
    },
    splitTerminal: () => {
      throw new Error("renderer split callback must not run");
    },
  });
  const dispatch = createTerminalControlAdapter({ adapter });
  const request = (id, op, params) => dispatch({ id, version: 1, op, params }, { ...context(), requestId: id });

  assert.deepEqual(await request("workspace-focus", "focus_terminal", { terminal: "sibling" }), { terminal: "sibling", focused: true });
  assert.deepEqual(
    await request("workspace-rename", "rename_terminal", {
      terminal: "sibling",
      name: "Worker",
    }),
    { terminal: "sibling", renamed: true, name: "Worker" },
  );
  assert.deepEqual(
    await request("workspace-split", "split_terminal", {
      terminal: "sibling",
      direction: "below",
    }),
    { terminal: "sibling", split: "below" },
  );
  const updated = await workspace.load();
  assert.equal(updated.panels["panel-sibling"].title, "Worker");
  assert.equal(updated.projects["project-a"].activePanelId, "panel-sibling");
  assert.equal(updated.projects["project-a"].layout.kind, "split");
  assert.equal(updated.projects["project-a"].layout.direction, "vertical");

  const movedViewId = `${viewId}:other`;
  await workspace.apply({
    commandId: "view-other",
    command: { type: "view.create", viewId: movedViewId, name: "Other" },
  });
  await workspace.apply({
    commandId: "move-project",
    command: {
      type: "project.move",
      projectId: "project-a",
      targetViewId: movedViewId,
    },
  });
  const moved = await request("workspace-moved", "focus_terminal", {
    terminal: "sibling",
  });
  assert.deepEqual(moved, { terminal: "sibling", focused: true });
  assert.equal((await workspace.load()).projects["project-a"].viewId, movedViewId);
});

test("server terminal adapter waits on canonical activity transitions with bounded timeout", async () => {
  const pty = createPtyFactory();
  const terminal = new TerminalService({
    serverId: "server-a",
    ptyFactory: pty,
    generateSessionId: () => "caller",
  });
  const activity = new TerminalActivityService({ serverId: "server-a" });
  const handle = await terminal.createSession({
    projectId: "project-a",
    cols: 80,
    rows: 24,
  });
  const identity = {
    serverId: "server-a",
    projectId: "project-a",
    sessionId: handle.sessionId,
  };
  activity.register(identity);
  const dispatch = createTerminalControlAdapter({
    adapter: createServerTerminalControlAdapter({
      terminal,
      launchResolver: createLaunchResolver(),
      activity,
      maxWaitSeconds: 2,
    }),
  });
  const request = (id, op, params) => dispatch({ id, version: 1, op, params }, { ...context(), requestId: id });

  activity.ingestSignal(identity, { kind: "command", phase: "executing" });
  const idlePending = request("idle", "wait_for_idle", {
    terminal: "caller",
    seconds: 1,
    timeout: 1,
  });
  setTimeout(
    () =>
      activity.ingestSignal(identity, {
        kind: "command",
        phase: "finished",
        exitCode: 7,
      }),
    5,
  );
  assert.deepEqual(await idlePending, {
    terminal: "caller",
    idle: true,
    timedOut: false,
    exitCode: 7,
  });

  const commandPending = request("command", "wait_for_command", {
    terminal: "caller",
    timeout: 1,
  });
  setTimeout(() => {
    activity.ingestSignal(identity, { kind: "command", phase: "executing" });
    activity.ingestSignal(identity, {
      kind: "command",
      phase: "finished",
      exitCode: 3,
    });
  }, 5);
  assert.deepEqual(await commandPending, {
    terminal: "caller",
    completed: true,
    timedOut: false,
    exitCode: 3,
  });

  const attentionPending = request("attention", "wait_for_attention", {
    terminal: "caller",
    timeout: 1,
  });
  setTimeout(() => activity.ingestSignal(identity, { kind: "bell" }), 5);
  assert.deepEqual(await attentionPending, {
    terminal: "caller",
    attention: true,
    timedOut: false,
    exitCode: 3,
  });

  activity.ingestSignal(identity, { kind: "userInput" });
  assert.deepEqual(
    await request("zero-idle", "wait_for_idle", {
      terminal: "caller",
      seconds: 0,
    }),
    { terminal: "caller", idle: true, timedOut: false, exitCode: 3 },
  );
  assert.deepEqual(
    await request("timeout", "wait_for_attention", {
      terminal: "caller",
      timeout: 0.01,
    }),
    { terminal: "caller", attention: false, timedOut: true },
  );
});
