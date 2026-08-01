import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const css = await readFile(new URL('../src/web/index.css', import.meta.url), 'utf8')

test('browser connection dialog stays within the visual viewport and device safe areas', () => {
  assert.match(css, /\.browser-host-shell[\s\S]*?min-height:\s*100dvh;/u)
  assert.match(css, /\.connect-modal-backdrop\s*\{[\s\S]*?position:\s*fixed;/u)
  assert.match(css, /\.connect-modal-backdrop\s*\{[\s\S]*?env\(safe-area-inset-top\)[\s\S]*?env\(safe-area-inset-bottom\)/u)
  assert.match(css, /\.connect-modal\s*\{[\s\S]*?max-height:\s*calc\(100dvh - env\(safe-area-inset-top\) - env\(safe-area-inset-bottom\) - 48px\);/u)
})

test('narrow browser connection dialog remains internally scrollable instead of escaping the viewport', () => {
  assert.match(css, /@media \(max-width:\s*720px\)[\s\S]*?\.connect-modal-backdrop\s*\{[\s\S]*?align-items:\s*start;[\s\S]*?env\(safe-area-inset-top\)[\s\S]*?env\(safe-area-inset-bottom\)/u)
  assert.match(css, /@media \(max-width:\s*720px\)[\s\S]*?\.connect-modal\s*\{[\s\S]*?max-height:\s*calc\(100dvh - env\(safe-area-inset-top\) - env\(safe-area-inset-bottom\) - 32px\);/u)
  assert.match(css, /\.connect-modal\s*\{[\s\S]*?overflow:\s*auto;/u)
})
