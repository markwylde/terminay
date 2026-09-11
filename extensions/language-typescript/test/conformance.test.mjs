import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createLanguageServerExtensionHarness, openLanguageServerSession } from "@terminay/extension-api/testing";
import extension, { languageServerCliPath } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")).terminay;

/** The real language server, or the reason this suite cannot run. */
function missingLanguageServer() {
  try {
    languageServerCliPath();
    return undefined;
  } catch (error) {
    return `typescript-language-server is not installed: ${error.message}`;
  }
}

const MAIN = [
  'import { greet } from "local-dep";',
  "",
  'export const value: number = greet("world");',
  "",
].join("\n");

/**
 * A real project: a `tsconfig`, a dependency resolved through `node_modules`,
 * the project's own TypeScript, and one genuine type error. Nothing here is a
 * stub — the assertions below are only worth anything against the real server.
 */
async function createFixtureProject() {
  const root = await mkdtemp(join(tmpdir(), "terminay-ts-conformance-"));
  await writeFile(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        allowJs: true,
        checkJs: true,
        jsx: "preserve",
        noEmit: true,
      },
      include: ["src"],
    }, null, 2),
    "utf8",
  );
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture-project", version: "1.0.0", type: "module" }, null, 2), "utf8");

  const dependency = join(root, "node_modules", "local-dep");
  await mkdir(dependency, { recursive: true });
  await writeFile(join(dependency, "package.json"), JSON.stringify({ name: "local-dep", version: "1.0.0", types: "index.d.ts", main: "index.js" }), "utf8");
  await writeFile(join(dependency, "index.d.ts"), "export declare function greet(name: string): string;\n", "utf8");
  await writeFile(join(dependency, "index.js"), 'export function greet(name) { return "hello " + name; }\n', "utf8");

  // The project's own TypeScript, so the session reports `project typescript`.
  await symlink(join(packageRoot, "node_modules", "typescript"), join(root, "node_modules", "typescript"), "dir");

  const source = join(root, "src");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "main.ts"), MAIN, "utf8");
  await writeFile(join(source, "widget.tsx"), 'export const count: number = "not a number";\n', "utf8");
  await writeFile(join(source, "legacy.js"), "/** @type {number} */\nexport const total = \"not a number\";\n", "utf8");
  await writeFile(join(source, "panel.jsx"), "/** @type {number} */\nexport const size = \"not a number\";\n", "utf8");
  return root;
}

const skip = missingLanguageServer();

test("the real typescript-language-server serves the project's TypeScript", { skip, timeout: 180_000 }, async (t) => {
  const projectRoot = await createFixtureProject();
  t.after(() => rm(projectRoot, { recursive: true, force: true }));

  const harness = await createLanguageServerExtensionHarness(extension, { manifest });
  t.after(() => harness.dispose());
  const launch = await harness.launch({ languageServerId: "typescript", projectRoot });
  assert.match(launch.description, /^project typescript \d+\.\d+/u);
  assert.equal(launch.initializationOptions.tsserver.path, join(projectRoot, "node_modules", "typescript", "lib", "tsserver.js"));

  const session = await openLanguageServerSession(launch, { projectRoot, timeoutMs: 90_000 });
  t.after(() => session.dispose());
  const initialized = await session.initialize();
  assert.ok(initialized.capabilities.completionProvider, "the server advertises completion");
  assert.ok(initialized.capabilities.definitionProvider, "the server advertises definition");

  const main = join(projectRoot, "src", "main.ts");
  session.didOpen({ path: main, languageId: "typescript", text: MAIN });

  // The dependency's declaration file is a real type error's source of truth:
  // `greet` returns a string and the declaration says so.
  const errors = await session.waitForDiagnostics(
    main,
    (diagnostics) => diagnostics.some((diagnostic) => diagnostic.severity === 1),
    90_000,
  );
  const error = errors.find((diagnostic) => diagnostic.severity === 1);
  assert.match(error.message, /string.*not assignable.*number/isu);

  // The import resolves through node_modules, so definition lands in the
  // dependency's own declaration file rather than nowhere.
  const line = MAIN.split("\n")[2];
  const definition = await session.definition(main, { line: 2, character: line.indexOf("greet") + 1 });
  const locations = Array.isArray(definition) ? definition : [definition];
  assert.ok(locations.length > 0, "definition returned a location");
  assert.match(locations[0].uri ?? locations[0].targetUri, /local-dep\/index\.d\.ts$/u);

  const hover = await session.hover(main, { line: 2, character: line.indexOf("greet") + 1 });
  assert.match(JSON.stringify(hover.contents), /greet/u);

  const completion = await session.completion(main, { line: 2, character: line.indexOf("greet") + 3 });
  const items = Array.isArray(completion) ? completion : completion.items;
  assert.ok(items.some((item) => item.label === "greet"), "completion lists the imported symbol");

  // Every extension the manifest claims is really served by this server.
  for (const [file, languageId, text] of [
    ["widget.tsx", "typescriptreact", 'export const count: number = "not a number";\n'],
    ["legacy.js", "javascript", "/** @type {number} */\nexport const total = \"not a number\";\n"],
    ["panel.jsx", "javascriptreact", "/** @type {number} */\nexport const size = \"not a number\";\n"],
  ]) {
    const path = join(projectRoot, "src", file);
    session.didOpen({ path, languageId, text });
    const published = await session.waitForDiagnostics(
      path,
      (diagnostics) => diagnostics.some((diagnostic) => diagnostic.severity === 1),
      90_000,
    );
    assert.ok(published.length > 0, `${file} received diagnostics`);
  }
});
