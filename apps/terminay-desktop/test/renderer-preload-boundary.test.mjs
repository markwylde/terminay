import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const rendererRoot = new URL("../src/renderer/", import.meta.url);

async function rendererSources(directory = rendererRoot) {
  const entries = await readdir(directory, { withFileTypes: true });
  const sources = [];
  for (const entry of entries) {
    const location = new URL(entry.name, directory);
    if (entry.isDirectory()) {
      sources.push(...await rendererSources(new URL(`${entry.name}/`, directory)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      sources.push({ path: join(directory.pathname, entry.name), source: await readFile(location, "utf8") });
    }
  }
  return sources;
}

test("Desktop renderer is limited to TerminayClient and the narrow host facade", async () => {
  const sources = await rendererSources();
  assert.ok(sources.length > 0, "renderer sources must be present");

  for (const { path, source } of sources) {
    assert.doesNotMatch(source, /from\s+["']electron["']|from\s+["'][^"']*(?:\/main\/|\/preload\/)[^"']*["']/u, path);
    assert.doesNotMatch(source, /\b(?:ipcRenderer|contextBridge|window\.terminay)\b/u, path);
  }
});
