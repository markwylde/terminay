import test from "node:test";
import assert from "node:assert/strict";
import { OrderedEventJournal, scopeAllows } from "../dist/index.js";

test("server core scopes and ordered journal are transport-neutral", () => {
  assert.equal(scopeAllows("admin", "write"), true);
  const journal = new OrderedEventJournal({ maxEvents: 2 });
  journal.append("one", { value: 1 });
  journal.append("two", { value: 2 });
  journal.append("three", { value: 3 });
  assert.deepEqual(journal.replay(1).events.map((event) => event.event), ["two", "three"]);
});

test("transient publications reach live subscribers without advancing or evicting retained history", () => {
  const journal = new OrderedEventJournal({ maxEvents: 2 });
  const live = [];
  journal.append("workspace", { value: 1 });
  journal.append("workspace", { value: 2 });
  const unsubscribe = journal.subscribe((event) => live.push(event));

  for (let index = 0; index < 10_000; index += 1) {
    journal.publishTransient("terminal", { type: "output", position: index });
  }

  unsubscribe();
  assert.equal(live.length, 10_000);
  assert.equal(journal.revision, 2);
  assert.deepEqual(journal.replay(0).events.map((event) => event.payload.value), [1, 2]);
});
