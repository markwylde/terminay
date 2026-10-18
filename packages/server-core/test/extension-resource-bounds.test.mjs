import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ExtensionHost } from "../dist/index.js";

async function hostFixture() {
  const root = await mkdtemp(join(tmpdir(), "terminay-extension-resource-"));
  for (const name of ["config", "data", "cache"]) await mkdir(join(root, name));
  await writeFile(join(root, "extension.js"), `export function activate() { return { methods: { hold(_input, { signal }) { return new Promise((resolve) => signal.addEventListener("abort", () => resolve("cancelled"), { once: true })); } } }; }`);
  return { extensionId: "example.resources", packageRoot: root, entrypoint: "extension.js", configDirectory: join(root, "config"), dataDirectory: join(root, "data"), cacheDirectory: join(root, "cache"), permissions: [] };
}

test("provider IPC rejects the seventeenth simultaneous invocation without waiting for a slot", async () => {
  const descriptor = await hostFixture();
  const controllers = Array.from({ length: 16 }, () => new AbortController());
  const host = new ExtensionHost(descriptor.extensionId, { broker: { async request() {} }, limits: { maxConcurrentInvocations: 16 } });
  await host.start(descriptor);
  let settledAdmitted = 0;
  const admitted = controllers.map((controller) =>
    host.invoke({ method: "hold", signal: controller.signal }).finally(() => { settledAdmitted += 1; }));
  // Every admitted invocation holds its slot until it is aborted, which only
  // happens below. A rejection that queued or blocked for a slot could only
  // arrive after one of them settled, so the order is the proof.
  await assert.rejects(host.invoke({ method: "hold" }), /admission limit/);
  assert.equal(settledAdmitted, 0, "admission rejection must not queue or block behind an admitted invocation");
  for (const controller of controllers) controller.abort();
  await Promise.allSettled(admitted);
  assert.equal(host.status().state, "running");
  await host.stop();
});

