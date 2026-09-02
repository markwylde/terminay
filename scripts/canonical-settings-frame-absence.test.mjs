import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('renderer settings and transport have no preload compatibility fallback', async () => {
  const [client, declarations, runtimeSpec, settingsSpec] = await Promise.all([
    read('src/shared/rendererServerClient.ts'),
    read('src/vite-env.d.ts'),
    read('openspec/specs/server-runtime-and-protocol/spec.md'),
    read('openspec/specs/settings-shortcuts-and-desktop-integration/spec.md'),
  ])
  const combined = [client, declarations].join('\n')

  assert.doesNotMatch(combined, /LegacyServerFrameCapability|PreloadServerMessagePort|preloadFrameCapability/u)
  assert.doesNotMatch(combined, /terminayServerConnectionHost|terminayTerminalSettingsCompatibilityHost/u)
  assert.match(client, /port: MessagePort/u)
  assert.match(runtimeSpec, /SHALL accept only that selected-server byte endpoint/u)
  assert.match(settingsSpec, /No terminal-settings preload global or snapshot adapter SHALL exist/u)

  for (const path of [
    'src/shared/legacyServerFrameCapability.ts',
    'src/services/settings/legacySettingsCapability.ts',
  ]) {
    await assert.rejects(access(new URL(`../${path}`, import.meta.url)), { code: 'ENOENT' })
  }
})
