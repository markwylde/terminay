import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { transform } from 'esbuild'

const macroSettings = await importTransformed('../src/macroSettings.ts')

test('macro preview renders legacy fields and the supported Eta subset', () => {
  assert.equal(
    macroSettings.renderMacroTemplate(
      "Hello {{Name}} <% if (enabled === true) { %>yes<% } else { %>no<% } %> <%= it.Name %>",
      { Name: 'Ada', enabled: true },
    ),
    'Hello Ada yes Ada',
  )
  assert.equal(
    macroSettings.renderMacroTemplate("<% if (enabled === true) { %>yes<% } else { %>no<% } %>", { enabled: false }),
    'no',
  )
})

test('macro preview fails closed for executable Eta and never renders secret values', () => {
  const preview = macroSettings.tryRenderMacroTemplate('<% process.exit() %>', {})
  assert.match(preview, /^Template error:/)
  assert.equal(
    macroSettings.tryRenderMacroTemplate('deploy {{Environment}} [secret:api-token]', { Environment: 'prod' }),
    'deploy prod [secret:api-token]',
  )
})

test('macro placeholder discovery stays aligned with safe Eta interpolation and conditions', () => {
  assert.deepEqual(
    macroSettings.mergeFieldsWithSteps([
      { id: 'step-1', type: 'type', content: '<%= message %><% if (enabled === true) { %>{{Name}}<% } %>' },
    ], []).map((field) => field.name),
    ['Name', 'message', 'enabled'],
  )
})

async function importTransformed(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8')
  const transformed = await transform(source, {
    format: 'esm',
    loader: 'ts',
    platform: 'node',
    target: 'node20',
  })
  const directory = await mkdtemp(join(tmpdir(), 'terminay-macro-preview-'))
  const outputPath = join(directory, 'macroSettings.mjs')
  await writeFile(outputPath, transformed.code)
  test.after(async () => rm(directory, { force: true, recursive: true }))
  return import(outputPath)
}
