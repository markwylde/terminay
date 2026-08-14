import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('renderer settings and transport have no preload compatibility fallback', async () => {
  const [client, declarations, runtimeSpec, settingsSpec] = await Promise.all([
    read('src/shared/rendererServerClient.ts'),
    read('src/vite-env.d.ts'),
    read('specs/features/server-runtime-and-protocol.md'),
    read('specs/features/settings-shortcuts-and-desktop-integration.md'),
  ])
  const combined = [client, declarations].join('\n')

  assert.doesNotMatch(combined, /LegacyServerFrameCapability|PreloadServerMessagePort|preloadFrameCapability/u)
  assert.doesNotMatch(combined, /terminayServerConnectionHost|terminayTerminalSettingsCompatibilityHost/u)
  assert.match(client, /port: MessagePort/u)
  assert.match(runtimeSpec, /accepts only that selected-server byte endpoint/u)
  assert.match(settingsSpec, /No legacy terminal-settings preload global/u)

  for (const path of [
    'src/shared/legacyServerFrameCapability.ts',
    'src/services/settings/legacySettingsCapability.ts',
  ]) {
    await assert.rejects(access(new URL(`../${path}`, import.meta.url)), { code: 'ENOENT' })
  }
})
