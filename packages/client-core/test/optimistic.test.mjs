import test from "node:test";
import assert from "node:assert/strict";
import { optimisticMutation } from "../dist/index.js";

test("optimistic mutation has deterministic commit and rollback", () => {
  const mutation = optimisticMutation({ active: "a" }, (value) => ({ ...value, active: "b" }));
  assert.deepEqual(mutation.optimistic, { active: "b" });
  assert.deepEqual(mutation.rollback(), { active: "a" });
  assert.deepEqual(mutation.commit({ active: "server" }), { active: "server" });
});
