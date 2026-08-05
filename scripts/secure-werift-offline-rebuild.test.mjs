import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  RETAINED_RUNTIME_PACKAGES,
  TRANSITIVE_RUNTIME_DEPENDENCY_OVERRIDES,
} from './build-secure-werift-candidate.mjs'

test('candidate.1 source acquisition pins ranged transitive runtime dependencies', () => {
  assert.deepEqual(TRANSITIVE_RUNTIME_DEPENDENCY_OVERRIDES, {
    pvutils: RETAINED_RUNTIME_PACKAGES['node_modules/pvutils'][0],
  })
})

test('candidate.1 offline rebuild gate separates mirror acquisition from the network-free proof', async () => {
  const builder = await readFile(new URL('./build-secure-werift-candidate.mjs', import.meta.url), 'utf8')
  const proof = await readFile(new URL('./prove-secure-werift-offline-rebuild.mjs', import.meta.url), 'utf8')
  const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')

  assert.match(builder, /npm_config_offline: 'true'/u)
  assert.equal(
    [...builder.matchAll(/overrides: TRANSITIVE_RUNTIME_DEPENDENCY_OVERRIDES/gu)].length,
    2,
  )
  assert.match(builder, /verifySecureWeriftSourceMirror\(sourceMirror\)/u)
  assert.match(builder, /Secure Werift mirrored license integrity mismatch/u)
  assert.match(proof, /buildSecureWeriftCandidate[\s\S]*sourceMirror/u)
  assert.match(proof, /Offline candidate rebuilds differ/u)
  assert.match(proof, /Offline candidate archives differ/u)
  assert.match(workflow, /Prepare integrity-pinned Secure Werift source mirror/u)
  assert.match(workflow, /Prove clean network-independent Secure Werift rebuild/u)
  assert.match(workflow, /--prepare-mirror "\$RUNNER_TEMP\/secure-werift-source-mirror"/u)
  assert.match(workflow, /--prove-mirror "\$RUNNER_TEMP\/secure-werift-source-mirror"/u)
  assert.match(workflow, /npm_config_offline: "true"/u)
  assert.doesNotMatch(
    workflow.slice(
      workflow.indexOf('Prove clean network-independent Secure Werift rebuild'),
      workflow.indexOf('Prove clean network-independent Secure Werift rebuild') + 500,
    ),
    /curl|npm (?:install|view)|git clone/u,
  )
})
