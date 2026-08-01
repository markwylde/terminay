import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { UiBundleStore } from "@terminay/server-core";
import { buildUiBundleManifest } from "../../../scripts/build-ui-bundle-manifest.mjs";
import { createEmbeddedServer, createLocalUiServer, createStandaloneServer } from "../dist/index.js";

test("one generated content-addressed UI bundle launches through standalone, embedded, and verified remote installation", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-generated-launch-"));
  try {
    const bundleRoot = join(root, "ui");
    await mkdir(join(bundleRoot, "assets"), { recursive: true });
    await writeFile(join(bundleRoot, "index.html"), '<!doctype html><script type="module" src="/assets/app.js"></script>');
    await writeFile(join(bundleRoot, "assets", "app.js"), "globalThis.__terminayReady = true;");
    const manifest = await buildUiBundleManifest({
      rootDirectory: bundleRoot,
      serverVersion: "4.0.0",
      protocolVersion: "1",
    });

    await assertLaunch({
      mode: "standalone",
      rootDirectory: bundleRoot,
      token: "generated-standalone-token",
      createRuntime: (uiServer) => createStandaloneServer({
        serverId: "generated-standalone",
        serverVersion: "4.0.0",
        dataRoot: join(root, "standalone-data"),
        uiServer,
      }),
      manifest,
    });
    await assertLaunch({
      mode: "embedded",
      rootDirectory: bundleRoot,
      token: "generated-embedded-token",
      createRuntime: (uiServer) => createEmbeddedServer({
        serverId: "generated-embedded",
        serverVersion: "4.0.0",
        dataRoot: join(root, "embedded-data"),
        uiServer,
      }),
      manifest,
    });

    const store = new UiBundleStore({ rootDirectory: join(root, "remote-bundles") });
    const prefix = `/remote-app/${manifest.bundleId}/`;
    await store.install({
      manifest,
      read: (path) => readFile(join(bundleRoot, ...path.slice(prefix.length).split("/"))),
    });
    await assertLaunch({
      mode: "remote",
      rootDirectory: root,
      bundleStore: store,
      token: "generated-remote-token",
      createRuntime: (uiServer) => createStandaloneServer({
        serverId: "generated-remote",
        serverVersion: "4.0.0",
        dataRoot: join(root, "remote-data"),
        uiServer,
      }),
      manifest,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function assertLaunch({ mode, rootDirectory, bundleStore, token, createRuntime, manifest }) {
  const uiServer = createLocalUiServer({
    rootDirectory,
    ...(bundleStore === undefined ? {} : { bundleStore }),
    serverId: `server-${mode}`,
    serverVersion: manifest.serverVersion,
    authToken: token,
  });
  const runtime = createRuntime(uiServer);
  await runtime.start();
  try {
    const address = uiServer.address;
    assert.ok(address);
    const headers = { Authorization: `Bearer ${token}` };
    const [entry, script, servedManifest] = await Promise.all([
      fetch(`${address.origin}/`, { headers }),
      fetch(`${address.origin}/assets/app.js`, { headers }),
      fetch(`${address.origin}/manifest.json`, { headers }),
    ]);
    assert.equal(entry.status, 200, `${mode} entry`);
    assert.equal(script.status, 200, `${mode} script`);
    assert.equal(servedManifest.status, 200, `${mode} manifest`);
    assert.match(await entry.text(), /assets\/app\.js/u);
    assert.equal(await script.text(), "globalThis.__terminayReady = true;");
    assert.deepEqual(await servedManifest.json(), manifest);
  } finally {
    await runtime.stop();
  }
}
