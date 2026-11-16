import assert from "node:assert/strict";
import test from "node:test";
import { validateSessionWorkflow, workflowSerializedSize } from "../dist/index.js";

// Step dependencies on the client (ADR-0128).

const serverId = (n) => `step-${String(n).padStart(36, "0")}`;
const view = (steps, extra = {}) => ({
  sessionId: "s1",
  state: "attached",
  workflow: { id: "wf-1", name: "Flow", openingPrompt: "", templateId: null, createdAt: 0, steps },
  resumeStepId: null,
  unfinished: true,
  ...extra,
});
const step = (id, extra = {}) => ({ id, title: id, prompt: "", icon: "", status: "not_started", note: "", startedAt: null, endedAt: null, ...extra });

test("a step's after and the ready step ids are read", () => {
  const parsed = validateSessionWorkflow(view([step("a", { after: [] }), step("b", { after: [] }), step("c", { after: ["a", "b"] })], { readyStepIds: ["a", "b"] }));
  assert.deepEqual(parsed.workflow.steps.map((item) => item.after), [[], [], ["a", "b"]]);
  assert.deepEqual(parsed.readyStepIds, ["a", "b"]);
});

test("steps without after read as a chain, and after keeps only earlier steps", () => {
  const chain = validateSessionWorkflow(view([step("a"), step("b"), step("c")]));
  assert.deepEqual(chain.workflow.steps.map((item) => item.after), [[], ["a"], ["b"]]);
  assert.deepEqual(chain.readyStepIds, []);
  const odd = validateSessionWorkflow(view([step("a", { after: ["c"] }), step("b", { after: ["a", "zz"] }), step("c", { after: [] })]));
  assert.deepEqual(odd.workflow.steps.map((item) => item.after), [[], ["a"], []]);
});

test("the serialized size counts after as server ids only where it is not the default", () => {
  const steps = [
    { id: serverId(0), title: "A", prompt: "", icon: "", after: [] },
    { id: serverId(1), title: "B", prompt: "", icon: "", after: [serverId(0)] },
    { id: "draft-key", title: "C", prompt: "", icon: "", after: [serverId(0)] },
  ];
  // The server's encoding of the same content, with its 41-character ids.
  const expected = Buffer.byteLength(
    JSON.stringify({
      name: "T",
      openingPrompt: "",
      steps: [
        { title: "A", prompt: "", icon: "" },
        { title: "B", prompt: "", icon: "" },
        { title: "C", prompt: "", icon: "", after: [serverId(0)] },
      ],
    }),
  );
  assert.equal(workflowSerializedSize({ name: "T", openingPrompt: "", steps }), expected);
  // Without dependencies it is the plain encoding.
  assert.equal(
    workflowSerializedSize({ name: "T", openingPrompt: "", steps: [{ title: "A", prompt: "", icon: "" }] }),
    Buffer.byteLength(JSON.stringify({ name: "T", openingPrompt: "", steps: [{ title: "A", prompt: "", icon: "" }] })),
  );
});
