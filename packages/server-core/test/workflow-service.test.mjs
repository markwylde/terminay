import assert from "node:assert/strict";
import * as fs from "node:fs";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  applyStepUpdate,
  createMemoryWorkflowTemplateBackend,
  createWorkflowTemplateFileBackend,
  isUnfinished,
  resumeStepId,
  serializedWorkflowSize,
  validateTemplate,
  validateWorkflowInput,
  WORKFLOW_LAUNCH_INSTRUCTION,
  WORKFLOW_LIMITS,
  WORKFLOW_RESUME_INSTRUCTION,
  WorkflowStore,
  WorkflowTemplateRepository,
  workflowFileName,
  workflowLaunchText,
  workflowResumeText,
} from "../dist/index.js";

const root = () => mkdtempSync(join(tmpdir(), "terminay-workflows-"));
const step = (title, extra = {}) => ({ title, prompt: `do ${title}`, ...extra });
const template = (extra = {}) => ({
  id: "tpl-standard",
  name: "Standard flow",
  description: "",
  category: "",
  openingPrompt: "Ship the feature.",
  steps: [step("Propose"), step("Apply"), step("Verify")],
  ...extra,
});
const code = (value) => (error) => error?.code === value;

function workflowOf(steps) {
  return {
    id: "wf-1",
    name: "Flow",
    openingPrompt: "",
    templateId: null,
    createdAt: 0,
    steps: steps.map(([id, status, extra = {}]) => ({
      id,
      title: id,
      prompt: "",
      icon: "",
      status,
      note: "",
      startedAt: null,
      endedAt: null,
      ...extra,
    })),
  };
}

// 1.2 normalisation and bounds

test("templates assign ids to new steps, allow duplicate titles, and map unknown icons to none", () => {
  const value = validateTemplate(template({ steps: [step("Same", { icon: "rocket-ship" }), step("Same", { icon: "flask" })] }));
  assert.equal(value.steps.length, 2);
  assert.notEqual(value.steps[0].id, value.steps[1].id);
  assert.equal(value.steps[0].icon, "");
  assert.equal(value.steps[1].icon, "flask");
});

test("a renamed step keeps its id", () => {
  const first = validateTemplate(template());
  const renamed = structuredClone(first);
  renamed.steps[1].title = "Apply the change";
  const second = validateTemplate(renamed, new Set(first.steps.map((item) => item.id)));
  assert.deepEqual(second.steps.map((item) => item.id), first.steps.map((item) => item.id));
  assert.equal(second.steps[1].title, "Apply the change");
});

test("an empty template, an empty name, and an empty step title are refused", () => {
  assert.throws(() => validateTemplate(template({ steps: [] })), code("invalid_workflow"));
  assert.throws(() => validateTemplate(template({ name: "  " })), code("invalid_workflow"));
  assert.throws(() => validateTemplate(template({ steps: [step("")] })), code("invalid_workflow"));
});

test("each field bound is refused, never truncated", () => {
  assert.throws(() => validateTemplate(template({ name: "n".repeat(121) })), code("invalid_workflow"));
  assert.throws(() => validateTemplate(template({ steps: [step("t".repeat(121))] })), code("invalid_workflow"));
  assert.throws(() => validateTemplate(template({ openingPrompt: "p".repeat(8193) })), code("invalid_workflow"));
  assert.throws(
    () => validateTemplate(template({ steps: Array.from({ length: 51 }, (_, index) => step(`s${index}`)) })),
    code("invalid_workflow"),
  );
  assert.equal(validateTemplate(template({ name: "n".repeat(120) })).name, "n".repeat(120));
});

/** Fifty steps whose serialized size is exactly `target` bytes. */
function contentOfSize(target, unit) {
  const steps = Array.from({ length: 50 }, (_, index) => ({ title: `Step ${index}`, prompt: "", icon: "" }));
  const content = { name: "Sized", openingPrompt: "", steps };
  // Grow prompts with escape-heavy text, then pad with plain bytes.
  let index = 0;
  while (serializedWorkflowSize(content) + Buffer.byteLength(JSON.stringify(unit)) < target) {
    const next = steps[index % 50].prompt + unit;
    if (Buffer.byteLength(next) > WORKFLOW_LIMITS.maxPromptBytes) break;
    steps[index % 50].prompt = next;
    index += 1;
  }
  for (let at = 0; serializedWorkflowSize(content) < target; at = (at + 1) % 50)
    if (Buffer.byteLength(steps[at].prompt) < WORKFLOW_LIMITS.maxPromptBytes) steps[at].prompt += "a";
  return content;
}

test("the serialized bound counts JSON escaping: 56 KiB passes and 56 KiB + 1 byte is refused with the size", () => {
  const limit = WORKFLOW_LIMITS.maxSerializedBytes;
  for (const unit of ["\"\\\t\n\r", "plain prose. "]) {
    const exact = contentOfSize(limit, unit);
    assert.equal(serializedWorkflowSize(exact), limit);
    const accepted = validateWorkflowInput(exact);
    assert.deepEqual(accepted.steps.map((item) => item.prompt), exact.steps.map((item) => item.prompt));
    const over = structuredClone(exact);
    const at = over.steps.findIndex((item) => Buffer.byteLength(item.prompt) < WORKFLOW_LIMITS.maxPromptBytes);
    over.steps[at].prompt += "a";
    assert.equal(serializedWorkflowSize(over), limit + 1);
    assert.throws(
      () => validateWorkflowInput(over),
      (error) => error.code === "invalid_workflow" && error.details?.size === limit + 1,
    );
  }
});

test("an agent-supplied step id is never kept", () => {
  const value = validateWorkflowInput({ name: "Agent", steps: [{ id: "step-mine", title: "One" }] });
  assert.notEqual(value.steps[0].id, "step-mine");
});

// 1.3 template repository

test("the template repository conflicts on a stale revision and keeps order across reload", async () => {
  const directory = root();
  const repository = new WorkflowTemplateRepository(createWorkflowTemplateFileBackend(directory));
  const first = await repository.apply({ command: { type: "upsert", template: template({ id: "tpl-a", name: "A" }) } });
  assert.equal(first.ok, true);
  await repository.apply({ command: { type: "upsert", template: template({ id: "tpl-b", name: "B" }) } });
  const stale = await repository.apply({
    expectedRevision: first.revision,
    command: { type: "remove", templateId: "tpl-a" },
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.conflict.code, "conflict");
  await repository.apply({ command: { type: "reorder", templateIds: ["tpl-b", "tpl-a"] } });

  const reloaded = new WorkflowTemplateRepository(createWorkflowTemplateFileBackend(directory));
  const state = await reloaded.load();
  assert.deepEqual(state.templates.map((item) => item.id), ["tpl-b", "tpl-a"]);
  assert.equal(state.revision, 3);
});

test("an empty category persists, and a command without categories keeps the stored list", async () => {
  const backend = createMemoryWorkflowTemplateBackend();
  const repository = new WorkflowTemplateRepository(backend);
  await repository.apply({ command: { type: "replace", templates: [template()], categories: ["Shipping", "Empty"] } });
  await repository.apply({ command: { type: "reorder", templateIds: ["tpl-standard"] } });
  const reloaded = new WorkflowTemplateRepository(backend);
  assert.deepEqual((await reloaded.load()).categories, ["Shipping", "Empty"]);
});

test("a repeated command id returns the first outcome", async () => {
  const repository = new WorkflowTemplateRepository(createMemoryWorkflowTemplateBackend());
  const envelope = { commandId: "cmd-1", command: { type: "upsert", template: template() } };
  const first = await repository.apply(envelope);
  const again = await repository.apply(envelope);
  assert.equal(again.revision, first.revision);
});

// 2.5 and 2.6 step rules, times, resume point

test("at most one step is active, and step_active names it", () => {
  const workflow = workflowOf([["a", "running"], ["b", "not_started"]]);
  assert.throws(
    () => applyStepUpdate(workflow, "b", "running", undefined, 1),
    (error) => error.code === "step_active" && error.details.stepId === "a",
  );
  assert.throws(
    () => applyStepUpdate(workflow, "b", "needs_input", undefined, 1),
    (error) => error.code === "step_active" && error.details.stepId === "a",
  );
  assert.throws(() => applyStepUpdate(workflow, "zzz", "done", undefined, 1), (error) => error.code === "step_not_found");
  // Any status may move to any status.
  const done = applyStepUpdate(workflow, "a", "done", undefined, 2);
  assert.equal(applyStepUpdate(done, "a", "not_started", undefined, 3).steps[0].status, "not_started");
});

test("a note replaces, an empty note clears, and an update without one keeps it", () => {
  let workflow = workflowOf([["a", "not_started"]]);
  workflow = applyStepUpdate(workflow, "a", "running", "first", 1);
  assert.equal(workflow.steps[0].note, "first");
  workflow = applyStepUpdate(workflow, "a", "needs_input", undefined, 2);
  assert.equal(workflow.steps[0].note, "first");
  workflow = applyStepUpdate(workflow, "a", "running", "", 3);
  assert.equal(workflow.steps[0].note, "");
  assert.throws(() => applyStepUpdate(workflow, "a", "done", "two\nlines", 4), code("invalid_workflow"));
  assert.throws(() => applyStepUpdate(workflow, "a", "done", "x".repeat(201), 4), code("invalid_workflow"));
});

test("step times follow the table", () => {
  const at = (status, from, extra) => applyStepUpdate(workflowOf([["a", from, extra]]), "a", status, undefined, 100).steps[0];
  for (const active of ["running", "needs_input"]) {
    // Start from not started.
    assert.deepEqual([at(active, "not_started").startedAt, at(active, "not_started").endedAt], [100, null]);
    // Retry of a finished step.
    for (const final of ["done", "failed"]) {
      const retried = at(active, final, { startedAt: 10, endedAt: 20 });
      assert.deepEqual([retried.startedAt, retried.endedAt], [100, null]);
    }
  }
  // Between running and needs_input both times are kept.
  const moved = at("needs_input", "running", { startedAt: 10 });
  assert.deepEqual([moved.startedAt, moved.endedAt], [10, null]);
  // Direct completion sets both.
  const direct = at("done", "not_started");
  assert.deepEqual([direct.startedAt, direct.endedAt], [100, 100]);
  // Finishing a running step keeps its start.
  const finished = at("failed", "running", { startedAt: 10 });
  assert.deepEqual([finished.startedAt, finished.endedAt], [10, 100]);
  // A repeated final status changes no time.
  const repeated = at("done", "done", { startedAt: 10, endedAt: 20 });
  assert.deepEqual([repeated.startedAt, repeated.endedAt], [10, 20]);
  // Reset clears both and the note.
  const reset = at("not_started", "done", { startedAt: 10, endedAt: 20, note: "ok" });
  assert.deepEqual([reset.startedAt, reset.endedAt, reset.note], [null, null, ""]);
});

test("the resume point is the active step, else the first step not done", () => {
  assert.equal(resumeStepId(workflowOf([["a", "done"], ["b", "failed"], ["c", "needs_input"]])), "c");
  assert.equal(resumeStepId(workflowOf([["a", "done"], ["b", "failed"], ["c", "not_started"]])), "b");
  assert.equal(resumeStepId(workflowOf([["a", "done"]])), null);
  assert.equal(isUnfinished(workflowOf([["a", "done"]])), false);
  assert.equal(isUnfinished(workflowOf([["a", "done"], ["b", "failed"]])), true);
});

// 2.1 – 2.4 store durability and lifetime

const content = validateWorkflowInput({ name: "Flow", steps: [step("One"), step("Two")] });
const fresh = (name = "Flow") => ({
  ...content,
  id: `wf-${name}`,
  name,
  templateId: null,
  createdAt: 0,
  steps: content.steps.map((item, index) => ({
    ...item,
    id: `step-${index}`,
    status: "not_started",
    note: "",
    startedAt: null,
    endedAt: null,
  })),
});

test("a change is on disk before it is acknowledged or published", () => {
  const directory = root();
  const store = new WorkflowStore({ directory });
  const seen = [];
  store.onChange((change) => {
    const record = JSON.parse(readFileSync(join(directory, workflowFileName("s1")), "utf8"));
    seen.push(record.workflow?.steps[0].status);
  });
  store.attach("s1", fresh());
  store.updateStep("s1", "step-0", "running");
  assert.deepEqual(seen, ["not_started", "running"]);
});

test("a failed write changes nothing and publishes nothing", () => {
  const directory = root();
  let fail = false;
  const fileOps = {
    openSync: (...args) => fs.openSync(...args),
    writeSync: (fd, data) => {
      if (fail) throw new Error("disk full");
      return fs.writeSync(fd, data);
    },
    fsyncSync: (fd) => fs.fsyncSync(fd),
    closeSync: (fd) => fs.closeSync(fd),
    renameSync: (from, to) => fs.renameSync(from, to),
    readFileSync: (path) => fs.readFileSync(path),
    rmSync: (path, options) => fs.rmSync(path, options),
    existsSync: (path) => fs.existsSync(path),
  };
  const store = new WorkflowStore({ directory, fileOps });
  store.attach("s1", fresh());
  let published = 0;
  store.onChange(() => (published += 1));
  fail = true;
  assert.throws(() => store.updateStep("s1", "step-0", "running"), code("write_failed"));
  assert.equal(store.get("s1").workflow.steps[0].status, "not_started");
  assert.equal(published, 0);
  fail = false;
  const reloaded = new WorkflowStore({ directory });
  reloaded.restore(["s1"]);
  assert.equal(reloaded.get("s1").workflow.steps[0].status, "not_started");
});

test("a crash at any point of a W1 to W2 replacement restores exactly one of them", () => {
  for (let crashAt = 1; ; crashAt += 1) {
    const directory = root();
    new WorkflowStore({ directory }).attach("s1", fresh("W1"));
    let calls = 0;
    const crash = (fn) => (...args) => {
      calls += 1;
      if (calls === crashAt) throw new Error("crash");
      return fn(...args);
    };
    const fileOps = {
      openSync: crash((...args) => fs.openSync(...args)),
      writeSync: crash((fd, data) => fs.writeSync(fd, data)),
      fsyncSync: crash((fd) => fs.fsyncSync(fd)),
      closeSync: (fd) => fs.closeSync(fd),
      renameSync: crash((from, to) => fs.renameSync(from, to)),
      readFileSync: crash((path) => fs.readFileSync(path)),
      rmSync: (path, options) => fs.rmSync(path, options),
      existsSync: (path) => fs.existsSync(path),
    };
    const writer = new WorkflowStore({ directory, fileOps });
    writer.restore(["s1"]);
    let crashed = false;
    try {
      writer.attach("s1", fresh("W2"), "wf-W1");
    } catch {
      crashed = true;
    }
    const reader = new WorkflowStore({ directory });
    reader.restore(["s1"]);
    const view = reader.get("s1");
    assert.equal(view?.state, "attached", `crash at call ${crashAt}`);
    assert.ok(["W1", "W2"].includes(view.workflow.name), `crash at call ${crashAt}`);
    if (!crashed) {
      assert.equal(view.workflow.name, "W2");
      assert.ok(crashAt > 3, "the replacement makes several file calls");
      break;
    }
  }
});

test("an unfinished workflow is replaced only when replaceWorkflowId names it", () => {
  const store = new WorkflowStore();
  store.attach("s1", fresh("W1"));
  assert.throws(
    () => store.attach("s1", fresh("W2")),
    (error) => error.code === "workflow_exists" && error.details.workflowId === "wf-W1",
  );
  assert.throws(() => store.attach("s1", fresh("W2"), "wf-other"), code("workflow_exists"));
  assert.equal(store.attach("s1", fresh("W2"), "wf-W1").workflow.name, "W2");
  // A finished workflow is replaced without confirmation.
  store.updateStep("s1", "step-0", "done");
  store.updateStep("s1", "step-1", "done");
  assert.equal(store.attach("s1", fresh("W3")).workflow.name, "W3");
});

test("restore keeps running sessions, discards closed ones, and falls back to .previous", () => {
  const directory = root();
  const store = new WorkflowStore({ directory });
  store.attach("running", fresh("Kept"));
  store.updateStep("running", "step-0", "running");
  store.attach("closed", fresh("Gone"));
  // Corrupt the current copy; the previous one is still valid.
  writeFileSync(join(directory, workflowFileName("running")), "{not json");

  const restored = new WorkflowStore({ directory });
  restored.restore(["running"]);
  const view = restored.get("running");
  assert.equal(view.state, "attached");
  assert.equal(view.workflow.name, "Kept");
  assert.equal(restored.get("closed"), undefined);
  const names = readdirSync(directory);
  assert.ok(!names.some((name) => name.startsWith(workflowFileName("closed"))));
  assert.ok(names.some((name) => name.includes(".corrupt-")), "the corrupt copy is kept aside");
});

test("a session whose copies are both corrupt stays unrestorable across restarts until removed", () => {
  const directory = root();
  const store = new WorkflowStore({ directory });
  store.attach("good", fresh("Good"));
  store.attach("bad", fresh("Bad"));
  store.updateStep("bad", "step-0", "done");
  writeFileSync(join(directory, workflowFileName("bad")), "{");
  writeFileSync(join(directory, `${workflowFileName("bad")}.previous`), "{");

  for (let restart = 0; restart < 2; restart += 1) {
    const restored = new WorkflowStore({ directory });
    restored.restore(["good", "bad"]);
    assert.equal(restored.get("good").state, "attached");
    assert.deepEqual(restored.get("bad"), { sessionId: "bad", state: "unrestorable" });
    assert.throws(() => restored.workflowOf("bad"), code("no_workflow"));
    assert.throws(() => restored.attach("bad", fresh()), code("workflow_exists"));
  }
  const restored = new WorkflowStore({ directory });
  restored.restore(["good", "bad"]);
  restored.remove("bad");
  assert.equal(restored.get("bad"), undefined);
  const again = new WorkflowStore({ directory });
  again.restore(["good", "bad"]);
  assert.equal(again.get("bad"), undefined);
  assert.equal(again.attach("bad", fresh("New")).workflow.name, "New");
});

test("a held session keeps its file over shutdown; ending the session deletes it", () => {
  const directory = root();
  const store = new WorkflowStore({ directory });
  store.attach("held", fresh());
  // Shutdown with the holder: nothing is deleted.
  const afterRestart = new WorkflowStore({ directory });
  afterRestart.restore(["held"]);
  assert.equal(afterRestart.get("held").state, "attached");
  let changes = 0;
  afterRestart.onChange((change) => {
    changes += 1;
    assert.equal(change.state, "none");
  });
  afterRestart.endSession("held");
  assert.equal(changes, 1);
  assert.deepEqual(readdirSync(directory), []);
  const later = new WorkflowStore({ directory });
  later.restore(["held"]);
  assert.equal(later.get("held"), undefined);
});

// 3.1 launch text

test("launch and resume text is /goal, the opening prompt, and the fixed instruction", () => {
  assert.equal(workflowLaunchText("Ship it."), `/goal Ship it.\n\n${WORKFLOW_LAUNCH_INSTRUCTION}`);
  assert.equal(workflowLaunchText("  "), `/goal ${WORKFLOW_LAUNCH_INSTRUCTION}`);
  assert.equal(workflowResumeText(""), `/goal ${WORKFLOW_RESUME_INSTRUCTION}`);
  assert.match(WORKFLOW_RESUME_INSTRUCTION, /resume_step_id/u);
  assert.throws(() => workflowLaunchText("x".repeat(16 * 1024)), code("invalid_workflow"));
});
