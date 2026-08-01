import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const image = process.env.TERMINAY_CONTAINER_IMAGE;
const enabled = process.env.TERMINAY_CONTAINER_SMOKE === "1";

/**
 * This is intentionally opt-in: CI environments that do not provide a
 * container runtime must not pretend to exercise a Linux image. Release and
 * local image verification invoke it with a freshly built image tag, e.g.:
 *
 *   TERMINAY_CONTAINER_SMOKE=1 \
 *   TERMINAY_CONTAINER_IMAGE=localhost/terminay-server:verify \
 *   node --test apps/terminay-server/test/docker-foreground-smoke.mjs
 */
test("standalone Docker image starts headlessly, becomes ready, and exits cleanly on SIGTERM", { skip: !enabled }, async () => {
  assert.ok(image, "TERMINAY_CONTAINER_IMAGE is required when TERMINAY_CONTAINER_SMOKE=1");
  const containerName = `terminay-task6-${process.pid}-${Date.now()}`;
  let started = false;

  try {
    await run("podman", [
      "run", "--detach", "--rm", "--name", containerName,
      "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
      "--publish", "127.0.0.1::8080",
      "--env", "TERMINAY_SERVER_ID=task6-foreground-smoke",
      "--env", "TERMINAY_SERVER_VERSION=task6",
      "--env", "TERMINAY_HTTP_HOST=0.0.0.0",
      "--env", "TERMINAY_HTTP_PORT=4317",
      "--env", "TERMINAY_HEALTH_HOST=0.0.0.0",
      "--env", "TERMINAY_HEALTH_PORT=8080",
      image,
    ]);
    started = true;

    const healthOrigin = await publishedOrigin(containerName);
    const ready = await eventually(async () => {
      const response = await fetch(`${healthOrigin}/readyz`).catch(() => undefined);
      return response?.ok === true ? response : undefined;
    });
    assert.ok(ready, "container did not become ready");
    assert.deepEqual(await ready.json(), {
      status: "ok",
      ready: true,
      phase: "ready",
      serverId: "task6-foreground-smoke",
      version: "task6",
    });

    await run("podman", ["kill", "--signal", "TERM", containerName]);
    const { stdout } = await run("podman", ["wait", containerName]);
    assert.equal(stdout.trim(), "0", "foreground runtime must exit cleanly after SIGTERM");
    started = false;
  } finally {
    if (started) await run("podman", ["rm", "--force", containerName]).catch(() => undefined);
  }
});

async function publishedOrigin(containerName) {
  const { stdout } = await run("podman", ["port", containerName, "8080/tcp"]);
  const address = stdout.trim().split(/\s+/u).find((value) => value.startsWith("127.0.0.1:"));
  assert.ok(address, `No loopback health port published: ${stdout}`);
  return `http://${address}`;
}

async function eventually(predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result !== undefined) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return undefined;
}

function run(command, args) {
  return execFileAsync(command, args, { encoding: "utf8" });
}
