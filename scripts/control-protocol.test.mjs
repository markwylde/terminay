import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { transform } from 'esbuild'

const { encodeControlMessage, createControlMessageDecoder } = await importTransformed(
  '../electron/control/protocol.ts',
)

test('encode/decode round-trips a single message', () => {
  const decode = createControlMessageDecoder()
  const message = { id: 'a1', token: 't', op: 'list_terminals', params: {} }
  const decoded = decode(encodeControlMessage(message))
  assert.deepEqual(decoded, [message])
})

test('decoder reassembles a message split across chunks', () => {
  const decode = createControlMessageDecoder()
  const line = encodeControlMessage({ id: 'x', op: 'write_terminal', params: { text: 'hi' } })
  const mid = Math.floor(line.length / 2)
  assert.deepEqual(decode(line.slice(0, mid)), [])
  const out = decode(line.slice(mid))
  assert.equal(out.length, 1)
  assert.equal(out[0].id, 'x')
  assert.equal(out[0].params.text, 'hi')
})

test('decoder yields multiple messages from one chunk', () => {
  const decode = createControlMessageDecoder()
  const chunk = encodeControlMessage({ id: '1' }) + encodeControlMessage({ id: '2' })
  const out = decode(chunk)
  assert.deepEqual(
    out.map((m) => m.id),
    ['1', '2'],
  )
})

test('decoder skips malformed lines and reports them', () => {
  const errors = []
  const decode = createControlMessageDecoder((line) => errors.push(line))
  const out = decode(`not json\n${encodeControlMessage({ id: 'ok' })}`)
  assert.deepEqual(
    out.map((m) => m.id),
    ['ok'],
  )
  assert.deepEqual(errors, ['not json'])
})

test('decoder ignores blank lines', () => {
  const decode = createControlMessageDecoder()
  assert.deepEqual(decode('\n\n   \n'), [])
})

async function importTransformed(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8')
  const transformed = await transform(source, {
    format: 'esm',
    loader: 'ts',
    platform: 'node',
    target: 'node20',
  })
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-control-test-'))
  const outputPath = join(tempDir, `${relativePath.split('/').pop()}.mjs`)
  await writeFile(outputPath, transformed.code)
  return import(outputPath)
}
