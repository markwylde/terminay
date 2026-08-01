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
