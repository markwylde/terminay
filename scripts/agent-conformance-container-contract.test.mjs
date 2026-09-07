import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const text = (path) => readFile(new URL(path, root), "utf8");

/** Every directory under `extensions/` whose name marks it an agent provider. */
async function agentExtensions() {
  const entries = await readdir(new URL("extensions/", root), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("agent-"))
    .map((entry) => entry.name)
    .sort();
}

test("every agent extension ships a conformance image", async () => {
  const extensions = await agentExtensions();
  assert.ok(extensions.length > 0, "no agent extensions were discovered");
  for (const extension of extensions) {
    await assert.doesNotReject(
      text(`extensions/${extension}/Dockerfile`),
      `${extension} must ship a Dockerfile that installs its CLI and runs its conformance suite`,
    );
  }
});

/**
 * Terminay supports the latest CLI of each provider and nothing older. A
 * pinned version in one of these images would quietly hold a provider at a
 * release the product does not claim to support, and the suite would keep
 * reporting green against it.
 */
test("conformance images install the latest CLI rather than a pinned version", async () => {
  for (const extension of await agentExtensions()) {
    const dockerfile = await text(`extensions/${extension}/Dockerfile`);
    // The CLI install is the instruction carrying CLI_REVISION; the image's own
    // toolchain (a pinned npm, a bun runtime) is deliberately not. Shell line
    // continuations are joined first, because an install that needs extra flags
    // spans several lines and its version would otherwise not be on the line
    // the marker is on.
    const installs = dockerfile
      .replace(/\\\n\s*/gu, " ")
      .split("\n")
      .filter((line) => /CLI_REVISION=\$\{CLI_REVISION\}/u.test(line));
    assert.equal(installs.length, 1, `${extension} must install exactly one CLI under CLI_REVISION`);
    const [install] = installs;
    assert.doesNotMatch(
      install,
      /@\d+\.\d+/u,
      `${extension} pins a CLI version: ${install.trim()}`,
    );
    assert.match(
      install,
      /@latest|install\.sh/u,
      `${extension} must install the latest CLI: ${install.trim()}`,
    );
    // Docker would otherwise serve the CLI layer from cache forever, so a
    // "latest" install would freeze at whatever the first build resolved.
    assert.match(
      dockerfile,
      /ARG CLI_REVISION=/u,
      `${extension} must accept CLI_REVISION so the CLI layer is not cached`,
    );
  }
});

test("every agent extension is runnable through the conformance runner", async () => {
  const runner = await text("scripts/run-agent-conformance-container.sh");
  for (const extension of await agentExtensions()) {
    assert.match(
      runner,
      new RegExp(`^\\s*${extension}\\)`, "mu"),
      `${extension} must have a case in run-agent-conformance-container.sh naming its enable flag and required key`,
    );
  }
});

/**
 * The credentials only ever reach a container. A conformance run that read the
 * developer's home would authenticate as whoever is logged in, which is what
 * made these tests impossible to reproduce in CI.
 */
test("the conformance runner mounts no host directory", async () => {
  const runner = await text("scripts/run-agent-conformance-container.sh");
  // `command -v docker` is not a mount; only docker run flags are.
  const runFlags = runner.slice(runner.indexOf("docker run --rm"));
  assert.doesNotMatch(runFlags, /--volume|--mount|\s-v\s/u);
  assert.match(runner, /docker run --rm/u);
});

/**
 * These images are generated from one another, so a copied CMD can silently
 * run a different extension's suite — the Grok image shipped running Claude
 * Code's until this caught it.
 */
test("each conformance image runs its own extension's suite", async () => {
  for (const extension of await agentExtensions()) {
    const [dockerfile, manifest] = await Promise.all([
      text(`extensions/${extension}/Dockerfile`),
      text(`extensions/${extension}/package.json`),
    ]);
    const { name } = JSON.parse(manifest);
    // The suite may be launched directly or through an entrypoint script that
    // first prepares the container — Claude Code pre-records its API-key
    // approval, Codex exchanges its key for a login. Either way the image must
    // end up running this workspace's own conformance suite and no other.
    const cmd = dockerfile.split("\n").find((line) => line.startsWith("CMD ")) ?? "";
    assert.notEqual(cmd, "", `${extension}'s image must declare a CMD`);
    const launcher = /([\w./-]*conformance-entrypoint\.sh)/u.exec(cmd)?.[1];
    const launched = launcher
      ? await text(`extensions/${extension}/${launcher.split("/").pop()}`)
      : cmd;
    assert.match(
      launched,
      new RegExp(`test:conformance[^\n]*--workspace ${name}|--workspace", "${name}"`, "u"),
      `${extension}'s image must run ${name}'s conformance suite`,
    );
  }
});
