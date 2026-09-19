import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, symlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  defineExtension,
  defineMcpInstallTarget,
  defineSessionSource,
  validAgentManifestFixture,
} from "../dist/index.js";
import { createAgentExtensionHarness } from "../dist/testing.js";

const here = dirname(fileURLToPath(import.meta.url));
const sdkRoot = resolve(here, "..");
const exampleRoot = resolve(here, "../examples/session-source");
const sourceId = "dev.terminay.fixture/agents";
const targetId = "dev.terminay.fixture/fixture-client";
const manifest = validAgentManifestFixture;

const session = (overrides = {}) => ({
  id: "session-1",
  harness: "fixture-agent",
  pid: 4242,
  cwd: "/home/test/project",
  status: "running",
  ...overrides,
});

/** An extension whose source runs `body` with the start arguments. */
function sourceExtension(body, { id = sourceId } = {}) {
  return defineExtension({
    activate(context) {
      context.subscriptions.add(context.agents.registerSessionSource(id, defineSessionSource({ start: body })));
    },
  });
}

test("default-exported activate(context) runs and a global Terminay singleton fails to compile", async () => {
  let activated = false;
  const harness = await createAgentExtensionHarness(defineExtension({
    activate(context) {
      activated = true;
      assert.equal(typeof context.agents.registerSessionSource, "function");
      assert.equal(typeof context.mcp.registerInstallTarget, "function");
      assert.equal("registerProvider" in context.agents, false);
      assert.equal("terminay" in globalThis, false);
    },
  }));
  assert.equal(activated, true);
  await harness.dispose();

  const dts = `${await readFile(join(sdkRoot, "dist/index.d.ts"), "utf8")}\n${await readFile(join(sdkRoot, "dist/types.d.ts"), "utf8")}`;
  assert.match(dts, /export declare function defineExtension/);
  assert.doesNotMatch(dts, /declare (?:const|var|let|function) terminay\b/);
  assert.doesNotMatch(dts, /interface GlobalThis[\s\S]*terminay/);
  const denied = await readFile(join(here, "types/no-global.ts"), "utf8");
  assert.match(denied, /@ts-expect-error There is no global Terminay singleton/);
});

test("registration accepts declared ids and refuses undeclared or duplicate ids", async () => {
  const harness = await createAgentExtensionHarness(sourceExtension(() => {}), { manifest });
  assert.deepEqual(harness.registeredSourceIds(), [sourceId]);
  await harness.dispose();

  await assert.rejects(
    createAgentExtensionHarness(sourceExtension(() => {}, { id: "dev.terminay.fixture/other" }), { manifest }),
    /undeclared/,
  );
  await assert.rejects(
    createAgentExtensionHarness(defineExtension({
      activate(context) {
        const target = defineMcpInstallTarget({ status: async () => ({}), install: async () => ({}), uninstall: async () => ({}) });
        context.mcp.registerInstallTarget(targetId, target);
        context.mcp.registerInstallTarget(targetId, target);
      },
    }), { manifest }),
    /Duplicate MCP install target/,
  );
});

test("disposal aborts a running source's signal and ignores later publications", async () => {
  let captured;
  const harness = await createAgentExtensionHarness(sourceExtension((start) => { captured = start; }), { manifest });
  await harness.start();
  captured.publisher.reset([session()]);
  assert.equal(captured.signal.aborted, false);
  await harness.release("disabled");
  assert.equal(captured.signal.aborted, true);
  captured.publisher.upsert(session({ id: "late" }));
  assert.deepEqual(harness.publications().map((publication) => publication.kind), ["reset"]);
});

test("a stopped source receives an aborted signal, as switching agent status off does", async () => {
  let captured;
  const harness = await createAgentExtensionHarness(sourceExtension((start) => { captured = start; }), { manifest });
  await harness.start();
  harness.stop();
  assert.equal(captured.signal.aborted, true);
  await harness.dispose();
});

test("the source receives enabled-harness changes and switched-off sessions leave the live set", async () => {
  let captured;
  const seen = [];
  const harness = await createAgentExtensionHarness(sourceExtension((start) => {
    captured = start;
    start.onEnabledHarnessesChanged((enabled) => seen.push(enabled));
  }), { manifest });
  await harness.start(undefined, { enabledHarnesses: ["fixture-agent", "other-agent"] });
  captured.publisher.reset([session(), session({ id: "session-2", harness: "other-agent" })]);
  harness.setEnabledHarnesses(["fixture-agent"]);
  assert.deepEqual(seen, [["fixture-agent"]]);
  assert.deepEqual(harness.sessions().map((item) => item.id), ["session-1"]);

  captured.publisher.upsert(session({ id: "session-3", harness: "other-agent" }));
  assert.equal(harness.violations().at(-1).issues[0].code, "harness_not_enabled");
  await harness.dispose();
});

test("a non-conforming source fails bounds, harness, publication, and privacy checks", async () => {
  let captured;
  const harness = await createAgentExtensionHarness(sourceExtension((start) => { captured = start; }), { manifest });
  await harness.start();
  const { publisher } = captured;
  publisher.upsert(session({ title: "x".repeat(10_000) }));
  publisher.upsert(session({ harness: "undeclared" }));
  publisher.upsert(session({ transcript: [{ role: "user", text: "secret" }] }));
  publisher.reset([session(), session()]);
  publisher.remove("never-reported");
  publisher.diagnostic({ code: "provider-error", message: "x", path: "/home/test/.claude" });
  assert.deepEqual(harness.violations().map((violation) => violation.call), ["upsert", "upsert", "upsert", "reset", "remove", "diagnostic"]);
  assert.deepEqual(harness.publications(), []);
  assert.throws(() => harness.assertConformant(), /breached the contract/);
  await harness.dispose();
});

test("MCP install target results and commands are validated", async () => {
  const harness = await createAgentExtensionHarness(defineExtension({
    activate(context) {
      context.mcp.registerInstallTarget(targetId, defineMcpInstallTarget({
        async status({ server, signal }) {
          assert.equal(signal.aborted, false);
          return { state: server.args.length > 0 ? "installed" : "maybe", configPath: "/home/test/.fixture.json" };
        },
        install: async () => ({ ok: true, installed: true }),
        uninstall: async () => ({ ok: true, installed: false, extra: 1 }),
      }));
    },
  }), { manifest });
  assert.equal((await harness.mcpStatus(targetId)).state, "installed");
  await assert.rejects(harness.mcpStatus(targetId, { command: "/bin/terminay", args: [] }), /Invalid MCP install target result/);
  await assert.rejects(harness.mcpStatus(targetId, { command: "", args: [] }), /Invalid MCP server command/);
  assert.deepEqual(await harness.mcpInstall(targetId), { ok: true, installed: true });
  await assert.rejects(harness.mcpUninstall(targetId), /Invalid MCP install target result/);
  await harness.dispose();
});

test("the public API exposes no host-owned behaviour", async () => {
  const api = await import("../dist/index.js");
  const names = Object.keys(api);
  for (const forbidden of [
    "renderSidebar", "navigate", "subscribeClients", "acknowledge",
    "orderCanonical", "enableExtension", "disableExtension", "packExtension",
    "spawnExtensionHost", "bindSession", "bindTerminal", "resolveWorktrees",
  ]) {
    assert.equal(names.includes(forbidden), false, forbidden);
  }
  assert.equal(typeof api.defineExtension, "function");
  assert.equal(typeof api.defineSessionSource, "function");
  assert.equal(typeof api.defineMcpInstallTarget, "function");
});

test("the example package imports only the public SDK", async () => {
  const source = [
    await readFile(join(exampleRoot, "extension.js"), "utf8"),
    await readFile(join(exampleRoot, "example-agent.js"), "utf8"),
    await readFile(join(exampleRoot, "test.mjs"), "utf8"),
  ].join("\n");
  assert.match(source, /@terminay\/extension-api/);
  assert.equal(/@terminay\/(?!extension-api)/.test(source), false);
  assert.doesNotMatch(source, /server-core|electron\/|apps\/terminay-server/);
});

test("example package tests pass against the published SDK", async (t) => {
  const modules = join(exampleRoot, "node_modules", "@terminay");
  await mkdir(modules, { recursive: true });
  const link = join(modules, "extension-api");
  await rm(link, { recursive: true, force: true }).catch(() => undefined);
  await symlink(sdkRoot, link, "dir");
  t.after(() => rm(join(exampleRoot, "node_modules"), { recursive: true, force: true }));
  const result = spawnSync(process.execPath, ["--test", "test.mjs"], { cwd: exampleRoot, encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
