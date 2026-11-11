import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExtensionHost } from "../dist/index.js";

const SOURCE_ID = "example.forge/forge";
const ORIGIN = "https://forge.example.net";

const PULL = {
  reference: { kind: "pullRequest", origin: ORIGIN, owner: "acme", name: "app", number: 88 },
  title: "Add events",
  url: `${ORIGIN}/acme/app/pulls/88`,
  state: "open",
  author: "octo",
  labels: [],
  comments: 0,
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-10T10:00:00Z",
  pullRequest: { headBranch: "feat", baseBranch: "main", headOwner: "acme", headName: "app" },
};

async function fixture(body, { permissions = ["forge-source"], register = SOURCE_ID } = {}) {
  const root = await mkdtemp(join(tmpdir(), "terminay-forge-"));
  await writeFile(
    join(root, "extension.js"),
    `const PULL = ${JSON.stringify(PULL)};
export function activate(context) {
  globalThis.forges = context.forges;
  globalThis.registration = context.forges.registerSource("${register}", {
    ${body}
  });
}`,
    { mode: 0o600 },
  );
  for (const name of ["config", "data", "cache"]) await mkdir(join(root, name));
  return {
    extensionId: "example.forge",
    packageRoot: root,
    entrypoint: "extension.js",
    configDirectory: join(root, "config"),
    dataDirectory: join(root, "data"),
    cacheDirectory: join(root, "cache"),
    permissions,
    forgeSources: [
      { id: SOURCE_ID, displayName: "Forge", kinds: ["pullRequest", "issue"], allReach: "readable" },
    ],
  };
}

const answering = `
    async accounts() { return [{ origin: "${ORIGIN}", login: "octo", credentialSource: "sign-in", state: "ready", owners: ["octo"] }]; },
    async claim(remote) { return remote.url.includes("forge.example.net") ? { origin: "${ORIGIN}", owner: "acme", name: "app" } : null; },
    async query(query) {
      const foreign = { ...PULL, reference: { ...PULL.reference, name: "secret" }, url: "${ORIGIN}/acme/secret/pulls/1" };
      return { items: [PULL, foreign], nextCursor: "2" };
    },
    async detail(reference) { return { summary: { ...PULL, reference: { ...PULL.reference, number: reference.number } }, body: "b", comments: [] }; },`;

const query = { kind: "pullRequest", scope: "all", state: "open", origin: ORIGIN, pageSize: 50, repositories: [{ owner: "acme", name: "app" }] };

test("a declared forge source registers and answers each call, validated", async (t) => {
  const host = new ExtensionHost("example.forge", { broker: { async request() {} } });
  t.after(() => host.stop());
  await host.start(await fixture(answering));
  assert.deepEqual(host.status().forgeSources.map((source) => source.id), [SOURCE_ID]);
  const accounts = await host.forgeSourceAccounts(SOURCE_ID);
  assert.equal(accounts[0].login, "octo");
  assert.deepEqual(
    await host.claimForgeRemote(SOURCE_ID, { name: "origin", url: "git@forge.example.net:acme/app.git" }),
    { origin: ORIGIN, owner: "acme", name: "app" },
  );
  assert.equal(await host.claimForgeRemote(SOURCE_ID, { name: "origin", url: "git@github.com:a/b.git" }), null);
  const page = await host.queryForgeSource(SOURCE_ID, query);
  assert.equal(page.page.items.length, 1, "the item outside the query is dropped");
  assert.equal(page.page.nextCursor, "2");
  const detail = await host.forgeSourceDetail(SOURCE_ID, PULL.reference);
  assert.equal(detail.summary.reference.number, 88);
});

test("a detail for another item is refused", async (t) => {
  const host = new ExtensionHost("example.forge", { broker: { async request() {} } });
  t.after(() => host.stop());
  await host.start(
    await fixture(answering.replace("number: reference.number", "number: reference.number + 1")),
  );
  await assert.rejects(host.forgeSourceDetail(SOURCE_ID, PULL.reference), /different item/);
});

test("a claim for another host is refused", async (t) => {
  const host = new ExtensionHost("example.forge", { broker: { async request() {} } });
  t.after(() => host.stop());
  await host.start(await fixture(answering.replace('remote.url.includes("forge.example.net")', "true")));
  await assert.rejects(
    host.claimForgeRemote(SOURCE_ID, { name: "origin", url: "git@github.com:a/b.git" }),
    /another host/,
  );
});

test("a query that never answers times out", async (t) => {
  const host = new ExtensionHost("example.forge", {
    broker: { async request() {} },
    limits: { invocationTimeoutMs: 200 },
  });
  t.after(() => host.stop());
  await host.start(await fixture(answering.replace("async query(query) {", "async query(query) { await new Promise(() => {});")));
  const started = Date.now();
  await assert.rejects(host.queryForgeSource(SOURCE_ID, query), /timed out/);
  assert.ok(Date.now() - started < 5_000);
});

test("a source registered without forge-source is refused", async () => {
  const host = new ExtensionHost("example.forge", { broker: { async request() {} } });
  await assert.rejects(host.start(await fixture(answering, { permissions: [] })), /invalid forge source registrations/);
});

test("an undeclared source cannot register", async () => {
  const host = new ExtensionHost("example.forge", { broker: { async request() {} } });
  await assert.rejects(host.start(await fixture(answering, { register: "example.forge/other" })));
});

test("an invalidation hint reaches the broker and a stopped host has no sources", async (t) => {
  const events = [];
  const host = new ExtensionHost("example.forge", {
    broker: { async request() {} },
    forges: {
      invalidate: (event) => events.push(event),
      sourceStopped: (event) => events.push({ stopped: event.sourceId }),
    },
  });
  await host.start(
    await fixture(answering.replace("async accounts() {", `async accounts() { globalThis.registration.invalidate("${ORIGIN}"); globalThis.registration.invalidate("http://bad");`)),
  );
  await host.forgeSourceAccounts(SOURCE_ID);
  for (let i = 0; i < 50 && events.length === 0; i += 1) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(events, [{ extensionId: "example.forge", sourceId: SOURCE_ID, origin: ORIGIN }]);
  await host.stop();
  await assert.rejects(host.forgeSourceAccounts(SOURCE_ID));
  t.diagnostic("stopped host refuses forge calls");
});

test("a forge source may only resolve its own extension's tokens", async (t) => {
  const asked = [];
  const host = new ExtensionHost("example.forge", {
    broker: { async request() {} },
    worktrees: {
      publish() {},
      requestSignIn() {},
      async token(request) {
        asked.push(request);
        return request.extensionId === "example.forge" ? "own-token" : undefined;
      },
      async rejectToken() {},
    },
  });
  t.after(() => host.stop());
  await host.start(
    await fixture(
      answering.replace(
        "async accounts() {",
        `async accounts() { const token = await globalThis.forges.credentials.token("${ORIGIN}"); if (token !== "own-token") throw new Error("no token");`,
      ),
    ),
  );
  await host.forgeSourceAccounts(SOURCE_ID);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].extensionId, "example.forge");
  assert.equal(asked[0].origin, ORIGIN);
});
