import assert from "node:assert/strict";
import test from "node:test";
import { decodeFrame, DEFAULT_PROTOCOL_LIMITS, encodeFrame } from "@terminay/protocol";
import { TerminayClient, TerminayClientFacade, TerminayGitClient } from "../dist/index.js";

function scriptedTransport() {
  const sent = [];
  const queue = [];
  const waiters = [];
  let open = false;
  const enqueue = (envelope) => {
    const frame = encodeFrame(envelope, new Uint8Array(), DEFAULT_PROTOCOL_LIMITS);
    const waiter = waiters.shift();
    if (waiter) waiter({ done: false, value: frame });
    else queue.push(frame);
  };
  return {
    sent,
    async open() { open = true; },
    async send(frame) {
      assert.equal(open, true);
      const envelope = decodeFrame(frame, DEFAULT_PROTOCOL_LIMITS).envelope;
      sent.push(envelope);
      if (envelope.type === "client_hello") {
        enqueue({ type: "server_hello", protocolVersion: 1, serverId: "server-a", serverVersion: "test", clientId: envelope.clientId, capabilities: ["git"], limits: DEFAULT_PROTOCOL_LIMITS, authScope: "write" });
      } else if (envelope.type === "query") {
        enqueue({ type: "query_result", queryId: envelope.queryId, ok: true, result: { worktrees: [] } });
      } else if (envelope.type === "command") {
        enqueue({ type: "command_result", commandId: envelope.commandId, correlationId: envelope.correlationId, ok: true, result: { accepted: true } });
      }
    },
    async close() { open = false; while (waiters.length > 0) waiters.shift()({ done: true, value: undefined }); },
    incoming: {
      [Symbol.asyncIterator]() {
        return {
          next() {
            const frame = queue.shift();
            if (frame) return Promise.resolve({ done: false, value: frame });
            return new Promise((resolve) => waiters.push(resolve));
          },
        };
      },
    },
  };
}

test("TerminayClient carries Git worktree and reviewed Quick Push operations over framed transport", async () => {
  const transport = scriptedTransport();
  const client = new TerminayClient({ transport, clientId: "client-a", capabilities: ["clipboard", "native.windows"] });
  await client.connect();
  const git = new TerminayGitClient(new TerminayClientFacade(client), { capabilities: { clipboard: true, nativeWindows: true } });
  await git.status({ projectId: "project-a", repositoryId: "repo-a", worktreeId: "worktree-a" });
  await git.diff({ projectId: "project-a", repositoryId: "repo-a", worktreeId: "worktree-a", path: "src/file.ts" });
  await git.list({ projectId: "project-a", repositoryId: "repo-a" });
  await git.reveal({ projectId: "project-a", repositoryId: "repo-a", worktreeId: "worktree-a" });
  await git.copy({ projectId: "project-a", repositoryId: "repo-a", worktreeId: "worktree-a" });
  await git.proposeQuickPush({ projectId: "project-a", repositoryId: "repo-a", worktreeId: "worktree-a", provider: "codex", targetBranch: "main" });
  const operations = transport.sent.filter((envelope) => envelope.type === "query" || envelope.type === "command");
  assert.deepEqual(operations.map((envelope) => envelope.operation), [
    "git.status",
    "git.diff",
    "git.worktrees.list",
    "git.worktree.reveal",
    "git.worktree.copy",
    "git.quick-push.propose",
  ]);
  assert.equal(operations[1].payload.path, "src/file.ts");
  assert.equal(Object.hasOwn(operations[2].payload, "path"), false);
  assert.equal(Object.hasOwn(operations[3].payload, "path"), false);
  await client.close();
});
