import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

const directory = await mkdtemp(join(tmpdir(), 'terminay-about-window-'))
const output = join(directory, 'aboutWindowDocument.mjs')
await build({
  bundle: true,
  entryPoints: ['electron/aboutWindowDocument.ts'],
  format: 'esm',
  logLevel: 'silent',
  outfile: output,
  platform: 'node',
})
const { ABOUT_WINDOW_LINKS, aboutWindowDocument, aboutWindowDocumentHtml, aboutWindowExternalUrl } =
  await import(pathToFileURL(output).href)
test.after(async () => {
  await rm(directory, { force: true, recursive: true })
})

test('the About document names the version, author, licence, and links', () => {
  const html = aboutWindowDocumentHtml({ version: '5.9.0', year: 2026 })
  assert.match(html, /Version 5\.9\.0/)
  assert.match(html, /Mark Wylde/)
  assert.match(html, /GNU AGPL v3\.0 or later/)
  assert.match(html, /open source/)
  for (const url of Object.values(ABOUT_WINDOW_LINKS)) assert.ok(html.includes(`href="${url}"`), url)
  assert.ok(html.includes('href="https://terminay.com/"'))
  assert.ok(html.includes('href="https://github.com/markwylde/terminay"'))
})

test('the About document runs no script and loads nothing', () => {
  const html = aboutWindowDocumentHtml({ version: '1.0.0' })
  assert.doesNotMatch(html, /<script/i)
  assert.doesNotMatch(html, /\son[a-z]+=/i)
  assert.match(html, /default-src 'none'; style-src 'unsafe-inline'/)
  assert.deepEqual(
    [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]).sort(),
    Object.values(ABOUT_WINDOW_LINKS).sort(),
  )
})

test('the version is escaped', () => {
  const html = aboutWindowDocumentHtml({ version: '<img src=x onerror=alert(1)>' })
  assert.doesNotMatch(html, /<img/)
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
})

test('the artwork stops moving under reduced motion', () => {
  assert.match(aboutWindowDocumentHtml({ version: '1.0.0' }), /prefers-reduced-motion:reduce\)\{\.w\{animation:none\}/)
})

test('it is served as a data URL', () => {
  const url = aboutWindowDocument({ version: '1.0.0' })
  assert.ok(url.startsWith('data:text/html;charset=UTF-8,'))
  assert.match(decodeURIComponent(url.slice(url.indexOf(',') + 1)), /About Terminay/)
})

test('only the rendered links may leave the window', () => {
  for (const url of Object.values(ABOUT_WINDOW_LINKS)) assert.equal(aboutWindowExternalUrl(url), url)
  for (const url of [
    'https://terminay.com/evil',
    'https://github.com/markwylde/terminay/../../x',
    'https://github.com/markwylde/terminay?x=1',
    'http://terminay.com/',
    'file:///etc/passwd',
    'data:text/html,hi',
    '',
    undefined,
    null,
    42,
  ]) {
    assert.equal(aboutWindowExternalUrl(url), null, String(url))
  }
})
