import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { EXTENSION_LIMITS, validateDeclarativeForm, validateOptionSourceResult } from "@terminay/extension-api";
import { ExtensionHost } from "../dist/extensions/index.js";

async function hostFixture() {
  const root = await mkdtemp(join(tmpdir(), "terminay-extension-resource-"));
  for (const name of ["config", "data", "cache"]) await mkdir(join(root, name));
  await writeFile(join(root, "extension.js"), `export function activate() { return { methods: { hold(_input, { signal }) { return new Promise((resolve) => signal.addEventListener("abort", () => resolve("cancelled"), { once: true })); } } }; }`);
  return { extensionId: "example.resources", packageRoot: root, entrypoint: "extension.js", configDirectory: join(root, "config"), dataDirectory: join(root, "data"), cacheDirectory: join(root, "cache"), permissions: [] };
}

test("menu option and progressive form inventories accept the advertised bound and reject one more", () => {
  const options = Array.from({ length: EXTENSION_LIMITS.fieldOptions }, (_, index) => ({ value: `item-${index}`, label: `Item ${index}` }));
  assert.equal(validateOptionSourceResult({ options }).ok, true);
  assert.equal(validateOptionSourceResult({ options: [...options, { value: "overflow", label: "Overflow" }] }).ok, false);

  const fields = Array.from({ length: EXTENSION_LIMITS.formFields }, (_, index) => ({ id: `field-${index}`, label: `Field ${index}`, type: "text" }));
  const form = { id: "bounded-form", title: "Bounded", submitLabel: "Save", sections: [{ id: "main", title: "Main", fields }] };
  assert.equal(validateDeclarativeForm(form).ok, true);
  assert.equal(validateDeclarativeForm({ ...form, sections: [{ ...form.sections[0], fields: [...fields, { id: "overflow", label: "Overflow", type: "text" }] }] }).ok, false);
});

test("provider IPC rejects the seventeenth simultaneous invocation within a bounded latency", async () => {
  const descriptor = await hostFixture();
  const controllers = Array.from({ length: 16 }, () => new AbortController());
  const host = new ExtensionHost(descriptor.extensionId, { broker: { async request() {} }, limits: { maxConcurrentInvocations: 16 } });
  await host.start(descriptor);
  const admitted = controllers.map((controller) => host.invoke({ method: "hold", signal: controller.signal }));
  const startedAt = performance.now();
  await assert.rejects(host.invoke({ method: "hold" }), /admission limit/);
  assert.ok(performance.now() - startedAt < 250, "admission rejection must not queue or block");
  for (const controller of controllers) controller.abort();
  await Promise.allSettled(admitted);
  assert.equal(host.status().state, "running");
  await host.stop();
});
