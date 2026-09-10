import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  hostileManifestFixtures,
  validateExtensionManifest,
  validateLanguageServerContribution,
  validateLanguageServerLaunch,
  validLanguageServerManifestFixture,
} from "@terminay/extension-api";
import {
  createLanguageServerExtensionHarness,
  openLanguageServerSession,
} from "@terminay/extension-api/testing";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "../fixtures/language-server");
const sdkRoot = resolve(here, "..");

test("a language-server-only manifest is a supported contribution", () => {
  assert.equal(validateExtensionManifest(validLanguageServerManifestFixture).ok, true);
  const both = validateExtensionManifest({
    ...validLanguageServerManifestFixture,
    permissions: ["agent-observation"],
    contributes: {
      agentProviders: [{
        id: "dev.terminay.language-fixture/agent",
        displayName: "Fixture Agent",
        processMatchers: [{ executableName: "fixture-agent" }],
      }],
      languageServers: validLanguageServerManifestFixture.contributes.languageServers,
    },
  });
  assert.equal(both.ok, true);
});

test("language server contributions are bounded, declarative selectors", () => {
  const rejects = (patch, code) => {
    const result = validateLanguageServerContribution({
      ...validLanguageServerManifestFixture.contributes.languageServers[0],
      ...patch,
    });
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.code === code), `${code}: ${JSON.stringify(result.issues)}`);
  };
  rejects({ id: "TypeScript" }, "invalid_id");
  rejects({ languageIds: [] }, "invalid_array");
  rejects({ fileExtensions: [] }, "invalid_array");
  rejects({ fileExtensions: ["ts"] }, "invalid_file_extension");
  rejects({ fileExtensions: ["src/*.ts"] }, "invalid_file_extension");
  rejects({ fileExtensions: [".ts x"] }, "invalid_file_extension");
  rejects({ fileExtensions: [".ts", ".ts"] }, "duplicate");
  rejects({ command: "node" }, "unknown_field");
  for (const name of ["languageServerPathSelector", "languageServerEmptySelectors"])
    assert.equal(validateExtensionManifest(hostileManifestFixtures[name]).ok, false);
  const duplicated = validateExtensionManifest({
    ...validLanguageServerManifestFixture,
    contributes: {
      languageServers: [
        validLanguageServerManifestFixture.contributes.languageServers[0],
        validLanguageServerManifestFixture.contributes.languageServers[0],
      ],
    },
  });
  assert.equal(duplicated.ok, false);
  assert.ok(duplicated.issues.some((issue) => issue.code === "duplicate"));
});

test("a launch an extension returns is bounded before anything is spawned", () => {
  assert.equal(validateLanguageServerLaunch({ command: "typescript-language-server", args: ["--stdio"] }).ok, true);
  assert.equal(validateLanguageServerLaunch({ command: "node", args: Array.from({ length: 65 }, () => "-e") }).ok, false);
  assert.equal(validateLanguageServerLaunch({ command: "node", args: [], env: { "not a name": "x" } }).ok, false);
  assert.equal(validateLanguageServerLaunch({ command: "node", args: [], description: "x".repeat(201) }).ok, false);
  assert.equal(validateLanguageServerLaunch({ command: "node", args: [], cwd: "/" }).ok, false);
});

test("registration refuses an undeclared id and a second registration of one id", async () => {
  const runtime = { async launch() { return { command: "node", args: [] }; } };
  const register = (ids) => createLanguageServerExtensionHarness(
    {
      activate(context) {
        for (const id of ids) context.registerLanguageServerProvider({ id, runtime });
      },
    },
    { manifest: validLanguageServerManifestFixture },
  );
  await assert.rejects(register(["not-contributed"]), /undeclared or invalid/u);
  await assert.rejects(register(["fixture-language", "fixture-language"]), /Duplicate language server/u);
  const accepted = await register(["fixture-language"]);
  assert.deepEqual(accepted.registeredIds(), ["fixture-language"]);
  await accepted.dispose();
});

test("independent third-party language fixture validates, packs, activates, and serves LSP", async (t) => {
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  assert.equal(validateExtensionManifest(manifest.terminay).ok, true);

  const temporary = await mkdtemp(join(tmpdir(), "terminay-language-fixture-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  await execFileAsync("npm", ["pack", "--ignore-scripts", "--pack-destination", temporary], { cwd: packageRoot });
  const archives = (await readdir(temporary)).filter((name) => name.endsWith(".tgz"));
  assert.equal(archives.length, 1);
  const archive = join(temporary, archives[0]);
  const { stdout: listing } = await execFileAsync("tar", ["-tzf", archive]);
  assert.match(listing, /^package\/dist\/extension\.js$/mu);
  assert.match(listing, /^package\/dist\/stub-language-server\.js$/mu);

  const extracted = join(temporary, "package");
  await mkdir(extracted, { recursive: true });
  await execFileAsync("tar", ["-xzf", archive, "-C", extracted, "--strip-components=1"]);
  await mkdir(join(extracted, "node_modules", "@terminay"), { recursive: true });
  await symlink(sdkRoot, join(extracted, "node_modules", "@terminay", "extension-api"), "dir");

  // The public conformance CLI accepts the packed language-server package.
  const { stdout: conformance } = await execFileAsync(process.execPath, [
    join(sdkRoot, "dist", "conformance.js"),
    join(extracted, "package.json"),
  ]);
  assert.match(conformance, /dev\.terminay\.language-fixture/u);

  const loaded = await import(pathToFileURL(join(extracted, "dist", "extension.js")));
  const harness = await createLanguageServerExtensionHarness(loaded.default, {
    manifest: manifest.terminay,
  });
  t.after(() => harness.dispose());
  assert.deepEqual(harness.registeredIds(), ["fixture-language"]);
  await assert.rejects(
    harness.launch({ languageServerId: "not-contributed", projectRoot: temporary }),
    /Unknown language server/u,
  );

  const projectRoot = join(temporary, "project");
  await mkdir(projectRoot, { recursive: true });
  const documentPath = join(projectRoot, "main.fixture");
  await writeFile(documentPath, "let value = 1\n", "utf8");

  const launch = await harness.launch({ languageServerId: "fixture-language", projectRoot });
  assert.equal(launch.command, process.execPath);
  assert.equal(launch.description, "stub language server");

  const session = await openLanguageServerSession(launch, { projectRoot, timeoutMs: 20_000 });
  t.after(() => session.dispose());
  const initialized = await session.initialize();
  assert.equal(initialized.capabilities.hoverProvider, true);

  session.didOpen({ path: documentPath, languageId: "fixturelang", text: "let value = 1\n" });
  const diagnostics = await session.waitForDiagnostics(documentPath);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].message, "fixture diagnostic");

  const completion = await session.completion(documentPath, { line: 0, character: 4 });
  assert.equal(completion.items.length, 1);
  assert.equal(completion.items[0].label, "fixtureCompletion");
  const hover = await session.hover(documentPath, { line: 0, character: 4 });
  assert.equal(hover.contents.value, "fixture hover");
  const definition = await session.definition(documentPath, { line: 0, character: 4 });
  assert.equal(definition.length, 1);
  assert.match(definition[0].uri, /main\.fixture$/u);
});
