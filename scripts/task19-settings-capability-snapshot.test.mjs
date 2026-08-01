import assert from 'node:assert/strict'
import { build } from 'esbuild'
import test from 'node:test'

async function loadCapabilityModule() {
  const result = await build({
    bundle: true,
    entryPoints: ['src/services/settings/legacySettingsCapability.ts'],
    format: 'esm',
    platform: 'node',
    target: 'node22',
    write: false,
  })
  const source = result.outputFiles[0].text
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
}

test('Task 19 settings compatibility snapshots only named host capabilities', async () => {
  const { captureLegacySettingsCapability } = await loadCapabilityModule()
  const calls = []
  const api = {
    getTerminalSettings: () => ({ fontSize: 14 }),
    onTerminalSettingsChanged: (listener) => {
      listener({ settings: { fontSize: 15 } })
      return () => calls.push('unsubscribe')
    },
    resetTerminalSettings: () => ({ fontSize: 12 }),
    updateTerminalSettings: (settings) => ({ ...settings, saved: true }),
    unrelatedPrivilegedOperation: () => { throw new Error('must not be retained') },
  }

  const capability = captureLegacySettingsCapability(api)
  assert.notEqual(capability, api)
  assert.equal(Object.isFrozen(capability), true)
  assert.equal('unrelatedPrivilegedOperation' in capability, false)

  api.getTerminalSettings = () => { throw new Error('mutated broad host object was consulted') }
  assert.deepEqual(await capability.getTerminalSettings(), { fontSize: 14 })
  assert.deepEqual(await capability.updateTerminalSettings({ fontSize: 16 }), { fontSize: 16, saved: true })
  const unsubscribe = capability.onTerminalSettingsChanged((message) => calls.push(message.settings.fontSize))
  unsubscribe()
  assert.deepEqual(calls, [15, 'unsubscribe'])
})

test('Task 19 settings compatibility fails closed for incomplete host capabilities', async () => {
  const { captureLegacySettingsCapability } = await loadCapabilityModule()
  assert.throws(
    () => captureLegacySettingsCapability({ getTerminalSettings: () => ({}) }),
    /legacy settings capability .* is unavailable/,
  )
})

test('Task 19 settings adapter snapshots direct capability injection', async () => {
  const { captureLegacySettingsCapability } = await loadCapabilityModule()
  const api = {
    getTerminalSettings: () => ({ fontSize: 14 }),
    onTerminalSettingsChanged: () => () => {},
    resetTerminalSettings: () => ({ fontSize: 12 }),
    updateTerminalSettings: (settings) => settings,
  }

  const capability = captureLegacySettingsCapability(api)
  api.getTerminalSettings = () => ({ fontSize: 99 })
  assert.deepEqual(await capability.getTerminalSettings(), { fontSize: 14 })
})

test('Task 19 settings compatibility supplier leaves the broad preload', async () => {
  const [entry, preload, declarations, compatibility] = await Promise.all([
    import('node:fs/promises').then(({ readFile }) => readFile('src/rendererRuntime.tsx', 'utf8')),
    import('node:fs/promises').then(({ readFile }) => readFile('electron/preload.ts', 'utf8')),
    import('node:fs/promises').then(({ readFile }) => readFile('src/vite-env.d.ts', 'utf8')),
    import('node:fs/promises').then(({ readFile }) => readFile('src/types/terminay.ts', 'utf8')),
  ])
  assert.match(entry, /createLegacySettingsClient\(\s*window\.terminayTerminalSettingsCompatibilityHost,?\s*\)/u)
  assert.match(entry, /<TerminalSettingsClientProvider client=\{legacySettingsClient\}>/u)
  assert.match(preload, /exposeInMainWorld\(\s*'terminayTerminalSettingsCompatibilityHost'/u)
  assert.match(preload, /serialized\.length > 1_048_576/u)
  assert.match(declarations, /terminayTerminalSettingsCompatibilityHost:/u)
  assert.doesNotMatch(compatibility, /^ {2}onTerminalSettingsChanged:/mu)
})
