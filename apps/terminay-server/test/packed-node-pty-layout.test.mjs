import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { stageProductionDependencyClosure } from "../../../scripts/standalone-runtime-dependencies.mjs";

const repositoryRoot = resolve(new URL("../../..", import.meta.url).pathname);
const supportedPlatform = process.platform === "darwin" || process.platform === "linux";

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolveRun({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}: ${stderr}`));
    });
  });
}

test("packed standalone node-pty resolves from its isolated closure despite hostile cwd module paths", { skip: !supportedPlatform }, async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-packed-node-pty-layout-"));
  try {
    const archives = join(root, "archives");
    const extracted = join(root, "extracted");
    await Promise.all([mkdir(archives), mkdir(extracted)]);
    const packed = JSON.parse((await run("npm", [
      "pack", "--workspace", "@terminay/server", "--json", "--pack-destination", archives,
    ], { cwd: repositoryRoot })).stdout);
    assert.equal(packed.length, 1);
    await run("tar", ["-xzf", join(archives, packed[0].filename), "-C", extracted]);

    const packageRoot = join(extracted, "package");
    await stageProductionDependencyClosure({
      destinationModules: join(packageRoot, "node_modules"),
      runtimeModules: join(repositoryRoot, "node_modules"),
      workspacePackages: {
        "@terminay/server-core": join(repositoryRoot, "packages/server-core"),
        "@terminay/protocol": join(repositoryRoot, "packages/protocol"),
      },
      rootPackages: ["@terminay/server-core", "@terminay/protocol", "@modelcontextprotocol/sdk", "node-pty", "zod"],
    });

    const hostileCwd = join(root, "hostile-cwd");
    const hostileModule = join(hostileCwd, "node_modules", "node-pty");
    await mkdir(hostileModule, { recursive: true });
    await writeFile(join(hostileModule, "package.json"), '{"name":"node-pty","main":"index.js"}\n');
    await writeFile(join(hostileModule, "index.js"), "throw new Error('hostile node-pty was loaded');\n");

    const proof = join(packageRoot, "dist", "packed-node-pty-layout-proof.mjs");
    await writeFile(proof, `import * as nodePty from "node-pty";
import { fileURLToPath } from "node:url";
const resolved = fileURLToPath(import.meta.resolve("node-pty"));
const terminal = nodePty.spawn("/bin/sh", ["-c", "printf 'PACKED_NODE_PTY_LAYOUT_OK\\\\n'"], { cols: 80, rows: 24, cwd: process.cwd(), name: "xterm-256color" });
let output = "";
const timeout = setTimeout(() => { terminal.kill(); process.exitCode = 1; }, 5_000);
terminal.onData((chunk) => { output += chunk; });
terminal.onExit(() => { clearTimeout(timeout); process.stdout.write(JSON.stringify({ resolved, output })); });
`);
    const result = await run(process.execPath, [proof], {
      cwd: hostileCwd,
      env: { ...process.env, NODE_PATH: join(hostileCwd, "node_modules") },
    });
    assert.equal(result.stderr, "");
    const evidence = JSON.parse(result.stdout);
    const stagedNodePty = await realpath(join(packageRoot, "node_modules", "node-pty"));
    assert.ok(
      evidence.resolved.startsWith(`${stagedNodePty}/`),
      `node-pty must resolve from the staged package closure, received ${evidence.resolved}`,
    );
    assert.ok(!evidence.resolved.includes(hostileCwd));
    assert.match(evidence.output, /PACKED_NODE_PTY_LAYOUT_OK/);
    assert.equal(
      JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")).bin["terminay-server"],
      "dist/cli.js",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
