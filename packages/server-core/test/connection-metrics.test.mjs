import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONNECTION_METRICS_CAPABILITY,
  CONNECTION_METRICS_OPERATIONS,
} from "@terminay/protocol";
import {
  CONNECTION_METRICS_FILE,
  ConnectionMetricsService,
  DEFAULT_SERVER_SETTINGS,
  connectionMetricsEnabledFrom,
  createServerCoreComposition,
  stats,
} from "../dist/index.js";

const recover = (extra = {}) => ({
  kind: "recover",
  trigger: "resume-probe",
  host: "browser",
  attempts: 1,
  hiddenMs: 62_000,
  detectMs: 1_500,
  transportMs: 420,
  helloMs: 30,
  syncMs: 180,
  totalMs: 630,
  ...extra,
});

async function tempFile() {
  return join(await mkdtemp(join(tmpdir(), "terminay-metrics-")), CONNECTION_METRICS_FILE);
}

test("recording is off by default and stores nothing", async () => {
  assert.equal(DEFAULT_SERVER_SETTINGS.remoteAccess.connectionMetrics, false);
  assert.equal(connectionMetricsEnabledFrom(DEFAULT_SERVER_SETTINGS), false);
  const service = new ConnectionMetricsService({ enabled: () => false });
  assert.equal(service.record(recover()), false);
  assert.equal(service.summary().count, 0);
  assert.equal(service.summary().enabled, false);
});

test("a recovery is stored with its durations and summarised per trigger", async () => {
  const file = await tempFile();
  let now = 1_000;
  const service = new ConnectionMetricsService({ file, enabled: () => true, now: () => now });
  assert.equal(service.record(recover()), true);
  now = 2_000;
  assert.equal(service.record(recover({ totalMs: 900, attempts: 2, failure: "timeout" })), true);
  now = 3_000;
  assert.equal(service.record({ kind: "resume-alive", trigger: "resume-probe", host: "browser", probeRttMs: 12 }), true);
  await service.flush();

  const summary = service.summary();
  assert.equal(summary.count, 3);
  assert.equal(summary.since, 1_000);
  assert.equal(summary.until, 3_000);
  assert.deepEqual(summary.byKind, { recover: 2, "resume-alive": 1 });
  const resume = summary.byTrigger["resume-probe"];
  assert.equal(resume.count, 3);
  assert.equal(resume.retried, 1);
  assert.deepEqual(resume.durations.totalMs, { count: 2, mean: 765, p50: 630, p95: 900, max: 900 });
  assert.equal(summary.recent[0].at, 3_000, "most recent first");

  // A fresh service reads the same samples back from the data root.
  const reloaded = new ConnectionMetricsService({ file, enabled: () => true });
  assert.equal(reloaded.summary().count, 3);
});

test("unknown fields and invalid values are dropped, never stored", async () => {
  const file = await tempFile();
  const service = new ConnectionMetricsService({ file, enabled: () => true });
  assert.equal(service.record(recover({ deviceId: "phone-1", hostname: "mac.local", totalMs: "fast", syncMs: -5, failure: "boom" })), true);
  assert.equal(service.record({ kind: "recover", trigger: "nope", host: "browser" }), false, "a sample without a known trigger is refused");
  assert.equal(service.record("not a sample"), false);
  await service.flush();
  const text = await readFile(file, "utf8");
  assert.equal(text.includes("phone-1"), false);
  assert.equal(text.includes("mac.local"), false);
  const [stored] = service.summary().recent;
  assert.equal(stored.totalMs, undefined);
  assert.equal(stored.syncMs, undefined);
  assert.equal(stored.failure, undefined);
  assert.equal(stored.transportMs, 420);
});

test("the store keeps the newest samples and skips corrupt lines", async () => {
  const file = await tempFile();
  await writeFile(file, `{"broken"\n${JSON.stringify({ ...recover(), at: 5 })}\n`);
  const service = new ConnectionMetricsService({ file, enabled: () => true, maxSamples: 4, compactAt: 6 });
  assert.equal(service.summary().count, 1, "the corrupt line is skipped");
  for (let index = 0; index < 8; index += 1) service.record(recover({ totalMs: index }));
  await service.flush();
  const lines = (await readFile(file, "utf8")).trim().split("\n");
  assert.equal(lines.length <= 6, true, `compacted to ${lines.length} lines`);
  const summary = service.summary();
  assert.equal(summary.count, 4);
  assert.equal(summary.recent[0].totalMs, 7);
  service.clear();
  await service.flush();
  assert.equal(service.summary().count, 0);
  assert.equal(new ConnectionMetricsService({ file, enabled: () => true }).summary().count, 0);
});

test("nearest-rank percentiles", () => {
  assert.deepEqual(stats([5]), { count: 1, mean: 5, p50: 5, p95: 5, max: 5 });
  const hundred = Array.from({ length: 100 }, (_, index) => index + 1);
  assert.deepEqual(stats(hundred), { count: 100, mean: 51, p50: 50, p95: 95, max: 100 });
});

test("a composed server advertises the capability and serves the operations", async (t) => {
  const file = await tempFile();
  const quietPty = { spawn() { throw new Error("no terminals in this test"); } };
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: "metrics-server",
    serverVersion: "1.0.0",
    capabilities: ["desktop"],
    ptyFactory: quietPty,
    connectionMetrics: { file },
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "admin" }),
  });
  t.after(() => composition.shutdown());
  assert.equal(composition.connectionMetrics instanceof ConnectionMetricsService, true);
  assert.equal(composition.coreOptions.capabilities.includes(CONNECTION_METRICS_CAPABILITY), true);
  assert.equal(composition.operations.commands.has(CONNECTION_METRICS_OPERATIONS.record), true);
  assert.equal(composition.operations.commands.has(CONNECTION_METRICS_OPERATIONS.clear), true);
  assert.equal(composition.operations.queries.has(CONNECTION_METRICS_OPERATIONS.summary), true);
  assert.equal(composition.operations.policies.get(CONNECTION_METRICS_OPERATIONS.clear).scope, "write");
});
