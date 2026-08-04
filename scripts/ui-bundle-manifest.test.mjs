import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  deriveUiBundleId,
  uiBundleIdentity,
  validateUiBundleManifest,
  verifyUiBundle,
} from "../packages/server-core/dist/index.js";
import {
  buildUiBundleManifest,
  UI_BUNDLE_CSP,
  UI_BUNDLE_HOST_COMPATIBILITY,
} from "./build-ui-bundle-manifest.mjs";

test("production UI manifest deterministically includes every emitted application asset and compatibility field", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-generated-ui-"));
  try {
    await mkdir(join(root, "assets"));
    await writeFile(
      join(root, "index.html"),
      '<!doctype html><link rel="stylesheet" href="/assets/app.css"><script type="module" src="/assets/app.js"></script>',
    );
    await writeFile(
      join(root, "assets", "app.js"),
      "export const ready = true;",
    );
    await writeFile(
      join(root, "assets", "app.css"),
      ":root { color: canvastext; }",
    );
    await writeFile(
      join(root, "terminay.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
    );

    const manifest = await buildUiBundleManifest({
      rootDirectory: root,
      serverVersion: "3.2.1",
      protocolVersion: "1",
    });
    assert.equal(manifest.serverVersion, "3.2.1");
    assert.equal(manifest.protocolVersion, "1");
    assert.equal(manifest.contentSecurityPolicy, UI_BUNDLE_CSP);
    assert.equal(manifest.bundleFormatVersion, 1);
    assert.deepEqual(manifest.hostCompatibility, UI_BUNDLE_HOST_COMPATIBILITY);
    assert.deepEqual(
      manifest.assets.map((asset) =>
        asset.path.slice(`/remote-app/${manifest.bundleId}/`.length),
      ),
      ["assets/app.css", "assets/app.js", "index.html", "terminay.svg"],
    );
    assert.equal(
      deriveUiBundleId(
        manifest.assets,
        manifest.bundleId,
        uiBundleIdentity(manifest),
      ),
      manifest.bundleId,
    );
    const verified = await verifyUiBundle(manifest, {
      read: (path) =>
        readFile(
          join(
            root,
            ...path
              .slice(`/remote-app/${manifest.bundleId}/`.length)
              .split("/"),
          ),
        ),
    });
    assert.match(
      new TextDecoder().decode(verified.read(manifest.entryPath)),
      /assets\/app\.js/u,
    );
    assert.deepEqual(
      JSON.parse(await readFile(join(root, "manifest.json"), "utf8")),
      manifest,
    );

    const originalId = manifest.bundleId;
    await writeFile(
      join(root, "assets", "app.js"),
      "export const ready = false;",
    );
    const changed = await buildUiBundleManifest({
      rootDirectory: root,
      serverVersion: "3.2.1",
      protocolVersion: "1",
    });
    assert.notEqual(changed.bundleId, originalId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("current UI manifests require compatibility metadata and bind it into the bundle id", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "terminay-generated-ui-compatibility-"),
  );
  try {
    await writeFile(join(root, "index.html"), "<!doctype html>");
    const manifest = await buildUiBundleManifest({
      rootDirectory: root,
      serverVersion: "3.2.1",
    });
    assert.doesNotThrow(() =>
      validateUiBundleManifest(manifest, { requireHostCompatibility: true }),
    );
    assert.throws(
      () =>
        validateUiBundleManifest(
          {
            ...manifest,
            bundleFormatVersion: undefined,
            hostCompatibility: undefined,
          },
          { requireHostCompatibility: true },
        ),
      /host compatibility metadata is required/u,
    );
    assert.throws(
      () =>
        validateUiBundleManifest({
          ...manifest,
          hostCompatibility: {
            ...manifest.hostCompatibility,
            hostBridge: { minimum: 1, maximum: 2 },
          },
        }),
      /bundle id does not match/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("production UI manifest generation rejects symbolic-link content", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "terminay-generated-ui-link-"));
  try {
    await writeFile(join(root, "index.html"), "<!doctype html>");
    const outside = join(
      root,
      "..",
      `outside-${createHash("sha256").update(root).digest("hex")}.js`,
    );
    await writeFile(outside, "secret");
    try {
      const { symlink } = await import("node:fs/promises");
      await symlink(outside, join(root, "escape.js"));
    } catch (error) {
      if (error?.code === "EPERM")
        return t.skip("symbolic links are unavailable");
      throw error;
    }
    await assert.rejects(
      buildUiBundleManifest({ rootDirectory: root, serverVersion: "1.0.0" }),
      /symbolic link/u,
    );
    await rm(outside, { force: true });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
