import assert from "node:assert/strict"
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
