import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  applyStepUpdate,
  createMemoryWorkflowTemplateBackend,
  instantiateWorkflow,
  readyStepIds,
  resumeStepId,
  serializedWorkflowSize,
  validateTemplate,
  validateWorkflowInput,
  WORKFLOW_LAUNCH_INSTRUCTION,
  WORKFLOW_LIMITS,
  WorkflowStore,
  WorkflowTemplateRepository,
  workflowFileName,
} from "../dist/index.js";

// Step dependencies (ADR-0128): `after`, readiness, blocked starts, and
// reading records written before steps had dependencies.

const root = () => mkdtempSync(join(tmpdir(), "terminay-workflow-dag-"));
const step = (title, extra = {}) => ({ title, prompt: `do ${title}`, ...extra });
const code = (value) => (error) => error?.code === value;
const stepNamed = (step) => (error) => error?.code === "invalid_workflow" && error.details?.step === step;

function workflowOf(steps) {
  return {
    id: "wf-1",
    name: "Flow",
    openingPrompt: "",
    templateId: null,
    createdAt: 0,
    steps: steps.map(([id, status, after = [], extra = {}]) => ({
      id,
      title: id,
      prompt: "",
      icon: "",
      after,
      status,
      note: "",
      startedAt: null,
      endedAt: null,
      ...extra,
    })),
  };
}

const reviews = () =>
  validateWorkflowInput({
    name: "Propose then review",
    steps: [
      step("Propose", { id: "p" }),
      step("Codex review", { id: "c", after: ["p"] }),
      step("Spec review", { id: "s", after: ["p"] }),
      step("Amend", { id: "a", after: ["c", "s"] }),
    ],
  });

test("steps given without after run one after another; an empty after waits on nothing", () => {
  const chain = validateWorkflowInput({ name: "Chain", steps: [step("A"), step("B"), step("C"), step("D")] });
  chain.steps.forEach((item, index) => assert.deepEqual(item.after, index === 0 ? [] : [chain.steps[index - 1].id]));
  const together = validateWorkflowInput({ name: "Together", steps: [step("A", { after: [] }), step("B", { after: [] }), step("C", { after: [] })] });
  assert.deepEqual(together.steps.map((item) => item.after), [[], [], []]);
  const workflow = instantiateWorkflow(together, null, 0);
  assert.equal(readyStepIds(workflow).length, 3);
});

test("after names earlier steps by request id, and the server assigns every id", () => {
  const content = reviews();
  const [propose, codex, spec, amend] = content.steps;
  for (const item of content.steps) assert.match(item.id, /^step-/u);
  assert.deepEqual(codex.after, [propose.id]);
  assert.deepEqual(spec.after, [propose.id]);
  assert.deepEqual(amend.after, [codex.id, spec.id]);
});

test("a later, unknown, self or repeated dependency is refused naming the step", () => {
  const refuse = (steps, at) => assert.throws(() => validateWorkflowInput({ name: "Bad", steps }), stepNamed(at));
  refuse([step("A", { id: "a", after: ["b"] }), step("B", { id: "b" })], 1);
  refuse([step("A", { id: "a" }), step("B", { id: "b", after: ["z"] })], 2);
  refuse([step("A", { id: "a" }), step("B", { id: "b", after: ["b"] })], 2);
  refuse([step("A", { id: "a" }), step("B", { id: "b" }), step("C", { id: "c", after: ["a", "a"] })], 3);
  refuse([step("A", { id: "a" }), step("B", { id: "a" })], 2);
  refuse([step("A", { id: "x".repeat(65) })], 1);
  // A template save is held to the same rules.
  assert.throws(
    () => validateTemplate({ id: "tpl-x", name: "T", steps: [step("A", { id: "a", after: ["b"] }), step("B", { id: "b" })] }),
    stepNamed(1),
  );
});

test("a workflow holds at most 200 dependencies", () => {
  // 21 roots, then 10 steps each waiting on all 21 roots: 210 links.
  const roots = Array.from({ length: 21 }, (_, index) => step(`R${index}`, { id: `r${index}`, after: [] }));
  const ids = roots.map((item) => item.id);
  const leaves = Array.from({ length: 10 }, (_, index) => step(`L${index}`, { id: `l${index}`, after: ids }));
  assert.throws(() => validateWorkflowInput({ name: "Wide", steps: [...roots, ...leaves] }), code("invalid_workflow"));
  const fits = validateWorkflowInput({ name: "Wide", steps: [...roots, ...leaves.slice(0, 9)] });
  assert.equal(fits.steps.reduce((sum, item) => sum + item.after.length, 0), 189);
  assert.equal(WORKFLOW_LIMITS.maxDependencies, 200);
});

test("long request ids count against the serialized bound", () => {
  const limit = WORKFLOW_LIMITS.maxSerializedBytes;
  const alias = (index) => `${"a".repeat(60)}${String(index).padStart(4, "0")}`;
  const build = (promptBytes) => {
    const steps = Array.from({ length: 50 }, (_, index) =>
      step(`S${index}`, { id: alias(index), prompt: "p".repeat(promptBytes), after: index < 4 ? [] : [alias(index - 1), alias(index - 2), alias(index - 3), alias(index - 4)] }),
    );
    return { name: "Aliases", steps };
  };
  // Find a prompt size where the request encoding is just over the bound.
  let bytes = 900;
  while (Buffer.byteLength(JSON.stringify(build(bytes))) <= limit) bytes += 1;
  const over = build(bytes);
  assert.throws(() => validateWorkflowInput(over), (error) => error?.code === "invalid_workflow" && error.details?.field === "size");
  // With short ids the same content fits, since server ids are shorter than these aliases.
  const short = { ...over, steps: over.steps.map((item, index) => ({ ...item, id: `s${index}`, after: item.after.map((id) => `s${Number(id.slice(60))}`) })) };
  const accepted = validateWorkflowInput(short);
  assert.ok(serializedWorkflowSize(accepted) <= limit);
});

test("starting is blocked until dependencies settle; a step under way can always report and finish", () => {
  const workflow = instantiateWorkflow(reviews(), null, 0);
  const [p, c, s, a] = workflow.steps.map((item) => item.id);
  let current = applyStepUpdate(workflow, p, "done", undefined, 1);
  assert.deepEqual(readyStepIds(current), [c, s]);
  current = applyStepUpdate(current, c, "running", undefined, 2);
  current = applyStepUpdate(current, s, "running", undefined, 2);
  assert.throws(
    () => applyStepUpdate(current, a, "running", undefined, 3),
    (error) => error.code === "step_blocked" && JSON.stringify(error.details.stepIds) === JSON.stringify([c, s]),
  );
  current = applyStepUpdate(current, c, "done", undefined, 4);
  current = applyStepUpdate(current, s, "skipped", "not needed", 4);
  assert.deepEqual(readyStepIds(current), [a]);
  current = applyStepUpdate(current, a, "running", undefined, 5);
  // A dependency reopened while its dependent runs does not strand it.
  current = applyStepUpdate(current, s, "not_started", undefined, 6);
  current = applyStepUpdate(current, a, "needs_input", undefined, 7);
  current = applyStepUpdate(current, a, "running", undefined, 8);
  current = applyStepUpdate(current, a, "done", "first", 9);
  current = applyStepUpdate(current, a, "done", "again", 10);
  assert.equal(current.steps[3].note, "again");
});

test("the resume point is the first active step, else the first ready step, else the first unsettled", () => {
  assert.equal(resumeStepId(workflowOf([["a", "failed"], ["b", "running"]])), "b");
  assert.equal(resumeStepId(workflowOf([["a", "done"], ["b", "done"], ["c", "failed"]])), "c");
  // Step 2 waits on the failed step 1; step 3 waits on nothing.
  const blocked = workflowOf([["a", "failed"], ["b", "not_started", ["a"]], ["c", "not_started"]]);
  assert.equal(resumeStepId(blocked), "a");
  assert.deepEqual(readyStepIds(blocked), ["a", "c"]);
  // Nothing ready: the first step that is not settled.
  assert.equal(resumeStepId(workflowOf([["a", "not_started", ["b"]], ["b", "failed", ["a"]]])), "a");
});

test("launching a template keeps its shape under new ids", async () => {
  const repository = new WorkflowTemplateRepository(createMemoryWorkflowTemplateBackend());
  const saved = await repository.apply({
    command: {
      type: "upsert",
      template: { id: "tpl-dag", name: "DAG", steps: [step("One", { id: "one" }), step("Two", { id: "two", after: [] }), step("Three", { id: "three", after: ["one", "two"] })] },
    },
  });
  assert.equal(saved.ok, true);
  const template = saved.state.templates[0];
  const [one, two, three] = template.steps;
  assert.deepEqual(three.after, [one.id, two.id]);
  const workflow = instantiateWorkflow(template, template.id, 0);
  const ids = workflow.steps.map((item) => item.id);
  assert.notDeepEqual(ids, template.steps.map((item) => item.id));
  assert.deepEqual(workflow.steps[2].after, [ids[0], ids[1]]);
  // Saving it again with its own ids keeps every id and dependency.
  const again = await repository.apply({ command: { type: "upsert", template } });
  assert.deepEqual(again.state.templates[0].steps, template.steps);
});

test("a stored record without dependencies reads as a chain, and its out-of-order step can still finish", () => {
  const directory = root();
  const record = {
    schemaVersion: 1,
    sessionId: "s1",
    workflow: {
      id: "wf-old",
      name: "Old",
      openingPrompt: "",
      templateId: null,
      createdAt: 0,
      steps: ["one", "two", "three"].map((id, index) => ({
        id: `step-${id}`,
        title: id,
        prompt: "",
        icon: "",
        status: index === 2 ? "running" : index === 0 ? "done" : "not_started",
        note: "",
        startedAt: index === 2 ? 5 : null,
        endedAt: null,
      })),
    },
  };
  writeFileSync(join(directory, workflowFileName("s1")), JSON.stringify(record));
  const store = new WorkflowStore({ directory });
  store.restore(["s1"]);
  const view = store.get("s1");
  assert.equal(view.state, "attached");
  assert.deepEqual(view.workflow.steps.map((item) => item.after), [[], ["step-one"], ["step-two"]]);
  // Step three runs although step two, which it now waits on, is not started.
  store.updateStep("s1", "step-three", "done", "finished anyway");
  assert.equal(store.get("s1").workflow.steps[2].status, "done");
  assert.equal(JSON.parse(readFileSync(join(directory, workflowFileName("s1")), "utf8")).schemaVersion, 2);
});

test("a stored template at the size bound still loads when its chain adds bytes", async () => {
  const limit = WORKFLOW_LIMITS.maxSerializedBytes;
  const steps = Array.from({ length: 50 }, (_, index) => ({ id: `step-${String(index).padStart(36, "0")}`, title: `S${index}`, prompt: "", icon: "" }));
  const content = { name: "Big", openingPrompt: "", steps };
  // Pad the opening prompt so the stored template is exactly at the bound before dependencies.
  const base = serializedWorkflowSize(content);
  content.openingPrompt = "o".repeat(Math.min(limit - base, WORKFLOW_LIMITS.maxPromptBytes));
  const backend = createMemoryWorkflowTemplateBackend({
    schemaVersion: 1,
    revision: 3,
    categories: [],
    templates: [{ id: "tpl-big", name: "Big", description: "", category: "", ...content }],
  });
  const repository = new WorkflowTemplateRepository(backend);
  const state = await repository.load();
  assert.equal(state.templates.length, 1);
  assert.deepEqual(state.templates[0].steps[1].after, [steps[0].id]);
});

test("a record whose dependencies were dropped by an older server reads as a chain", () => {
  const directory = root();
  const store = new WorkflowStore({ directory });
  store.attach("s1", instantiateWorkflow(reviews(), null, 0));
  const path = join(directory, workflowFileName("s1"));
  const record = JSON.parse(readFileSync(path, "utf8"));
  for (const item of record.workflow.steps) delete item.after;
  writeFileSync(path, JSON.stringify(record));
  const reloaded = new WorkflowStore({ directory });
  reloaded.restore(["s1"]);
  const steps = reloaded.get("s1").workflow.steps;
  steps.forEach((item, index) => assert.deepEqual(item.after, index === 0 ? [] : [steps[index - 1].id]));
});

test("the launch instruction names dependencies and working ready steps together", () => {
  assert.match(WORKFLOW_LAUNCH_INSTRUCTION, /only once every step in its after list is done or skipped/u);
  assert.match(WORKFLOW_LAUNCH_INSTRUCTION, /may be worked at the same time/u);
});
