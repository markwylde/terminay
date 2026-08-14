import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  RemoteConnectionManager,
  TerminalService,
  TerminalServiceError,
  WorkspaceStore,
  createInitialWorkspace,
  validateWorkspace,
} from "@terminay/server-core";

function fakePty() {
  const processes = [];
  return {
    processes,
    spawn() {
      const data = new Set();
      const exits = new Set();
      const process = {
        pid: 9000 + processes.length,
        writes: [],
        write(bytes) { this.writes.push(new Uint8Array(bytes)); },
        resize() {},
        kill() {},
        onData(listener) { data.add(listener); return () => data.delete(listener); },
        onExit(listener) { exits.add(listener); return () => exits.delete(listener); },
      };
      processes.push(process);
      return process;
    },
  };
}

const identity = Object.freeze({ serverId: "server-a", projectId: "project-a", sessionId: "session-a" });
const writeAuthorization = Object.freeze({ ...identity, scope: "write", clientId: "client-a" });

test("terminal operations reject forged server, project, and session identities", async () => {
  const pty = fakePty();
  const service = new TerminalService({ serverId: "server-a", ptyFactory: pty });
  const session = await service.createSession({ ...identity, cols: 80, rows: 24 });

  for (const forgedIdentity of [
    { ...identity, serverId: "server-b" },
    { ...identity, projectId: "project-b" },
    { ...identity, sessionId: "session-b" },
  ]) {
    assert.throws(
      () => service.subscribe(forgedIdentity, { authorization: { ...forgedIdentity, scope: "read" } }),
      (error) => error instanceof TerminalServiceError && error.code === "session_not_found" || error instanceof TerminalServiceError && error.code === "forbidden",
    );
  }

  for (const forgedAuthorization of [
    { ...writeAuthorization, serverId: "server-b" },
    { ...writeAuthorization, projectId: "project-b" },
    { ...writeAuthorization, sessionId: "session-b" },
  ]) {
    await assert.rejects(
      service.input(identity, "blocked", forgedAuthorization),
      (error) => error instanceof TerminalServiceError && error.code === "forbidden",
    );
  }

  await service.input(identity, "allowed", writeAuthorization);
  assert.equal(new TextDecoder().decode(pty.processes[0].writes[0]), "allowed");
  assert.equal(session.identity.serverId, "server-a");
  assert.equal(session.identity.projectId, "project-a");
  assert.equal(session.identity.sessionId, "session-a");
  await assert.rejects(
    service.createSession({ serverId: "server-b", projectId: "project-a", sessionId: "session-b", cols: 80, rows: 24 }),
    (error) => error instanceof TerminalServiceError && error.code === "forbidden",
  );
});

test("workspace views, projects, panels, and sessions cannot cross ownership boundaries", () => {
  const store = new WorkspaceStore(createInitialWorkspace("server-a"));
  const defaultViewId = store.state.viewOrder[0];
  assert.equal(store.apply({ commandId: "project-a", command: { type: "project.create", projectId: "project-a", viewId: defaultViewId, root: "/tmp/a", name: "A" } }).ok, true);
  assert.equal(store.apply({ commandId: "view-b", command: { type: "view.create", viewId: "view-b", name: "B" } }).ok, true);
  assert.equal(store.apply({ commandId: "project-b", command: { type: "project.create", projectId: "project-b", viewId: "view-b", root: "/tmp/b", name: "B" } }).ok, true);
  assert.equal(store.apply({ commandId: "session-a", command: { type: "terminal.create", sessionId: "session-a", projectId: "project-a", createdAt: 1 } }).ok, true);
  assert.equal(store.apply({ commandId: "panel-a", command: { type: "panel.create", panel: { id: "panel-a", projectId: "project-a", type: "terminal", sessionId: "session-a", createdAt: 1 } } }).ok, true);

  const crossProjectPanel = store.apply({
    commandId: "forged-panel",
    command: {
      type: "panel.create",
      panel: { id: "panel-forged", projectId: "project-b", type: "terminal", sessionId: "session-a", createdAt: 1 },
    },
  });
  assert.equal(crossProjectPanel.ok, false);
  assert.equal(store.state.panels["panel-forged"], undefined);

  const crossServer = store.state;
  crossServer.views[defaultViewId] = { ...crossServer.views[defaultViewId], serverId: "server-b" };
  assert.throws(() => validateWorkspace(crossServer), /view crosses server boundary/);

  const crossView = store.state;
  crossView.projects["project-a"] = { ...crossView.projects["project-a"], viewId: "view-b" };
  assert.throws(() => validateWorkspace(crossView), /view\/project ownership mismatch|project crosses server\/view boundary/);

  const crossSession = store.state;
  crossSession.terminalSessions["session-a"] = { ...crossSession.terminalSessions["session-a"], projectId: "project-b" };
  assert.throws(() => validateWorkspace(crossSession), /terminal panel\/session ownership mismatch/);
});

test("remote admission binds server identity and revocation to exact devices", () => {
  let now = 100;
  const manager = new RemoteConnectionManager({
    serverId: "server-a",
    sessionOrigin: "https://session.example.test",
    now: () => now,
    maxPeers: 3,
  });
  manager.expose(1_000);
  const proof = (deviceId, ticketId, overrides = {}) => ({
    deviceId,
    ticketId,
    serverId: "server-a",
    sessionOrigin: "https://session.example.test",
    expiresAt: 900,
    authenticated: true,
    ...overrides,
  });

  const deviceA = manager.admit(proof("device-a", "ticket-a"));
  assert.throws(() => manager.admit(proof("device-b", "ticket-forged", { serverId: "server-b" })), /identity mismatch/);
  manager.revokeDevice("device-a");
  assert.throws(() => manager.send(deviceA.peerId, "application", new Uint8Array([1])), /not connected/);
  assert.throws(() => manager.admit(proof("device-a", "ticket-a-replay")), /revoked/);

  const deviceB = manager.admit(proof("device-b", "ticket-b"));
  assert.notEqual(deviceB.peerId, deviceA.peerId);
  manager.send(deviceB.peerId, "application", new Uint8Array([7]));
  assert.deepEqual([...manager.drain(deviceB.peerId, "application")], [new Uint8Array([7])]);
  now = 1_000;
  assert.equal(manager.exposure.state, "disabled");
});

test("server UI host keeps privileged navigation and browser permissions denied", async () => {
  const host = await readFile(new URL("../electron/serverUiHost.ts", import.meta.url), "utf8");
  const remote = await readFile(new URL("../electron/remote/service.ts", import.meta.url), "utf8");
  assert.match(host, /contextIsolation:\s*true/);
  assert.match(host, /nodeIntegration:\s*false/);
  assert.match(host, /sandbox:\s*true/);
  assert.match(host, /webSecurity:\s*true/);
  assert.match(host, /allowRunningInsecureContent:\s*false/);
  assert.match(host, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.match(
    host,
    /const denyWebviewAttachment = \(event: Event\) => \{\s*event\.preventDefault\(\);\s*\};/,
  );
  assert.match(
    host,
    /\.on\('will-attach-webview', denyWebviewAttachment\)/,
  );
  assert.match(
    host,
    /const restrictFrameNavigation = \([\s\S]*?isAllowedNavigation\(event\.url, expectedOrigin, allowedFileRoot\)/,
  );
  assert.match(
    host,
    /\.on\('will-frame-navigate', restrictFrameNavigation\)/,
  );
  assert.match(
    host,
    /const restrictNavigation = \([\s\S]*?isAllowedNavigation\(target, expectedOrigin, allowedFileRoot\)/,
  );
  assert.match(host, /\.on\('will-navigate', restrictNavigation\)/);
  assert.match(
    host,
    /const restrictRedirect = \([\s\S]*?isAllowedNavigation\(target, expectedOrigin, allowedFileRoot\)/,
  );
  assert.match(host, /\.on\('will-redirect', restrictRedirect\)/);
  assert.match(host, /item\.cancel\(\)/);
  assert.match(host, /setPermissionCheckHandler\(\(\) => false\)/);
  assert.match(host, /callback\(false\)/);
  assert.match(remote, /content-security-policy/);
  assert.match(remote, /default-src 'self'/);
  assert.match(remote, /script-src 'self'/);
  assert.match(remote, /object-src 'none'/);
  assert.match(remote, /frame-ancestors 'none'/);
  assert.match(remote, /permissions-policy/);
  assert.match(remote, /camera=\(\), microphone=\(\)/);
  assert.match(remote, /referrer-policy/);
});
