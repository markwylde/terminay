import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { build } from 'esbuild'

const boundary = await importBoundary()

test('signaling boundary round-trips bounded relay records and rejects unsafe shapes', () => {
  const valid = {
    candidate: { candidate: 'candidate:1 1 UDP 1 127.0.0.1 9 typ host', sdpMid: '0', sdpMLineIndex: 0 },
    roomId: 'room-a',
    type: 'ice',
  }
  const serialized = boundary.serializeSignalingMessage(valid)
  assert.deepEqual(boundary.parseSignalingMessage(serialized), valid)
  assert.deepEqual(boundary.parseSignalingMessage(new TextEncoder().encode(serialized)), valid)

  const malformed = [
    null,
    [],
    '{}',
    '{"type":"bad type"}',
    '{"type":"offer","__proto__":{"polluted":true}}',
    '{"type":"offer","constructor":{"prototype":{"polluted":true}}}',
    '{"type":"offer",',
  ]
  for (const value of malformed) assert.throws(() => boundary.parseSignalingMessage(value), Error)
  assert.throws(() => boundary.serializeSignalingMessage(undefined), /object/)
  assert.throws(() => boundary.serializeSignalingMessage({ type: 'offer', payload: 'x'.repeat(130 * 1024) }), /128 KiB/)
  assert.throws(() => boundary.parseSignalingMessage(new Uint8Array([0xff, 0xfe])), /UTF-8/)
})

test('deterministic fuzz inputs cannot escape signaling validation as non-Errors', () => {
  for (let seed = 1; seed <= 2_000; seed += 1) {
    const bytes = new Uint8Array(seed % 257)
    let state = seed >>> 0
    for (let index = 0; index < bytes.length; index += 1) {
      state = (state * 1664525 + 1013904223) >>> 0
      bytes[index] = state & 0xff
    }
    try {
      boundary.parseSignalingMessage(bytes)
    } catch (error) {
      assert.ok(error instanceof Error)
    }
  }
})

test('signaling depth, field-count, cyclic, and oversized relay frames are bounded', () => {
  let nested = { type: 'offer' }
  for (let index = 0; index < 30; index += 1) nested = { type: 'offer', nested }
  assert.throws(() => boundary.serializeSignalingMessage(nested), /deeply nested/)

  const manyFields = { type: 'offer' }
  for (let index = 0; index < 600; index += 1) manyFields[`field-${index}`] = index
  assert.throws(() => boundary.serializeSignalingMessage(manyFields), /too many fields/)

  const cyclic = { type: 'offer' }
  cyclic.self = cyclic
  assert.throws(() => boundary.serializeSignalingMessage(cyclic), /cycle/)
  assert.throws(() => boundary.parseSignalingMessage(`{"type":"offer","payload":"${'x'.repeat(130 * 1024)}"}`), /128 KiB/)
})

async function importBoundary() {
  const directory = await mkdtemp(join(tmpdir(), 'terminay-task20-signaling-'))
  const output = join(directory, 'signalingBoundary.mjs')
  await build({ bundle: true, entryPoints: [new URL('../electron/remote/signalingBoundary.ts', import.meta.url).pathname], format: 'esm', outfile: output, platform: 'node', target: 'node24' })
  const module = await import(output)
  await rm(directory, { recursive: true, force: true })
  return module
}
