import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * The standalone CLI runs on import, so its wiring is checked at the source.
 * Git, file observations, and language sessions are released by the shared
 * composition (covered in server-core); this host must release its own
 * per-project records on the same `project.close`.
 */
const source = await readFile(new URL("../src/cli.ts", import.meta.url), "utf8");

test("the standalone server releases its per-project records when a project closes", () => {
  const operations = source.match(/workspaceOperations: \{[\s\S]*?\n\t\t\},\n/u)?.[0] ?? "";
  assert.match(operations, /releaseProject: \(projectId\) => \{[\s\S]*?files\.releaseProject\(projectId\);[\s\S]*?agentScope\.removeProject\(projectId\);/u);

  const release = source.match(/releaseProject: \(projectId\) => \{\n\t\t\tmdxRuntime\.disposeProject[\s\S]*?\n\t\t\},/u)?.[0] ?? "";
  for (const map of ["sessionProjects", "contentProjects", "catalogProjects", "documentationProjects", "mdxRuntimeProjects"])
    assert.match(release, new RegExp(`${map}\\.delete\\(projectId\\)`, "u"), `${map} is not released`);
});
