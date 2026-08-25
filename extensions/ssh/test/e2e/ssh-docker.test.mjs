import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileStore, HostTrustManager, ConnectionPool, RemoteTerminalManager, SftpFilesystem } from "../../dist/index.js";

const image = "terminay-plugin-ssh-fixture:task46";
let container;

test.before(() => {
  const built = run("docker", ["build", "-t", image, new URL(".", import.meta.url).pathname]); assert.equal(built.status, 0, built.stderr);
  const started = run("docker", ["run", "-d", "-P", image]); assert.equal(started.status, 0, started.stderr); container = started.stdout.trim();
});
test.after(() => { if (container) run("docker", ["rm", "-f", container]); });

test("real Docker SSH proves strict trust, password auth, PTY, SFTP, and transport loss", async () => {
  const portResult = run("docker", ["port", container, "22/tcp"]); const port = Number(portResult.stdout.trim().split(":").at(-1)); assert.ok(port > 0);
  const root = await mkdtemp(join(tmpdir(), "terminay-ssh-e2e-")); const store = await new ProfileStore(join(root, "config"), join(root, "data")).load();
  await store.save({ id: "fixture", displayName: "Fixture", hostname: "127.0.0.1", port, username: "terminay", auth: { mode: "password", passwordSecretRef: "password" }, defaultRoot: "/home/terminay/project", hostVerification: "strict", timeouts: { connectMs: 5000, handshakeMs: 5000, keepaliveMs: 1000 } });
  const trust = new HostTrustManager(store); const broker = { secrets: { withValue: async (input, use) => { assert.equal(input.profileId, "fixture"); const bytes = Buffer.from("secret-pass"); try { return await use(bytes); } finally { bytes.fill(0); } } }, sshAgent: unavailableAgent() };
  const pool = new ConnectionPool({ store, trust, broker });
  let challenge; try { const lease = await pool.acquire("fixture", 1); lease.release(); } catch (e) { challenge = e; }
  assert.equal(challenge.code, "host-key-approval-required"); await trust.approve({ profileId: "fixture", expectedRevision: 1, challengeId: challenge.details.challengeId, action: "approve" }, "e2e");
  const lease = await pool.acquire("fixture", 1); lease.release(); assert.equal(pool.status("fixture", 1).status, "ready");
  const fs = new SftpFilesystem(pool); const rootResult = await fs.resolveRoot({ profileId: "fixture", revision: 1, root: "/home/terminay/project" }); assert.equal(rootResult.root, "/home/terminay/project");
  await fs.write({ profileId: "fixture", revision: 1, root: rootResult.root, path: "real.txt", data: "from docker" }); const read = await fs.read({ profileId: "fixture", revision: 1, root: rootResult.root, path: "real.txt" }); assert.equal(Buffer.from(read.data, "base64").toString(), "from docker");
  const terminals = new RemoteTerminalManager(pool); await terminals.create({ sessionId: "docker-shell", profileId: "fixture", revision: 1, root: rootResult.root, rows: 24, cols: 80, environment: { TERM: "xterm" } }); terminals.input({ sessionId: "docker-shell", data: "pwd\nprintf 'PTY_OK\\n'\n" });
  const output = await waitOutput(terminals, "docker-shell", "PTY_OK"); assert.match(output, /\/home\/terminay\/project/);
  run("docker", ["kill", container]); await waitFor(() => terminals.read({ sessionId: "docker-shell" }).exit?.interrupted === true); assert.equal(terminals.read({ sessionId: "docker-shell" }).exit.reason, "transport-lost");
  await pool.close();
});

test("real Docker SSH authenticates with a vault private key", async () => {
  const restarted = run("docker", ["start", container]); assert.equal(restarted.status, 0, restarted.stderr);
  const port = Number(run("docker", ["port", container, "22/tcp"]).stdout.trim().split(":").at(-1));
  const root = await mkdtemp(join(tmpdir(), "terminay-ssh-key-e2e-")); const keyPath = join(root, "id_ed25519");
  const generated = run("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", keyPath]); assert.equal(generated.status, 0, generated.stderr);
  const copied = run("docker", ["cp", `${keyPath}.pub`, `${container}:/tmp/terminay.pub`]); assert.equal(copied.status, 0, copied.stderr);
  const installed = run("docker", ["exec", container, "sh", "-c", "mkdir -p /home/terminay/.ssh && cat /tmp/terminay.pub > /home/terminay/.ssh/authorized_keys && chown -R terminay:terminay /home/terminay/.ssh && chmod 700 /home/terminay/.ssh && chmod 600 /home/terminay/.ssh/authorized_keys"]); assert.equal(installed.status, 0, installed.stderr);
  const privateKey = await readFile(keyPath); const store = await new ProfileStore(join(root, "config"), join(root, "data")).load();
  await store.save({ id: "key", displayName: "Key Fixture", hostname: "127.0.0.1", port, username: "terminay", auth: { mode: "private-key", privateKeySecretRef: "key-secret" }, defaultRoot: "~", hostVerification: "strict", timeouts: { connectMs: 5000, handshakeMs: 5000, keepaliveMs: 1000 } });
  const trust = new HostTrustManager(store); const broker = { secrets: { withValue: async (_input, use) => { const bytes = Buffer.from(privateKey); try { return await use(bytes); } finally { bytes.fill(0); } } }, sshAgent: unavailableAgent() }; const pool = new ConnectionPool({ store, trust, broker });
  let challenge; try { await pool.acquire("key", 1); } catch (e) { challenge = e; } assert.equal(challenge.code, "host-key-approval-required");
  await trust.approve({ profileId: "key", expectedRevision: 1, challengeId: challenge.details.challengeId, action: "approve" }, "e2e"); const lease = await pool.acquire("key", 1); lease.release(); assert.equal(pool.status("key", 1).status, "ready"); await pool.close();
});

async function waitOutput(terminals, sessionId, expected) { let output = ""; await waitFor(() => { output += Buffer.from(terminals.read({ sessionId }).data, "base64").toString(); return output.includes(expected); }); return output; }
async function waitFor(predicate) { const deadline = Date.now() + 10000; while (Date.now() < deadline) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 50)); } throw new Error("timed out waiting for fixture"); }
function run(command, args) { return spawnSync(command, args, { encoding: "utf8" }); }
function unavailableAgent() { return { listIdentities: async () => [], sign: async () => { throw new Error("unavailable"); } }; }
