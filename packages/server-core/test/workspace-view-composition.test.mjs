import assert from "node:assert/strict";
import test from "node:test";
import { TerminayClient } from "@terminay/client-core";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import { FEATURE_CAPABILITIES } from "@terminay/protocol";
import { TerminayClientFacade, serveWorkspaceView } from "@terminay/client-core";
import {
  ServerSettingsRepository,
  createServerCoreComposition,
} from "../dist/index.js";

const SERVER = "view-server";
const identity = { serverId: SERVER, projectId: "project-a", sessionId: "session-a" };

function recordingPty() {
  const processes = [];
  return {
    processes,
    spawn() {
      const data = new Set();
      const exits = new Set();
      const process = {
        pid: 4000 + processes.length,
        writes: [],
        write(bytes) { process.writes.push(typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes)); },
        resize() {},
        kill() {},
        onData(listener) { data.add(listener); return () => data.delete(listener); },
        onExit(listener) { exits.add(listener); return () => exits.delete(listener); },
        emitData(value) { for (const listener of data) listener(new TextEncoder().encode(value)); },
        emitExit() { for (const listener of exits) listener({ exitCode: 0, signal: null }); },
      };
      processes.push(process);
      return process;
    },
  };
}

async function composed({ permissions = {}, appWindows = {} } = {}) {
  let persisted;
  const settings = new ServerSettingsRepository({
    load: async () => structuredClone(persisted),
    commit: async (state) => { persisted = structuredClone(state); },
  });
  const pty = recordingPty();
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: SERVER,
    serverVersion: "test",
    capabilities: [],
    ptyFactory: pty,
    authenticate: ({ hello }) => ({
      clientId: hello.clientId,
      authScope: hello.clientId === "reader" ? "read" : "write",
      ...(hello.clientId.startsWith("bound-") ? { claims: { projectId: "project-b" } } : {}),
    }),
    settings,
    mcpApprovals: true,
    ...(appWindows === null ? {} : { appWindows }),
  });
  const cleanups = [];
  const connect = async (clientId, { attach = true, mirror = true } = {}) => {
    const pair = createInMemoryTransportPair({ autoOpen: false });
    await pair.open();
    const connection = composition.core.accept(pair.server);
    const task = connection.start();
    const client = new TerminayClient({ transport: pair.client, clientId, capabilities: [FEATURE_CAPABILITIES.appWindows, ...(mirror ? [FEATURE_CAPABILITIES.appWindowMirror] : [])] });
    const hello = await client.connect();
    cleanups.push(async () => {
      await client.close().catch(() => undefined);
      await connection.close().catch(() => undefined);
      await task.catch(() => undefined);
    });
    if (attach) await client.command("terminal.attach", { clientId, identity, fromPosition: 0 });
    return { client, hello };
  };
  await composition.start();
  await settings.update({ terminayMcp: { enabled: true, permissions } });
  await composition.terminal.createSession({ projectId: identity.projectId, sessionId: identity.sessionId, cols: 80, rows: 24 });
  return {
    composition,
    pty,
    connect,
    process: () => pty.processes[0],
    close: async () => { for (const cleanup of cleanups) await cleanup(); await composition.shutdown(); },
  };
}


/**
 * The facade a window serves view requests over. `ready()` settles once every
 * subscription and command it has sent so far has been answered, so a window
 * that has started serving is then subscribed and attached on the server.
 */
function windowFacade(client) {
  const sent = [];
  const track = (pending) => {
    sent.push(pending.catch(() => undefined));
    return pending;
  };
  const facade = new TerminayClientFacade({
    query: (...args) => client.query(...args),
    command: (...args) => track(client.command(...args)),
    subscribe: (...args) => track(client.subscribe(...args)),
  });
  return { facade, ready: () => Promise.all(sent) };
}

/** A window that answers view requests, recording what it was asked. Settles
 * once the window is serving. */
async function serve(client, name, asked) {
  const { facade, ready } = windowFacade(client);
  serveWorkspaceView(facade, async (request) => {
    asked.push([name, request.op, request.params]);
    return { layout: { projectId: request.params.projectId ?? "project-a", answeredBy: name } };
  });
  await ready();
}

test("a terminal's view requests reach only the window holding its presentation, and its answer comes back", async () => {
  const server = await composed();
  try {
    const holder = await server.connect("desktop");
    const watcher = await server.connect("laptop", { attach: false });
    const asked = [];
    await serve(holder.client, "desktop", asked);
    await serve(watcher.client, "laptop", asked);
    const { relay, targetFor } = server.composition.workspaceView;
    const target = targetFor({ terminalSessionId: identity.sessionId, projectId: identity.projectId });
    assert.equal(target.clientId, "desktop");
    const answer = await relay.request(target, "layout", { projectId: "project-a" }, "project-a");
    assert.equal(answer.layout.answeredBy, "desktop");
    assert.deepEqual(asked, [["desktop", "layout", { projectId: "project-a" }]]);
  } finally {
    await server.close();
  }
});

test("a chat's view requests go to the window that sent its latest message", async () => {
  const server = await composed();
  try {
    const { targetFor } = server.composition.workspaceView;
    // No agent chats are composed here, so a chat has no window to talk to.
    assert.equal(targetFor({ terminalSessionId: "chat:c1", projectId: "system:automations", chatId: "c1" }), undefined);
  } finally {
    await server.close();
  }
});

test("a window that closes fails the request it was asked and is never asked again", async () => {
  const server = await composed();
  try {
    const holder = await server.connect("desktop");
    const { facade, ready } = windowFacade(holder.client);
    let reachedWindow;
    const asked = new Promise((resolve) => { reachedWindow = resolve; });
    serveWorkspaceView(facade, () => {
      reachedWindow();
      return new Promise(() => {});
    });
    await ready();
    const { relay, targetFor } = server.composition.workspaceView;
    const target = targetFor({ terminalSessionId: identity.sessionId, projectId: identity.projectId });
    const pending = relay.request(target, "layout", {}, "project-a");
    // The window has been asked, and never answers.
    await asked;
    await holder.client.close();
    await assert.rejects(pending, (error) => error.code === "unavailable");
    await assert.rejects(relay.request(target, "layout", {}, "project-a"), (error) => error.code === "unavailable");
  } finally {
    await server.close();
  }
});

test("a window bound to another project is never asked about this one", async () => {
  const server = await composed();
  try {
    const bound = await server.connect("bound-window", { attach: false });
    const asked = [];
    await serve(bound.client, "bound", asked);
    await assert.rejects(
      server.composition.workspaceView.relay.request({ clientId: "bound-window" }, "layout", {}, "project-a"),
      (error) => error.code === "unavailable",
    );
    assert.deepEqual(asked, []);
  } finally {
    await server.close();
  }
});
