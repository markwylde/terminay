import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { EXTENSION_LIMITS } from "@terminay/extension-api";
import { ExtensionHost } from "../dist/index.js";

async function hostFixture() {
  const root = await mkdtemp(join(tmpdir(), "terminay-extension-resource-"));
  for (const name of ["config", "data", "cache"]) await mkdir(join(root, name));
  await writeFile(join(root, "extension.js"), `export function activate() { return { methods: { hold(_input, { signal }) { return new Promise((resolve) => signal.addEventListener("abort", () => resolve("cancelled"), { once: true })); } } }; }`);
  return { extensionId: "example.resources", packageRoot: root, entrypoint: "extension.js", configDirectory: join(root, "config"), dataDirectory: join(root, "data"), cacheDirectory: join(root, "cache"), permissions: [] };
}

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

