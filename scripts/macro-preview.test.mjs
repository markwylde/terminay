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

test('macro preview fails closed for executable Eta', () => {
  const preview = macroSettings.tryRenderMacroTemplate('<% process.exit() %>', {})
  assert.match(preview, /^Template error:/)
  // The Macros window shows such a template as written; rendering it throws.
  assert.throws(() => macroSettings.renderMacroTemplate('<% process.exit() %>', {}))
})

test('macro preview renders what the window needs: a missing value, a marked value, a field-driven wait', () => {
  // An input with no value renders as nothing, so the window substitutes a
  // marker first and shows the input's label where the marker lands.
  assert.equal(macroSettings.renderMacroTemplate('merge into {{branch}}.', {}), 'merge into .')
  assert.equal(macroSettings.renderMacroTemplate('merge into {{branch}}.', { branch: '' }), 'merge into .')
  assert.equal(
    macroSettings.renderMacroTemplate('merge into {{branch}} then <%= branch %>.', { branch: '\u00010\u0001' }),
    'merge into \u00010\u0001 then \u00010\u0001.',
  )
  assert.equal(macroSettings.renderMacroDurationMs('{Delay}', { Delay: 2.5 }), 2500)
  assert.equal(macroSettings.renderMacroDurationMs('3', {}), 3000)
  // A wait whose field has no value yet cannot be timed; the window shows it as written.
  assert.throws(() => macroSettings.renderMacroDurationMs('{Delay}', {}), /non-negative number of seconds/)
})

test('a stored step the client does not know is kept as unsupported, never as text', () => {
  const [macro] = macroSettings.normalizeMacros([
    { id: 'm', title: 'M', category: ' Release ', steps: [{ id: 's', type: 'secret', secretId: 'api-token' }, { id: 'k', type: 'key', key: 'Enter' }] },
  ])
  assert.deepEqual(macro.steps[0], { id: 's', type: 'unsupported', sourceType: 'secret' })
  assert.equal(JSON.stringify(macro).includes('api-token'), false)
  assert.equal(macro.category, 'Release')
  assert.equal(macro.submitMode, 'type-and-submit')
  // Normalising again keeps the original type name.
  assert.deepEqual(macroSettings.normalizeMacros([macro])[0].steps[0], macro.steps[0])
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
