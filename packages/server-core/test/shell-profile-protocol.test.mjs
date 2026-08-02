import assert from "node:assert/strict";
import test from "node:test";
import { encodeFrame } from "@terminay/protocol";
import {
  createOperationDispatcher,
  createShellProfileOperationRegistry,
  createSettingsOperationRegistry,
  createWorkspaceOperationRegistry,
  OrderedEventJournal,
  ServerSettingsRepository,
  ShellProfileCatalogueService,
  ShellProfileDiscoveryService,
  WorkspaceStore,
  createInitialWorkspace,
} from "../dist/index.js";

const writeContext = { connectionId: "connection", clientId: "client", authScope: "write", signal: new AbortController().signal };
const readContext = { ...writeContext, authScope: "read" };
const profile = { name: "Zsh", target: { kind: "executable", executable: "/bin/zsh" }, args: ["--no-rcs"], startupMode: "default", environment: { EDITOR: "vim" } };

async function fixture(projectReferences = () => [], audit) {
  let persisted;
  const settings = new ServerSettingsRepository({ load: async () => persisted, commit: async (state) => { persisted = structuredClone(state); } });
  await settings.load();
  const discovery = new ShellProfileDiscoveryService({
    platform: "darwin", accountShell: "/bin/zsh", probeExecutable: async (candidate) => candidate === "/bin/zsh" ? candidate : null,
    readEtcShells: async () => "/bin/zsh\n",
  });
  const service = new ShellProfileCatalogueService({ settings, discovery, projectReferences, ...(audit === undefined ? {} : { audit }) });
  const dispatcher = createOperationDispatcher(createShellProfileOperationRegistry(service).operations);
  return { settings, service, dispatcher };
}

async function command(dispatcher, operation, payload, commandId, expectedRevision = 0) {
  return dispatcher.command({ envelope: { type: "command", commandId, correlationId: `${commandId}:c`, operation, payload, expectedRevision }, body: new Uint8Array(), context: writeContext });
}

test("catalogue is read-authorized and redacts environment while detail requires write authority", async () => {
  const { dispatcher } = await fixture();
  const created = await command(dispatcher, "shell-profiles.create", { profile }, "create");
  assert.equal(created.ok, true);
  const entry = created.result.entries.find((candidate) => candidate.kind === "custom");
  assert.equal("environment" in entry, false);
  assert.equal(entry.environmentEntryCount, 1);
  const catalogue = await dispatcher.query({ envelope: { type: "query", queryId: "catalogue", operation: "shell-profiles.catalogue", payload: {} }, body: new Uint8Array(), context: readContext });
  assert.equal(catalogue.envelope.ok, true);
  const denied = await dispatcher.query({ envelope: { type: "query", queryId: "detail-read", operation: "shell-profiles.detail", payload: { profileId: entry.id } }, body: new Uint8Array(), context: readContext });
  assert.equal(denied.envelope.ok, false);
  assert.equal(denied.envelope.error.code, "forbidden");
  const detail = await dispatcher.query({ envelope: { type: "query", queryId: "detail-write", operation: "shell-profiles.detail", payload: { profileId: entry.id } }, body: new Uint8Array(), context: writeContext });
  assert.deepEqual(detail.envelope.result.environment, { EDITOR: "vim" });
});

test("create assigns an id from command identity and duplicate delivery is idempotent", async () => {
  const { dispatcher, settings } = await fixture();
  const first = await command(dispatcher, "shell-profiles.create", { profile: { ...profile, id: "client-controlled" } }, "same-command");
  const second = await command(dispatcher, "shell-profiles.create", { profile: { ...profile, name: "Changed retry" } }, "same-command");
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.revision, second.revision);
  assert.match(first.result.entries.find((entry) => entry.kind === "custom").id, /^profile:[a-f0-9]{24}$/);
  assert.equal(settings.revision, 1);
});

test("duplicate profile names are actionable during validation and enforced during mutation", async () => {
  const { dispatcher } = await fixture();
  const created = await command(dispatcher, "shell-profiles.create", { profile }, "first-profile");
  assert.equal(created.ok, true);
  const duplicate = { ...profile, id: "profile:duplicate", name: "zSH" };
  const validation = await dispatcher.query({
    envelope: { type: "query", queryId: "duplicate-validation", operation: "shell-profiles.validate", payload: { profile: duplicate } },
    body: new Uint8Array(),
    context: writeContext,
  });
  assert.equal(validation.envelope.ok, true);
  assert.deepEqual(validation.envelope.result.issues.find((issue) => issue.code === "duplicate-name"), {
    code: "duplicate-name",
    field: "name",
    message: "A shell profile with this name already exists.",
  });
  const rejected = await command(dispatcher, "shell-profiles.create", { profile: duplicate }, "duplicate-profile", 1);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, "validation");
});

test("discovered profiles cannot become durable defaults and referenced custom profiles cannot be deleted", async () => {
  let referencedId;
  const { dispatcher } = await fixture((id) => id === referencedId ? ["project"] : []);
  const initial = await dispatcher.query({ envelope: { type: "query", queryId: "catalogue", operation: "shell-profiles.catalogue", payload: {} }, body: new Uint8Array(), context: readContext });
  const discovered = initial.envelope.result.entries.find((entry) => entry.kind === "discovered");
  const rejected = await command(dispatcher, "shell-profiles.set-default", { profileId: discovered.id }, "bad-default");
  assert.equal(rejected.ok, false);
  const created = await command(dispatcher, "shell-profiles.create", { profile }, "create", 0);
  referencedId = created.result.entries.find((entry) => entry.kind === "custom").id;
  const deletion = await command(dispatcher, "shell-profiles.delete", { profileId: referencedId }, "delete", 1);
  assert.equal(deletion.ok, false);
  assert.equal(deletion.error.code, "conflict");
  assert.deepEqual(deletion.error.details.projectIds, ["project"]);
});

test("generic settings and workspace operations cannot bypass profile boundaries", async () => {
  const { settings } = await fixture();
  const settingsDispatcher = createOperationDispatcher(createSettingsOperationRegistry(settings, new OrderedEventJournal()).operations);
  const settingsBypass = await command(settingsDispatcher, "settings.update", { settings: { shellProfiles: { defaultProfileId: "attacker" } } }, "settings-bypass");
  assert.equal(settingsBypass.ok, false);
  assert.equal(settingsBypass.error.code, "validation");

  const workspace = new WorkspaceStore(createInitialWorkspace("server"));
  const registry = createWorkspaceOperationRegistry(workspace, { shellProfileExists: (id) => id === "system" });
  const workspaceDispatcher = createOperationDispatcher(registry.operations);
  const bypass = await command(workspaceDispatcher, "workspace.command", { command: { type: "project.shellProfile.replace", fromProfileId: "a", toProfileId: "b" } }, "workspace-bypass");
  assert.equal(bypass.ok, false);
  assert.equal(bypass.error.code, "validation");
});

test("broad settings snapshots omit profile environment values", async () => {
  const { dispatcher, settings } = await fixture();
  await command(dispatcher, "shell-profiles.create", { profile }, "create");
  const settingsDispatcher = createOperationDispatcher(createSettingsOperationRegistry(settings, new OrderedEventJournal()).operations);
  const response = await settingsDispatcher.query({ envelope: { type: "query", queryId: "settings", operation: "settings.get", payload: {} }, body: new Uint8Array(), context: readContext });
  assert.deepEqual(response.envelope.result.settings.shellProfiles.profiles[0].environment, {});
  assert.equal(JSON.stringify(response).includes("vim"), false);
});

test("a near-budget durable catalogue fits the default framed query response", async () => {
  const { settings, service } = await fixture();
  const profiles = Array.from({ length: 3 }, (_, index) => ({
    id: `profile:${index}`, name: `Profile ${index}`, target: { kind: "executable", executable: "/bin/zsh" },
    args: Array.from({ length: 64 }, (__, argument) => `${argument}:${"x".repeat(140)}`), startupMode: "default", environment: {},
  }));
  const changed = await settings.set("shellProfiles", { defaultProfileId: "system", cwdPolicy: "current", profiles, order: profiles.map((entry) => entry.id) });
  assert.equal(changed.ok, true);
  const catalogue = await service.catalogue();
  const frame = encodeFrame({ type: "query_result", queryId: "catalogue-frame", ok: true, result: catalogue });
  assert.ok(frame.byteLength < 64 * 1024);
  assert.equal(JSON.stringify(catalogue).includes("x".repeat(140)), false);
});

test("profile audit outcomes are bounded metadata and never contain environment values", async () => {
  const outcomes = [];
  const { dispatcher } = await fixture(() => [], (outcome) => outcomes.push(outcome));
  await command(dispatcher, "shell-profiles.create", { profile }, "audit-create");
  await command(dispatcher, "shell-profiles.set-default", { profileId: "missing" }, "audit-failure", 1);
  assert.deepEqual(outcomes.map((entry) => [entry.action, entry.ok]), [["create", true], ["catalogue", true], ["set-default", false]]);
  const serialized = JSON.stringify(outcomes);
  assert.equal(serialized.includes("EDITOR"), false);
  assert.equal(serialized.includes("vim"), false);
  assert.ok(serialized.length < 1024);
});
