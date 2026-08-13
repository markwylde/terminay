import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { build } from 'esbuild'
import { join } from 'node:path'
import test from 'node:test'

const bundleDirectory = await mkdtemp(join(process.cwd(), '.web-reconnect-attempt-'))
const bundlePath = join(bundleDirectory, 'reconnectAttempt.mjs')
const policyBundlePath = join(bundleDirectory, 'reconnectPolicy.mjs')
await build({
  entryPoints: ['src/web/reconnectAttempt.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundlePath,
  logLevel: 'silent',
})
await build({
  entryPoints: ['src/web/reconnectPolicy.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: policyBundlePath,
  logLevel: 'silent',
})
const { runBoundedBrowserRecoveryStep } = await import(`${bundlePath}?test=${Date.now()}`)
const { isAutoRestorableProfile, isBrowserReconnectOrigin, reconnectNeedsFreshPairing } =
  await import(`${policyBundlePath}?test=${Date.now()}`)
test.after(() => rm(bundleDirectory, { force: true, recursive: true }))

test('browser recovery bounds an acquisition which ignores cancellation', async () => {
  let callback
  let cleared = false
  const attempt = new AbortController()
  const pending = runBoundedBrowserRecoveryStep({
    clock: {
      clearTimeout: () => { cleared = true },
      setTimeout: (next) => { callback = next; return 1 },
    },
    label: 'Credential lookup',
    operation: async () => new Promise(() => {}),
    signal: attempt.signal,
    timeoutMs: 30,
  })
  callback()
  await assert.rejects(pending, /Credential lookup timed out after 30ms/)
  assert.equal(cleared, true)
})

test('browser recovery aborts a hung acquisition when its generation is cancelled', async () => {
  const attempt = new AbortController()
  const pending = runBoundedBrowserRecoveryStep({
    clock: {
      clearTimeout: () => undefined,
      setTimeout: () => 1,
    },
    label: 'Reconnect ticket',
    operation: async () => new Promise(() => {}),
    signal: attempt.signal,
  })
  attempt.abort(new Error('superseded'))
  await assert.rejects(pending, /superseded/)
})

test('browser reconnect policy accepts HTTPS and exact loopback development origins', () => {
  for (const origin of [
    'https://session.example.test',
    'http://localhost:4317',
    'http://server.localhost:4317',
    'http://127.0.0.1:4317',
    'http://[::1]:4317',
  ]) assert.equal(isBrowserReconnectOrigin(origin), true, origin)
  for (const origin of ['http://example.test', 'ws://localhost:4317'])
    assert.equal(isBrowserReconnectOrigin(origin), false, origin)
})

test('browser auto-restore is limited to active remote profiles in recoverable states', () => {
  const profile = { id: 'profile-a', label: 'Server', origin: 'https://server.test', status: 'unreachable' }
  assert.equal(isAutoRestorableProfile(profile), true)
  assert.equal(isAutoRestorableProfile({ ...profile, status: 'connected' }), true)
  assert.equal(isAutoRestorableProfile({ ...profile, status: 'connecting' }), true)
  assert.equal(isAutoRestorableProfile({ ...profile, status: 'disconnected' }), false)
  assert.equal(isAutoRestorableProfile({ ...profile, archived: true }), false)
  assert.equal(isAutoRestorableProfile({ ...profile, isLocal: true }), false)
})

test('only permanent reconnect proof failures require fresh pairing', () => {
  for (const message of [
    'reconnect proof request is invalid',
    'reconnect credential is unavailable for this server',
    'reconnect credential changed while signing',
    'Saved reconnect credentials were rejected during protocol handshake.',
    'Server reconnect request failed (401)',
  ]) assert.equal(reconnectNeedsFreshPairing(new Error(message)), true, message)
  for (const cause of [new Error('client is not connected'), new Error('Server reconnect request failed (502)'), '401'])
    assert.equal(reconnectNeedsFreshPairing(cause), false)
})
