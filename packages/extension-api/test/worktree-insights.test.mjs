import assert from "node:assert/strict";
import test from "node:test";
import {
  EXTENSION_LIMITS,
  isHttpsOrigin,
  isSafeHttpsUrl,
  validManifestFixture,
  validateExtensionManifest,
  validateWorktreeInsightSourceContribution,
  validateWorktreeProperties,
  validateWorktreeSignInRequest,
} from "../dist/index.js";

const insightManifest = Object.freeze({
  ...validManifestFixture,
  permissions: ["network", "worktree-observation"],
  contributes: {
    worktreeInsights: [{ id: `${validManifestFixture.id}/forge`, displayName: "Forge" }],
  },
});

const properties = Object.freeze({
  pullRequest: {
    number: 285,
    title: "feat: about window",
    url: "https://git.example.net/owner/repo/pulls/285",
    state: "open",
    mergeable: true,
  },
  checks: {
    passed: 12,
    failed: 2,
    pending: 2,
    skipped: 0,
    total: 16,
    items: [
      { name: "CI / Build", state: "failed", url: "https://git.example.net/owner/repo/actions/runs/1/jobs/0" },
      { name: "CI / Lint", state: "passed" },
    ],
  },
});

test("a worktree-insight-only package passes contribution validation", () => {
  assert.equal(validateExtensionManifest(insightManifest).ok, true);
});

test("worktree insight sources require worktree-observation", () => {
  const result = validateExtensionManifest({ ...insightManifest, permissions: ["network"] });
  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some(
      (issue) => issue.code === "missing_permission" && /worktree-observation/.test(issue.message),
    ),
  );
});

test("worktree insight declarations are namespaced and closed", () => {
  const extensionId = validManifestFixture.id;
  assert.equal(validateWorktreeInsightSourceContribution({ id: `${extensionId}/forge`, displayName: "Forge" }, extensionId).ok, true);
  assert.equal(validateWorktreeInsightSourceContribution({ id: "other.ext/forge", displayName: "Forge" }, extensionId).ok, false);
  assert.equal(validateWorktreeInsightSourceContribution({ id: `${extensionId}/forge`, displayName: "Forge", render: "<b>" }, extensionId).ok, false);
});

test("valid worktree properties are accepted and copied", () => {
  const result = validateWorktreeProperties(properties);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, properties);
  assert.notEqual(result.value, properties);
});

test("worktree properties reject URLs with credentials or non-HTTPS schemes", () => {
  for (const url of [
    "http://git.example.net/owner/repo/pulls/1",
    "https://user:secret@git.example.net/owner/repo/pulls/1",
    "javascript:alert(1)",
    "file:///etc/passwd",
  ]) {
    const result = validateWorktreeProperties({ pullRequest: { ...properties.pullRequest, url } });
    assert.equal(result.ok, false, url);
  }
});

test("worktree checks must sum to their total", () => {
  const result = validateWorktreeProperties({ checks: { ...properties.checks, total: 17 } });
  assert.equal(result.ok, false);
  assert.match(result.reason, /sum/);
});

test("worktree checks bound their items and reject unknown fields", () => {
  const items = Array.from({ length: EXTENSION_LIMITS.worktreeCheckItems + 1 }, (_, index) => ({
    name: `check ${index}`,
    state: "passed",
  }));
  const tooMany = validateWorktreeProperties({
    checks: { passed: items.length, failed: 0, pending: 0, skipped: 0, total: items.length, items },
  });
  assert.equal(tooMany.ok, false);
  assert.equal(validateWorktreeProperties({ ...properties, badge: "hi" }).ok, false);
  assert.equal(validateWorktreeProperties({ pullRequest: { ...properties.pullRequest, state: "weird" } }).ok, false);
});

test("sign-in requests name an HTTPS origin and optional token page", () => {
  assert.equal(
    validateWorktreeSignInRequest({
      origin: "https://git.example.net",
      provider: "Gitea",
      tokenPageUrl: "https://git.example.net/user/settings/applications",
    }).ok,
    true,
  );
  assert.equal(validateWorktreeSignInRequest({ origin: "https://git.example.net/path", provider: "Gitea" }).ok, false);
  assert.equal(validateWorktreeSignInRequest({ origin: "http://git.example.net", provider: "Gitea" }).ok, false);
});

test("HTTPS helpers accept only credential-free HTTPS", () => {
  assert.equal(isSafeHttpsUrl("https://example.net/a?b=c"), true);
  assert.equal(isSafeHttpsUrl("https://a:b@example.net/"), false);
  assert.equal(isHttpsOrigin("https://example.net"), true);
  assert.equal(isHttpsOrigin("https://example.net/"), false);
});

test("the SDK exports the worktree insight authoring surface", async () => {
  const sdk = await import("../dist/index.js");
  assert.equal(typeof sdk.defineWorktreeInsightSource, "function");
  const runtime = { start() {} };
  assert.equal(sdk.defineWorktreeInsightSource(runtime), runtime);
});
