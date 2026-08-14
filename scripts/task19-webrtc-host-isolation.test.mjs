import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const legacyRemoteReference = /(?:legacyRemote|remote\/Remote|remote\.html)/u

test('Task 19 removes the legacy Electron WebRTC host from the normal renderer module graph', async () => {
  const source = await readFile('src/rendererRuntime.tsx', 'utf8')

  assert.doesNotMatch(
    source,
    /^import\s+[^\n]*\bWebRtcHost\b[^\n]*from\s+['"]\.\/remote\/WebRtcHost\.tsx['"]/mu,
    'the primary renderer must not statically load the Electron-only WebRTC compatibility host',
  )
  assert.doesNotMatch(source, /WebRtcHost|webrtc-host/u)
})

test('Task 19 keeps the retired terminal-only remote graph out of normal Desktop and web entries', async () => {
  const [desktopEntry, desktopWorkspace, webEntry, webViteConfig] = await Promise.all([
    readFile('src/main.tsx', 'utf8'),
    readFile('src/App.tsx', 'utf8'),
    readFile('src/web/main.tsx', 'utf8'),
    readFile('vite.web.config.ts', 'utf8'),
  ])

  // The Desktop entry has one explicit lazy compatibility escape hatch. It
  // must not be statically imported, and neither the normal workspace nor the
  // browser entry may reach into the retired terminal-only tree at all.
  assert.doesNotMatch(desktopEntry, /^import\s+[^\n]*\.\/remote\//mu)
  assert.doesNotMatch(desktopWorkspace, legacyRemoteReference)
  assert.doesNotMatch(webEntry, legacyRemoteReference)
  assert.doesNotMatch(webViteConfig, /remote\.html/u)
})
