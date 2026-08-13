import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { build } from 'esbuild'
import { join } from 'node:path'
import test from 'node:test'

const directory = await mkdtemp(join(process.cwd(), '.web-connection-failure-'))
const bundle = join(directory, 'failure.mjs')
await build({ entryPoints: ['src/web/webConnectionFailure.ts'], bundle: true, format: 'esm', platform: 'node', outfile: bundle, logLevel: 'silent' })
const { classifyWebConnectionFailure } = await import(`${bundle}?test=${Date.now()}`)
test.after(() => rm(directory, { force: true, recursive: true }))

test('revoked and expired credentials block recovery', () => {
  assert.deepEqual(classifyWebConnectionFailure(new Error('device was revoked')), { disposition: 'blocked', reason: 'revoked' })
  assert.deepEqual(classifyWebConnectionFailure(new Error('reconnect credential expired')), { disposition: 'blocked', reason: 'expired' })
})

test('stopped exposure blocks while host shutdown stops', () => {
  assert.deepEqual(classifyWebConnectionFailure(new Error('remote exposure stopped')), { disposition: 'blocked', reason: 'exposure-stopped' })
  assert.deepEqual(classifyWebConnectionFailure(new Error('server is shutting down')), { disposition: 'stopped', reason: 'host-shutdown' })
})

test('offline relay and route failures remain retryable', () => {
  assert.equal(classifyWebConnectionFailure(new Error('network offline')).reason, 'offline')
  assert.equal(classifyWebConnectionFailure(new Error('TURN relay unavailable')).reason, 'relay')
  assert.equal(classifyWebConnectionFailure(new Error('signaling route unavailable')).reason, 'route')
})
