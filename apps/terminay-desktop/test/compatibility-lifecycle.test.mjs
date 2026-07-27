import assert from "node:assert/strict";
import test from "node:test";
import { TerminayTerminalClient } from "@terminay/client-core";
import { decodeFrame, encodeFrame } from "@terminay/protocol";
import { createDesktopIpcClient, ServerScopedIpcMessagePort } from "../dist/compatibility/index.js";
import { WindowViewRegistry } from "../dist/main/index.js";
import { createDesktopRendererContext } from "../dist/renderer/index.js";

function ports() {
  const a = { onmessage: null, onmessageerror: null, postMessage(value) { queueMicrotask(() => b.onmessage?.({ data: clone(value) })); }, start() {}, close() {} };
  const b = { onmessage: null, onmessageerror: null, postMessage(value) { queueMicrotask(() => a.onmessage?.({ data: clone(value) })); }, start() {}, close() {} };
  return [a, b];
}

function clone(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const packet = value;
  return { ...packet, ...(packet.frame instanceof Uint8Array ? { frame: packet.frame.slice() } : {}) };
}

function serverPeer(rawPort) {
  const port = new ServerScopedIpcMessagePort(rawPort, "server-lifecycle");
  let attachmentCount = 0;
  port.onmessage = (event) => {
    const decoded = decodeFrame(event.data);
    if (decoded.envelope.type === "client_hello") {
      port.postMessage(encodeFrame({
        type: "server_hello",
        protocolVersion: 1,
        serverId: "server-lifecycle",
        serverVersion: "test",
        clientId: decoded.envelope.clientId,
        capabilities: [],
        limits: { maxFrameBytes: 1024, maxHeaderBytes: 1024, maxBodyBytes: 1024, maxQueuedBytes: 1024, maxStreamChunkBytes: 1024, maxBinaryChunkBytes: 1024, maxCapabilities: 8, maxEventsPerBatch: 8 },
        authScope: "write",
      }));
      return;
    }
    if (decoded.envelope.type !== "command") return;
    const command = decoded.envelope;
    let result = {};
    if (command.operation === "terminal.attach" || command.operation === "terminal.resume") {
      attachmentCount += 1;
      result = { attachmentId: `attachment-${attachmentCount}`, fromPosition: command.payload.fromPosition, position: command.payload.fromPosition, events: [] };
    }
    port.postMessage(encodeFrame({ type: "command_result", commandId: command.commandId, correlationId: command.correlationId, ok: true, result }));
  };
}

test("renderer reload and window close detach views without replacing the server/client/terminal identity", async () => {
  const [rendererPort, serverPort] = ports();
  serverPeer(serverPort);
  const client = createDesktopIpcClient({ port: rendererPort, serverId: "server-lifecycle", clientId: "client-lifecycle" });
  const server = await client.connect();
  const terminal = new TerminayTerminalClient(client);
  const identity = { serverId: server.serverId, projectId: "project-lifecycle", sessionId: "session-lifecycle", clientId: "client-lifecycle" };
  const attachment = await terminal.attach(identity);
  const windows = new WindowViewRegistry();
  windows.bind({ windowId: "window-lifecycle", connectionId: "local:server-lifecycle", workspaceViewId: "view-lifecycle" });

  const firstRenderer = createDesktopRendererContext({ client });
  const reloadedRenderer = createDesktopRendererContext({ client });
  assert.equal(reloadedRenderer.client, firstRenderer.client);
  assert.equal(reloadedRenderer.connection.server?.serverId, "server-lifecycle");
  assert.equal(attachment.identity.sessionId, "session-lifecycle");

  assert.equal(windows.unbind("window-lifecycle")?.workspaceViewId, "view-lifecycle");
  assert.equal(client.state, "connected");
  assert.equal(attachment.closed, false);
  assert.equal(attachment.identity.serverId, "server-lifecycle");
  await attachment.detach();
  await client.close();
});
