import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import {
  assertHostedDeploymentOrder,
  createHostedDeploymentPlan,
  HostedDeploymentOrderError,
  HOSTED_COMPONENTS,
} from "./hosted-deployment-order.mjs"

function plan(overrides = {}) {
  return createHostedDeploymentPlan({
    currentHosted: { version: "1.0.0", minimumClientVersion: "1.0.0", maximumClientVersion: "1.0.1" },
    nextHosted: { version: "1.1.0", minimumClientVersion: "1.0.0", maximumClientVersion: "1.1.0" },
    currentClients: [
      { id: "desktop", version: "1.0.0" },
      { id: "web", version: "1.0.1" },
    ],
    dependentClients: [
      { id: "desktop", version: "1.1.0" },
      { id: "web", version: "1.1.0" },
    ],
    ...overrides,
  })
}

test("hosted plan keeps existing clients compatible before dependent clients roll out", () => {
  const release = plan()
  assert.deepEqual(release.compatibility.hostedComponents, HOSTED_COMPONENTS)
  assert.equal(release.compatibility.currentClientsCovered, true)
  assert.deepEqual(release.stages.map((stage) => stage.id), [
    "publish-hosted",
    "verify-hosted",
    "client:desktop",
    "client:web",
    "retire-previous-hosted",
  ])
  assertHostedDeploymentOrder(release, release.stages.map((stage) => stage.id))
  assert.equal(Object.isFrozen(release), true)
  assert.equal(Object.isFrozen(release.stages), true)
})

test("a hosted revision that drops an existing client is rejected before rollout", () => {
  assert.throws(() => plan({
    nextHosted: { version: "1.1.0", minimumClientVersion: "1.1.0", maximumClientVersion: "1.1.0" },
  }), (error) => error instanceof HostedDeploymentOrderError && error.code === "hosted-not-backward-compatible")
})

test("a dependent client outside the hosted window is rejected", () => {
  assert.throws(() => plan({
    dependentClients: [{ id: "desktop", version: "1.2.0" }],
  }), (error) => error instanceof HostedDeploymentOrderError && error.code === "hosted-not-backward-compatible")
})

test("execution validation prevents clients or retirement from preceding hosted verification", () => {
  const release = plan()
  const ids = release.stages.map((stage) => stage.id)
  assert.throws(() => assertHostedDeploymentOrder(release, [ids[0], ids[2], ids[1], ids[3], ids[4]]), (error) => error instanceof HostedDeploymentOrderError && error.code === "invalid-order")
  assert.throws(() => assertHostedDeploymentOrder(release, [ids[0], ids[1], ids[4], ids[2], ids[3]]), (error) => error instanceof HostedDeploymentOrderError && error.code === "invalid-order")
  assert.throws(() => assertHostedDeploymentOrder(release, [ids[1], ids[0], ids[2], ids[3], ids[4]]), /must run after publish-hosted/)
})

const prereleaseWorkflowUrl = new URL("../.github/workflows/main-prerelease.yml", import.meta.url)

function workflowJob(workflow, name) {
  const header = `\n  ${name}:\n`
  const start = workflow.indexOf(header)
  assert.ok(start >= 0, `the workflow must declare job ${name}`)
  const rest = workflow.slice(start + header.length)
  const next = rest.search(/^ {2}[a-z][a-z0-9-]*:\n/mu)
  return next === -1 ? rest : rest.slice(0, next)
}

test("the rolling prerelease uploads every replacement before any published name moves", async () => {
  const workflow = await readFile(prereleaseWorkflowUrl, "utf8")

  const upload = workflow.indexOf("- name: Upload replacement assets under temporary names")
  const rename = workflow.indexOf("- name: Rename temporary assets over the published rolling release")
  const verify = workflow.indexOf("- name: Verify the published rolling release")
  assert.ok(upload >= 0 && rename > upload && verify > rename,
    "replacements must be uploaded, then renamed over, then re-verified")

  const uploadStep = workflow.slice(upload, rename)
  assert.match(uploadStep, /gh release upload "\$RELEASE_TAG" "release\/server\/\$NAME\.incoming"/u,
    "a replacement must land beside the published set under a temporary name")
  assert.doesNotMatch(uploadStep, /-X DELETE/u,
    "no published asset may be removed while a replacement is still uploading")

  const renameStep = workflow.slice(rename, verify)
  const promote = renameStep.slice(renameStep.indexOf("promote() {"))
  const deletePublished = promote.indexOf("-X DELETE")
  const patchIncoming = promote.indexOf("-X PATCH")
  assert.ok(deletePublished >= 0 && patchIncoming > deletePublished,
    "the published name must be freed immediately before the uploaded replacement takes it")
  assert.match(renameStep, /-f "name=\$NAME"/u, "the replacement must take the published name")

  // Both architectures are built from one commit before anything is published,
  // so a track never advertises a mixed-revision pair.
  assert.match(workflowJob(workflow, "publish"), /^ {4}needs: \[plan, build-archives, build-desktop\]$/mu)
  assert.match(workflowJob(workflow, "build-archives"), /fail-fast: true/u)
  assert.match(workflow, /--channel "\$CHANNEL"/u)
  assert.match(workflow, /--revision "\$EXPECTED_COMMIT"/u)

  // A release tagged for a branch makes that name ambiguous in every clone of
  // the repository: `git fetch main` then resolves the tag, not the branch.
  assert.match(workflow, /RELEASE_TAG=main-latest\n/u)
  assert.match(workflow, /RELEASE_TAG=canary-latest\n/u)
  assert.match(workflow, /gh release create "\$RELEASE_TAG"/u)
  assert.doesNotMatch(
    workflow,
    /gh release (?:create|view|upload|download) (?:main|canary)(?![-\w])/u,
    "a rolling prerelease tag must not be named for a branch",
  )
})

function prereleaseStep(workflow, name) {
  const start = workflow.indexOf(`- name: ${name}\n`)
  assert.ok(start >= 0, `the rolling prerelease must have step ${name}`)
  const next = workflow.indexOf("- name:", start + 1)
  return workflow.slice(start, next === -1 ? undefined : next)
}

test("the track names the rolling release, the assets, the metadata channel and notarization", async () => {
  const workflow = await readFile(prereleaseWorkflowUrl, "utf8")
  assert.match(workflow, /^on:\n {2}workflow_call:\n {4}inputs:\n {6}track:\n/mu)
  assert.match(workflow, /^ {6}dry_run:\n(?: {8}.*\n)*? {8}type: boolean\n {8}default: false$/mu)
  const names = prereleaseStep(workflowJob(workflow, "plan"), "Name the track's release, assets and channel")
  assert.match(names, /nightly\)\n(?:\s+#.*\n)*\s+RELEASE_TAG=main-latest\n\s+ASSET=main\n\s+NOTARIZE=true\n/u)
  assert.match(names, /canary\)\n\s+RELEASE_TAG=canary-latest\n\s+ASSET=canary\n\s+NOTARIZE=false\n\s+LEGACY_BETA=false\n/u)
  assert.match(names, /\*\)\n\s+echo "Unknown track: \$TRACK" >&2\n\s+exit 1/u)
  // The archive manifest records the same name as the assets.
  assert.match(names, /echo "channel=\$ASSET"/u)

  // The version is derived once, guarded by the published build's count, and
  // re-derived by every desktop platform to the same value.
  const version = prereleaseStep(workflowJob(workflow, "plan"), "Derive the prerelease version")
  assert.match(version, /node scripts\/prerelease-version\.mjs --track "\$TRACK" --notes-out "[^"]+" --published-build "\$RUNNER_TEMP\/published\/build\.json"/u)
  assert.match(version, /test "\$\{VERSION##\*\.\}" = "\$TRACK"/u)
  assert.match(prereleaseStep(workflowJob(workflow, "plan"), "Read the track's published build"),
    /gh release download "\$RELEASE_TAG" --repo "\$GH_REPO" --pattern build\.json/u)
})

test("the canary caller builds every push to main, one at a time, with no notarization credential", async () => {
  const canary = await readFile(new URL("../.github/workflows/canary.yml", import.meta.url), "utf8")
  assert.match(canary, /^on:\n {2}push:\n {4}branches:\n {6}- main\n {2}workflow_dispatch:\n/mu)
  // A dispatch is a dry run unless asked otherwise.
  assert.match(canary, /^ {6}dry_run:\n(?: {8}.*\n)*? {8}default: true$/mu)
  assert.match(canary, /^concurrency:\n(?: {2}#.*\n)* {2}group: canary\n {2}cancel-in-progress: false$/mu)
  assert.match(canary, /uses: \.\/\.github\/workflows\/main-prerelease\.yml/u)
  assert.match(canary, /^ {6}track: canary$/mu)
  assert.doesNotMatch(canary, /APPLE_APP_SPECIFIC_PASSWORD:|secrets: inherit/u)
  assert.doesNotMatch(canary, /^ {2}schedule:/mu)
})

test("the nightly caller builds once a night, only when main moved, and notarizes", async () => {
  const nightly = await readFile(new URL("../.github/workflows/nightly.yml", import.meta.url), "utf8")
  assert.match(nightly, /^on:\n {2}schedule:\n(?: {4}#.*\n)* {4}- cron: "23 2 \* \* \*"\n {2}workflow_dispatch:\n/mu)
  // GitHub drops scheduled runs at the top of the hour under load.
  assert.doesNotMatch(nightly, /- cron: "0 /u)
  assert.match(nightly, /^concurrency:\n(?: {2}#.*\n)* {2}group: nightly\n {2}cancel-in-progress: false$/mu)
  const decide = workflowJob(nightly, "decide")
  assert.match(decide, /gh release download main-latest --repo "\$GH_REPO" --pattern build\.json/u)
  assert.match(decide, /node scripts\/nightly-skip\.mjs --head "\$HEAD_COMMIT" --build-json "[^"]+"/u)
  assert.doesNotMatch(decide, /^ {4}permissions:\n(?: {6}.*\n)* {6}contents: write/mu)
  const build = workflowJob(nightly, "nightly")
  assert.match(build, /^ {4}needs: decide\n(?: {4}#.*\n)* {4}if: needs\.decide\.outputs\.build == 'true'$/mu)
  assert.match(build, /^ {6}track: nightly$/mu)
  assert.match(build, /APPLE_APP_SPECIFIC_PASSWORD: \$\{\{ secrets\.APPLE_APP_SPECIFIC_PASSWORD \}\}/u)
})

test("the rolling prerelease publishes desktop builds beside the archives and moves metadata, then build.json, last", async () => {
  const workflow = await readFile(prereleaseWorkflowUrl, "utf8")
  const archives = workflowJob(workflow, "build-archives")
  const desktop = workflowJob(workflow, "build-desktop")
  const publish = workflowJob(workflow, "publish")

  // The server archive build does not depend on the desktop build.
  assert.match(archives, /^ {4}needs: plan$/mu)
  assert.match(desktop, /^ {4}needs: plan$/mu)
  assert.doesNotMatch(archives, /build-desktop|main-desktop/u)

  // Fixed names per platform and track, so each run replaces the last.
  const asset = (suffix) => `terminay-desktop-\\$\\{\\{ needs\\.plan\\.outputs\\.asset \\}\\}-${suffix}`
  const metadata = (suffix) => `\\$\\{\\{ inputs\\.track \\}\\}${suffix}\\.yml`
  assert.match(desktop, new RegExp(`- os: macos-latest\\n\\s+label: macOS\\n\\s+platform: mac\\n\\s+target: zip\\n\\s+asset: ${asset("mac\\.zip")}\\n\\s+metadata: ${metadata("-mac")}`, "u"))
  assert.match(desktop, new RegExp(`- os: ubuntu-latest\\n\\s+label: Linux\\n\\s+platform: linux\\n\\s+target: AppImage\\n\\s+asset: ${asset("linux-x86_64\\.AppImage")}\\n\\s+metadata: ${metadata("-linux")}`, "u"))
  assert.match(desktop, new RegExp(`- os: windows-latest\\n\\s+label: Windows\\n\\s+platform: win\\n\\s+target: nsis\\n\\s+asset: ${asset("windows-x64-Setup\\.exe")}\\n\\s+metadata: ${metadata("")}`, "u"))
  assert.match(desktop, /fetch-depth: 0\n\s+fetch-tags: true\n\s+persist-credentials: false/u,
    "the prerelease version is derived from the commits since the latest tag")
  assert.doesNotMatch(desktop, /^ {4}permissions:/mu, "the desktop build job must keep the read-only token")

  const order = [
    "Verify the build commit",
    "Check macOS signing secrets",
    "Import Apple signing certificate",
    "Derive the prerelease version and release notes",
    "Sync package version to the prerelease version",
    "Build packaged prerelease app",
    "Check every native file in the Windows prerelease is x64",
    "Build the Windows update probe's next version",
    "Install the Windows prerelease installer, run terminals from it, and update it in place",
    "Check the Linux prerelease AppImage against the glibc floor and run terminals from it there",
    "Verify exact prerelease asset selection",
    "Verify the macOS prerelease zip is signed by the team under the hardened runtime",
    "Verify generated prerelease update metadata",
    "Write and verify prerelease checksum",
    "Upload prerelease workflow artifact",
  ].map((name) => desktop.indexOf(`- name: ${name}\n`))
  assert.ok(order.every((index, i) => index >= 0 && (i === 0 || index > order[i - 1])), "desktop prerelease steps must run in order")

  const version = prereleaseStep(desktop, "Derive the prerelease version and release notes")
  assert.match(version, /node scripts\/prerelease-version\.mjs --track "\$TRACK" --notes-out "\$RUNNER_TEMP\/prerelease-notes\.md"/u)
  assert.match(version, /test "\$VERSION" = "\$PLANNED_VERSION"/u)
  assert.match(prereleaseStep(desktop, "Sync package version to the prerelease version"), /node scripts\/sync-package-version\.mjs "\$VERSION"/u)

  const build = prereleaseStep(desktop, "Build packaged prerelease app")
  // Notarization credentials reach only a notarized track's macOS build.
  assert.match(build, /APPLE_ID: \$\{\{ matrix\.os == 'macos-latest' && needs\.plan\.outputs\.notarize == 'true' && vars\.APPLE_ID \|\| '' \}\}/u)
  assert.match(build, /APPLE_APP_SPECIFIC_PASSWORD: \$\{\{ matrix\.os == 'macos-latest' && needs\.plan\.outputs\.notarize == 'true' && secrets\.APPLE_APP_SPECIFIC_PASSWORD \|\| '' \}\}/u)
  assert.match(build, /CSC_IDENTITY_AUTO_DISCOVERY: \$\{\{ matrix\.os == 'macos-latest' && 'true' \|\| 'false' \}\}/u)
  // macOS builds on its runner, where it signs; Linux builds in the GNU/Linux
  // floor image (ADR-0077). Both run the same prerelease build.
  assert.match(build, /sh scripts\/build-prerelease-desktop\.sh "\$TRACK" "\$PLATFORM" "\$TARGET" "\$ASSET" "\$RUNNER_TEMP\/prerelease-notes\.md"/u)
  assert.match(build, /if \[ "\$PLATFORM" = linux \]; then\n\s+(?:#.*\n\s+)*sh scripts\/run-in-linux-floor\.sh --output release\/main-desktop --input "\$RUNNER_TEMP\/prerelease-notes\.md:prerelease-notes\.md" -- sh scripts\/build-prerelease-desktop\.sh "\$TRACK" "\$PLATFORM" "\$TARGET" "\$ASSET" prerelease-notes\.md\n/u)
  const prereleaseBuild = await readFile(new URL("./build-prerelease-desktop.sh", import.meta.url), "utf8")
  assert.match(prereleaseBuild, /--publish never/u)
  // The GitHub provider does not derive its channel from the version, so an
  // unnamed channel would write latest-*.yml onto the track's release.
  assert.match(prereleaseBuild, /"-c\.publish\.channel=\$track"/u)
  assert.match(prereleaseBuild, /nightly\|canary\) ;;/u)
  assert.match(prereleaseBuild, /"-c\.\$platform\.artifactName=\$asset"/u)
  assert.match(prereleaseBuild, /"-c\.releaseInfo\.releaseNotesFile=\$notes"/u)
  // A Canary macOS build is never submitted to Apple.
  assert.match(prereleaseBuild, /if \[ "\$platform" = mac \] && \[ "\$track" = canary \]; then notarize=-c\.mac\.notarize=false; fi\n/u)
  assert.match(prereleaseBuild, /^ {2}\$notarize$/mu)
  const floor = prereleaseStep(desktop, "Check the Linux prerelease AppImage against the glibc floor and run terminals from it there")
  assert.match(floor, /if: matrix\.platform == 'linux'/u)
  assert.match(floor, /node scripts\/linux-glibc-floor\.mjs check --target linux-x64 "release\/main-desktop\/\$ASSET"/u)
  assert.match(floor, /sh scripts\/probe-linux-glibc-floor\.sh appimage "release\/main-desktop\/\$ASSET"/u)
  const pe = prereleaseStep(desktop, "Check every native file in the Windows prerelease is x64")
  assert.match(pe, /if: matrix\.platform == 'win'/u)
  assert.match(pe, /node scripts\/check-windows-pe-architecture\.mjs release\/main-desktop\/win-unpacked/u)
  const updateBuild = prereleaseStep(desktop, "Build the Windows update probe's next version")
  assert.match(updateBuild, /if: matrix\.platform == 'win'/u)
  assert.match(updateBuild, /sh scripts\/build-windows-update-probe\.sh .+ "\$RUNNER_TEMP\/update-probe"\)/u,
    "build N+1 is written outside release/, so no publish step can select it")
  const windowsProbe = prereleaseStep(desktop, "Install the Windows prerelease installer, run terminals from it, and update it in place")
  assert.match(windowsProbe, /if: matrix\.platform == 'win'/u)
  assert.match(windowsProbe, /\.\/scripts\/probe-windows-desktop\.ps1 -Installer "release\/main-desktop\/\$env:ASSET" -Record "[^"]+" -UpdateFeed "\$env:RUNNER_TEMP\/update-probe" -UpdateVersion \$env:UPDATE_VERSION/u)

  // Every track is signed and fails without its certificate; only the
  // notarized track also needs Apple's notary credentials.
  const secrets = prereleaseStep(desktop, "Check macOS signing secrets")
  assert.match(secrets, /Refusing to publish an unsigned or unnotarized macOS prerelease/u)
  assert.match(secrets, /required="MACOS_CERTIFICATE_P12 MACOS_CERTIFICATE_PASSWORD APPLE_TEAM_ID"\n\s+if \[ "\$NOTARIZE" = true \]; then\n\s+required="\$required APPLE_ID APPLE_APP_SPECIFIC_PASSWORD"/u)

  const zip = prereleaseStep(desktop, "Verify the macOS prerelease zip is signed by the team under the hardened runtime")
  assert.match(zip, /ditto -x -k "\$ZIP" "\$EXTRACTED"/u)
  assert.match(zip, /codesign --verify --deep --strict --verbose=2 "\$APP_BUNDLE"/u)
  assert.match(zip, /grep -F "TeamIdentifier=\$APPLE_TEAM_ID"/u)
  assert.match(zip, /grep -E 'flags=0x\[0-9a-f\]\+\\\(\[\^\)\]\*runtime\[\^\)\]\*\\\)'/u)
  // Gatekeeper and the stapled ticket are checked only where Apple was asked.
  assert.match(zip, /if \[ "\$NOTARIZE" = true \]; then\n(?:\s+#.*\n)*\s+spctl --assess --type execute --verbose=4 "\$APP_BUNDLE"\n\s+xcrun stapler validate "\$APP_BUNDLE"\n\s+else\n/u)
  assert.match(zip, /A Canary app must not carry a notarization ticket/u)
  const metadataCheck = prereleaseStep(desktop, "Verify generated prerelease update metadata")
  assert.match(metadataCheck, /--expect-file "\$ASSET"[\s\S]*--require-release-notes/u)
  assert.match(metadataCheck, /--version "\$VERSION"/u)
  const selection = prereleaseStep(desktop, "Verify exact prerelease asset selection")
  assert.match(selection, /test "\$ACTUAL_FILES" = "\$EXPECTED_FILES"/u)
  assert.match(selection, /test "\$ACTUAL_METADATA" = "\$OUTPUT\/\$METADATA"/u)
  const artifact = prereleaseStep(desktop, "Upload prerelease workflow artifact")
  assert.match(artifact, /name: prerelease-desktop-\$\{\{ matrix\.platform \}\}/u,
    "desktop artifacts must not match the server archive download pattern")
  assert.match(artifact, /include-hidden-files: false/u)

  // Publishing: dry runs and branches never publish, and a failed desktop
  // build never holds the server archives back.
  assert.match(publish, /if: \$\{\{ !cancelled\(\) && needs\.plan\.result == 'success' && needs\.build-archives\.result == 'success' && inputs\.dry_run != true && github\.ref == 'refs\/heads\/main' \}\}/u)
  assert.match(publish, /DESKTOP: \$\{\{ needs\.build-desktop\.result \}\}/u)
  assert.match(prereleaseStep(publish, "Download built rolling channel assets"), /pattern: prerelease-server-\*/u)
  const desktopDownload = prereleaseStep(publish, "Download built desktop prerelease assets")
  assert.match(desktopDownload, /if: needs\.build-desktop\.result == 'success'/u)
  assert.match(desktopDownload, /pattern: prerelease-desktop-\*/u)
  const preflight = prereleaseStep(publish, "Verify every downloaded desktop prerelease asset before publication")
  assert.match(preflight, /release-checksum\.mjs verify "\$OUTPUT\/\$payload" "\$OUTPUT\/\$payload\.sha256"/u)
  assert.match(preflight, /test "\$MAC_VERSION" = "\$LINUX_VERSION"/u, "every platform must be one build")
  assert.match(preflight, /test "\$MAC_VERSION" = "\$WINDOWS_VERSION"/u)
  assert.match(preflight, /test "\$MAC_VERSION" = "\$VERSION"/u)
  assert.match(preflight, /test "\$\{MAC_VERSION##\*\.\}" = "\$TRACK"/u)

  // One list of every published name, in promotion order.
  const set = prereleaseStep(publish, "Name the track's published set")
  assert.match(set, /SERVER_NAMES="\$SERVER_NAMES terminay-server-\$ASSET-\$target\.tar\.gz\$suffix"/u)
  assert.match(set, /PAYLOADS="terminay-desktop-\$ASSET-mac\.zip terminay-desktop-\$ASSET-linux-x86_64\.AppImage terminay-desktop-\$ASSET-windows-x64-Setup\.exe"/u)
  assert.match(set, /METADATA_NAMES="\$TRACK-mac\.yml \$TRACK-linux\.yml \$TRACK\.yml"/u)
  assert.match(set, /if \[ "\$LEGACY_BETA" = true \]; then\n\s+LEGACY_NAMES="beta-mac\.yml beta-linux\.yml beta\.yml"/u)

  // build.json is written only for a published desktop set, and names this
  // commit and version.
  const record = prereleaseStep(publish, "Write the build record")
  assert.match(record, /if: needs\.build-desktop\.result == 'success'/u)
  assert.match(record, /JSON\.stringify\(\{ commit: process\.argv\[1\], version: process\.argv\[2\] \}\)/u)
  assert.match(record, /"\$EXPECTED_COMMIT" "\$VERSION" > release\/main-desktop\/build\.json/u)

  const upload = prereleaseStep(publish, "Upload replacement assets under temporary names")
  assert.match(upload, /for NAME in \$PAYLOAD_NAMES \$METADATA_NAMES \$LEGACY_NAMES build\.json; do\n\s+cp "release\/main-desktop\/\$NAME" "release\/main-desktop\/\$NAME\.incoming"\n\s+gh release upload "\$RELEASE_TAG" "release\/main-desktop\/\$NAME\.incoming" --repo "\$GH_REPO" --clobber/u)

  const rename = prereleaseStep(publish, "Rename temporary assets over the published rolling release")
  const servers = rename.indexOf("for NAME in $SERVER_NAMES; do\n            promote")
  const payloads = rename.indexOf("for NAME in $PAYLOAD_NAMES; do\n              promote")
  const metadataPromotion = rename.indexOf("for NAME in $METADATA_NAMES $LEGACY_NAMES; do\n              promote")
  const buildRecord = rename.indexOf("promote build.json")
  assert.ok(servers >= 0 && payloads > servers && metadataPromotion > payloads && buildRecord > metadataPromotion,
    "archives, then payloads, then metadata, then build.json")
  assert.equal(rename.slice(buildRecord).match(/promote /gu).length, 1, "nothing may move after build.json")
  // Once the legacy Beta feed has ended, its stale metadata is removed.
  assert.match(rename, /if \[ "\$TRACK" = nightly \] && \[ "\$LEGACY_BETA" != true \]; then\n(?:\s+#.*\n)*\s+for NAME in beta-mac\.yml beta-linux\.yml beta\.yml; do/u)

  const verify = prereleaseStep(publish, "Verify the published rolling release")
  assert.match(verify, /--jq '\.assets\[\]\.name' \| LC_ALL=C sort\)"/u)
  assert.match(verify, /EXPECTED_ASSET_NAMES="\$\(for name in \$SERVER_NAMES \$PAYLOAD_NAMES \$METADATA_NAMES \$LEGACY_NAMES build\.json; do echo "\$name"; done \| LC_ALL=C sort\)"\n\s+test "\$ASSET_NAMES" = "\$EXPECTED_ASSET_NAMES"/u,
    "a published desktop set must leave exactly the full set, build.json included")
  assert.match(verify, /--release-assets "\$RUNNER_TEMP\/release-asset-names"/u)
  assert.match(verify, /cmp "\$PUBLISHED\/\$1" "release\/main-desktop\/\$1"/u)
  assert.match(verify, /for prefix in "\$TRACK" \$\{LEGACY_NAMES:\+beta\}; do/u)
  assert.match(verify, /cmp "\$PUBLISHED\/build\.json" release\/main-desktop\/build\.json/u)
})

test("the nightly also publishes the legacy Beta metadata as verified byte copies until the end date", async () => {
  const workflow = await readFile(prereleaseWorkflowUrl, "utf8")
  const publish = workflowJob(workflow, "publish")
  const copies = prereleaseStep(publish, "Copy the nightly metadata under the legacy Beta names")
  assert.match(copies, /if: needs\.build-desktop\.result == 'success' && needs\.plan\.outputs\.legacy_beta == 'true'/u)
  assert.match(copies, /test "\$TRACK" = nightly/u)
  for (const suffix of ["-mac", "-linux", ""]) {
    assert.ok(copies.includes(`cp "$OUTPUT/nightly${suffix}.yml" "$OUTPUT/beta${suffix}.yml"`), `beta${suffix}.yml must copy nightly${suffix}.yml`)
    assert.match(copies, new RegExp(`verify-update-metadata\\.mjs --metadata "\\$OUTPUT/beta${suffix}\\.yml"[^\\n]*\\)" = "\\$VERSION"`, "u"))
  }
  // The copies are made after the nightly metadata was verified and before
  // anything is uploaded, so they move in the same swap.
  assert.ok(publish.indexOf("- name: Verify every downloaded desktop prerelease asset before publication") < publish.indexOf("- name: Copy the nightly metadata under the legacy Beta names"))
  assert.ok(publish.indexOf("- name: Copy the nightly metadata under the legacy Beta names") < publish.indexOf("- name: Upload replacement assets under temporary names"))
  // The end date lives in one script that both the prerelease and the image
  // workflow read.
  const plan = workflowJob(workflow, "plan")
  assert.match(plan, /LEGACY_BETA="\$\(node scripts\/legacy-beta-feed\.mjs\)"/u)
  const script = await readFile(new URL("./legacy-beta-feed.mjs", import.meta.url), "utf8")
  assert.match(script, /export const LEGACY_BETA_FEED_UNTIL = '2027-02-09'$/mu)
})

test("a new canary-latest release links no payload", async () => {
  const workflow = await readFile(prereleaseWorkflowUrl, "utf8")
  const create = prereleaseStep(workflowJob(workflow, "publish"), "Ensure the rolling prerelease exists")
  assert.match(create, /if ! gh release view "\$RELEASE_TAG" --repo "\$GH_REPO"/u)
  assert.match(create, /--prerelease/u)
  assert.match(create, /TITLE="canary \(rolling\)"/u)
  const notes = create.match(/NOTES="([^"]*)"/gu)
  assert.ok(notes && notes.length === 2)
  for (const note of notes) {
    assert.doesNotMatch(note, /https?:|terminay-desktop|releases\/download/u, "release notes must link no payload")
  }
})

test("no document links a canary desktop payload for download", async () => {
  // Gatekeeper blocks an un-notarized app fetched in a browser, so a Canary is
  // reached only through the update channel.
  const { readdir } = await import("node:fs/promises")
  const files = [
    new URL("../README.md", import.meta.url),
    new URL("../apps/terminay-cli/README.md", import.meta.url),
  ]
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory)
      if (entry.isDirectory()) await walk(child)
      else if (entry.name.endsWith(".md")) files.push(child)
    }
  }
  await walk(new URL("../docs/", import.meta.url))
  for (const file of files) {
    const text = await readFile(file, "utf8")
    assert.doesNotMatch(text, /canary-latest\/terminay-desktop/u, `${file.pathname} must not link a canary desktop payload`)
  }
  const workflow = await readFile(prereleaseWorkflowUrl, "utf8")
  assert.doesNotMatch(workflow, /canary-latest\/terminay-desktop/u)
})

test("the rolling server archives carry the prerelease version, not the workspace placeholder", async () => {
  const workflow = await readFile(prereleaseWorkflowUrl, "utf8")
  const archives = workflowJob(workflow, "build-archives")
  const sync = archives.indexOf('node scripts/sync-package-version.mjs "$VERSION"')
  const build = archives.indexOf("Build self-contained rolling channel archive")
  assert.ok(sync > 0 && sync < build, "the version is synced before the archive is built")
  assert.match(archives, /VERSION: \$\{\{ needs\.plan\.outputs\.version \}\}\n\s+run: node scripts\/sync-package-version\.mjs "\$VERSION"/u)
  assert.match(archives, /--version "\$VERSION" > "\$RUNNER_TEMP\/standalone-probe\.json"/u)
})
