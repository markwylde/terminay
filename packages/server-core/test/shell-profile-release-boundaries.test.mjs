import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { TerminayClient } from "@terminay/client-core";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import {
  HeadlessChannelTransport,
  MAX_SHELL_PROFILES,
  OrderedEventJournal,
  ServerConnection,
  ServerSettingsRepository,
  ShellProfileCatalogueService,
  ShellProfileDiscoveryService,
  WorkspaceStore,
  createInitialWorkspace,
  createOperationDispatcher,
  createServerCore,
  createSettingsOperationRegistry,
  createShellProfileOperationRegistry,
  createWorkspaceOperationRegistry,
  normalizeShellProfilesSettings,
} from "../dist/index.js";

const writeContext = Object.freeze({
  connectionId: "connection-write",
  clientId: "client-write",
  authScope: "write",
  signal: new AbortController().signal,
});
const readContext = Object.freeze({ ...writeContext, connectionId: "connection-read", clientId: "client-read", authScope: "read" });
const noneContext = Object.freeze({ ...writeContext, connectionId: "connection-none", clientId: "client-none", authScope: "none" });

function customProfile(overrides = {}) {
  return {
    name: "Release Zsh",
    target: { kind: "executable", executable: "/bin/zsh" },
    args: ["--no-rcs"],
    startupMode: "default",
    environment: { RELEASE_MARKER: "do-not-leak-release-marker", REMOVE_ME: null },
    ...overrides,
  };
}

async function fixture(projectReferences = () => []) {
  let persisted;
  const settings = new ServerSettingsRepository({
    load: async () => persisted,
    commit: async (state) => { persisted = structuredClone(state); },
  });
  await settings.load();
  const discovery = new ShellProfileDiscoveryService({
    platform: "darwin",
    accountShell: "/bin/zsh",
    environmentShell: "/bin/bash",
    probeExecutable: async (candidate) => ["/bin/zsh", "/bin/bash"].includes(candidate) ? candidate : null,
    readEtcShells: async () => "/bin/zsh\n/bin/bash\n",
  });
  const service = new ShellProfileCatalogueService({ settings, discovery, projectReferences });
  const dispatcher = createOperationDispatcher(createShellProfileOperationRegistry(service).operations);
  return { settings, service, dispatcher };
}

function query(dispatcher, operation, payload, context = writeContext, queryId = `${operation}:query`) {
  return dispatcher.query({
    envelope: { type: "query", queryId, operation, payload },
    body: new Uint8Array(),
    context,
  });
}

function command(dispatcher, operation, payload, commandId, expectedRevision, context = writeContext) {
  return dispatcher.command({
    envelope: {
      type: "command",
      commandId,
      correlationId: `${commandId}:correlation`,
      operation,
      payload,
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
    },
    body: new Uint8Array(),
    context,
  });
}

test("shell profile protocol enforces read/write authorization and redacts environment values", async () => {
  const { dispatcher, settings } = await fixture();

  const deniedCreate = await command(dispatcher, "shell-profiles.create", { profile: customProfile() }, "denied-create", 0, readContext);
  assert.equal(deniedCreate.ok, false);
  assert.equal(deniedCreate.error.code, "forbidden");
  assert.equal(settings.revision, 0, "an unauthorized mutation must not advance durable state");

  const created = await command(dispatcher, "shell-profiles.create", { profile: customProfile() }, "create-release", 0);
  assert.equal(created.ok, true);
  const createdEntry = created.result.entries.find((entry) => entry.kind === "custom");
  assert.ok(createdEntry);
  assert.equal("environment" in createdEntry, false);
  assert.equal(createdEntry.environmentEntryCount, 2);
  assert.equal(JSON.stringify(created.result).includes("do-not-leak-release-marker"), false);

  const readCatalogue = await query(dispatcher, "shell-profiles.catalogue", {}, readContext);
  assert.equal(readCatalogue.envelope.ok, true);
  assert.equal(JSON.stringify(readCatalogue.envelope).includes("do-not-leak-release-marker"), false);
  const deniedCatalogue = await query(dispatcher, "shell-profiles.catalogue", {}, noneContext);
  assert.equal(deniedCatalogue.envelope.ok, false);
  assert.equal(deniedCatalogue.envelope.error.code, "forbidden");

  for (const operation of ["shell-profiles.detail", "shell-profiles.validate"]) {
    const payload = operation.endsWith("detail") ? { profileId: createdEntry.id } : { profile: customProfile({ id: "profile:validation" }) };
    const denied = await query(dispatcher, operation, payload, readContext, `${operation}:denied`);
    assert.equal(denied.envelope.ok, false, `${operation} must require write authority`);
    assert.equal(denied.envelope.error.code, "forbidden");
  }

  const detail = await query(dispatcher, "shell-profiles.detail", { profileId: createdEntry.id }, writeContext);
  assert.equal(detail.envelope.ok, true);
  assert.deepEqual(detail.envelope.result.environment, { RELEASE_MARKER: "do-not-leak-release-marker", REMOVE_ME: null });

  const settingsDispatcher = createOperationDispatcher(createSettingsOperationRegistry(settings, new OrderedEventJournal()).operations);
  const broad = await query(settingsDispatcher, "settings.get", {}, readContext);
  assert.equal(broad.envelope.ok, true);
  assert.deepEqual(broad.envelope.result.settings.shellProfiles.profiles[0].environment, {});
  assert.equal(JSON.stringify(broad.envelope).includes("do-not-leak-release-marker"), false);
});

test("every shell profile mutation is write-authorized before payload handling", async () => {
  const { dispatcher, settings } = await fixture();
  for (const [index, operation] of [
    "shell-profiles.refresh",
    "shell-profiles.create",
    "shell-profiles.update",
    "shell-profiles.reorder",
    "shell-profiles.delete",
    "shell-profiles.set-default",
    "shell-profiles.set-cwd-policy",
    "shell-profiles.reset",
  ].entries()) {
    const denied = await command(dispatcher, operation, {}, `denied-mutation-${index}`, 0, readContext);
    assert.equal(denied.ok, false, `${operation} did not require write authority`);
    assert.equal(denied.error.code, "forbidden");
  }
  assert.equal(settings.revision, 0);
});

test("validation failures never echo environment values", async () => {
  const { dispatcher } = await fixture();
  const marker = "release-error-secret-marker";
  const rejected = await command(dispatcher, "shell-profiles.create", {
    profile: customProfile({ environment: { API_TOKEN: marker } }),
  }, "secret-like-environment", 0);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, "validation");
  assert.equal(JSON.stringify(rejected).includes(marker), false);
});

test("create uses a server-generated stable id and duplicate command delivery is idempotent", async () => {
  const { dispatcher, settings } = await fixture();
  const commandId = "release-idempotent-create";
  const expectedId = `profile:${createHash("sha256").update(commandId).digest("hex").slice(0, 24)}`;

  const first = await command(dispatcher, "shell-profiles.create", {
    profile: customProfile({ id: "client-selected-id" }),
  }, commandId, 0);
  const replayFromAnotherConnection = await command(dispatcher, "shell-profiles.create", {
    profile: customProfile({ id: "another-client-id", name: "Mutated retry", environment: { SHOULD_NOT_APPLY: "value" } }),
  }, commandId, 0, { ...writeContext, connectionId: "connection-retry", clientId: "client-retry" });

  assert.equal(first.ok, true);
  assert.equal(replayFromAnotherConnection.ok, true);
  assert.equal(first.revision, replayFromAnotherConnection.revision);
  assert.equal(settings.revision, 1);
  const customs = replayFromAnotherConnection.result.entries.filter((entry) => entry.kind === "custom");
  assert.equal(customs.length, 1);
  assert.equal(customs[0].id, expectedId);
  assert.equal(customs[0].name, "Release Zsh");
});

test("discovered defaults and deletion of every referenced custom profile are rejected", async () => {
  let referencedProfileId;
  const { dispatcher } = await fixture((profileId) => profileId === referencedProfileId ? ["project-a", "project-b"] : []);
  const initial = await query(dispatcher, "shell-profiles.catalogue", {}, readContext);
  const discovered = initial.envelope.result.entries.find((entry) => entry.kind === "discovered");
  assert.ok(discovered);

  const discoveredDefault = await command(dispatcher, "shell-profiles.set-default", { profileId: discovered.id }, "discovered-default", 0);
  assert.equal(discoveredDefault.ok, false);
  assert.equal(discoveredDefault.error.code, "unavailable");

  const created = await command(dispatcher, "shell-profiles.create", { profile: customProfile() }, "referenced-create", 0);
  assert.equal(created.ok, true);
  referencedProfileId = created.result.entries.find((entry) => entry.kind === "custom").id;

  const serverDefault = await command(dispatcher, "shell-profiles.set-default", { profileId: referencedProfileId }, "server-default", 1);
  assert.equal(serverDefault.ok, true);
  const serverReferencedDelete = await command(dispatcher, "shell-profiles.delete", { profileId: referencedProfileId }, "delete-server-reference", 2);
  assert.equal(serverReferencedDelete.ok, false);
  assert.equal(serverReferencedDelete.error.code, "conflict");

  const clearedServerDefault = await command(dispatcher, "shell-profiles.set-default", { profileId: "system" }, "clear-server-default", 2);
  assert.equal(clearedServerDefault.ok, true);
  const projectReferencedDelete = await command(dispatcher, "shell-profiles.delete", { profileId: referencedProfileId }, "delete-project-reference", 3);
  assert.equal(projectReferencedDelete.ok, false);
  assert.equal(projectReferencedDelete.error.code, "conflict");
  assert.deepEqual(projectReferencedDelete.error.details.projectIds, ["project-a", "project-b"]);
});

test("generic settings and workspace operations cannot bypass dedicated shell-profile mutations", async () => {
  const { settings, dispatcher } = await fixture();
  const settingsDispatcher = createOperationDispatcher(createSettingsOperationRegistry(settings, new OrderedEventJournal()).operations);

  for (const [index, settingsPatch] of [
    { shellProfiles: { defaultProfileId: "profile:attacker", cwdPolicy: "home", profiles: [], order: [] } },
    { shellProfiles: null },
  ].entries()) {
    const result = await command(settingsDispatcher, "settings.update", { settings: settingsPatch }, `settings-bypass-${index}`, 0);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation");
  }
  for (const [index, path] of ["shellProfiles", "shellProfiles.defaultProfileId"].entries()) {
    const result = await command(settingsDispatcher, "settings.reset", { path }, `settings-reset-bypass-${index}`, 0);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation");
  }
  assert.equal(settings.revision, 0);

  const created = await command(dispatcher, "shell-profiles.create", { profile: customProfile() }, "reset-preservation-create", 0);
  assert.equal(created.ok, true);
  const profileId = created.result.entries.find((entry) => entry.kind === "custom").id;
  const selected = await command(dispatcher, "shell-profiles.set-default", { profileId }, "reset-preservation-default", 1);
  assert.equal(selected.ok, true);
  const changed = await command(settingsDispatcher, "settings.update", { settings: { scrollback: 9001 } }, "reset-preservation-update", 2);
  assert.equal(changed.ok, true);
  const profilesBeforeReset = structuredClone(settings.settings.shellProfiles);

  const reset = await command(settingsDispatcher, "settings.reset", {}, "reset-preserving-profiles", 3);
  assert.equal(reset.ok, true);
  assert.equal(reset.result.settings.scrollback, 5000);
  assert.deepEqual(settings.settings.shellProfiles, profilesBeforeReset);
  assert.equal(settings.revision, 4);

  const workspace = new WorkspaceStore(createInitialWorkspace("server-release"));
  const workspaceDispatcher = createOperationDispatcher(createWorkspaceOperationRegistry(workspace, {
    shellProfileExists: (profileId) => profileId === "system",
  }).operations);
  for (const [index, injected] of [
    { type: "project.shellProfile.set", projectId: "project-a", profileId: "system" },
    { type: "project.shellProfile.clear", projectId: "project-a" },
    { type: "project.shellProfile.replace", fromProfileId: "profile:a", toProfileId: "system" },
  ].entries()) {
    const result = await command(workspaceDispatcher, "workspace.command", { command: injected }, `workspace-bypass-${index}`, 0);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation");
  }
  assert.equal(workspace.state.revision, 0);
});

class FakeChannel {
  constructor(peer = null) {
    this.label = "application";
    this.peer = peer;
    this.readyState = "open";
    this.bufferedAmount = 0;
    this.messages = new Set();
    this.states = new Set();
    this.closed = false;
  }
  send(frame) { this.peer?.emit(new Uint8Array(frame)); }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = "closed";
    for (const listener of [...this.states]) listener("closed");
    if (this.peer !== null && !this.peer.closed) this.peer.close();
  }
  onMessage(listener) { this.messages.add(listener); return () => this.messages.delete(listener); }
  onStateChange(listener) { this.states.add(listener); return () => this.states.delete(listener); }
  emit(frame) { for (const listener of [...this.messages]) listener(new Uint8Array(frame)); }
}

function largestUniformLegalCatalogue() {
  const build = (argumentLength) => ({
    defaultProfileId: "system",
    cwdPolicy: "current",
    profiles: Array.from({ length: MAX_SHELL_PROFILES }, (_, index) => ({
      id: `profile:bulk-${index}`,
      name: `Bulk profile ${index}`,
      target: { kind: "executable", executable: "/bin/zsh" },
      args: ["x".repeat(argumentLength)],
      startupMode: "default",
      environment: {},
    })),
    order: Array.from({ length: MAX_SHELL_PROFILES }, (_, index) => `profile:bulk-${index}`),
  });
  let low = 0;
  let high = 4096;
  while (low < high) {
    const candidate = Math.ceil((low + high) / 2);
    try { normalizeShellProfilesSettings(build(candidate)); low = candidate; }
    catch { high = candidate - 1; }
  }
  const settings = normalizeShellProfilesSettings(build(low));
  assert.equal(settings.profiles.length, MAX_SHELL_PROFILES);
  assert.throws(() => normalizeShellProfilesSettings(build(low + 1)), /storage limit/);
  return settings;
}

async function transportPair(kind) {
  if (kind === "local") {
    const pair = createInMemoryTransportPair();
    await pair.open();
    return pair;
  }
  const clientChannel = new FakeChannel();
  const serverChannel = new FakeChannel(clientChannel);
  clientChannel.peer = serverChannel;
  return { client: new HeadlessChannelTransport(clientChannel), server: new HeadlessChannelTransport(serverChannel) };
}

for (const kind of ["local", "remote"]) {
  test(`maximum legal shell catalogue crosses the framed ${kind} transport`, async () => {
    const settings = new ServerSettingsRepository({ load: async () => undefined, commit: async () => undefined });
    await settings.load();
    const maximum = largestUniformLegalCatalogue();
    const stored = await settings.set("shellProfiles", maximum, 0, "seed-maximum-catalogue");
    assert.equal(stored.ok, true);
    const discovery = new ShellProfileDiscoveryService({
      platform: "darwin",
      accountShell: "/bin/zsh",
      probeExecutable: async (candidate) => candidate === "/bin/zsh" ? candidate : null,
      readEtcShells: async () => "/bin/zsh\n",
    });
    const service = new ShellProfileCatalogueService({ settings, discovery });
    const registry = createShellProfileOperationRegistry(service);
    const pair = await transportPair(kind);
    const server = kind === "local"
      ? createServerCore({
          serverId: "server-catalogue",
          serverVersion: "test",
          capabilities: ["shell-profiles"],
          authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "read" }),
          eventJournal: new OrderedEventJournal(),
          ...registry.operations,
        }).accept(pair.server)
      : new ServerConnection(pair.server, {
          serverId: "server-catalogue",
          serverVersion: "test",
          capabilities: ["shell-profiles"],
          authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "read" }),
          ...registry.operations,
        });
    const serverTask = server.start();
    const client = new TerminayClient({ transport: pair.client, clientId: `client-${kind}`, capabilities: ["shell-profiles"] });
    try {
      await client.connect();
      const response = await client.query("shell-profiles.catalogue", {});
      assert.equal(response.result.entries.filter((entry) => entry.kind === "custom").length, MAX_SHELL_PROFILES);
      assert.ok(JSON.stringify(response.result).length < 64 * 1024, "the maximum legal redacted catalogue must fit the control header budget");
    } finally {
      await client.close().catch(() => undefined);
      await serverTask.catch(() => undefined);
    }
  });
}
