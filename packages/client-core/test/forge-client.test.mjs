import assert from "node:assert/strict";
import test from "node:test";
import { ForgeSupersededError, TerminayForgeClient } from "../dist/index.js";

function transport() {
  const calls = [];
  const pending = [];
  return {
    calls,
    pending,
    async query(operation, payload) {
      calls.push(["query", operation, payload]);
      if (operation === "forge.query") return new Promise((resolve) => pending.push(resolve));
      return {};
    },
    async command(operation, payload) {
      calls.push(["command", operation, payload]);
      return { ok: true };
    },
  };
}

test("the forge UI is hidden when the server does not advertise forge.v1", () => {
  assert.equal(new TerminayForgeClient(transport(), { serverCapabilities: ["git.v1"] }).available, false);
  assert.equal(new TerminayForgeClient(transport()).available, false);
  assert.equal(new TerminayForgeClient(transport(), { serverCapabilities: ["forge.v1"] }).available, true);
});

test("a late response to a replaced scope is ignored", async () => {
  const fake = transport();
  const client = new TerminayForgeClient(fake, { serverCapabilities: ["forge.v1"] });
  const request = { kind: "pullRequest", state: "open", purpose: "home" };
  const first = client.list({ ...request, scope: "reviewRequested" }, "home-prs");
  const second = client.list({ ...request, scope: "authored" }, "home-prs");
  await new Promise((resolve) => setImmediate(resolve));
  fake.pending[1]({ items: [], sources: [] });
  fake.pending[0]({ items: [{ stale: true }], sources: [] });
  await assert.rejects(first, ForgeSupersededError);
  assert.deepEqual((await second).items, []);
});

test("operations go to the forge protocol names", async () => {
  const fake = transport();
  const client = new TerminayForgeClient(fake);
  await client.claims("p1");
  await client.setSettings("gitea", { repositories: "all", owners: [], pullRequestsOnHome: true, issuesOnHome: true, projectTabs: true });
  await client.addAccount("gitea", "https://git.example.net", "t");
  assert.deepEqual(fake.calls.map(([kind, operation]) => [kind, operation]), [
    ["query", "forge.claims"],
    ["command", "forge.settings.set"],
    ["command", "forge.accounts.add"],
  ]);
});
