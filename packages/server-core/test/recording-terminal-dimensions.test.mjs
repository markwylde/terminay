import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TerminayClient } from "@terminay/client-core";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import {
  RecordingService,
  ServerRecordingAdapter,
  WorkspaceStore,
  createInitialWorkspace,
  createServerCoreComposition,
} from "../dist/index.js";

/**
 * A cast replays a full-screen program faithfully only when its header and
 * resize events match the size the program drew for. Terminals are created at
 * their real size and resized through the terminal protocol, so the recorder
 * must learn both from the terminal service itself.
 */

const SERVER = "recording-size-server";
const encoder = new TextEncoder();

function createPtyFactory() {
  const ptys = [];
  return {
    ptys,
    spawn() {
      const pty = {
        pid: 44_000 + ptys.length,
        dataListeners: new Set(),
        write() {},
        resize() {},
        kill() {},
        onData(listener) { pty.dataListeners.add(listener); return () => pty.dataListeners.delete(listener); },
        onExit() { return () => undefined; },
        onForegroundProcess() { return () => undefined; },
        emit(text) { for (const listener of pty.dataListeners) listener(encoder.encode(text)); },
      };
      ptys.push(pty);
      return pty;
    },
  };
}

test("a recording carries the terminal's live size and every protocol resize", async () => {
  const home = await mkdtemp(join(tmpdir(), "terminay-recording-size-"));
  const workspace = new WorkspaceStore(createInitialWorkspace(SERVER));
  const viewId = workspace.state.viewOrder[0];
  assert.equal(workspace.apply({ commandId: "project", command: { type: "project.create", projectId: "project-a", viewId, root: "/repo/project-a", name: "project-a" } }).ok, true);
  const service = new RecordingService({ homeDirectory: home, recordingRoot: join(home, "recordings"), serverId: SERVER });
  const ptyFactory = createPtyFactory();
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: SERVER,
    serverVersion: "test",
    capabilities: ["workspace", "terminal", "recordings"],
    ptyFactory,
    workspace,
    recordings: new ServerRecordingAdapter(service, { serverId: SERVER }),
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "admin" }),
  });
  const pair = createInMemoryTransportPair();
  const serverTask = composition.core.accept(pair.server).start();
  const client = new TerminayClient({ transport: pair.client, clientId: "recorder", capabilities: ["workspace.v1"] });
  try {
    await pair.open();
    await client.connect();
    const created = await client.command("terminal.create", { projectId: "project-a", cwd: "/repo/project-a", cols: 132, rows: 41 }, { commandId: "create" });
    const sessionId = created.result.sessionId;

    const state = service.start(sessionId, { projectId: "project-a" });
    ptyFactory.ptys[0].emit("before\r\n");
    // Protocol and host resizes both land in TerminalService.resize.
    await composition.terminal.resize(sessionId, { cols: 150, rows: 50 });
    ptyFactory.ptys[0].emit("after\r\n");
    service.stop(sessionId);

    const chunk = service.readRecordingChunk({ recordingId: state.recordingId, maxBytes: 64 * 1024 });
    const [header, ...events] = chunk.content.split("\n").filter(Boolean).map((line) => JSON.parse(line));
    assert.deepEqual([header.term.cols, header.term.rows], [132, 41]);
    assert.deepEqual(events.map((event) => [event[1], event[2]]), [["o", "before\r\n"], ["r", "150x50"], ["o", "after\r\n"]]);
  } finally {
    await client.close().catch(() => undefined);
    await serverTask.catch(() => undefined);
    await composition.shutdown?.().catch?.(() => undefined);
    await rm(home, { recursive: true, force: true });
  }
});
