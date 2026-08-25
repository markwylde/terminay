import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { createAgentExtensionHarness, fixtureTerminal } from "@terminay/extension-api/testing";
import { validateExtensionManifest } from "@terminay/extension-api";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "../fixtures/agent-provider");
const sdkRoot = resolve(here, "..");

test("independent third-party fixture validates, packs, activates, and maps lifecycle", async (t) => {
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  assert.equal(validateExtensionManifest(manifest.terminay).ok, true);

  const temporary = await mkdtemp(join(tmpdir(), "terminay-third-party-agent-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  await execFileAsync("npm", ["pack", "--ignore-scripts", "--pack-destination", temporary], { cwd: packageRoot });
  const archives = (await readdir(temporary)).filter((name) => name.endsWith(".tgz"));
  assert.equal(archives.length, 1);
  const archive = join(temporary, archives[0]);
  const { stdout: archiveListing } = await execFileAsync("tar", ["-tzf", archive]);
  assert.match(archiveListing, /^package\/dist\/extension\.js$/m);
  assert.match(archiveListing, /^package\/README\.md$/m);

  const extracted = join(temporary, "package");
  await mkdir(extracted, { recursive: true });
  await execFileAsync("tar", ["-xzf", archive, "-C", extracted, "--strip-components=1"]);
  await mkdir(join(extracted, "node_modules", "@terminay"), { recursive: true });
  await symlink(sdkRoot, join(extracted, "node_modules", "@terminay", "extension-api"), "dir");

  const loaded = await import(pathToFileURL(join(extracted, "dist", "extension.js")));
  const harness = await createAgentExtensionHarness(loaded.default);
  t.after(() => harness.dispose());
  await harness.observe(fixtureTerminal({
    foregroundExecutable: "fixture-agent",
    files: {
      "/home/test/.fixture-agent/session.jsonl": [
        { type: "session", title: "Public fixture" },
        { type: "turn", id: "turn-1" },
        { type: "done" },
      ],
    },
  }));
  assert.deepEqual(harness.events().map((event) => event.kind), ["session.started", "turn.started", "agent.done"]);
});
