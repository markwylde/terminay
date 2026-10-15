import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentStatusService,
  NotificationManager,
  TerminalActivityService,
  WorkspaceStore,
  createInitialWorkspace,
  createServerCoreComposition,
} from "../dist/index.js";

/**
 * Track activity is a panel setting in the workspace, and the notification
 * manager is what the header, the application badge, and phone push all read
 * (ADR-0061). So an untracked terminal is silenced where the composed server
 * binds activity to that manager (ADR-0065).
 */

const SERVER = "untracked-server";
const identity = { serverId: SERVER, projectId: "project-a", sessionId: "session-a" };

function fakeClock() {
  let now = 0;
  const timers = new Map();
  let nextId = 0;
  return {
    now: () => now,
    setTimeout(handler, milliseconds) { const id = ++nextId; timers.set(id, { at: now + milliseconds, handler }); return id; },
    clearTimeout(id) { timers.delete(id); },
    advance(milliseconds) {
      now += milliseconds;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.handler(); }
    },
  };
}

async function setup() {
  const workspace = new WorkspaceStore(createInitialWorkspace(SERVER));
  const viewId = workspace.state.viewOrder[0];
  assert.equal(workspace.apply({ commandId: "project", command: { type: "project.create", projectId: "project-a", viewId, root: "/repo/a", name: "a" } }).ok, true);
  assert.equal(workspace.apply({ commandId: "panel", command: { type: "terminal.createPanel", sessionId: "session-a", projectId: "project-a", panelId: "panel-a", cwd: "/repo/a", createdAt: 1 } }).ok, true);
  const clock = fakeClock();
  const activity = new TerminalActivityService({ serverId: SERVER, now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  const agents = new AgentStatusService({ activity });
  await agents.start();
  const notifications = new NotificationManager({ now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: SERVER,
    serverVersion: "test",
    capabilities: ["workspace", "terminal"],
    ptyFactory: { spawn: () => { throw new Error("no terminal is spawned"); } },
    workspace,
    activity,
    agents,
    notifications,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
  });
  activity.register(identity);
  let serial = 0;
  const setTracked = (enabled) =>
    assert.equal(workspace.apply({ commandId: `track-${++serial}`, command: { type: "panel.update", panelId: "panel-a", patch: { activityIndicatorsEnabled: enabled } } }).ok, true);
  const published = () => Object.values(notifications.snapshot().notifications).map((record) => record.kind);
  return { activity, clock, composition, notifications, published, setTracked };
}

test("an untracked terminal's bell publishes nothing for the header, the badge, or push", async (t) => {
  const { activity, clock, composition, published, setTracked } = await setup();
  t.after(() => composition.shutdown());
  setTracked(false);
  activity.ingestSignal(identity, { kind: "bell" });
  clock.advance(10_000);
  assert.deepEqual(published(), []);
});

test("untracking a terminal withdraws its notification, and re-tracking does not replay it", async (t) => {
  const { activity, clock, composition, notifications, published, setTracked } = await setup();
  t.after(() => composition.shutdown());
  activity.ingestSignal(identity, { kind: "bell" });
  clock.advance(10_000);
  assert.deepEqual(published(), ["attention"]);
  notifications.send({ projectId: "project-a", sessionId: "session-a" }, { body: "sent on purpose" });
  setTracked(false);
  clock.advance(10_000);
  assert.deepEqual(published(), ["message"], "only what a process sent survives");
  activity.ingestSignal(identity, { kind: "bell" });
  setTracked(true);
  clock.advance(10_000);
  assert.deepEqual(published(), ["message"], "the bell rung while untracked is not reported");
});
