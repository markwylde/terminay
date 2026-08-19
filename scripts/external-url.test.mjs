import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

const directory = await mkdtemp(join(tmpdir(), 'terminay-external-url-'))
const output = join(directory, 'externalUrl.mjs')
await build({
  bundle: true,
  entryPoints: ['electron/externalUrl.ts'],
  format: 'esm',
  logLevel: 'silent',
  outfile: output,
  platform: 'node',
})
const { normalizeExternalUrl } = await import(pathToFileURL(output).href)
test.after(async () => {
  await rm(directory, { recursive: true, force: true })
})

test('external URLs accept credential-free HTTP and HTTPS', () => {
  assert.equal(normalizeExternalUrl('http://127.0.0.1:8080/status'), 'http://127.0.0.1:8080/status')
  assert.equal(normalizeExternalUrl('https://example.com/docs'), 'https://example.com/docs')
  assert.equal(normalizeExternalUrl('HTTP://EXAMPLE.COM/docs'), 'http://example.com/docs')
  assert.equal(normalizeExternalUrl('http://example.com:80/docs'), 'http://example.com/docs')
  assert.equal(normalizeExternalUrl('https://example.com:443/docs'), 'https://example.com/docs')
})

test('external URLs reject other schemes, credentials, and control characters', () => {
  for (const url of [
    'javascript:alert(1)',
    'file:///etc/passwd',
    'ftp://example.com/file',
    'mailto:user@example.com',
    'http://user:pass@example.com/',
    'https://user@example.com/',
    'http://\u0000example.com/',
  ]) {
    assert.throws(() => normalizeExternalUrl(url), /HTTP or HTTPS/u)
  }
})
