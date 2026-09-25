import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  WorktreeInsightService,
  credentialId,
  fileWorktreePromptPreferences,
  parseGitConfig,
  remoteHosts,
} from "../dist/index.js";

const EXTENSION = "com.example.forge";
const SOURCE = `${EXTENSION}/forge`;
const ORIGIN = "https://git.example.net";

const CONFIG = parseGitConfig(`
[core]
	bare = false
[remote "origin"]
	url = ssh://git@git.example.net:4222/owner/repo.git
	fetch = +refs/heads/*:refs/remotes/origin/*
[branch "main"]
	remote = origin
	merge = refs/heads/main
[branch "feat/x"]
	remote = origin
	merge = refs/heads/feat/x
[branch "local-only"]
	remote = .
	merge = refs/heads/main
`);

function listing(projectId, worktrees = [["wt-main", "main"], ["wt-x", "feat/x"]], repositoryId = "repo-1") {
  return {
    projectId,
    repositoryId,
    repositoryRoot: "/work/repo",
    defaultBranch: "main",
    state: "ready",
    bounded: false,
    worktrees: worktrees.map(([id, branch]) => ({
      id, repositoryId, path: `/work/${id}`, branch, detached: false, head: `head-${id}`,
      isMain: id === "wt-main", isBare: false, isPrunable: false, locked: false, state: "clean",
      aheadOfDefaultBranchCount: 0, lineAdditions: 0, lineDeletions: 0, hasCommittedChanges: false, entries: [],
    })),
  };
}

function memoryVault() {
  const values = new Map();
  return {
    values,
    has: (id) => values.has(id),
    async put(id, _label, value) { values.set(id, new TextDecoder().decode(value)); },
    async read(id) { return values.get(id); },
    async remove(id) { values.delete(id); },
  };
}

function fakeHosts() {
  const calls = { started: [], stopped: [], contexts: [], credentials: [] };
  let listener;
  return {
    calls,
    contributions: [{ extensionId: EXTENSION, contribution: { id: SOURCE, displayName: "Forge" } }],
    worktreeInsightContributions() { return this.contributions; },
    onContributionsChanged(next) { listener = next; return () => { listener = undefined; }; },
    changed() { return listener?.(); },
    async startWorktreeInsightSource(sourceId, contexts) { calls.started.push({ sourceId, contexts: structuredClone(contexts) }); },
    async stopWorktreeInsightSource(sourceId) { calls.stopped.push(sourceId); },
    async setWorktreeInsightContexts(sourceId, contexts) { calls.contexts.push({ sourceId, contexts: structuredClone(contexts) }); },
    async notifyWorktreeCredential(sourceId, origin) { calls.credentials.push({ sourceId, origin }); },
  };
}

function service(overrides = {}) {
  const changes = [];
  const hosts = fakeHosts();
  const vault = memoryVault();
  const saved = [];
  const insights = new WorktreeInsightService({
    vault,
    readGitConfig: async () => CONFIG,
    preferences: { async load() { return overrides.suppressed ?? []; }, async save(ids) { saved.push([...ids]); } },
    onProjectChanged: (projectId, worktreeId) => changes.push([projectId, worktreeId]),
    ...overrides,
  });
  insights.attach(hosts);
  return { insights, hosts, vault, changes, saved };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const PROPS = {
  pullRequest: { number: 285, title: "About window", url: `${ORIGIN}/owner/repo/pulls/285`, state: "open" },
  checks: { passed: 1, failed: 1, pending: 0, skipped: 0, total: 2, items: [{ name: "CI / Build", state: "failed" }, { name: "CI / Lint", state: "passed" }] },
};

test("git config parsing yields remotes and branch upstreams", () => {
  assert.deepEqual(CONFIG.remotes, [{ name: "origin", url: "ssh://git@git.example.net:4222/owner/repo.git" }]);
  assert.deepEqual(CONFIG.upstreams.get("feat/x"), { remote: "origin", branch: "feat/x" });
  assert.equal(CONFIG.upstreams.has("local-only"), false);
  assert.deepEqual([...remoteHosts([{ url: "git@git.example.net:o/r.git" }, { url: "https://Other.Example/o/r" }])], ["git.example.net", "other.example"]);
});

test("a project's first listing issues a context to running sources, and only real changes re-issue it", async () => {
  const { insights, hosts } = service();
  await settle();
  assert.equal(hosts.calls.started.length, 1);
  await insights.observeListing(listing("p1"));
  await settle(); await settle();
  assert.equal(hosts.calls.contexts.length, 1);
  const [context] = hosts.calls.contexts[0].contexts;
  assert.equal(context.repositoryRoot, "/work/repo");
  assert.deepEqual(context.worktrees.map((worktree) => [worktree.id, worktree.upstream?.branch]), [["wt-main", "main"], ["wt-x", "feat/x"]]);
  await insights.observeListing(listing("p1"));
  await settle(); await settle();
  assert.equal(hosts.calls.contexts.length, 1, "an identical listing does not re-issue");
  await insights.observeListing(listing("p1", [["wt-main", "main"]]));
  await settle(); await settle();
  assert.equal(hosts.calls.contexts.length, 2, "a changed worktree set re-issues");
});

test("properties are accepted only for issued contexts and worktrees, and scoped to their project", async () => {
  const { insights, hosts, changes } = service();
  await insights.observeListing(listing("p1"));
  await settle(); await settle();
  const contextId = hosts.calls.contexts[0].contexts[0].id;
  insights.publish({ extensionId: EXTENSION, sourceId: SOURCE, contextId: "forged", worktreeId: "wt-main", properties: PROPS });
  insights.publish({ extensionId: EXTENSION, sourceId: SOURCE, contextId, worktreeId: "not-issued", properties: PROPS });
  assert.equal(insights.propertiesFor("p1").size, 0);
  insights.publish({ extensionId: EXTENSION, sourceId: SOURCE, contextId, worktreeId: "wt-main", properties: PROPS });
  assert.deepEqual(insights.propertiesFor("p1").get("wt-main"), PROPS);
  assert.equal(insights.propertiesFor("p2").size, 0);
  assert.deepEqual(changes, [["p1", "wt-main"]]);
  insights.publish({ extensionId: EXTENSION, sourceId: SOURCE, contextId, worktreeId: "wt-main", properties: PROPS });
  assert.equal(changes.length, 1, "an unchanged publication announces nothing");
});

test("invalid properties are rejected and the last valid ones kept", async () => {
  const errors = [];
  const { insights, hosts } = service({ onError: (message) => errors.push(message) });
  await insights.observeListing(listing("p1"));
  await settle(); await settle();
  const contextId = hosts.calls.contexts[0].contexts[0].id;
  insights.publish({ extensionId: EXTENSION, sourceId: SOURCE, contextId, worktreeId: "wt-main", properties: PROPS });
  insights.publish({ extensionId: EXTENSION, sourceId: SOURCE, contextId, worktreeId: "wt-main", properties: { pullRequest: { ...PROPS.pullRequest, url: "https://u:p@x.example/" } } });
  assert.deepEqual(insights.propertiesFor("p1").get("wt-main"), PROPS);
  assert.equal(errors.length, 1);
});

test("closing a project, losing a worktree, or stopping a source drops its properties", async () => {
  const { insights, hosts, changes } = service();
  await insights.observeListing(listing("p1"));
  await settle(); await settle();
  const contextId = hosts.calls.contexts[0].contexts[0].id;
  for (const worktreeId of ["wt-main", "wt-x"])
    insights.publish({ extensionId: EXTENSION, sourceId: SOURCE, contextId, worktreeId, properties: PROPS });
  await insights.observeListing(listing("p1", [["wt-main", "main"]]));
  assert.deepEqual([...insights.propertiesFor("p1").keys()], ["wt-main"]);
  insights.sourceStopped({ extensionId: EXTENSION, sourceId: SOURCE });
  assert.equal(insights.propertiesFor("p1").size, 0);
  insights.closeProject("p1");
  assert.ok(changes.some(([projectId, worktreeId]) => projectId === "p1" && worktreeId === "wt-x"));
});

test("closed projects are cancelled on the next listing", async () => {
  const open = new Set(["p1", "p2"]);
  const { insights, hosts } = service({ isProjectOpen: (projectId) => open.has(projectId) });
  await insights.observeListing(listing("p1"));
  open.delete("p1");
  await insights.observeListing(listing("p2", undefined, "repo-2"));
  await settle(); await settle();
  const latest = hosts.calls.contexts.at(-1).contexts;
  assert.equal(latest.length, 1);
  assert.equal(insights.signInFor("p1"), undefined);
});

test("a sign-in request prompts every project on that host once, and Yes stores the token in the vault", async () => {
  const { insights, hosts, vault } = service();
  await insights.observeListing(listing("p1"));
  await insights.observeListing(listing("p2", undefined, "repo-2"));
  insights.requestSignIn({ extensionId: EXTENSION, sourceId: SOURCE, request: { origin: ORIGIN, provider: "Forge", tokenPageUrl: `${ORIGIN}/user/settings/applications` } });
  insights.requestSignIn({ extensionId: EXTENSION, sourceId: SOURCE, request: { origin: ORIGIN, provider: "Forge" } });
  await settle();
  assert.equal(insights.signInFor("p1")?.origin, ORIGIN);
  assert.equal(insights.signInFor("p2")?.tokenPageUrl, `${ORIGIN}/user/settings/applications`);
  await assert.rejects(insights.respond("p1", ORIGIN, "accept", "has space"), /invalid/);
  await insights.respond("p1", ORIGIN, "accept", "tok123");
  assert.equal(vault.values.get(credentialId(EXTENSION, ORIGIN)), "tok123");
  assert.equal(insights.signInFor("p2"), undefined, "one answer clears the prompt everywhere");
  assert.deepEqual(hosts.calls.credentials, [{ sourceId: SOURCE, origin: ORIGIN }]);
  assert.equal(await insights.token({ extensionId: EXTENSION, sourceId: SOURCE, origin: ORIGIN }), "tok123");
  assert.equal(await insights.token({ extensionId: "other.ext", sourceId: "other.ext/x", origin: ORIGIN }), undefined, "another extension cannot resolve it");
  await insights.rejectToken({ extensionId: EXTENSION, sourceId: SOURCE, origin: ORIGIN });
  assert.equal(vault.values.size, 0);
  insights.requestSignIn({ extensionId: EXTENSION, sourceId: SOURCE, request: { origin: ORIGIN, provider: "Forge" } });
  await settle();
  assert.equal(insights.signInFor("p1")?.origin, ORIGIN, "a rejected token permits a new prompt");
});

test("maybe later suppresses the host for this server run only", async () => {
  const { insights } = service();
  await insights.observeListing(listing("p1"));
  insights.requestSignIn({ extensionId: EXTENSION, sourceId: SOURCE, request: { origin: ORIGIN, provider: "Forge" } });
  await settle();
  await insights.respond("p1", ORIGIN, "later");
  insights.requestSignIn({ extensionId: EXTENSION, sourceId: SOURCE, request: { origin: ORIGIN, provider: "Forge" } });
  await settle();
  assert.equal(insights.signInFor("p1"), undefined);
  const restarted = service();
  await restarted.insights.observeListing(listing("p1"));
  restarted.insights.requestSignIn({ extensionId: EXTENSION, sourceId: SOURCE, request: { origin: ORIGIN, provider: "Forge" } });
  await settle();
  assert.equal(restarted.insights.signInFor("p1")?.origin, ORIGIN);
});

test("don't ask again persists per extension until re-enabled", async () => {
  const { insights, saved } = service();
  await insights.observeListing(listing("p1"));
  insights.requestSignIn({ extensionId: EXTENSION, sourceId: SOURCE, request: { origin: ORIGIN, provider: "Forge" } });
  await settle();
  await insights.respond("p1", ORIGIN, "never");
  assert.deepEqual(saved.at(-1), [EXTENSION]);
  assert.deepEqual(await insights.suppressedExtensions(), [EXTENSION]);
  insights.requestSignIn({ extensionId: EXTENSION, sourceId: SOURCE, request: { origin: "https://other.example", provider: "Forge" } });
  await settle();
  assert.equal(insights.signInFor("p1"), undefined);
  const persisted = service({ suppressed: [EXTENSION] });
  await persisted.insights.observeListing(listing("p1"));
  persisted.insights.requestSignIn({ extensionId: EXTENSION, sourceId: SOURCE, request: { origin: ORIGIN, provider: "Forge" } });
  await settle();
  assert.equal(persisted.insights.signInFor("p1"), undefined, "the choice survives a restart");
  await persisted.insights.setPromptsSuppressed(EXTENSION, false);
  persisted.insights.requestSignIn({ extensionId: EXTENSION, sourceId: SOURCE, request: { origin: ORIGIN, provider: "Forge" } });
  await settle();
  assert.equal(persisted.insights.signInFor("p1")?.origin, ORIGIN);
});

test("prompt preferences round-trip through their file", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "terminay-insight-prefs-")), "prefs.json");
  const preferences = fileWorktreePromptPreferences(path);
  assert.deepEqual(await preferences.load(), []);
  await preferences.save(["com.terminay.gitea"]);
  assert.deepEqual(await preferences.load(), ["com.terminay.gitea"]);
  assert.match(await readFile(path, "utf8"), /suppressedExtensions/);
});

test("sources stop when their contribution disappears", async () => {
  const { hosts } = service();
  await settle();
  hosts.contributions = [];
  await hosts.changed();
  assert.deepEqual(hosts.calls.stopped, [SOURCE]);
});
