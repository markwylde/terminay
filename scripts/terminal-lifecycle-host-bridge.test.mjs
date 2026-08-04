import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('terminal inactivity wait uses the narrow lifecycle host bridge', async () => {
  const [app, preload, main, declarations, compatibility] = await Promise.all([
    readFile(new URL('src/App.tsx', root), 'utf8'),
    readFile(new URL('electron/preload.ts', root), 'utf8'),
    readFile(new URL('electron/main.ts', root), 'utf8'),
    readFile(new URL('src/vite-env.d.ts', root), 'utf8'),
    readFile(new URL('src/types/terminay.ts', root), 'utf8'),
  ])

  assert.doesNotMatch(app, /window\.terminayTerminalLifecycleHost\s*\.waitForInactivity\(/u)
  assert.match(app, /\.client\s*\.waitForInactivity\(/u)
  assert.doesNotMatch(app, /window\.terminay\.waitForTerminalInactivity\(/u)
  assert.match(preload, /exposeInMainWorld\('terminayTerminalLifecycleHost'/u)
  assert.match(preload, /desktop:terminal-lifecycle-host:wait-for-inactivity/u)
  assert.doesNotMatch(preload, /invoke\('terminal:wait-for-inactivity'/u)
  assert.match(main, /ipcMain\.handle\(\s*'desktop:terminal-lifecycle-host:wait-for-inactivity'/u)
  assert.doesNotMatch(main, /ipcMain\.handle\('terminal:wait-for-inactivity'/u)
  assert.match(main, /desktop:terminal-lifecycle-host:wait-for-inactivity'[\s\S]{0,220}assertTrustedAppSender/u)
  assert.match(main, /request\.durationMs > 86_400_000/u)
  assert.match(main, /serverTerminalAuthority\.isConsumerAttached\(/u)
  assert.doesNotMatch(
    main.slice(
      main.indexOf("'desktop:terminal-lifecycle-host:wait-for-inactivity'"),
      main.indexOf("'desktop:recording-service-host:get-state'"),
    ),
    /isRendererAttached/u,
  )
  assert.match(declarations, /terminayTerminalLifecycleHost:/u)
  assert.doesNotMatch(compatibility, /waitForTerminalInactivity/u)
})
