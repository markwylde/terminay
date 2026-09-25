import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExtensionHost, ExtensionHostManager } from "../dist/index.js";

const SOURCE_ID = "example.forge/forge";

async function fixture(source, permissions = ["worktree-observation"]) {
  const root = await mkdtemp(join(tmpdir(), "terminay-worktree-insight-"));
  await writeFile(join(root, "extension.js"), source, { mode: 0o600 });
  for (const name of ["config", "data", "cache"]) await mkdir(join(root, name));
  return {
    extensionId: "example.forge",
    packageRoot: root,
    entrypoint: "extension.js",
    configDirectory: join(root, "config"),
    dataDirectory: join(root, "data"),
    cacheDirectory: join(root, "cache"),
    permissions,
    worktreeInsights: [{ id: SOURCE_ID, displayName: "Forge" }],
  };
}

const EXTENSION = `
export function activate(context) {
  context.worktrees.registerInsightSource("${SOURCE_ID}", {
    async start({ contexts, onContextsChanged, publisher, credentials, signal }) {
      const publishAll = async (live) => {
        for (const ctx of live) {
          const token = await credentials.token("https://forge.example");
          for (const worktree of ctx.worktrees)
            publisher.publish(ctx.id, worktree.id, {
              pullRequest: { number: 7, title: token ?? "no-token", url: "https://forge.example/pr/7", state: "open" },
            });
        }
        if (live.length === 0) publisher.requestSignIn({ origin: "https://forge.example", provider: "Forge" });
      };
      await publishAll(contexts);
      onContextsChanged((live) => void publishAll(live));
      credentials.onAvailable((origin) => publisher.publish("ctx-1", "wt-1", { pullRequest: { number: 8, title: origin, url: "https://forge.example/pr/8", state: "draft" } }));
      signal.addEventListener("abort", () => {});
    },
  });
}`;

function recordingBroker() {
  const calls = { published: [], signIns: [], stopped: [], rejected: [] };
  return {
    calls,
    publish(request) { calls.published.push(structuredClone(request)); },
    requestSignIn(request) { calls.signIns.push(structuredClone(request)); },
    async token() { return "secret-token"; },
    async rejectToken(request) { calls.rejected.push(request.origin); },
    sourceStopped(request) { calls.stopped.push(request.sourceId); },
  };
}

async function eventually(check, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("condition never held");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const CONTEXT = {
  id: "ctx-1",
  repositoryRoot: "/work/repo",
  remotes: [{ name: "origin", url: "https://forge.example/o/r.git" }],
  worktrees: [{ id: "wt-1", path: "/work/repo", branch: "main", upstream: { remote: "origin", branch: "main" }, head: "abc" }],
};

test("a started insight source receives contexts, resolves credentials, and publishes through the broker", async (t) => {
  const worktrees = recordingBroker();
  const host = new ExtensionHost("example.forge", { broker: { async request() {} }, worktrees });
  t.after(() => host.stop());
  await host.start(await fixture(EXTENSION));
  assert.deepEqual(host.status().worktreeInsightSources.map((source) => source.id), [SOURCE_ID]);
  await host.startWorktreeInsightSource(SOURCE_ID, []);
  await eventually(() => worktrees.calls.signIns.length === 1);
  assert.deepEqual(worktrees.calls.signIns[0].request, { origin: "https://forge.example", provider: "Forge" });
  await host.setWorktreeInsightContexts(SOURCE_ID, [CONTEXT]);
  await eventually(() => worktrees.calls.published.length === 1);
  const [published] = worktrees.calls.published;
  assert.equal(published.extensionId, "example.forge");
  assert.equal(published.contextId, "ctx-1");
  assert.equal(published.worktreeId, "wt-1");
  assert.equal(published.properties.pullRequest.title, "secret-token");
  await host.notifyWorktreeCredential(SOURCE_ID, "https://forge.example");
  await eventually(() => worktrees.calls.published.length === 2);
  assert.equal(worktrees.calls.published[1].properties.pullRequest.state, "draft");
  await host.stopWorktreeInsightSource(SOURCE_ID);
  assert.deepEqual(worktrees.calls.stopped, [SOURCE_ID]);
});

test("an insight source registered without worktree-observation is refused", async () => {
  const host = new ExtensionHost("example.forge", { broker: { async request() {} }, worktrees: recordingBroker() });
  await assert.rejects(host.start(await fixture(EXTENSION, ["network"])), /invalid worktree insight source registrations/);
});

test("an undeclared insight source registration fails activation", async () => {
  const host = new ExtensionHost("example.forge", { broker: { async request() {} }, worktrees: recordingBroker() });
  await assert.rejects(
    host.start(await fixture(`export function activate(context) { context.worktrees.registerInsightSource("example.forge/other", { start() {} }); }`)),
    /undeclared or invalid/,
  );
});

test("publications from a source the host has not started are dropped", async (t) => {
  const worktrees = recordingBroker();
  const host = new ExtensionHost("example.forge", { broker: { async request() {} }, worktrees });
  t.after(() => host.stop());
  await host.start(await fixture(EXTENSION));
  await host.startWorktreeInsightSource(SOURCE_ID, []);
  await host.stopWorktreeInsightSource(SOURCE_ID);
  await host.setWorktreeInsightContexts(SOURCE_ID, [CONTEXT]);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(worktrees.calls.published.length, 0);
});

test("the manager lists insight sources only after activation and routes calls to their owner", async () => {
  const worktrees = recordingBroker();
  const manager = new ExtensionHostManager({ broker: { async request() {} }, worktrees });
  await manager.start(await fixture(EXTENSION));
  assert.deepEqual(manager.worktreeInsightContributions().map(({ contribution }) => contribution.id), [SOURCE_ID]);
  await manager.startWorktreeInsightSource(SOURCE_ID, [CONTEXT]);
  await eventually(() => worktrees.calls.published.length === 1);
  await manager.shutdown();
  assert.deepEqual(worktrees.calls.stopped, [SOURCE_ID]);
});
