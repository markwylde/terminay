import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PuzedInvalidationReconciler, PuzedStateRepository } from "../dist/index.js";

test("cursor, retained SSH binding, machine, job, and address survive restart", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "terminay-puzed-state-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "state.json");
  const state = await PuzedStateRepository.open(file);
  await state.save("profile", "44");
  await state.saveBinding({ platformProfileId: "profile", machineId: "machine", sshUsername: "vms", sshBindingId: "binding:key" });
  await state.saveMachine("profile", { id: "machine", name: "dev", tags: ["system:Terminay"] });
  await state.saveJob("profile", { id: "job", status: "running" });
  await state.saveAddress("profile", "machine", "10.0.0.3");
  const restored = await PuzedStateRepository.open(file);
  assert.equal(await restored.load("profile"), "44");
  assert.equal((await restored.get("profile", "machine")).sshBindingId, "binding:key");
  assert.equal(restored.machine("profile", "machine").name, "dev");
  assert.equal(restored.job("profile", "job").status, "running");
  assert.equal(restored.address("profile", "machine"), "10.0.0.3");
  assert.equal((await readFile(file, "utf8")).includes("private"), false);
});

test("SSE invalidations refetch authoritative machine/job resources", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "terminay-puzed-reconcile-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const state = await PuzedStateRepository.open(join(directory, "state.json"));
  let resyncs = 0;
  const reconciler = new PuzedInvalidationReconciler("profile", {
    getMachine: async () => ({ machine: { id: "machine", name: "updated", tags: ["system:Terminay"] } }),
    getJob: async () => ({ id: "job", status: "succeeded" }),
  }, state, async () => { resyncs++; });
  await reconciler.handle({ kind: "entity", event: { id: "machine", type: "machine", method: "updated" } });
  await reconciler.handle({ kind: "entity", event: { id: "job", type: "job", method: "updated" } });
  await reconciler.handle({ kind: "entity", event: { id: "nic", type: "network_interface", method: "updated" } });
  await reconciler.handle({ kind: "resync" });
  assert.equal(state.machine("profile", "machine").name, "updated");
  assert.equal(state.job("profile", "job").status, "succeeded");
  assert.equal(resyncs, 2);
});
