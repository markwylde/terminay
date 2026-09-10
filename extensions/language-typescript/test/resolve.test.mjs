import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateExtensionManifest, validateLanguageServerLaunch } from "@terminay/extension-api";
import { createLanguageServerExtensionHarness } from "@terminay/extension-api/testing";
import extension, { LANGUAGE_SERVER_ID, bundledTypeScript, languageServerCliPath, resolveTypeScript, typescriptLanguageServer } from "../dist/index.js";

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).terminay;

async function projectWithTypeScript(version) {
  const root = await mkdtemp(join(tmpdir(), "terminay-language-typescript-"));
  if (version) {
    const installed = join(root, "node_modules", "typescript");
    await mkdir(join(installed, "lib"), { recursive: true });
    await writeFile(join(installed, "package.json"), JSON.stringify({ name: "typescript", version }), "utf8");
    await writeFile(join(installed, "lib", "tsserver.js"), "// fixture tsserver\n", "utf8");
  }
  return root;
}

test("the manifest contributes one TypeScript language server", () => {
  assert.equal(validateExtensionManifest(manifest).ok, true);
  assert.equal(manifest.id, "com.terminay.language.typescript");
  const [contributed] = manifest.contributes.languageServers;
  assert.equal(contributed.id, LANGUAGE_SERVER_ID);
  assert.deepEqual(contributed.languageIds, ["typescript", "typescriptreact", "javascript", "javascriptreact"]);
  assert.deepEqual(contributed.fileExtensions, [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
});

test("activation registers exactly the contributed language server", async () => {
  const harness = await createLanguageServerExtensionHarness(extension, { manifest });
  assert.deepEqual(harness.registeredIds(), ["typescript"]);
  await harness.dispose();
});

test("a project with its own TypeScript is served by that TypeScript", async (t) => {
  const root = await projectWithTypeScript("4.9.9");
  t.after(() => rm(root, { recursive: true, force: true }));
  const resolved = resolveTypeScript(root);
  assert.equal(resolved.source, "project");
  assert.equal(resolved.version, "4.9.9");
  assert.equal(resolved.tsserverPath, join(root, "node_modules", "typescript", "lib", "tsserver.js"));
  assert.equal(resolved.description, "project typescript 4.9.9");

  const launch = await typescriptLanguageServer.launch(
    { languageServerId: "typescript", projectRoot: root },
    new AbortController().signal,
  );
  assert.equal(validateLanguageServerLaunch(launch).ok, true);
  assert.equal(launch.command, process.execPath);
  assert.equal(launch.args.at(-1), "--stdio");
  assert.equal(launch.args[0], languageServerCliPath());
  assert.equal(launch.initializationOptions.tsserver.path, resolved.tsserverPath);
  assert.equal(launch.description, "project typescript 4.9.9");
});

test("a project without TypeScript is served by the bundled TypeScript", async (t) => {
  const root = await projectWithTypeScript(null);
  t.after(() => rm(root, { recursive: true, force: true }));
  const bundled = bundledTypeScript();
  const resolved = resolveTypeScript(root);
  assert.equal(resolved.source, "bundled");
  assert.equal(resolved.tsserverPath, bundled.tsserverPath);
  assert.match(resolved.description, /^bundled typescript \d+\.\d+/u);
  assert.equal(resolved.tsserverPath.includes(root), false);

  const launch = await typescriptLanguageServer.launch(
    { languageServerId: "typescript", projectRoot: root },
    new AbortController().signal,
  );
  assert.equal(launch.initializationOptions.tsserver.path, bundled.tsserverPath);
  assert.equal(launch.description, resolved.description);
});

test("a project directory that is not TypeScript's own is never mistaken for it", async (t) => {
  const root = await projectWithTypeScript(null);
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "node_modules", "typescript"), { recursive: true });
  // A `typescript` directory with no tsserver is not a usable TypeScript.
  assert.equal(resolveTypeScript(root).source, "bundled");
  assert.throws(() => resolveTypeScript("relative/path"), /absolute/u);
});

test("an aborted launch starts nothing", async (t) => {
  const root = await projectWithTypeScript(null);
  t.after(() => rm(root, { recursive: true, force: true }));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    typescriptLanguageServer.launch({ languageServerId: "typescript", projectRoot: root }, controller.signal),
    /aborted/u,
  );
});

test("the extension imports only the public SDK and Node built-ins", async () => {
  for (const file of ["index.ts", "resolve.ts"]) {
    const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
    for (const match of source.matchAll(/from '([^']+)'/gu)) {
      const specifier = match[1];
      assert.ok(
        specifier.startsWith("@terminay/extension-api") || specifier.startsWith("node:") || specifier.startsWith("./"),
        `${file}: ${specifier}`,
      );
    }
  }
});
