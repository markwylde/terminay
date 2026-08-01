import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { TerminalService } from "@terminay/server-core";
import {
  ControlCapabilityStore,
  createControlEndpoint,
  createServerTerminalControlAdapter,
  createTerminalControlAdapter,
} from "../dist/index.js";

function createPtyFactory() {
  const processes = [];
  return {
    processes,
    spawn(options) {
      const dataListeners = new Set();
      const exitListeners = new Set();
      const process = {
        pid: 7000 + processes.length,
        options,
        writes: [],
        write(bytes) { this.writes.push(new Uint8Array(bytes)); },
        resize() {},
        kill() {},
        onData(listener) { dataListeners.add(listener); return () => dataListeners.delete(listener); },
        onExit(listener) { exitListeners.add(listener); return () => exitListeners.delete(listener); },
        emitData(value) {
          const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
          for (const listener of dataListeners) listener(bytes);
        },
        emitExit(exit = {}) { for (const listener of exitListeners) listener(exit); },
      };
      processes.push(process);
      return process;
    },
  };
}

function textResult(result) {
  return result.content.find((item) => item.type === "text")?.text ?? "";
}

test("MCP stdio reaches server-owned terminal handlers without renderer IPC", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-server-owned-mcp-"));
  const socketPath = join(root, "control.sock");
  const pty = createPtyFactory();
  const ids = ["caller", "sibling"];
  const terminal = new TerminalService({
    serverId: "server-a",
    ptyFactory: pty,
    generateSessionId: () => ids.shift(),
  });
  const caller = await terminal.createSession({ projectId: "project-a", cols: 80, rows: 24 });
  const sibling = await terminal.createSession({ projectId: "project-a", cols: 80, rows: 24 });
  pty.processes[1].emitData("server-owned output\n");

  let rendererIpcCalls = 0;
  const rendererFallback = () => {
    rendererIpcCalls += 1;
    throw new Error("renderer IPC fallback must not run");
  };
  const serverAdapter = createServerTerminalControlAdapter({
    terminal,
    focusTerminal: rendererFallback,
    renameTerminal: rendererFallback,
    splitTerminal: rendererFallback,
  });
  const dispatch = createTerminalControlAdapter({ adapter: serverAdapter });
  const capabilities = new ControlCapabilityStore({ tokenFactory: () => "server-owned-mcp-token" });
  const lease = capabilities.mint(caller.sessionId, caller.projectId);
  const endpoint = createControlEndpoint({ socketPath, capabilities, dispatch });
  await endpoint.start();

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../dist/mcpEntry.js", import.meta.url))],
    env: {
      ...process.env,
      TERMINAY_CONTROL_SOCKET: socketPath,
      TERMINAY_CONTROL_TOKEN: lease.token,
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "server-owned-mcp-test", version: "1.0.0" });
  try {
    await client.connect(transport);

    const listed = await client.callTool({ name: "list_terminals", arguments: {} });
    assert.notEqual(listed.isError, true, JSON.stringify(listed));
    assert.match(textResult(listed), new RegExp(sibling.sessionId));

    const read = await client.callTool({
      name: "read_terminal",
      arguments: { terminal: sibling.sessionId },
    });
    assert.notEqual(read.isError, true, JSON.stringify(read));
    assert.match(textResult(read), /server-owned output/);

    const written = await client.callTool({
      name: "write_terminal",
      arguments: { terminal: sibling.sessionId, text: "from MCP", submit: true },
    });
    assert.notEqual(written.isError, true, JSON.stringify(written));
    assert.equal(new TextDecoder().decode(pty.processes[1].writes[0]), "from MCP\r");
    assert.equal(rendererIpcCalls, 0);
  } finally {
    await client.close().catch(() => {});
    await endpoint.stop();
    await rm(root, { recursive: true, force: true });
  }
});
