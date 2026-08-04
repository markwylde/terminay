import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ci = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

function jobBody(name, nextName) {
  const start = ci.indexOf(`  ${name}:\n`);
  const end = ci.indexOf(`  ${nextName}:\n`, start + 1);
  assert.ok(start >= 0, `CI must declare ${name}`);
  assert.ok(end > start, `${name} must appear before ${nextName}`);
  return ci.slice(start, end);
}

test("native release probes bind Linux x64 and arm64 jobs to their actual runners", () => {
  const job = jobBody("native-release-runner-probes", "pty-packaged-linux");

  assert.match(ci, /node --test .*scripts\/task20-native-runner-contract\.test\.mjs/u,
    "the smoke gate must execute this workflow contract test");
  assert.doesNotMatch(job, /^ {4}container:/mu,
    "native release evidence must execute on the runner, not inside a container");
  assert.match(job, /^ {4}runs-on: \$\{\{ matrix\.os \}\}$/mu);
  assert.match(job, /^ {4}timeout-minutes: 30$/mu);
  assert.match(job, /arch: x64\n\s+os: ubuntu-24\.04\n\s+runner_arch: X64\n\s+uname_arch: x86_64\n\s+node_arch: x64/u);
  assert.match(job, /arch: arm64\n\s+os: ubuntu-24\.04-arm\n\s+runner_arch: ARM64\n\s+uname_arch: aarch64\n\s+node_arch: arm64/u);

  const architectureStep = job.indexOf("- name: Verify native release-runner architecture");
  const installStep = job.indexOf("- name: Install dependencies");
  const probeStep = job.indexOf("- name: Run native standalone-server and PTY probes");
  assert.ok(architectureStep >= 0 && installStep > architectureStep && probeStep > installStep,
    "architecture must be verified before dependency installation and native probes");
  const architecture = job.slice(architectureStep, installStep);
  assert.match(architecture, /test "\$RUNNER_ARCH" = "\$EXPECTED_RUNNER_ARCH"/u);
  assert.match(architecture, /test "\$\(uname -m\)" = "\$EXPECTED_UNAME_ARCH"/u);
  assert.match(architecture, /process\.stdout\.write\(process\.arch\)/u);
  assert.match(architecture, /"\$EXPECTED_NODE_ARCH"/u);
});

test("native release probes build the server and exercise packed node-pty on each runner", () => {
  const job = jobBody("native-release-runner-probes", "pty-packaged-linux");
  const probeStep = job.slice(job.indexOf("- name: Run native standalone-server and PTY probes"));

  assert.match(probeStep, /npm run build --workspace @terminay\/server/u,
    "the release runner must build the server it probes");
  assert.match(probeStep, /node --test scripts\/standalone-artifact\.test\.mjs scripts\/pty-exit-protocol\.test\.mjs/u,
    "the release runner must execute both the extracted standalone/node-pty and PTY exit probes");
  assert.match(probeStep, /npm pack --workspace @terminay\/server --json --pack-destination release-evidence/u,
    "the release runner must pack the exact standalone payload after probes");
});

test("native release probes persist an exact runner identity record only after probes pass", () => {
  const job = jobBody("native-release-runner-probes", "pty-packaged-linux");
  const probeStep = job.indexOf("- name: Run native standalone-server and PTY probes");
  const evidenceStep = job.indexOf("- name: Record native release-runner evidence");
  const uploadStep = job.indexOf("- name: Upload native release-runner evidence");

  assert.ok(probeStep >= 0 && evidenceStep > probeStep && uploadStep > evidenceStep,
    "runner evidence must only be recorded/uploaded after native probes pass");
  const record = job.slice(evidenceStep, uploadStep);
  assert.match(record, /record-native-runner-evidence\.mjs/u);
  assert.match(record, /--target "\$TARGET"/u);
  assert.match(record, /--artifact "\$\(cat "\$RUNNER_TEMP\/terminay-server-artifact-path"\)"/u);
  assert.match(record, /--output "release-evidence\/native-runner-\$\{TARGET\}\.json"/u);
  const upload = job.slice(uploadStep);
  assert.match(upload, /name: native-runner-evidence-\$\{\{ matrix\.arch \}\}/u);
  assert.match(upload, /path: release-evidence\/native-runner-linux-\$\{\{ matrix\.arch \}\}\.json/u);
  assert.match(upload, /if-no-files-found: error/u);
});
