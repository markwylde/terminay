import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const COMPONENT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const FORBIDDEN_RUNTIME_REFERENCES = /(?:\bwindow\.terminay\b|\belectron\b|\bipcRenderer\b|\bipcMain\b|\bMessagePort\b|\bWebSocket\b|\bfetch\s*\(|\bXMLHttpRequest\b|\brequire\s*\(|\bprocess\s*\.)/u
const IMPORT_SPECIFIER = /(?:^|\n)\s*(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/gu
const DYNAMIC_IMPORT_SPECIFIER = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu

async function sourceComponents(directory = COMPONENT_DIRECTORY, relativeDirectory = '') {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries
    .filter(entry => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(entry => sourceComponents(join(directory, entry.name), join(relativeDirectory, entry.name))))
  const sources = await Promise.all(entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.mjs') && !entry.name.endsWith('.test.mjs'))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(async entry => Object.freeze({
      entry: join(relativeDirectory, entry.name),
      source: await readFile(join(directory, entry.name), 'utf8'),
    })))
  return [...sources, ...nested.flat()]
}

test('shared UI feature components remain renderer-neutral and transport-free', async () => {
  const components = await sourceComponents()
  assert.ok(components.length > 0, 'the shared UI package must contain feature components')

  for (const { entry, source } of components) {
    assert.doesNotMatch(source, FORBIDDEN_RUNTIME_REFERENCES, `${entry} must not reach a privileged runtime or concrete transport`)

    for (const match of source.matchAll(IMPORT_SPECIFIER)) {
      assert.match(match[1], /^\.\.?\//u, `${entry} may only import another local shared UI module`)
    }
    for (const match of source.matchAll(DYNAMIC_IMPORT_SPECIFIER)) {
      assert.match(match[1], /^\.\.?\//u, `${entry} may only import another local shared UI module`)
    }
  }
})
