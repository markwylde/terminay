import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import test from "node:test";

const root = resolve(new URL("..", import.meta.url).pathname);
const sourceExtensions = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx"]);

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["dist", "node_modules", "fixtures", "test"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (sourceExtensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

test("extension implementations use public SDK imports, never private Terminay modules", async () => {
  const roots = [join(root, "extensions"), join(root, "packages/extension-api/fixtures/agent-provider")];
  const violations = [];
  for (const directory of roots) {
    for (const file of await sourceFiles(directory)) {
      const source = await readFile(file, "utf8");
      for (const match of source.matchAll(/(?:from\s+|import\s*\()\s*["']([^"']+)["']/gu)) {
        const specifier = match[1];
        if (/^@terminay\/(?!extension-api(?:\/|$))/u.test(specifier) || /(?:^|\/)packages\/(?:server-core|client-core|ui-bundle|responsive-ui)(?:\/|$)|(?:^|\/)electron(?:\/|$)|(?:^|\/)src(?:\/|$)/u.test(specifier)) {
          violations.push(`${relative(root, file)} imports ${specifier}`);
        }
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("generic agent core and renderer contain no provider implementation details", async () => {
  const targets = [
    join(root, "packages/server-core/src/activity"),
    join(root, "packages/server-core/src/terminalService/types.ts"),
    join(root, "packages/server-core/src/terminalService/service.ts"),
    join(root, "packages/server-core/src/extensions/projectEnvironmentRuntime.ts"),
    join(root, "packages/server-core/src/extensions/localAgentObservation.ts"),
    join(root, "packages/client-core/src/agentStatus.ts"),
    join(root, "src/agentStatusStore.ts"),
  ];
  const forbidden = /\b(?:codex|claude-code|cursor-agent|oh-my-pi|omp|grok)\b|\.(?:codex|claude|cursor|omp|grok)(?:\/|["'])|\bsession_meta\b|\brollout-[^\s"']*|\boriginator\b\s*===?\s*["']codex-tui["']/iu;
  const violations = [];
  for (const target of targets) {
    const files = extname(target) ? [target] : await sourceFiles(target);
    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (forbidden.test(source)) violations.push(relative(root, file));
    }
  }
  assert.deepEqual(violations, [], "provider CLI names, journal schemas, roots, and mappings belong in extensions only");
});

test("production source has no leftover hard-coded agent drivers or private SSH/Puzed composition", async () => {
  const productionRoots = [
    join(root, "packages/server-core/src"),
    join(root, "packages/client-core/src"),
    join(root, "electron"),
    join(root, "src"),
    join(root, "apps/terminay-server/src"),
    join(root, "apps/terminay-desktop/src"),
  ];
  const forbiddenNames = new Set(["agentDrivers.ts", "agentJournal.ts", "ptyAgentBridge.ts", "ptyAgent.ts"]);
  const forbidden = /findProcessBoundCodexRollout|agentDriverRegistry|legacyPtyAgent|puzedSshComposition|composePuzedWithSsh/u;
  const violations = [];
  for (const directory of productionRoots) {
    for (const file of await sourceFiles(directory)) {
      if (forbiddenNames.has(file.split(/[\\/]/u).pop())) violations.push(relative(root, file));
      const source = await readFile(file, "utf8");
      if (forbidden.test(source)) violations.push(relative(root, file));
    }
  }
  assert.deepEqual(violations, [], "hard-coded agent drivers, journal sources, and private SSH/Puzed composition must not remain in production source");
});
