import assert from "node:assert/strict";
import test from "node:test";
import {
  EXTENSION_API_VERSION,
  forgeFixtureOrigin,
  forgeRemoteHost,
  validForgeIssueFixture,
  validForgeManifestFixture,
  validForgePullRequestFixture,
  validManifestFixture,
  validateExtensionManifest,
  validateForgeAccounts,
  validateForgeClaim,
  validateForgeDetail,
  validateForgePage,
  validateForgeQuery,
  validateForgeSummary,
  validateTerminalLauncherContribution,
} from "../dist/index.js";

const clone = (value) => structuredClone(value);
const query = {
  kind: "pullRequest",
  scope: "all",
  state: "open",
  origin: forgeFixtureOrigin,
  pageSize: 50,
};

test("the API version is 3.7.0", () => {
  assert.equal(EXTENSION_API_VERSION, "3.7.0");
});

test("a valid pull request and issue are accepted", () => {
  assert.equal(validateForgeSummary(validForgePullRequestFixture).ok, true);
  assert.equal(validateForgeSummary(validForgeIssueFixture).ok, true);
});

test("a canonical URL on another origin is refused", () => {
  const item = clone(validForgePullRequestFixture);
  item.url = "https://evil.example/acme/app/pulls/88";
  assert.equal(validateForgeSummary(item).ok, false);
});

test("a check hosted on another HTTPS origin is accepted", () => {
  const result = validateForgeSummary(validForgePullRequestFixture);
  assert.equal(result.ok, true);
  assert.equal(result.value.pullRequest.checks.items[1].url, "https://ci.example.org/build/7");
});

test("a check URL that is not HTTPS is refused", () => {
  const item = clone(validForgePullRequestFixture);
  item.pullRequest.checks.items[1].url = "http://ci.example.org/build/7";
  assert.equal(validateForgeSummary(item).ok, false);
});

test("a merged issue is refused", () => {
  const item = clone(validForgeIssueFixture);
  item.state = "merged";
  assert.equal(validateForgeSummary(item).ok, false);
});

test("checks counts that do not sum to the total are refused", () => {
  const item = clone(validForgePullRequestFixture);
  item.pullRequest.checks.total = 5;
  assert.equal(validateForgeSummary(item).ok, false);
});

test("credentials in a URL are refused", () => {
  const item = clone(validForgeIssueFixture);
  item.url = "https://user:pw@forge.example.net/acme/app/issues/541";
  assert.equal(validateForgeSummary(item).ok, false);
});

test("a page drops invalid and out-of-scope items and keeps the rest", () => {
  const foreign = clone(validForgePullRequestFixture);
  foreign.reference.name = "secret";
  foreign.url = `${forgeFixtureOrigin}/acme/secret/pulls/88`;
  const bad = clone(validForgePullRequestFixture);
  bad.url = "https://evil.example/x";
  const issue = clone(validForgeIssueFixture);
  const result = validateForgePage(
    { items: [validForgePullRequestFixture, foreign, bad, issue], nextCursor: "2" },
    { ...query, repositories: [{ owner: "ACME", name: "app" }] },
  );
  assert.equal(result.ok, true);
  assert.equal(result.value.page.items.length, 1);
  assert.equal(result.value.dropped, 3);
  assert.equal(result.value.page.nextCursor, "2");
});

test("an item from another origin than the query is dropped", () => {
  const result = validateForgePage(
    { items: [validForgePullRequestFixture] },
    { ...query, origin: "https://other.example" },
  );
  assert.equal(result.value.page.items.length, 0);
});

test("a short page with a cursor is valid", () => {
  const result = validateForgePage({ items: [], nextCursor: "c" }, query);
  assert.equal(result.ok, true);
});

test("a detail for a different item is refused", () => {
  const detail = { summary: validForgeIssueFixture, body: "text", comments: [] };
  assert.equal(validateForgeDetail(detail, validForgeIssueFixture.reference).ok, true);
  assert.equal(
    validateForgeDetail(detail, { ...validForgeIssueFixture.reference, number: 12 }).ok,
    false,
  );
});

test("queries are bounded and never carry empty lists", () => {
  assert.equal(validateForgeQuery(query).ok, true);
  assert.equal(validateForgeQuery({ ...query, repositories: [] }).ok, false);
  assert.equal(validateForgeQuery({ ...query, owners: [] }).ok, false);
  assert.equal(validateForgeQuery({ ...query, pageSize: 51 }).ok, false);
  assert.equal(validateForgeQuery({ ...query, scope: "assigned" }).ok, false);
  assert.equal(validateForgeQuery({ ...query, kind: "issue", state: "merged" }).ok, false);
  assert.equal(validateForgeQuery({ ...query, text: "x".repeat(257) }).ok, false);
});

test("two accounts for one origin refuse the list", () => {
  const account = {
    origin: forgeFixtureOrigin,
    login: "octo",
    credentialSource: "cli-config",
    state: "ready",
    owners: ["octo", "acme"],
  };
  assert.equal(validateForgeAccounts([account]).ok, true);
  assert.equal(validateForgeAccounts([account, { ...account, login: "other" }]).ok, false);
  assert.equal(validateForgeAccounts([{ ...account, origin: "http://x.example" }]).ok, false);
});

test("a claim must be on the remote's host", () => {
  const remote = { name: "origin", url: "ssh://git@forge.example.net:4222/acme/app.git" };
  const claim = { origin: forgeFixtureOrigin, owner: "acme", name: "app" };
  assert.equal(validateForgeClaim(claim, remote).ok, true);
  assert.equal(validateForgeClaim(null, remote).value, null);
  assert.equal(
    validateForgeClaim({ ...claim, origin: "https://evil.example" }, remote).ok,
    false,
  );
  assert.equal(forgeRemoteHost("git@github.com:o/r.git"), "github.com");
  assert.equal(forgeRemoteHost("https://GitHub.com/o/r"), "github.com");
});

test("a forge-source-only package passes manifest validation", () => {
  assert.equal(validateExtensionManifest(validForgeManifestFixture).ok, true);
});

test("a forge source without the permission is refused", () => {
  const manifest = { ...validForgeManifestFixture, permissions: ["network"] };
  const result = validateExtensionManifest(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "missing_permission"));
});

test("a forge source with an unknown allReach or kind is refused", () => {
  const source = validForgeManifestFixture.contributes.forgeSources[0];
  for (const changed of [{ ...source, allReach: "everything" }, { ...source, kinds: ["mergeRequest"] }]) {
    const manifest = { ...validForgeManifestFixture, contributes: { forgeSources: [changed] } };
    assert.equal(validateExtensionManifest(manifest).ok, false);
  }
});

test("a launcher may declare initialPrompt positional and nothing else", () => {
  const id = validManifestFixture.id;
  const launcher = { id: `${id}/launch`, displayName: "Echo", icon: "terminal" };
  assert.equal(validateTerminalLauncherContribution({ ...launcher, initialPrompt: "positional" }, id).ok, true);
  assert.equal(validateTerminalLauncherContribution({ ...launcher, initialPrompt: "stdin" }, id).ok, false);
  assert.equal(validateTerminalLauncherContribution({ ...launcher, initialPrompt: true }, id).ok, false);
});
