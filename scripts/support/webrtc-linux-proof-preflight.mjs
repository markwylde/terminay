import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const expectedArch = process.env.TERMINAY_PROOF_EXPECT_ARCH

assert.equal(process.platform, 'linux', 'The clean WebRTC proof must run on GNU/Linux.')
assert.ok(
  expectedArch === 'x64' || expectedArch === 'arm64',
  'TERMINAY_PROOF_EXPECT_ARCH must be x64 or arm64.',
)
assert.equal(process.arch, expectedArch, 'The Node runtime architecture must match its proof lane.')
assert.equal(process.env.DISPLAY, undefined, 'The displayless proof must not inherit DISPLAY.')
assert.equal(
  process.env.WAYLAND_DISPLAY,
  undefined,
  'The displayless proof must not inherit WAYLAND_DISPLAY.',
)

for (const tool of ['cc', 'c++', 'gcc', 'g++', 'clang', 'clang++', 'cmake', 'make', 'ninja']) {
  const lookup = spawnSync('sh', ['-c', `command -v '${tool}'`], {
    encoding: 'utf8',
  })
  assert.notEqual(lookup.status, 0, `Clean Linux proof unexpectedly found ${tool}.`)
}

process.stdout.write(`clean-linux-preflight=${JSON.stringify({
  arch: process.arch,
  node: process.version,
  platform: process.platform,
})}\n`)
