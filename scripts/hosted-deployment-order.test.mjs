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

test("the rolling main prerelease uploads every replacement before any published name moves", async () => {
  const workflow = await readFile(new URL("../.github/workflows/main-prerelease.yml", import.meta.url), "utf8")

  const upload = workflow.indexOf("- name: Upload replacement assets under temporary names")
  const rename = workflow.indexOf("- name: Rename temporary assets over the published main channel")
  const verify = workflow.indexOf("- name: Verify the published main channel set")
  assert.ok(upload >= 0 && rename > upload && verify > rename,
    "replacements must be uploaded, then renamed over, then re-verified")

  const uploadStep = workflow.slice(upload, rename)
  assert.match(uploadStep, /gh release upload main-latest "release\/main\/\$NAME\.incoming"/u,
    "a replacement must land beside the published set under a temporary name")
  assert.doesNotMatch(uploadStep, /-X DELETE/u,
    "no published asset may be removed while a replacement is still uploading")

  const renameStep = workflow.slice(rename, verify)
  const deletePublished = renameStep.indexOf("-X DELETE")
  const patchIncoming = renameStep.indexOf("-X PATCH")
  assert.ok(deletePublished >= 0 && patchIncoming > deletePublished,
    "the published name must be freed immediately before the uploaded replacement takes it")
  assert.match(renameStep, /-f "name=\$NAME"/u, "the replacement must take the published channel name")

  // Both architectures are built from one commit before anything is published,
  // so the channel never advertises a mixed-revision pair.
  assert.match(workflow, /needs: \[build-main-archives, build-main-desktop\]/u)
  assert.match(workflow, /fail-fast: true/u)
  assert.match(workflow, /--channel main/u)
  assert.match(workflow, /--revision "\$EXPECTED_COMMIT"/u)

  // A release tagged for a branch makes that name ambiguous in every clone of
  // the repository: `git fetch main` then resolves the tag, not the branch.
  assert.match(workflow, /gh release create main-latest/u)
  assert.doesNotMatch(
    workflow,
    /gh release (?:create|view|upload|download) main(?![-\w])/u,
    "the rolling prerelease tag must not be named for the default branch",
  )
})

function mainPrereleaseStep(workflow, name) {
  const start = workflow.indexOf(`- name: ${name}\n`)
  assert.ok(start >= 0, `main prerelease must have step ${name}`)
  const next = workflow.indexOf("- name:", start + 1)
  return workflow.slice(start, next === -1 ? undefined : next)
}

test("the rolling main prerelease publishes desktop betas beside the archives and moves their metadata last", async () => {
  const workflow = await readFile(new URL("../.github/workflows/main-prerelease.yml", import.meta.url), "utf8")
  const desktopStart = workflow.indexOf("  build-main-desktop:\n")
  const publishStart = workflow.indexOf("  publish-main-prerelease:\n")
  assert.ok(desktopStart > workflow.indexOf("  build-main-archives:\n") && publishStart > desktopStart)
  const desktop = workflow.slice(desktopStart, publishStart)
  const publish = workflow.slice(publishStart)

  // The server archive build does not depend on the desktop beta.
  assert.doesNotMatch(workflow.slice(0, desktopStart), /build-main-desktop|main-desktop/u)

  // Fixed names per platform, so each run replaces the last.
  assert.match(desktop, /- os: macos-latest\n\s+label: macOS\n\s+platform: mac\n\s+target: zip\n\s+asset: terminay-desktop-main-mac\.zip\n\s+metadata: beta-mac\.yml/u)
  assert.match(desktop, /- os: ubuntu-latest\n\s+label: Linux\n\s+platform: linux\n\s+target: AppImage\n\s+asset: terminay-desktop-main-linux-x86_64\.AppImage\n\s+metadata: beta-linux\.yml/u)
  assert.match(desktop, /fetch-depth: 0\n\s+fetch-tags: true\n\s+persist-credentials: false/u,
    "the beta version is derived from the commits since the latest tag")
  assert.doesNotMatch(desktop, /^ {4}permissions:/mu, "the desktop build job must keep the read-only token")

  const order = [
    "Verify the build commit",
    "Check macOS signing secrets",
    "Import Apple signing certificate",
    "Derive the beta version and release notes",
    "Sync package version to the beta version",
    "Build packaged beta app",
    "Verify exact beta asset selection",
    "Verify macOS signed and notarized beta zip",
    "Verify generated beta update metadata",
    "Write and verify beta checksum",
    "Upload beta workflow artifact",
  ].map((name) => desktop.indexOf(`- name: ${name}\n`))
  assert.ok(order.every((index, i) => index >= 0 && (i === 0 || index > order[i - 1])), "desktop beta steps must run in order")

  const version = mainPrereleaseStep(desktop, "Derive the beta version and release notes")
  assert.match(version, /node scripts\/main-beta-version\.mjs --run-number "\$RUN_NUMBER" --notes-out "\$RUNNER_TEMP\/beta-release-notes\.md"/u)
  assert.match(version, /RUN_NUMBER: \$\{\{ github\.run_number \}\}/u)
  assert.match(version, /test "\$\{VERSION##\*-beta\.\}" = "\$RUN_NUMBER"/u)
  assert.match(mainPrereleaseStep(desktop, "Sync package version to the beta version"), /node scripts\/sync-package-version\.mjs "\$VERSION"/u)

  const build = mainPrereleaseStep(desktop, "Build packaged beta app")
  assert.match(build, /APPLE_ID: \$\{\{ matrix\.os == 'macos-latest' && vars\.APPLE_ID \|\| '' \}\}/u)
  assert.match(build, /CSC_IDENTITY_AUTO_DISCOVERY: \$\{\{ matrix\.os == 'macos-latest' && 'true' \|\| 'false' \}\}/u)
  assert.match(build, /--publish never/u)
  // The GitHub provider does not derive its channel from the version, so an
  // unnamed channel would write latest-*.yml onto the beta channel.
  assert.match(build, /-c\.publish\.channel=beta/u)
  assert.match(build, /"-c\.\$PLATFORM\.artifactName=\$ASSET"/u)
  assert.match(build, /"-c\.releaseInfo\.releaseNotesFile=\$RUNNER_TEMP\/beta-release-notes\.md"/u)
  assert.match(mainPrereleaseStep(desktop, "Check macOS signing secrets"), /Refusing to publish an unsigned or unnotarized macOS beta/u)

  const zip = mainPrereleaseStep(desktop, "Verify macOS signed and notarized beta zip")
  assert.match(zip, /ditto -x -k "\$ZIP" "\$EXTRACTED"/u)
  assert.match(zip, /codesign --verify --deep --strict --verbose=2 "\$APP_BUNDLE"/u)
  assert.match(zip, /spctl --assess --type execute --verbose=4 "\$APP_BUNDLE"/u)
  assert.match(zip, /xcrun stapler validate "\$APP_BUNDLE"/u)
  const metadata = mainPrereleaseStep(desktop, "Verify generated beta update metadata")
  assert.match(metadata, /--expect-file "\$ASSET"[\s\S]*--require-release-notes/u)
  assert.match(metadata, /--version "\$VERSION"/u)
  const selection = mainPrereleaseStep(desktop, "Verify exact beta asset selection")
  assert.match(selection, /test "\$ACTUAL_FILES" = "\$EXPECTED_FILES"/u)
  assert.match(selection, /test "\$ACTUAL_METADATA" = "\$OUTPUT\/\$METADATA"/u)
  const artifact = mainPrereleaseStep(desktop, "Upload beta workflow artifact")
  assert.match(artifact, /name: main-desktop-\$\{\{ matrix\.platform \}\}/u,
    "desktop artifacts must not match the server archive download pattern")
  assert.match(artifact, /include-hidden-files: false/u)

  // Publishing: dry runs never publish, and a failed desktop build never
  // holds the server archives back.
  assert.match(publish, /if: \$\{\{ !cancelled\(\) && needs\.build-main-archives\.result == 'success' && \(github\.event_name == 'push' \|\| inputs\.dry_run != true\) \}\}/u)
  assert.match(publish, /DESKTOP_BETA: \$\{\{ needs\.build-main-desktop\.result \}\}/u)
  assert.match(mainPrereleaseStep(publish, "Download built main channel assets"), /pattern: main-prerelease-\*/u)
  const desktopDownload = mainPrereleaseStep(publish, "Download built desktop beta assets")
  assert.match(desktopDownload, /if: needs\.build-main-desktop\.result == 'success'/u)
  assert.match(desktopDownload, /pattern: main-desktop-\*/u)
  const preflight = mainPrereleaseStep(publish, "Verify every downloaded desktop beta asset before publication")
  assert.match(preflight, /release-checksum\.mjs verify "\$OUTPUT\/\$payload" "\$OUTPUT\/\$payload\.sha256"/u)
  assert.match(preflight, /test "\$MAC_VERSION" = "\$LINUX_VERSION"/u, "both platforms must be one beta")
  assert.match(preflight, /test "\$\{MAC_VERSION##\*-beta\.\}" = "\$RUN_NUMBER"/u)

  const upload = mainPrereleaseStep(publish, "Upload replacement assets under temporary names")
  assert.match(upload, /gh release upload main-latest "release\/main-desktop\/\$NAME\.incoming" --repo "\$GH_REPO" --clobber/u)
  for (const name of ["terminay-desktop-main-mac.zip", "terminay-desktop-main-mac.zip.sha256", "terminay-desktop-main-linux-x86_64.AppImage", "terminay-desktop-main-linux-x86_64.AppImage.sha256", "beta-mac.yml", "beta-linux.yml"]) {
    assert.ok(upload.includes(`${name} \\`) || upload.includes(`${name}; do`), `${name} must be uploaded as an incoming replacement`)
  }

  const rename = mainPrereleaseStep(publish, "Rename temporary assets over the published main channel")
  const promote = rename.slice(rename.indexOf("promote() {"), rename.indexOf("\n          }\n"))
  assert.ok(promote.indexOf("-X DELETE") >= 0 && promote.indexOf("-X PATCH") > promote.indexOf("-X DELETE"))
  const payloadPromotions = [
    rename.lastIndexOf('promote "terminay-server-main-$target.tar.gz$suffix"'),
    rename.lastIndexOf("terminay-desktop-main-mac.zip"),
    rename.lastIndexOf("terminay-desktop-main-linux-x86_64.AppImage.sha256"),
  ]
  const macMetadata = rename.indexOf("promote beta-mac.yml")
  const linuxMetadata = rename.indexOf("promote beta-linux.yml")
  assert.ok(macMetadata >= 0 && linuxMetadata > macMetadata)
  for (const payload of payloadPromotions) {
    assert.ok(payload >= 0 && payload < macMetadata, "beta metadata must be renamed into place after every payload")
  }
  assert.equal(rename.slice(macMetadata).match(/promote /gu).length, 2, "nothing may move after the beta metadata")

  const verify = mainPrereleaseStep(publish, "Verify the published main channel set")
  const expected = verify.slice(verify.indexOf("<<EOF\n"), verify.indexOf("\n          EOF\n")).split("\n").slice(1).map((line) => line.trim())
  assert.deepEqual(expected, [
    "beta-linux.yml",
    "beta-mac.yml",
    "terminay-desktop-main-linux-x86_64.AppImage",
    "terminay-desktop-main-linux-x86_64.AppImage.sha256",
    "terminay-desktop-main-mac.zip",
    "terminay-desktop-main-mac.zip.sha256",
    "terminay-server-main-linux-arm64.tar.gz",
    "terminay-server-main-linux-arm64.tar.gz.sha256",
    "terminay-server-main-linux-arm64.tar.gz.sig",
    "terminay-server-main-linux-x64.tar.gz",
    "terminay-server-main-linux-x64.tar.gz.sha256",
    "terminay-server-main-linux-x64.tar.gz.sig",
  ])
  assert.match(verify, /--jq '\.assets\[\]\.name' \| LC_ALL=C sort\)"/u)
  assert.match(verify, /if \[ "\$DESKTOP_BETA" = success \] \|\| \[ "\$ASSET_NAMES" != "\$SERVER_ASSET_NAMES" \]; then\n\s+test "\$ASSET_NAMES" = "\$EXPECTED_ASSET_NAMES"/u,
    "a built desktop beta must leave exactly the full set; otherwise the set is the full one or the server archives alone")
  assert.match(verify, /--metadata "\$PUBLISHED\/beta-mac\.yml"[\s\S]*--expect-file terminay-desktop-main-mac\.zip[\s\S]*--release-assets "\$RUNNER_TEMP\/main-latest-asset-names"/u)
  assert.match(verify, /--metadata "\$PUBLISHED\/beta-linux\.yml"[\s\S]*--expect-file terminay-desktop-main-linux-x86_64\.AppImage[\s\S]*--release-assets "\$RUNNER_TEMP\/main-latest-asset-names"/u)
  assert.match(verify, /cmp "\$PUBLISHED\/beta-mac\.yml" release\/main-desktop\/beta-mac\.yml/u)
})
