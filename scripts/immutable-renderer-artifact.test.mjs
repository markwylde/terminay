import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildUiBundleManifest } from "./build-ui-bundle-manifest.mjs";
import { stageImmutableRendererArtifact, validateRendererArtifact } from "./immutable-renderer-artifact.mjs";

test("immutable renderer staging validates the complete manifest and isolates an active run from source rebuilds", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-immutable-renderer-"));
  try {
    const source = join(root, "dist");
    await mkdir(join(source, "assets"), { recursive: true });
    await writeFile(join(source, "index.html"), '<script type="module" src="/assets/app.js"></script>');
    await writeFile(join(source, "assets", "app.js"), "export const version = 1;");
    const first = await buildUiBundleManifest({ rootDirectory: source, serverVersion: "1.0.0" });
    const staged = await stageImmutableRendererArtifact({ sourceRoot: source, destinationParent: join(root, "run") });

    await writeFile(join(source, "assets", "app.js"), "export const version = 2;");
    const second = await buildUiBundleManifest({ rootDirectory: source, serverVersion: "1.0.0" });
    assert.notEqual(second.bundleId, first.bundleId);
    assert.equal((await validateRendererArtifact(staged.rootDirectory)).bundleId, first.bundleId);
    assert.equal(await readFile(join(staged.rootDirectory, "assets", "app.js"), "utf8"), "export const version = 1;");
    await staged.assertUnchanged();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("renderer artifact validation rejects missing, tampered, and undeclared chunks", async (t) => {
  for (const scenario of ["missing", "tampered", "undeclared"]) {
    await t.test(scenario, async () => {
      const root = await mkdtemp(join(tmpdir(), `terminay-renderer-${scenario}-`));
      try {
        await mkdir(join(root, "assets"));
        await writeFile(join(root, "index.html"), '<script type="module" src="/assets/app.js"></script>');
        await writeFile(join(root, "assets", "app.js"), "export const ready = true;");
        await buildUiBundleManifest({ rootDirectory: root, serverVersion: "1.0.0" });
        if (scenario === "missing") await rm(join(root, "assets", "app.js"));
        if (scenario === "tampered") await writeFile(join(root, "assets", "app.js"), "tampered");
        if (scenario === "undeclared") await writeFile(join(root, "assets", "late.js"), "late");
        const expected = scenario === "undeclared" ? /complete file tree/u : scenario === "tampered" ? /size mismatch|hash mismatch/u : /missing/u;
        await assert.rejects(validateRendererArtifact(root), expected);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});
