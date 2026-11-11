import test from "node:test";
import assert from "node:assert/strict";
import { ForgeService, ServerForgeAdapter, memoryForgeSettings } from "../dist/index.js";

const GITEA = "https://git.example.net";
const GITHUB = "https://github.com";

function summary(origin, owner, name, number, updatedAt, extra = {}) {
  return {
    reference: { kind: "pullRequest", origin, owner, name, number },
    title: `PR ${number}`,
    url: `${origin}/${owner}/${name}/pulls/${number}`,
    state: "open",
    author: "octo",
    labels: [],
    comments: 0,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt,
    pullRequest: { headBranch: `b${number}`, baseBranch: "main", headOwner: owner, headName: name },
    ...extra,
  };
}

/** A fake manager: two sources, scripted pages, call log. */
function fakeHosts({ pages = {}, accounts, fail = new Set(), details = {} } = {}) {
  const calls = [];
  const contributionListeners = new Set();
  const eventListeners = new Set();
  let entries = [
    { extensionId: "gitea", contribution: { id: "gitea/forge", displayName: "Gitea", kinds: ["pullRequest", "issue"], allReach: "readable" } },
    { extensionId: "github", contribution: { id: "github/forge", displayName: "GitHub", kinds: ["pullRequest", "issue"], allReach: "owners" } },
  ];
  const accountList = accounts ?? {
    "gitea/forge": [{ origin: GITEA, login: "me", credentialSource: "cli-config", state: "ready", owners: ["me", "acme"] }],
    "github/forge": [{ origin: GITHUB, login: "me", credentialSource: "cli", state: "ready", owners: ["me"] }],
  };
  const hosts = {
    calls,
    forgeSourceContributions: () => entries,
    setEntries(next) {
      entries = next;
      for (const listener of contributionListeners) listener();
    },
    emit(event) {
      for (const listener of eventListeners) listener(event);
    },
    async forgeSourceAccounts(sourceId) {
      calls.push(["accounts", sourceId]);
      return accountList[sourceId] ?? [];
    },
    async claimForgeRemote(sourceId, remote) {
      calls.push(["claim", sourceId, remote.url]);
      if (sourceId === "gitea/forge" && remote.url.includes("git.example.net")) {
        if (remote.url.includes("terminay-probe")) return { origin: GITEA, owner: "terminay-probe", name: "terminay-probe" };
        const [, owner, name] = /[:/]([^/:]+)\/([^/]+?)(\.git)?$/.exec(remote.url);
        return { origin: GITEA, owner, name };
      }
      if (sourceId === "github/forge" && remote.url.includes("github.com")) {
        const [, owner, name] = /[:/]([^/:]+)\/([^/]+?)(\.git)?$/.exec(remote.url);
        return { origin: GITHUB, owner, name };
      }
      return null;
    },
    async queryForgeSource(sourceId, query) {
      calls.push(["query", sourceId, query]);
      if (fail.has(sourceId)) throw new Error(`${sourceId} timed out`);
      const script = pages[sourceId] ?? [];
      const index = query.cursor === undefined ? 0 : Number(query.cursor);
      const page = script[index] ?? { items: [] };
      return {
        page: {
          items: page.items,
          ...(index + 1 < script.length ? { nextCursor: String(index + 1) } : {}),
          ...(page.totalCount === undefined ? {} : { totalCount: page.totalCount }),
        },
        dropped: 0,
      };
    },
    async forgeSourceDetail(sourceId, reference) {
      calls.push(["detail", sourceId, reference.number]);
      return details[reference.number] ?? { summary: summary(reference.origin, reference.owner, reference.name, reference.number, "2026-11-10T00:00:00Z"), body: "body", comments: [] };
    },
    onContributionsChanged(listener) {
      contributionListeners.add(listener);
      return () => contributionListeners.delete(listener);
    },
    onForgeSourceEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
  };
  return hosts;
}

function fakeProjects(list = []) {
  const listeners = new Set();
  return {
    list,
    repositoryContexts: () => list,
    onContextsChanged(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const project = (projectId, remotes, worktrees = []) => ({
  projectId,
  context: { id: `ctx-${projectId}`, repositoryRoot: `/src/${projectId}`, remotes, worktrees },
});

const unbound = { scope: "read" };
const home = (extra = {}) => ({ kind: "pullRequest", scope: "reviewRequested", state: "open", purpose: "home", ...extra });

test("two clients asking the same question within 60 s ask each source once per account", async () => {
  const hosts = fakeHosts({ pages: { "gitea/forge": [{ items: [summary(GITEA, "acme", "app", 1, "2026-11-10T00:00:00Z")] }] } });
  const service = new ForgeService({ hosts, projects: fakeProjects() });
  await service.list(unbound, home());
  await service.list({ scope: "write" }, home());
  assert.equal(hosts.calls.filter(([kind]) => kind === "query").length, 2, "one per source");
});

test("an explicit refresh asks every source again", async () => {
  const hosts = fakeHosts();
  const service = new ForgeService({ hosts, projects: fakeProjects() });
  await service.list(unbound, home());
  await service.list(unbound, home({ fresh: true }));
  assert.equal(hosts.calls.filter(([kind]) => kind === "query").length, 4);
});

test("one source failing keeps the other's items and names the failure", async () => {
  const hosts = fakeHosts({
    pages: { "gitea/forge": [{ items: [summary(GITEA, "acme", "app", 1, "2026-11-10T00:00:00Z")] }] },
    fail: new Set(["github/forge"]),
  });
  const service = new ForgeService({ hosts, projects: fakeProjects() });
  const result = await service.list(unbound, home());
  assert.equal(result.items.length, 1);
  const github = result.sources.find((source) => source.sourceId === "github/forge");
  assert.equal(github.state, "failed");
  assert.match(github.error, /timed out/);
});

test("merging two sources holds an older item back until the newer source shows nothing newer remains", async () => {
  const hosts = fakeHosts({
    pages: {
      "github/forge": [
        { items: [summary(GITHUB, "me", "x", 1, "2026-11-10T10:00:00Z")] },
        { items: [summary(GITHUB, "me", "x", 2, "2026-11-10T08:00:00Z")] },
      ],
      "gitea/forge": [{ items: [summary(GITEA, "acme", "app", 3, "2026-11-10T09:00:00Z")] }],
    },
  });
  const service = new ForgeService({ hosts, projects: fakeProjects() });
  const first = await service.list(unbound, home({ pageSize: 1 }));
  assert.deepEqual(first.items.map((item) => item.item.reference.number), [1]);
  assert.ok(first.nextCursor);
  const second = await service.list(unbound, home({ pageSize: 1, cursor: first.nextCursor }));
  assert.deepEqual(second.items.map((item) => item.item.reference.number), [3]);
  const third = await service.list(unbound, home({ pageSize: 1, cursor: second.nextCursor }));
  assert.deepEqual(third.items.map((item) => item.item.reference.number), [2]);
  assert.equal(third.nextCursor, undefined);
});

test("a short page with a cursor is followed, and source cursors never reach the client", async () => {
  const hosts = fakeHosts({
    pages: {
      "gitea/forge": [{ items: [] }, { items: [summary(GITEA, "acme", "app", 5, "2026-11-10T00:00:00Z")] }],
    },
    accounts: { "gitea/forge": [{ origin: GITEA, login: "me", credentialSource: "cli-config", state: "ready", owners: ["me"] }] },
  });
  const service = new ForgeService({ hosts, projects: fakeProjects() });
  const result = await service.list(unbound, home());
  assert.equal(result.items.length, 1);
  assert.equal(result.nextCursor, undefined);
});

test("Repos of open projects with none open sends no query (fail closed)", async () => {
  const hosts = fakeHosts();
  const settings = memoryForgeSettings({ gitea: { repositories: "openProjects", owners: [], pullRequestsOnHome: true, issuesOnHome: true, projectTabs: true } });
  const service = new ForgeService({ hosts, projects: fakeProjects(), settings });
  await service.list(unbound, home());
  assert.ok(!hosts.calls.some(([kind, sourceId]) => kind === "query" && sourceId === "gitea/forge"));
});

test("Chosen owners with none switched on sends no query", async () => {
  const hosts = fakeHosts();
  const settings = memoryForgeSettings({ gitea: { repositories: "owners", owners: [], pullRequestsOnHome: true, issuesOnHome: true, projectTabs: true } });
  const service = new ForgeService({ hosts, projects: fakeProjects(), settings });
  await service.list(unbound, home());
  assert.ok(!hosts.calls.some(([kind, sourceId]) => kind === "query" && sourceId === "gitea/forge"));
});

test("Repos of open projects narrows to claimed repositories", async () => {
  const hosts = fakeHosts();
  const settings = memoryForgeSettings({ github: { repositories: "openProjects", owners: [], pullRequestsOnHome: true, issuesOnHome: true, projectTabs: true } });
  const projects = fakeProjects([project("p1", [{ name: "origin", url: "git@github.com:owner/app.git" }])]);
  const service = new ForgeService({ hosts, projects, settings });
  await service.list(unbound, home());
  const query = hosts.calls.find(([kind, sourceId]) => kind === "query" && sourceId === "github/forge")[2];
  assert.deepEqual(query.repositories, [{ owner: "owner", name: "app" }]);
});

test("an intersection that leaves nothing sends nothing", async () => {
  const hosts = fakeHosts();
  const projects = fakeProjects([project("p1", [{ name: "origin", url: "git@github.com:owner/app.git" }])]);
  const service = new ForgeService({ hosts, projects });
  await service.list(unbound, {
    kind: "pullRequest", scope: "all", state: "open", purpose: "project", projectId: "p1",
    repositories: [{ origin: GITHUB, owner: "other", name: "thing" }],
  });
  assert.ok(!hosts.calls.some(([kind]) => kind === "query"));
});

test("Issues on Home switched off sends no issue queries to that source", async () => {
  const hosts = fakeHosts();
  const settings = memoryForgeSettings({ gitea: { repositories: "all", owners: [], pullRequestsOnHome: true, issuesOnHome: false, projectTabs: true } });
  const service = new ForgeService({ hosts, projects: fakeProjects(), settings });
  await service.list(unbound, { kind: "issue", scope: "assigned", state: "open", purpose: "home" });
  assert.ok(!hosts.calls.some(([kind, sourceId]) => kind === "query" && sourceId === "gitea/forge"));
});

test("a project-bound client is narrowed to its project and refused Home and other repositories", async () => {
  const hosts = fakeHosts();
  const projects = fakeProjects([
    project("A", [{ name: "origin", url: "ssh://git@git.example.net:4222/acme/app.git" }]),
  ]);
  const service = new ForgeService({ hosts, projects });
  const bound = { scope: "read", projectId: "A" };
  await assert.rejects(service.list(bound, home()), /unbound/);
  await assert.rejects(service.accounts(bound), /unbound/);
  await service.list(bound, { kind: "pullRequest", scope: "all", state: "open", purpose: "project", projectId: "A" });
  const query = hosts.calls.find(([kind]) => kind === "query")[2];
  assert.deepEqual(query.repositories, [{ owner: "acme", name: "app" }]);
  await assert.rejects(
    service.list(bound, { kind: "issue", scope: "all", state: "open", purpose: "project", projectId: "B" }),
    /outside/,
  );
  await assert.rejects(
    service.detail(bound, "gitea/forge", { kind: "issue", origin: GITEA, owner: "acme", name: "secret", number: 1 }),
    /outside/,
  );
});

test("a cached detail of another repository is not returned to a project-bound client", async () => {
  const hosts = fakeHosts();
  const projects = fakeProjects([project("A", [{ name: "origin", url: "git@git.example.net:acme/app.git" }])]);
  const service = new ForgeService({ hosts, projects });
  const reference = { kind: "issue", origin: GITEA, owner: "acme", name: "secret", number: 7 };
  await service.detail(unbound, "gitea/forge", reference);
  await assert.rejects(service.detail({ scope: "read", projectId: "A" }, "gitea/forge", reference), /outside/);
  assert.equal(hosts.calls.filter(([kind]) => kind === "detail").length, 1);
});

test("disabling an extension clears its items and discards an in-flight result", async () => {
  let release;
  const hosts = fakeHosts({ pages: { "gitea/forge": [{ items: [summary(GITEA, "acme", "app", 1, "2026-11-10T00:00:00Z")] }] } });
  const original = hosts.queryForgeSource;
  hosts.queryForgeSource = async (sourceId, query) => {
    if (sourceId === "gitea/forge") await new Promise((resolve) => { release = resolve; });
    return original(sourceId, query);
  };
  const service = new ForgeService({ hosts, projects: fakeProjects() });
  const pending = service.list(unbound, home());
  await new Promise((resolve) => setTimeout(resolve, 10));
  hosts.setEntries(hosts.forgeSourceContributions().filter((entry) => entry.extensionId !== "gitea"));
  release();
  const result = await pending;
  assert.equal(result.items.length, 0);
  const after = await service.list(unbound, home());
  assert.ok(after.sources.every((source) => source.sourceId !== "gitea/forge"));
});

test("an invalidation hint drops cached pages for that origin and announces a change", async () => {
  const changes = [];
  const hosts = fakeHosts();
  const service = new ForgeService({ hosts, projects: fakeProjects(), onChanged: (change) => changes.push(change) });
  await service.list(unbound, home());
  hosts.emit({ kind: "invalidate", extensionId: "gitea", sourceId: "gitea/forge", origin: GITEA });
  await service.list(unbound, home());
  assert.equal(hosts.calls.filter(([kind, sourceId]) => kind === "query" && sourceId === "gitea/forge").length, 2);
  assert.deepEqual(changes, [{ reason: "invalidate", origin: GITEA }]);
});

test("the join matches the head branch or an upstream, and never a fork", async () => {
  const pages = {
    "gitea/forge": [{
      items: [
        summary(GITEA, "acme", "app", 88, "2026-11-10T03:00:00Z", { pullRequest: { headBranch: "change/13-events", baseBranch: "main", headOwner: "acme", headName: "app" } }),
        summary(GITEA, "acme", "app", 89, "2026-11-10T02:00:00Z", { pullRequest: { headBranch: "main", baseBranch: "main", headOwner: "forker", headName: "app" } }),
        summary(GITEA, "acme", "app", 90, "2026-11-10T01:00:00Z", { pullRequest: { headBranch: "feat", baseBranch: "main", headOwner: "acme", headName: "app" } }),
      ],
    }],
  };
  const hosts = fakeHosts({ pages });
  const remotes = [{ name: "origin", url: "git@git.example.net:ACME/App.git" }];
  const projects = fakeProjects([
    project("Forum", remotes, [
      { id: "w1", path: "/a", branch: "review-88", upstream: { remote: "origin", branch: "change/13-events" }, head: null },
      { id: "w2", path: "/b", branch: "main", upstream: { remote: "origin", branch: "main" }, head: null },
    ]),
    project("Forum2", remotes, [{ id: "w3", path: "/c", branch: "feat", upstream: null, head: null }]),
    project("Other", [{ name: "origin", url: "git@git.example.net:acme/other.git" }], [
      { id: "w4", path: "/d", branch: "feat", upstream: null, head: null },
    ]),
  ]);
  const service = new ForgeService({ hosts, projects });
  const result = await service.list(unbound, home({ scope: "all" }));
  const byNumber = Object.fromEntries(result.items.map((item) => [item.item.reference.number, item.worktrees.map(({ projectId, worktreeId, branch }) => ({ projectId, worktreeId, branch }))]));
  assert.equal(result.items.find((item) => item.item.reference.number === 88).worktrees[0].path, "/a");
  assert.deepEqual(byNumber[88], [{ projectId: "Forum", worktreeId: "w1", branch: "review-88" }]);
  assert.deepEqual(byNumber[89], [], "a fork's main never matches a local main");
  assert.deepEqual(byNumber[90], [{ projectId: "Forum2", worktreeId: "w3", branch: "feat" }]);
});

test("one pull request can match two worktrees, including the same repository open twice", async () => {
  const pages = {
    "gitea/forge": [{
      items: [summary(GITEA, "acme", "app", 7, "2026-11-10T03:00:00Z", { pullRequest: { headBranch: "fix", baseBranch: "main", headOwner: "acme", headName: "app" } })],
    }],
  };
  const remotes = [{ name: "origin", url: "git@git.example.net:acme/app.git" }];
  const projects = fakeProjects([
    project("One", remotes, [{ id: "a", path: "/a", branch: "fix", upstream: null, head: null }]),
    project("Two", remotes, [{ id: "b", path: "/b", branch: "local-fix", upstream: { remote: "origin", branch: "fix" }, head: null }]),
  ]);
  const service = new ForgeService({ hosts: fakeHosts({ pages }), projects });
  const result = await service.list(unbound, home({ scope: "all" }));
  assert.deepEqual(result.items[0].worktrees.map((match) => match.projectId).sort(), ["One", "Two"]);
});

test("badge counts use page size 1 and the forge's total count", async () => {
  const hosts = fakeHosts({
    pages: {
      "gitea/forge": [{ items: [summary(GITEA, "acme", "app", 1, "2026-11-10T00:00:00Z")], totalCount: 2 }, { items: [] }],
      "github/forge": [{ items: [], totalCount: 0 }],
    },
  });
  const service = new ForgeService({ hosts, projects: fakeProjects() });
  const counts = await service.counts(unbound);
  assert.equal(counts.pullRequests, 2);
  assert.ok(hosts.calls.filter(([kind]) => kind === "query").every(([, , query]) => query.pageSize === 1));
});

test("settings need admin scope, round-trip, and default on", async () => {
  const settings = memoryForgeSettings();
  const service = new ForgeService({ hosts: fakeHosts(), projects: fakeProjects(), settings });
  const sources = await service.sources(unbound);
  assert.deepEqual(sources[0].settings, { repositories: "all", owners: [], pullRequestsOnHome: true, issuesOnHome: true, projectTabs: true });
  await assert.rejects(service.setSettings({ scope: "write" }, "gitea", {}), /admin/);
  await service.setSettings({ scope: "admin" }, "gitea", { repositories: "owners", owners: ["acme"], pullRequestsOnHome: true, issuesOnHome: false, projectTabs: true });
  assert.equal(settings.saved.gitea.issuesOnHome, false);
  const reloaded = new ForgeService({ hosts: fakeHosts(), projects: fakeProjects(), settings });
  assert.deepEqual((await reloaded.settingsFor("gitea")).owners, ["acme"]);
  await assert.rejects(service.setSettings({ scope: "admin" }, "gitea", { repositories: "everything" }), /invalid/);
});

test("adding an account checks the claim first and stores the token in the vault", async () => {
  const stored = [];
  const credentials = {
    hasToken: () => false,
    async storeToken(extensionId, origin) { stored.push([extensionId, origin]); },
    async removeToken() {},
  };
  const service = new ForgeService({ hosts: fakeHosts(), projects: fakeProjects(), credentials });
  await assert.rejects(service.addAccount({ scope: "admin" }, "gitea", "https://example.com", "t"), /not a Gitea server/);
  assert.equal(stored.length, 0);
  await service.addAccount({ scope: "admin" }, "gitea", GITEA, "t");
  assert.deepEqual(stored, [["gitea", GITEA]]);
  await assert.rejects(service.removeAccount({ scope: "admin" }, "gitea", GITEA), /cannot be removed/);
});

test("the adapter narrows by request context and never returns a token", async () => {
  const hosts = fakeHosts();
  const projects = fakeProjects([project("A", [{ name: "origin", url: "git@git.example.net:acme/app.git" }])]);
  const adapter = new ServerForgeAdapter(new ForgeService({ hosts, projects }));
  const operations = adapter.operations();
  const request = (payload, claims) => ({ envelope: { payload }, body: new Uint8Array(), context: { authScope: "read", clientId: "c", ...(claims ? { claims } : {}) } });
  const accounts = await operations.queries["forge.accounts"](request({}));
  assert.ok(!JSON.stringify(accounts).toLowerCase().includes("token"));
  await assert.rejects(
    operations.queries["forge.query"](request(home(), { projectId: "A" })),
    /unbound/,
  );
  const claims = await operations.queries["forge.claims"](request({ projectId: "A" }, { projectId: "A" }));
  assert.equal(claims.claims[0].owner, "acme");
});
