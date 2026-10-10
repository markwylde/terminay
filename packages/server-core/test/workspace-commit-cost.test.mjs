import test from "node:test";
import assert from "node:assert/strict";
import {
  OrderedEventJournal,
  WorkspaceStore,
  createInitialWorkspace,
  createWorkspaceOperationRegistry,
} from "../dist/index.js";

/**
 * What one committed command costs the server, counted rather than timed: how
 * often the whole workspace state is copied, and how often it is written. The
 * counts must not grow with the workspace or with the number of observers
 * (ADR-0059).
 */

/** A workspace of `projects` projects with `terminals` terminals each. */
function workspaceOf(projects, terminals, options = {}) {
  const store = new WorkspaceStore(createInitialWorkspace("server-a"), options);
  const view = store.state.viewOrder[0];
  for (let p = 0; p < projects; p += 1) {
    const projectId = `project-${p}`;
    assert.equal(
      store.apply({ commandId: `create-${projectId}`, command: { type: "project.create", projectId, viewId: view, root: `/tmp/${projectId}`, name: projectId } }).ok,
      true,
    );
    for (let t = 0; t < terminals; t += 1) {
      const id = `${p}-${t}`;
      const applied = store.apply({
        commandId: `open-${id}`,
        command: { type: "terminal.createPanel", sessionId: `session-${id}`, projectId, panelId: `panel-${id}`, cwd: "/tmp", createdAt: 1 },
      });
      assert.equal(applied.ok, true, applied.conflict?.message);
    }
  }
  return store;
}

/** Count whole-state copies made while `run` executes. A copy is a
 * `structuredClone` of a value that holds the workspace's collections. */
function countStateCopies(run) {
  const original = globalThis.structuredClone;
  let copies = 0;
  const holdsState = (value) =>
    value !== null &&
    typeof value === "object" &&
    ((value.panels !== undefined && value.projects !== undefined) ||
      (value.state !== undefined && holdsState(value.state)));
  globalThis.structuredClone = (value, ...rest) => {
    if (holdsState(value)) copies += 1;
    return original(value, ...rest);
  };
  try {
    run();
  } finally {
    globalThis.structuredClone = original;
  }
  return copies;
}

const SIZES = [
  { projects: 2, terminals: 2 },
  { projects: 10, terminals: 4 },
  { projects: 40, terminals: 4 },
];

for (const size of SIZES) {
  test(`a rename copies the state once and writes it once (${size.projects} projects, ${size.terminals} terminals each)`, () => {
    let writes = 0;
    const store = workspaceOf(size.projects, size.terminals, { commit: () => { writes += 1; } });
    const journal = new OrderedEventJournal();
    const operations = createWorkspaceOperationRegistry(store, { eventJournal: journal });
    // The observers a composed server attaches: each is told of the commit.
    for (let observer = 0; observer < 4; observer += 1) store.subscribe(() => {});
    writes = 0;
    const copies = countStateCopies(() => {
      const applied = operations.applyHostCommand("rename-1", { type: "panel.update", panelId: "panel-0-0", patch: { title: "renamed" } });
      assert.equal(applied.ok, true, applied.conflict?.message);
    });
    assert.equal(writes, 1, "one durable write per commit");
    assert.equal(copies, 1, "one state copy per commit");
  });
}

test("reading the committed state copies nothing", () => {
  const store = workspaceOf(4, 4);
  const copies = countStateCopies(() => {
    for (let read = 0; read < 10; read += 1) {
      assert.equal(typeof store.state.revision, "number");
      assert.equal(store.snapshot().events.length, 0);
    }
  });
  assert.equal(copies, 0);
});
