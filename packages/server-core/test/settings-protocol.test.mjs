import assert from "node:assert/strict";
import test from "node:test";
import {
  createOperationDispatcher,
  createSettingsOperationRegistry,
  OrderedEventJournal,
  ServerSettingsRepository,
} from "../dist/index.js";

const context = {
  connectionId: "settings-connection",
  clientId: "settings-client",
  authScope: "write",
  signal: new AbortController().signal,
};

test("settings protocol exposes revisioned state and publishes committed changes", async () => {
  let persisted;
  const repository = new ServerSettingsRepository({
    load: async () => persisted,
    commit: async (state) => { persisted = structuredClone(state); },
  });
  const journal = new OrderedEventJournal();
  const registry = createSettingsOperationRegistry(repository, journal);
  const dispatcher = createOperationDispatcher(registry.operations);

  const initial = await dispatcher.query({
    envelope: { type: "query", queryId: "settings-get", operation: "settings.get", payload: {} },
    body: new Uint8Array(),
    context,
  });
  assert.equal(initial.envelope.ok, true);
  assert.equal(initial.envelope.result.revision, 0);

  const updated = await dispatcher.command({
    envelope: {
      type: "command",
      commandId: "settings-update",
      correlationId: "settings-update-correlation",
      operation: "settings.update",
      payload: { settings: { scrollback: 7000 } },
      expectedRevision: 0,
    },
    body: new Uint8Array(),
    context,
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.revision, 1);
  assert.equal(updated.result.settings.scrollback, 7000);
  assert.deepEqual(journal.replay(0).events.map((event) => event.event), ["settings.changed"]);

  const conflict = await dispatcher.command({
    envelope: {
      type: "command",
      commandId: "settings-conflict",
      correlationId: "settings-conflict-correlation",
      operation: "settings.reset",
      payload: {},
      expectedRevision: 0,
    },
    body: new Uint8Array(),
    context,
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error.code, "conflict");
  assert.equal(repository.revision, 1);
});
