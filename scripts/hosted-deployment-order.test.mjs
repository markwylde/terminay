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
  assert.match(workflow, /needs: build-main-archives/u)
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
