import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const workflowDirectory = new URL("../.github/workflows/", import.meta.url);
const workflowNames = (await readdir(workflowDirectory))
  .filter((name) => /\.ya?ml$/u.test(name))
  .sort();
const workflows = new Map(await Promise.all(workflowNames.map(async (name) => [
  name,
  await readFile(new URL(name, workflowDirectory), "utf8"),
])));
const giteaWorkflowDirectory = new URL("../.gitea/workflows/", import.meta.url);
const giteaWorkflowNames = (await readdir(giteaWorkflowDirectory))
  .filter((name) => /\.ya?ml$/u.test(name))
  .sort();
const giteaWorkflows = new Map(await Promise.all(giteaWorkflowNames.map(async (name) => [
  name,
  await readFile(new URL(name, giteaWorkflowDirectory), "utf8"),
])));
const providerWorkflows = new Map([
  ...[...workflows].map(([name, contents]) => [`.github/workflows/${name}`, contents]),
  ...[...giteaWorkflows].map(([name, contents]) => [`.gitea/workflows/${name}`, contents]),
]);

const reviewedPins = new Map([
  ["actions/checkout", "fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09"],
  ["actions/setup-node", "a0853c24544627f65ddf259abe73b1d18a591444"],
  ["actions/upload-artifact", "ea165f8d65b6e75b540449e92b4886f43607fa02"],
  ["actions/download-artifact", "d3f86a106a0bac45b974a628896c90dbdf5c8093"],
  ["apple-actions/import-codesign-certs", "2dbeb2d7c37642111f938c56ef0feb5d51dad55d"],
  ["docker/setup-buildx-action", "bb05f3f5519dd87d3ba754cc423b652a5edd6d2c"],
  ["docker/setup-qemu-action", "96fe6ef7f33517b61c61be40b68a1882f3264fb8"],
  ["docker/metadata-action", "dc802804100637a589fabce1cb79ff13a1411302"],
  ["docker/login-action", "dbcb813823bdd20940b903addbd779551569679f"],
  ["docker/build-push-action", "53b7df96c91f9c12dcc8a07bcb9ccacbed38856a"],
]);

const additionalReviewedPins = new Map([
  ["actions/upload-artifact", new Set(["ff15f0306b3f739f7b6fd43fb5d26cd321bd4de5"])],
  ["actions/download-artifact", new Set(["9bc31d5ccc31df68ecc42ccf4149144866c47d8a"])],
]);

function actionReferences(contents) {
  return [...contents.matchAll(/^\s*(?:-\s*)?uses:\s+([^@\s]+)@([^\s#]+)(?:\s+#.*)?$/gmu)];
}

test("all workflow actions use reviewed immutable commit pins", () => {
  for (const [name, contents] of providerWorkflows) {
    const references = actionReferences(contents);
    assert.ok(references.length > 0, `${name} must be scanned for action pins`);
    for (const [, action, revision] of references) {
      assert.match(revision, /^[0-9a-f]{40}$/u, `${name}: ${action} must use a full commit SHA`);
      assert.ok(
        revision === reviewedPins.get(action) || additionalReviewedPins.get(action)?.has(revision),
        `${name}: ${action} pin must be explicitly reviewed`,
      );
    }
  }
});

test("checkouts never persist GitHub credentials into a runner worktree", () => {
  for (const [name, contents] of providerWorkflows) {
    const lines = contents.split("\n");
    const checkoutLines = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => /uses:\s+actions\/checkout@/u.test(line));

    assert.ok(checkoutLines.length > 0, `${name} must be scanned for checkout steps`);

    for (const { index } of checkoutLines) {
      const stepLines = [];
      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        if (/^\s*-\s+(?:name:|uses:)/u.test(lines[cursor])) break;
        stepLines.push(lines[cursor]);
      }
      assert.match(
        stepLines.join("\n"),
        /^\s+persist-credentials:\s*false\s*$/mu,
        `${name}: checkout must remove its token from the runner Git configuration`,
      );
    }
  }
});

test("every workflow declares a token policy instead of inheriting repository defaults", () => {
  for (const [name, contents] of providerWorkflows) {
    assert.match(contents, /^\s{0,4}permissions:\s*$/mu, `${name} must declare GitHub token permissions`);
  }
});

test("release shell steps use a workflow-wide fail-closed bash contract", () => {
  const release = workflows.get("trigger-release.yml");
  assert.ok(release, "trigger-release.yml must exist");

  const permissions = release.indexOf("\npermissions:\n");
  const defaults = release.indexOf("\ndefaults:\n");
  const concurrency = release.indexOf("\nconcurrency:\n");
  assert.ok(permissions >= 0 && defaults > permissions && concurrency > defaults,
    "release shell defaults must be a workflow-level policy before jobs run");

  const defaultShell = release.slice(defaults, concurrency);
  assert.match(defaultShell, /^defaults:\n {2}run:\n {4}shell: bash -euo pipefail \{0\}$/mu,
    "every release shell step must fail on command, unset-variable, and pipeline errors");
});

test("release execution is serialized and an in-flight write-capable release is never cancelled", () => {
  const release = workflows.get("trigger-release.yml");
  assert.ok(release, "trigger-release.yml must exist");

  const defaults = release.indexOf("\ndefaults:\n");
  const concurrency = release.indexOf("\nconcurrency:\n");
  const jobs = release.indexOf("\njobs:\n");
  assert.ok(defaults >= 0 && concurrency > defaults && jobs > concurrency,
    "release concurrency policy must be declared before any jobs");

  const policy = release.slice(concurrency, jobs);
  assert.match(policy, /^concurrency:\n {2}group: trigger-release\n {2}cancel-in-progress: false$/mu,
    "release publication must use one stable queue and never cancel a running write-capable release");
});

test("every release job has an explicit bounded runtime", () => {
  const release = workflows.get("trigger-release.yml");
  assert.ok(release, "trigger-release.yml must exist");

  const jobsStart = release.indexOf("\njobs:\n");
  assert.notEqual(jobsStart, -1, "release workflow must declare jobs");
  const jobsSection = release.slice(jobsStart + "\njobs:\n".length);
  const jobs = new Map([...jobsSection.matchAll(/^ {2}([a-z][\w-]*):\n([\s\S]*?)(?=^ {2}[a-z][\w-]*:\n|(?![\s\S]))/gmu)]
    .map(([, name, body]) => [name, body]));

  assert.deepEqual([...jobs.keys()], ["smoke-test", "release", "build-binaries", "build-standalone-server", "publish-release-notes"]);
  for (const [name, body] of jobs) {
    const timeout = body.match(/^ {4}timeout-minutes:\s*(\d+)\s*$/mu);
    assert.ok(timeout, `${name} must define an explicit job timeout`);
    assert.ok(Number(timeout[1]) > 0 && Number(timeout[1]) <= 60,
      `${name} timeout must be a finite release-safety bound of no more than 60 minutes`);
  }
});

test("spec-progress push uses a step-scoped token instead of checkout credentials", () => {
  const workflow = giteaWorkflows.get("spec-progress.yml");
  assert.ok(workflow, ".gitea/workflows/spec-progress.yml must exist");
  assert.match(workflow, /persist-credentials:\s*false/u);
  assert.match(workflow, /GITHUB_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/u);
  assert.match(workflow, /http\.extraHeader=AUTHORIZATION: basic \$\{AUTH\}/u);
  assert.match(workflow, /git -c "http\.extraHeader=AUTHORIZATION: basic \$\{AUTH\}" push origin HEAD:main/u);
  assert.doesNotMatch(workflow, /^\s+git push origin HEAD:main$/mu);
});

test("ordinary CI retains a read-only token while using provider-neutral E2E artifacts", () => {
  const ci = workflows.get("ci.yml");
  const giteaCi = giteaWorkflows.get("ci.yml");
  assert.ok(ci, "ci.yml must exist");
  assert.ok(giteaCi, ".gitea/workflows/ci.yml must exist");
  for (const workflow of [ci, giteaCi]) {
    assert.match(workflow, /^permissions:\n {2}contents: read$/mu);
    assert.doesNotMatch(workflow, /^\s+(?:contents|packages|id-token|actions|checks|deployments|discussions|issues|pull-requests|security-events|statuses): write$/mu);
    assert.doesNotMatch(workflow, /docker (?:login|push|pull)/u);
  }
});

test("CI isolates incompatible artifact actions from every provider-runnable job", () => {
  const githubCi = workflows.get("ci.yml");
  const giteaCi = giteaWorkflows.get("ci.yml");
  assert.ok(githubCi, ".github/workflows/ci.yml must exist");
  assert.ok(giteaCi, ".gitea/workflows/ci.yml must exist");

  const job = (workflow, name) => {
    const header = `  ${name}:\n`;
    const start = workflow.indexOf(header);
    assert.notEqual(start, -1, `CI must declare ${name}`);
    const remainder = workflow.slice(start + header.length);
    const next = remainder.search(/^  [a-z][a-z0-9-]+:\n/mu);
    return next === -1 ? workflow.slice(start) : workflow.slice(start, start + header.length + next);
  };

  const githubImage = job(githubCi, "e2e-image");
  const githubShard = job(githubCi, "e2e-test");
  const giteaImage = job(giteaCi, "e2e-image");
  const giteaShard = job(giteaCi, "e2e-test");
  assert.match(githubShard, /needs: e2e-image/u);
  assert.match(githubShard, /d3f86a106a0bac45b974a628896c90dbdf5c8093/u);
  assert.doesNotMatch(`${githubImage}\n${githubShard}`, /(?:ff15f0306b3f739f7b6fd43fb5d26cd321bd4de5|9bc31d5ccc31df68ecc42ccf4149144866c47d8a)/u);
  assert.match(giteaShard, /needs: e2e-image/u);
  assert.match(giteaShard, /9bc31d5ccc31df68ecc42ccf4149144866c47d8a/u);
  assert.doesNotMatch(`${giteaImage}\n${giteaShard}`, /(?:ea165f8d65b6e75b540449e92b4886f43607fa02|d3f86a106a0bac45b974a628896c90dbdf5c8093)/u);

  assert.doesNotMatch(githubCi, /(?:ff15f0306b3f739f7b6fd43fb5d26cd321bd4de5|9bc31d5ccc31df68ecc42ccf4149144866c47d8a)/u);
  assert.doesNotMatch(giteaCi, /(?:ea165f8d65b6e75b540449e92b4886f43607fa02|d3f86a106a0bac45b974a628896c90dbdf5c8093)/u);
});

test("production WebRTC evidence is pinned to an immutable hosted signaling commit", () => {
  const ci = workflows.get("ci.yml");
  assert.ok(ci, "ci.yml must exist");

  const jobStart = ci.indexOf("  production-headless-webrtc:\n");
  const e2eStart = ci.indexOf("  e2e-test:\n");
  assert.ok(jobStart >= 0 && e2eStart > jobStart,
    "CI must declare the production WebRTC evidence job before E2E");
  const job = ci.slice(jobStart, e2eStart);
  const checkout = job.indexOf("- name: Check out hosted signaling service");
  const immutableRef = job.indexOf("- name: Verify immutable hosted signaling revision");
  const install = job.indexOf("- name: Install production proof dependencies");
  const proof = job.indexOf("- name: Prove production WebRTC on native Linux");
  assert.ok(checkout >= 0 && immutableRef > checkout && install > immutableRef && proof > install,
    "hosted signaling source must be verified before dependencies or WebRTC evidence run");

  const verification = job.slice(immutableRef, install);
  assert.match(verification, /EXPECTED_HOSTED_REF: \$\{\{ vars\.TERMINAY_HOSTED_WEBRTC_REF \}\}/u,
    "the verifier must use the configured hosted-service revision");
  assert.match(verification, /\[\[ "\$EXPECTED_HOSTED_REF" =~ \^\[0-9a-f\]\{40\}\$ \]\]/u,
    "a movable branch, tag, or abbreviated SHA must be rejected");
  assert.match(verification, /git -C terminay-hosted-service rev-parse HEAD/u,
    "the hosted checkout must resolve its actual commit");
  assert.match(verification, /test "\$\(git -C terminay-hosted-service rev-parse HEAD\)" = "\$EXPECTED_HOSTED_REF"/u,
    "the hosted checkout must exactly match the configured immutable commit");
  assert.match(verification, /git -C terminay-hosted-service status --porcelain/u,
    "the evidence job must reject a modified hosted source tree");
});

test("native Linux WebRTC evidence consumes the governed candidate selection", async () => {
  const ci = workflows.get("ci.yml");
  assert.ok(ci, "ci.yml must exist");
  const jobStart = ci.indexOf("  production-headless-webrtc:\n");
  const e2eStart = ci.indexOf("  e2e-test:\n");
  assert.ok(jobStart >= 0 && e2eStart > jobStart);
  const job = ci.slice(jobStart, e2eStart);
  assert.match(job, /- arch: x64\n\s+os: ubuntu-24\.04/u);
  assert.match(job, /- arch: arm64\n\s+os: ubuntu-24\.04-arm/u);
  assert.match(job, /TERMINAY_PROOF_EXPECT_ARCH: \$\{\{ matrix\.arch \}\}/u);
  assert.match(job, /node --test scripts\/production-headless-webrtc-secure-werift\.test\.mjs/u);

  const proof = await readFile(
    new URL("./production-headless-webrtc-secure-werift.test.mjs", import.meta.url),
    "utf8",
  );
  assert.match(proof, /stagedSelection\.package\?\.version, WERIFT_CANDIDATE_VERSION/u);
  assert.match(proof, /stagedSelection\.patches/u);
  assert.match(proof, /WERIFT_TURN_REFRESH_PATCH_SHA256/u);

  const selection = JSON.parse(await readFile(
    new URL("../build/webrtc-runtime/selection.json", import.meta.url),
    "utf8",
  ));
  assert.equal(selection.package.version, "0.24.1-candidate.1");
  assert.equal(
    selection.patches[0].sha256,
    "34ea60bd991256adb2cd50bfe0ef9011cfc79054aff686b9ec35ef4703de4211",
  );

  const load = job.indexOf("- name: Measure selected WebRTC runtime under direct and relay-only load");
  const upload = job.indexOf("- name: Upload selected WebRTC load evidence");
  assert.ok(load > job.indexOf("- name: Prove production WebRTC on native Linux"));
  assert.ok(upload > load);
  const loadStep = job.slice(load, upload);
  assert.match(loadStep, /npm run build --workspace @terminay\/server/u);
  assert.match(loadStep, /stage-selected-secure-werift-runtime\.mjs --output-dir "\$RUNTIME_ROOT"/u);
  assert.match(loadStep, /selection\.package\?\.version !== "0\.24\.1-candidate\.1"/u);
  assert.match(loadStep, /34ea60bd991256adb2cd50bfe0ef9011cfc79054aff686b9ec35ef4703de4211/u);
  assert.match(loadStep, /commit: process\.env\.GITHUB_SHA/u);
  assert.match(loadStep, /target: process\.env\.TARGET/u);
  assert.match(loadStep, /cp "\$RUNTIME_ROOT\/selection\.json" "\$EVIDENCE_ROOT\/selection\.json"/u);
  assert.match(loadStep, /"\$EVIDENCE_ROOT\/runner\.json"/u);
  assert.match(loadStep, /> "\$EVIDENCE_ROOT\/direct\.json"/u);
  assert.match(loadStep, /> "\$EVIDENCE_ROOT\/turn\.json"/u);
  assert.match(loadStep, /verify-native-webrtc-load-evidence\.mjs/u);
  assert.match(loadStep, /--commit "\$GITHUB_SHA"/u);
  assert.match(loadStep, /--mode direct[\s\S]*--duration-ms 10000[\s\S]*--peer-pairs 6/u);
  assert.match(loadStep, /docker\.io\/coturn\/coturn:4\.6\.3-r3/u);
  assert.match(loadStep, /umask 077/u);
  assert.match(loadStep, /trap cleanup EXIT/u);
  assert.match(loadStep, /docker rm --force "\$TURN_CONTAINER"/u);
  assert.match(loadStep, /"\$TURN_ROOT" == "\$RUNNER_TEMP"\/terminay-coturn\.\*/u);
  assert.match(loadStep, /--user "\$\(id -u\):\$\(id -g\)"/u);
  assert.match(loadStep, /docker inspect --format '\{\{\.State\.Status\}\}' "\$TURN_CONTAINER"/u);
  assert.match(loadStep, /docker logs "\$TURN_CONTAINER"/u);
  assert.match(loadStep, /--mode turn[\s\S]*--duration-ms 5000[\s\S]*--peer-pairs 4/u);
  assert.match(loadStep, /--turn-config "\$TURN_ROOT\/turnserver\.conf"/u);
  const uploadStep = job.slice(upload);
  assert.match(uploadStep, /name: selected-webrtc-load-\$\{\{ matrix\.arch \}\}/u);
  assert.match(uploadStep, /path: release-evidence\/webrtc-load-linux-\$\{\{ matrix\.arch \}\}/u);
  assert.match(uploadStep, /if-no-files-found: error/u);
});

test("release write permission is isolated to jobs that mutate release state", () => {
  const release = workflows.get("trigger-release.yml");
  assert.ok(release, "trigger-release.yml must exist");

  assert.match(release, /^permissions:\n(?: {2}#.*\n)* {2}contents: read$/mu,
    "release workflow must default to a read-only token");

  const jobsStart = release.indexOf("\njobs:\n");
  assert.notEqual(jobsStart, -1, "release workflow must declare jobs");
  const jobsSection = release.slice(jobsStart + "\njobs:\n".length);
  const jobs = new Map([...jobsSection.matchAll(/^ {2}([a-z][\w-]*):\n([\s\S]*?)(?=^ {2}[a-z][\w-]*:\n|(?![\s\S]))/gmu)]
    .map(([, name, body]) => [name, body]));
  assert.deepEqual([...jobs.keys()], ["smoke-test", "release", "build-binaries", "build-standalone-server", "publish-release-notes"]);

  assert.doesNotMatch(jobs.get("smoke-test"), /^ {4}permissions:/mu,
    "smoke-test must inherit the read-only workflow token");
  for (const name of ["release", "build-binaries", "build-standalone-server", "publish-release-notes"]) {
    assert.match(jobs.get(name), /^ {4}permissions:\n {6}contents: write$/mu,
      `${name} must explicitly declare the narrowly scoped release-write token`);
  }
});

test("standalone server release artifact is built from the immutable tag and verified before publication", () => {
  const release = workflows.get("trigger-release.yml");
  assert.ok(release, "trigger-release.yml must exist");

  const jobStart = release.indexOf("  build-standalone-server:\n");
  const notesStart = release.indexOf("  publish-release-notes:\n");
  assert.ok(jobStart >= 0 && notesStart > jobStart,
    "release workflow must contain a standalone server build job before release notes");
  const job = release.slice(jobStart, notesStart);
  assert.match(job, /ref: \$\{\{ needs\.release\.outputs\.tag \}\}/u,
    "standalone package must be built from the release tag rather than an advancing branch");
  assert.match(job, /test "\$\(git rev-parse HEAD\)" = "\$EXPECTED_COMMIT"/u,
    "standalone package job must verify the checked-out immutable source commit");
  assert.match(job, /npm pack --workspace @terminay\/server --json --pack-destination/u,
    "standalone package job must create a real npm pack artifact");
  assert.match(job, /node scripts\/sync-package-version\.mjs "\$VERSION"/u,
    "standalone package manifest version must use the tested release-tag synchronizer");
  assert.match(job, /node scripts\/standalone-artifact\.mjs "\$EXTRACTED\/package" "\$MANIFEST"/u,
    "the extracted package must pass non-executing payload inspection");
  assert.match(job, /require\(process\.argv\[1\]\)\.package\.version/u,
    "the inspected package version must match the release tag before publication");
  assert.match(job, /release-checksum\.mjs write "\$ARCHIVE" "\$ARCHIVE\.sha256"/u,
    "standalone package checksum must be written by the regular-file verifier");
  assert.match(job, /release-checksum\.mjs verify "\$ARCHIVE" "\$ARCHIVE\.sha256"/u,
    "standalone package checksum must be verified before upload");
  assert.match(job, /release\/\*\/terminay-server-\*\.tgz/u,
    "workflow-artifact upload must include only a version-derived standalone archive");
  assert.match(job, /gh release upload "\$TAG" "\$ARCHIVE" "\$ARCHIVE\.sha256" "\$ARCHIVE\.sig" --repo "\$GH_REPO"/u,
    "standalone package, checksum, and detached signature must be uploaded together without replacement");

  const notesJob = release.slice(notesStart);
  assert.match(notesJob, /needs: \[release, build-binaries, build-standalone-server\]/u,
    "release notes must wait for the standalone artifact publication");
  assert.match(notesJob, /terminay-server-\$\{VERSION\}\.tgz/u,
    "release-note verification must include the exact standalone archive");
  assert.match(notesJob, /terminay-server-\$\{VERSION\}\.tgz\.sha256/u,
    "release-note verification must include the standalone checksum sidecar");
});

test("standalone server archive is signed and re-verified at every release handoff", () => {
  const release = workflows.get("trigger-release.yml");
  assert.ok(release, "trigger-release.yml must exist");

  const jobStart = release.indexOf("  build-standalone-server:\n");
  const notesStart = release.indexOf("  publish-release-notes:\n");
  const job = release.slice(jobStart, notesStart);
  const checksum = job.indexOf("- name: Write and verify standalone server checksum");
  const signing = job.indexOf("- name: Sign and verify exact standalone server archive");
  const workflowUpload = job.indexOf("- name: Upload standalone server workflow artifact");
  const releaseUpload = job.indexOf("- name: Attach checksummed standalone server to GitHub release");
  assert.ok(checksum >= 0 && signing > checksum && workflowUpload > signing && releaseUpload > workflowUpload,
    "standalone archive must be signed after checksumming and before either upload handoff");

  const signingStep = job.slice(signing, workflowUpload);
  assert.match(signingStep, /TERMINAY_RELEASE_SIGNING_PRIVATE_KEY_B64: \$\{\{ secrets\.TERMINAY_RELEASE_SIGNING_PRIVATE_KEY_B64 \}\}/u,
    "the private signing key must be scoped to the signing step only");
  assert.match(signingStep, /TERMINAY_RELEASE_SIGNING_PUBLIC_KEY_B64: \$\{\{ vars\.TERMINAY_RELEASE_SIGNING_PUBLIC_KEY_B64 \}\}/u,
    "the paired public key must be configured explicitly");
  assert.match(signingStep, /release-signature\.mjs sign "\$ARCHIVE" "\$ARCHIVE\.sig"/u,
    "the exact archive must receive a detached signature");
  assert.match(signingStep, /release-signature\.mjs verify "\$ARCHIVE" "\$ARCHIVE\.sig"/u,
    "the signature must self-verify before upload");
  assert.match(job.slice(workflowUpload, releaseUpload), /terminay-server-\*\.tgz\.sig/u,
    "the workflow artifact handoff must retain the detached signature");
  const uploadStep = job.slice(releaseUpload);
  assert.match(uploadStep, /test ! -L "\$ARCHIVE"/u,
    "the final standalone upload must reject a symlinked archive");
  assert.match(uploadStep, /test ! -L "\$ARCHIVE\.sha256"/u,
    "the final standalone upload must reject a symlinked checksum sidecar");
  assert.match(uploadStep, /test ! -L "\$ARCHIVE\.sig"/u,
    "the final standalone upload must reject a symlinked detached signature");
  assert.match(uploadStep, /release-signature\.mjs verify "\$ARCHIVE" "\$ARCHIVE\.sig"/u,
    "the release upload must re-verify the detached signature");
  assert.match(uploadStep, /gh release upload "\$TAG" "\$ARCHIVE" "\$ARCHIVE\.sha256" "\$ARCHIVE\.sig" --repo "\$GH_REPO"/u,
    "the immutable GitHub Release handoff must include the signature");
  assert.doesNotMatch(uploadStep, /gh release upload[^\n]*--clobber/u,
    "standalone publication must refuse to replace a prior immutable release asset");

  const notes = release.slice(notesStart);
  const notesCheckout = notes.indexOf("- name: Check out release verification code");
  const notesSource = notes.indexOf("- name: Verify immutable release source before publication");
  const notesDownload = notes.indexOf("- name: Download release notes artifact");
  assert.ok(notesCheckout >= 0 && notesSource > notesCheckout && notesDownload > notesSource,
    "final publication must check out and verify immutable source before downloading release evidence");
  const notesCheckoutStep = notes.slice(notesCheckout, notesSource);
  assert.match(notesCheckoutStep, /ref: \$\{\{ needs\.release\.outputs\.tag \}\}/u,
    "signature verification code must come from the exact release tag");
  assert.match(notesCheckoutStep, /persist-credentials: false/u,
    "verification checkout must not persist a write-capable token");
  const notesSourceStep = notes.slice(notesSource, notesDownload);
  assert.match(notesSourceStep, /EXPECTED_COMMIT: \$\{\{ needs\.release\.outputs\.source_commit \}\}/u,
    "final publication must bind verification code to the captured release source");
  assert.match(notesSourceStep, /git rev-parse "\$TAG\^\{commit\}"/u,
    "final publication must resolve the immutable tag target");
  assert.match(notesSourceStep, /git rev-parse HEAD/u,
    "final publication must verify its checked-out source");
  assert.match(notes, /terminay-server-\$\{VERSION\}\.tgz\.sig/u,
    "release-note publication must require the published standalone signature");
  assert.match(notes, /release-signature\.mjs verify[\s\\]+"\$ASSET_DIR\/terminay-server-\$\{VERSION\}\.tgz"[\s\\]+"\$ASSET_DIR\/terminay-server-\$\{VERSION\}\.tgz\.sig"/u,
    "release-note publication must verify the downloaded standalone signature");
});

test("release notes accept exactly the verified release asset set", () => {
  const release = workflows.get("trigger-release.yml");
  assert.ok(release, "trigger-release.yml must exist");

  const verification = release.indexOf("- name: Verify immutable Desktop release assets before notes");
  const checksums = release.indexOf("- name: Verify published Desktop asset checksums before notes");
  assert.ok(verification >= 0 && checksums > verification,
    "release notes must verify the immutable asset set before downloading checksums");

  const step = release.slice(verification, checksums);
  assert.match(step, /ASSET_NAMES="\$\(gh release view "\$TAG" --repo "\$GH_REPO" --json assets --jq '\.assets\[\]\.[^']+' \| sort\)"/u,
    "the release asset list must be read from the selected immutable release and sorted");
  assert.match(step, /EXPECTED_ASSET_NAMES="\$\(cat <<EOF[\s\S]*Terminay-Linux-\$\{VERSION\}\.AppImage[\s\S]*terminay-server-\$\{VERSION\}\.tgz\.sig[\s\S]*EOF\n\s*\)"/u,
    "the expected Desktop, checksum, standalone archive, and signature names must be explicit");
  assert.match(step, /test "\$ASSET_NAMES" = "\$EXPECTED_ASSET_NAMES"/u,
    "release notes must reject stale or substituted extra attachments rather than checking only for required names");
  assert.doesNotMatch(step, /grep -Fx -- "\$expected"/u,
    "membership-only asset checks leave unexpected release attachments trusted");
});

test("AI release-notes credentials are scoped only to the steps that require them", () => {
  const release = workflows.get("trigger-release.yml");
  assert.ok(release, "trigger-release.yml must exist");

  const releaseJob = release.slice(release.indexOf("  release:\n"), release.indexOf("  build-binaries:\n"));
  assert.doesNotMatch(releaseJob, /^ {4}env:\n {6}OPENROUTER_API_KEY:/mu,
    "the whole release job must not inherit the AI provider credential");

  const credentialProbe = release.indexOf("- name: Detect AI release-notes credential");
  const generator = release.indexOf("- name: Generate AI release notes");
  const fallback = release.indexOf("- name: Use fallback release notes");
  assert.ok(credentialProbe >= 0, "release must probe AI credential availability in a dedicated step");
  assert.ok(generator > credentialProbe, "AI note generation must run after its credential probe");
  assert.ok(fallback > generator, "the credential-free fallback must remain after generation");

  const probeStep = release.slice(credentialProbe, generator);
  const generatorStep = release.slice(generator, fallback);
  const fallbackStep = release.slice(fallback, release.indexOf("- name: Upload release notes artifact"));
  assert.match(probeStep, /id: release_notes_credential/u,
    "the credential probe must expose only an availability output");
  assert.match(probeStep, /OPENROUTER_API_KEY: \$\{\{ secrets\.OPENROUTER_API_KEY \}\}/u,
    "the credential probe needs the key only to determine availability");
  assert.match(generatorStep, /OPENROUTER_API_KEY: \$\{\{ secrets\.OPENROUTER_API_KEY \}\}/u,
    "the generator step must receive the key explicitly");
  assert.match(generatorStep, /steps\.release_notes_credential\.outputs\.available == 'true'/u,
    "generation must depend on the non-secret availability output");
  assert.doesNotMatch(fallbackStep, /OPENROUTER_API_KEY/u,
    "the fallback must not receive an unused AI provider credential");
  assert.match(generatorStep, /continue-on-error: true/u,
    "optional AI notes must not block verified release artifacts");
  assert.match(fallbackStep, /steps\.generate_release_notes\.outcome != 'success'/u,
    "failed AI notes must select the credential-free fallback");
});

test("release workflow verifies every checksum sidecar before either upload path", () => {
  const release = workflows.get("trigger-release.yml");
  assert.ok(release, "trigger-release.yml must exist");

  const writeChecksums = release.indexOf("- name: Write release asset checksums");
  const verifyChecksums = release.indexOf("- name: Verify release asset checksums before upload");
  const uploadArtifact = release.indexOf("- name: Upload workflow artifact");
  const uploadRelease = release.indexOf("- name: Attach checksummed binaries to GitHub release");

  assert.ok(writeChecksums >= 0, "release workflow must write SHA-256 sidecars");
  assert.ok(verifyChecksums > writeChecksums,
    "checksum verification must happen after sidecar generation");
  assert.ok(uploadArtifact > verifyChecksums,
    "workflow artifact upload must happen after checksum verification");
  assert.ok(uploadRelease > verifyChecksums,
    "GitHub Release upload must happen after checksum verification");

  const verificationStep = release.slice(verifyChecksums, uploadArtifact);
  assert.match(verificationStep, /test -f "\$file\.sha256"/u,
    "checksum verification must require every sidecar");
  assert.match(verificationStep, /test ! -L "\$file"/u,
    "checksum verification must reject a symlinked Desktop payload");
  assert.match(verificationStep, /test ! -L "\$file\.sha256"/u,
    "checksum verification must reject a symlinked checksum sidecar");
  assert.match(verificationStep, /shasum -a 256 -c "\$\(basename "\$file"\)\.sha256"/u,
    "checksum verification must validate each release asset against its sidecar");
});

test("Desktop release upload rejects symlinked payloads or sidecars and re-verifies bytes", () => {
  const release = workflows.get("trigger-release.yml");
  assert.ok(release, "trigger-release.yml must exist");

  const writeChecksums = release.indexOf("- name: Write release asset checksums");
  const verifyChecksums = release.indexOf("- name: Verify release asset checksums before upload");
  const upload = release.indexOf("- name: Attach checksummed binaries to GitHub release");
  assert.ok(writeChecksums >= 0 && verifyChecksums > writeChecksums && upload > verifyChecksums,
    "Desktop checksum creation, verification, and upload must remain ordered");

  const writeStep = release.slice(writeChecksums, verifyChecksums);
  assert.match(writeStep, /test ! -e "\$file\.sha256"/u,
    "sidecar creation must refuse a pre-existing path rather than overwrite it");
  assert.match(writeStep, /test ! -L "\$file\.sha256"/u,
    "sidecar creation must explicitly reject a dangling symlink");

  const uploadStep = release.slice(upload, release.indexOf("  build-standalone-server:\n"));
  assert.match(uploadStep, /test ! -L "\$file"/u,
    "Desktop publication must reject a symlinked payload at the final handoff");
  assert.match(uploadStep, /test ! -L "\$file\.sha256"/u,
    "Desktop publication must reject a symlinked sidecar at the final handoff");
  assert.match(uploadStep, /shasum -a 256 -c "\$\(basename "\$file"\)\.sha256"/u,
    "Desktop publication must re-verify bytes after the workflow-artifact handoff");
});

test("published release checksum sidecars are portable and are verified from their payload directory", () => {
  const release = workflows.get("trigger-release.yml");
  assert.ok(release, "trigger-release.yml must exist");

  const desktopWrite = release.indexOf("- name: Write release asset checksums");
  const desktopVerify = release.indexOf("- name: Verify release asset checksums before upload");
  const standaloneWrite = release.indexOf("- name: Write and verify standalone server checksum");
  const standaloneUpload = release.indexOf("- name: Upload standalone server workflow artifact");
  assert.ok(desktopWrite >= 0 && desktopVerify > desktopWrite,
    "Desktop checksum creation and verification steps must exist in order");
  assert.ok(standaloneWrite >= 0 && standaloneUpload > standaloneWrite,
    "standalone checksum creation must precede artifact upload");

  const desktopWriteStep = release.slice(desktopWrite, desktopVerify);
  const desktopVerifyStep = release.slice(desktopVerify, release.indexOf("- name: Upload workflow artifact", desktopVerify));
  const standaloneStep = release.slice(standaloneWrite, standaloneUpload);
  assert.match(desktopWriteStep, /printf '%s {2}%s\\n' "\$checksum" "\$\(basename "\$[A-Za-z_]+"\)" > "\$[A-Za-z_]+\.sha256"/u,
    "Desktop checksum sidecars must record only the portable payload basename");
  assert.doesNotMatch(desktopWriteStep, /shasum -a 256 "\$[A-Za-z_]+" > "\$[A-Za-z_]+\.sha256"/u,
    "Desktop sidecars must not retain a runner-local release path");
  assert.match(standaloneStep, /release-checksum\.mjs write "\$ARCHIVE" "\$ARCHIVE\.sha256"/u,
    "standalone checksum sidecars must be written by the basename-bound verifier");
  assert.match(standaloneStep, /release-checksum\.mjs verify "\$ARCHIVE" "\$ARCHIVE\.sha256"/u,
    "standalone checksum sidecars must be verified by the regular-file verifier");
  assert.match(desktopVerifyStep, /cd "\$\(dirname "\$file"\)"/u,
    "Desktop checksum verification must run beside the payload");
});

test("release workflow artifacts explicitly exclude hidden files", () => {
  const release = workflows.get("trigger-release.yml");
  assert.ok(release, "trigger-release.yml must exist");

  const uploadSteps = [...release.matchAll(
    /^ {6}- name: (?:Upload release notes artifact|Upload workflow artifact|Upload standalone server workflow artifact)\n([\s\S]*?)(?=^ {6}- name:|^ {2}[a-z][\w-]*:|$(?![\s\S]))/gmu,
  )];
  assert.equal(uploadSteps.length, 3,
    "release workflow must retain exactly the reviewed workflow-artifact uploads");

  for (const [, step] of uploadSteps) {
    assert.match(step, /^ {10}include-hidden-files:\s*false\s*$/mu,
      "release workflow artifacts must explicitly exclude hidden files");
  }
});

test("macOS release DMGs are verified for signing, team identity, Gatekeeper, and notarization before checksums", () => {
  const release = workflows.get("trigger-release.yml");
  assert.ok(release, "trigger-release.yml must exist");

  const build = release.indexOf("- name: Build packaged app");
  const selection = release.indexOf("- name: Verify exact release asset selection");
  const verification = release.indexOf("- name: Verify macOS signed and notarized release DMG");
  const writeChecksums = release.indexOf("- name: Write release asset checksums");

  assert.ok(build >= 0, "release workflow must build the packaged app");
  assert.ok(selection > build,
    "the deterministic release candidate must be selected before macOS verification");
  assert.ok(verification > build,
    "macOS release verification must happen after packaging");
  assert.ok(writeChecksums > verification,
    "macOS release verification must finish before the artifact is checksummed");

  const verificationStep = release.slice(verification, writeChecksums);
  assert.match(verificationStep, /if: matrix\.os == 'macos-latest'/u,
    "the verification must be scoped to the macOS release lane");
  assert.match(verificationStep, /TAG: \$\{\{ needs\.release\.outputs\.tag \}\}/u,
    "macOS verification must derive its candidate from the release-created tag");
  assert.match(verificationStep, /DMG="release\/\$VERSION\/Terminay-Mac-\$VERSION-Installer\.dmg"/u,
    "macOS verification must inspect the deterministic selected DMG path");
  assert.match(verificationStep, /APPLE_ID: \$\{\{ vars\.APPLE_ID \}\}/u,
    "final-DMG notarization must receive the configured Apple account only in its verification step");
  assert.match(verificationStep, /APPLE_APP_SPECIFIC_PASSWORD: \$\{\{ secrets\.APPLE_APP_SPECIFIC_PASSWORD \}\}/u,
    "final-DMG notarization must receive its app-specific password only in its verification step");
  assert.match(verificationStep, /xcrun notarytool submit "\$DMG"[\s\S]*--wait/u,
    "the exact final DMG must be submitted to Apple and awaited before publication");
  assert.match(verificationStep, /xcrun stapler staple "\$DMG"/u,
    "the accepted final DMG must receive its notarization ticket");
  assert.doesNotMatch(verificationStep, /find release -type f -name '\*\.dmg'/u,
    "macOS verification must not inspect whichever DMG happens to be discovered first");
  assert.match(verificationStep, /hdiutil attach "\$DMG" -nobrowse -readonly/u,
    "the uploaded DMG itself must be mounted read-only for inspection");
  assert.match(verificationStep, /APP_BUNDLE_COUNT="\$\(find "\$MOUNT_POINT" -type d -name 'Terminay\.app' -print \| wc -l/u,
    "the mounted candidate must contain exactly one Terminay app bundle");
  assert.match(verificationStep, /test "\$APP_BUNDLE_COUNT" = 1/u,
    "an ambiguous or missing mounted app bundle must fail before signing checks");
  assert.match(verificationStep, /test ! -L "\$APP_BUNDLE"/u,
    "the signed application must not be a mounted-DMG symlink");
  assert.match(verificationStep, /APP_EXECUTABLE="\$APP_BUNDLE\/Contents\/MacOS\/Terminay"/u,
    "the expected executable must be selected from the mounted app bundle");
  assert.match(verificationStep, /test -f "\$APP_EXECUTABLE"/u,
    "the mounted app must contain the expected executable");
  assert.match(verificationStep, /test ! -L "\$APP_EXECUTABLE"/u,
    "the executable checked by signing tools must not be a symlink");
  assert.match(verificationStep, /codesign --verify --deep --strict --verbose=2 "\$APP_BUNDLE"/u,
    "the embedded app signature must be verified strictly");
  assert.match(verificationStep, /grep -F "TeamIdentifier=\$APPLE_TEAM_ID"/u,
    "the embedded app must match the configured Apple signing team");
  assert.match(verificationStep, /spctl --assess --type execute --verbose=4 "\$APP_BUNDLE"/u,
    "Gatekeeper must assess the embedded app");
  assert.match(verificationStep, /xcrun stapler validate "\$DMG"/u,
    "the upload candidate DMG must carry a valid notarization staple");
  assert.match(verificationStep, /stage-macos-app-from-dmg\.sh "\$DMG"/u,
    "the signed app must be copied off the read-only DMG before it is booted");
  assert.match(verificationStep, /TERMINAY_PACKAGED_APP="\$STAGED_APP"/u,
    "startup smoke must boot the writable staged copy, not the mounted installer");
  assert.doesNotMatch(verificationStep, /TERMINAY_PACKAGED_APP="\$APP_BUNDLE"/u,
    "startup smoke must not launch Chromium from the read-only DMG");
});

test("macOS packaging proves microphone capability and a non-empty user disclosure before release verification", () => {
  const release = workflows.get("trigger-release.yml");
  assert.ok(release, "trigger-release.yml must exist");

  const build = release.indexOf("- name: Build packaged app");
  const entitlement = release.indexOf("- name: Verify macOS microphone entitlement");
  const dmgVerification = release.indexOf("- name: Verify macOS signed and notarized release DMG");
  const writeChecksums = release.indexOf("- name: Write release asset checksums");
  assert.ok(build >= 0 && entitlement > build,
    "microphone capability verification must inspect the packaged app after it is built");
  assert.ok(dmgVerification > entitlement,
    "the app capability must be verified before the DMG release candidate is accepted");
  assert.ok(writeChecksums > dmgVerification,
    "capability and DMG verification must finish before the artifact is checksummed");

  const entitlementStep = release.slice(entitlement, dmgVerification);
  assert.match(entitlementStep, /if: matrix\.os == 'macos-latest'/u,
    "microphone verification must run only for the macOS package lane");
  assert.match(entitlementStep, /codesign -d --entitlements :- "\$APP_BUNDLE"/u,
    "the entitlement must be read from the packaged application, not source metadata");
  assert.match(entitlementStep, /Print :com\.apple\.security\.device\.audio-input/u,
    "the packaged app must explicitly carry the microphone entitlement");
  assert.match(entitlementStep, /grep -q true/u,
    "the microphone entitlement must be enabled");
  assert.match(entitlementStep, /Print :NSMicrophoneUsageDescription/u,
    "the packaged app must provide a platform microphone usage disclosure");
  assert.match(entitlementStep, /test -n "\$\(printf '%s' "\$MICROPHONE_USAGE_DESCRIPTION" \| tr -d '\[:space:\]'\)"/u,
    "the microphone usage disclosure must not be empty or whitespace");
});

test("binary packaging selects exactly one release-tagged Desktop asset before checksumming", () => {
  const release = workflows.get("trigger-release.yml");
  assert.ok(release, "trigger-release.yml must exist");

  const matrixStart = release.indexOf("      matrix:\n");
  const matrix = release.slice(matrixStart, release.indexOf("\n    steps:\n", matrixStart));
  assert.match(matrix, /asset_template: Terminay-Mac-%VERSION%-Installer\.dmg/u,
    "the macOS lane must declare its deterministic release asset name");
  assert.match(matrix, /asset_template: Terminay-Linux-%VERSION%\.AppImage/u,
    "the Linux lane must declare its deterministic release asset name");

  const verification = release.indexOf("- name: Verify exact release asset selection");
  const checksums = release.indexOf("- name: Write release asset checksums");
  assert.ok(verification >= 0, "binary packaging must verify its exact release asset selection");
  assert.ok(checksums > verification,
    "exact asset selection must finish before checksumming makes bytes publishable");

  const selectionStep = release.slice(verification, checksums);
  assert.match(selectionStep, /TAG: \$\{\{ needs\.release\.outputs\.tag \}\}/u,
    "asset selection must derive the expected artifact from the release-created tag");
  assert.match(selectionStep, /\[\[ "\$TAG" =~ \^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/u,
    "asset selection must reject a malformed release tag before using it in a path");
  assert.match(selectionStep, /EXPECTED_FILE="release\/\$VERSION\/\$EXPECTED_ASSET"/u,
    "asset selection must require the deterministic release output path");
  assert.match(selectionStep, /test -f "\$EXPECTED_FILE"/u,
    "the expected release artifact must exist");
  assert.match(selectionStep, /test ! -L "\$EXPECTED_FILE"/u,
    "the deterministic desktop artifact must not be a symlink");
  assert.match(selectionStep, /find release -type f/u,
    "asset selection must enumerate publishable desktop artifacts rather than trusting an upload glob");
  assert.match(selectionStep, /-name '\*\.dmg'/u,
    "asset selection must include every DMG candidate");
  assert.match(selectionStep, /-name '\*\.AppImage'/u,
    "asset selection must include every AppImage candidate");
  assert.match(selectionStep, /test "\$CANDIDATE_COUNT" = 1/u,
    "a stale second desktop artifact must fail packaging");
  assert.match(selectionStep, /test "\$ACTUAL_FILE" = "\$EXPECTED_FILE"/u,
    "the sole selected artifact must be the tag-derived candidate");
});

test("binary packaging checks out the immutable release tag before syncing or building", () => {
  const release = workflows.get("trigger-release.yml");
  assert.ok(release, "trigger-release.yml must exist");

  const buildStart = release.indexOf("  build-binaries:\n");
  const publishStart = release.indexOf("  publish-release-notes:\n");
  assert.ok(buildStart >= 0, "release workflow must declare its binary build job");
  assert.ok(publishStart > buildStart, "release-note publication must follow binary packaging");

  const buildJob = release.slice(buildStart, publishStart);
  const checkout = buildJob.indexOf("- name: Check out code");
  const syncVersion = buildJob.indexOf("- name: Sync package version to release tag");
  const packageBuild = buildJob.indexOf("- name: Build packaged app");
  assert.ok(checkout >= 0, "binary job must check out a source revision");
  assert.ok(syncVersion > checkout, "package metadata must be synced after the immutable checkout");
  assert.ok(packageBuild > syncVersion, "packaging must run after version metadata is synced");

  const checkoutStep = buildJob.slice(checkout, syncVersion);
  assert.match(checkoutStep, /ref:\s*\$\{\{ needs\.release\.outputs\.tag \}\}/u,
    "binary packaging must use the exact tag created by the release job, not a mutable branch ref");
  assert.match(checkoutStep, /persist-credentials:\s*false/u,
    "tag checkout must remain credential-free");
});

test("binary packaging fails closed if the checked-out tag no longer resolves to the release source commit", () => {
  const release = workflows.get("trigger-release.yml");
  assert.ok(release, "trigger-release.yml must exist");

  const releaseStart = release.indexOf("  release:\n");
  const binariesStart = release.indexOf("  build-binaries:\n");
  const publishStart = release.indexOf("  publish-release-notes:\n");
  assert.ok(releaseStart >= 0 && binariesStart > releaseStart,
    "release and binary packaging jobs must exist in order");
  assert.ok(publishStart > binariesStart,
    "binary packaging job must precede release-note publication");

  const releaseJob = release.slice(releaseStart, binariesStart);
  assert.match(releaseJob, /source_commit:\s*\$\{\{ steps\.release_source\.outputs\.commit \}\}/u,
    "release must expose its exact source commit to downstream packaging jobs");
  const sourceStep = release.slice(
    release.indexOf("- name: Record immutable release source and tag baseline"),
    release.indexOf("- name: Create release tag"),
  );
  assert.match(sourceStep, /id:\s*release_source/u,
    "release source recording must have a stable output id");
  assert.match(sourceStep, /git rev-parse HEAD/u,
    "release source recording must resolve the actual tagged commit");

  const buildJob = release.slice(binariesStart, publishStart);
  const verification = buildJob.indexOf("- name: Verify immutable release tag source");
  const install = buildJob.indexOf("- name: Install dependencies");
  const sync = buildJob.indexOf("- name: Sync package version to release tag");
  assert.ok(verification >= 0 && install > verification && sync > verification,
    "tag/source verification must finish before dependencies or version/build mutation");

  const verificationStep = buildJob.slice(verification, install);
  assert.match(verificationStep, /TAG: \$\{\{ needs\.release\.outputs\.tag \}\}/u,
    "verification must use the release-created tag");
  assert.match(verificationStep, /EXPECTED_COMMIT: \$\{\{ needs\.release\.outputs\.source_commit \}\}/u,
    "verification must use the release job's captured source commit");
  assert.match(verificationStep, /git rev-parse "\$TAG\^\{commit\}"/u,
    "verification must resolve the tag target commit");
  assert.match(verificationStep, /git rev-parse HEAD/u,
    "verification must resolve the checked-out commit");
  assert.match(verificationStep, /test "\$TAG_COMMIT" = "\$EXPECTED_COMMIT"/u,
    "a moved tag must fail before packaging");
  assert.match(verificationStep, /test "\$CHECKED_OUT_COMMIT" = "\$EXPECTED_COMMIT"/u,
    "an incorrect checkout must fail before packaging");
});

test("release creation accepts exactly one newly-created canonical tag for its captured source", () => {
  const release = workflows.get("trigger-release.yml");
  assert.ok(release, "trigger-release.yml must exist");

  const releaseStart = release.indexOf("  release:\n");
  const binariesStart = release.indexOf("  build-binaries:\n");
  assert.ok(releaseStart >= 0 && binariesStart > releaseStart,
    "release and binary packaging jobs must exist in order");
  const releaseJob = release.slice(releaseStart, binariesStart);

  const baseline = releaseJob.indexOf("- name: Record immutable release source and tag baseline");
  const create = releaseJob.indexOf("- name: Create release tag");
  const resolve = releaseJob.indexOf("- name: Resolve and verify newly created release tag");
  assert.ok(baseline >= 0 && create > baseline && resolve > create,
    "release source/tag baseline must be captured before creation and verified afterwards");

  const baselineStep = releaseJob.slice(baseline, create);
  assert.match(baselineStep, /git rev-parse HEAD/u,
    "the baseline must capture the source commit before release creation");
  assert.match(baselineStep, /terminay-release-tags-before/u,
    "the baseline must record canonical tags that already point at that source");
  assert.match(baselineStep, /grep -E '\^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$'/u,
    "the baseline must consider only canonical semantic-version tags");
  assert.match(baselineStep, /LC_ALL=C sort -u/u,
    "the baseline tag list must use comm-compatible deterministic ordering");

  const resolveStep = releaseJob.slice(resolve, releaseJob.indexOf("- name: Detect AI release-notes credential"));
  assert.match(resolveStep, /SOURCE_COMMIT: \$\{\{ steps\.release_source\.outputs\.commit \}\}/u,
    "release tag verification must use the source commit captured before tag creation");
  assert.match(resolveStep, /comm -13 "\$RUNNER_TEMP\/terminay-release-tags-before" "\$AFTER_TAGS" > "\$NEW_TAGS"/u,
    "only tags created during this release invocation may be selected");
  assert.match(resolveStep, /LC_ALL=C sort -u/u,
    "the post-release tag list must use comm-compatible deterministic ordering");
  assert.match(resolveStep, /test "\$NEW_TAG_COUNT" = 1/u,
    "ambiguous multiple new tags must fail closed");
  assert.match(resolveStep, /\[\[ "\$TAG" =~ \^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$ \]\]/u,
    "the selected new tag must be canonical semver");
  assert.match(resolveStep, /test "\$\(git rev-parse "\$TAG\^\{commit\}"\)" = "\$SOURCE_COMMIT"/u,
    "the selected tag must still resolve to the captured source commit");
  assert.match(resolveStep, /if \[ "\$NEW_TAG_COUNT" = 0 \]; then[\s\S]*no_release=true/u,
    "a no-op release must skip publication rather than reuse an older tag");
});

test("release notes are not published until every immutable Desktop asset and checksum is attached", () => {
  const release = workflows.get("trigger-release.yml");
  assert.ok(release, "trigger-release.yml must exist");

  const publishStart = release.indexOf("  publish-release-notes:\n");
  assert.ok(publishStart >= 0, "release workflow must publish release notes in a dedicated job");
  const publishJob = release.slice(publishStart);
  const download = publishJob.indexOf("- name: Download release notes artifact");
  const verify = publishJob.indexOf("- name: Verify immutable Desktop release assets before notes");
  const append = publishJob.indexOf("- name: Append release asset summary");
  const edit = publishJob.indexOf("- name: Update GitHub release notes");

  assert.ok(download >= 0 && verify > download,
    "release assets must be checked after notes are downloaded");
  assert.ok(append > verify && edit > append,
    "asset verification must complete before release notes are assembled or published");

  const verificationStep = publishJob.slice(verify, append);
  assert.match(verificationStep, /gh release view "\$TAG" --repo "\$GH_REPO" --json assets --jq '\.assets\[\]\.name'/u,
    "verification must inspect the actual GitHub Release asset list");
  assert.match(verificationStep, /Terminay-Mac-\$\{VERSION\}-Installer\.dmg/u,
    "verification must require the deterministic macOS artifact");
  assert.match(verificationStep, /Terminay-Mac-\$\{VERSION\}-Installer\.dmg\.sha256/u,
    "verification must require the macOS checksum sidecar");
  assert.match(verificationStep, /Terminay-Linux-\$\{VERSION\}\.AppImage/u,
    "verification must require the deterministic Linux artifact");
  assert.match(verificationStep, /Terminay-Linux-\$\{VERSION\}\.AppImage\.sha256/u,
    "verification must require the Linux checksum sidecar");
  assert.match(verificationStep, /test "\$ASSET_NAMES" = "\$EXPECTED_ASSET_NAMES"/u,
    "the release attachment list must exactly equal the reviewed set, rather than allowing extra assets beside required names");
});

test("standalone npm payload is inspected without executing unresolved package dependencies", () => {
  const release = workflows.get("trigger-release.yml");
  assert.ok(release, "trigger-release.yml must exist");

  const verifyStart = release.indexOf("- name: Verify extracted standalone server payload before checksumming");
  const checksumStart = release.indexOf("- name: Write and verify standalone server checksum");
  assert.ok(verifyStart >= 0 && checksumStart > verifyStart,
    "standalone payload verification must precede checksumming");
  const verification = release.slice(verifyStart, checksumStart);
  assert.match(verification, /node scripts\/standalone-artifact\.mjs "\$EXTRACTED\/package" "\$MANIFEST"/u,
    "the extracted npm package must use the non-executing artifact inspector");
  assert.match(verification, /require\(process\.argv\[1\]\)\.package\.version/u,
    "the inspected package version must equal the release tag version");
  assert.doesNotMatch(verification, /dist\/cli\.js" --version/u,
    "the raw npm payload must not execute before its declared dependencies are installed");
});

test("release notes verify downloaded GitHub Release bytes against their published checksum sidecars", () => {
  const release = workflows.get("trigger-release.yml");
  assert.ok(release, "trigger-release.yml must exist");

  const assetNameVerification = release.indexOf("- name: Verify immutable Desktop release assets before notes");
  const checksumVerification = release.indexOf("- name: Verify published Desktop asset checksums before notes");
  const summary = release.indexOf("- name: Append release asset summary");
  const notes = release.indexOf("- name: Update GitHub release notes");
  assert.ok(assetNameVerification >= 0, "release notes must first verify expected asset names");
  assert.ok(checksumVerification > assetNameVerification,
    "published-byte verification must follow the release asset-name verification");
  assert.ok(summary > checksumVerification,
    "download links must not be appended before published bytes verify");
  assert.ok(notes > checksumVerification,
    "GitHub Release notes must not publish before published bytes verify");

  const verification = release.slice(checksumVerification, summary);
  assert.match(verification, /gh release download "\$TAG" --repo "\$GH_REPO" --dir "\$ASSET_DIR" --pattern "\$expected"/u,
    "the exact published assets and sidecars must be downloaded from GitHub Release");
  assert.match(verification, /test -f "\$ASSET_DIR\/\$expected"/u,
    "every expected downloaded asset must exist before checksumming");
  assert.match(verification, /Terminay-Mac-\$\{VERSION\}-Installer\.dmg\.sha256/u,
    "the macOS checksum sidecar must be downloaded");
  assert.match(verification, /Terminay-Linux-\$\{VERSION\}\.AppImage\.sha256/u,
    "the Linux checksum sidecar must be downloaded");
  assert.match(verification, /cd "\$ASSET_DIR"[\s\S]*shasum -a 256 -c "\$\(basename "\$asset"\)\.sha256"/u,
    "downloaded assets must verify beside their portable published sidecars");
});
