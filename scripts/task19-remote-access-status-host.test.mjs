import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [app, controller, settings, preload, declarations, compatibility] = await Promise.all([
  readFile('src/App.tsx', 'utf8'),
  readFile('src/workspace/useRemoteAccessController.ts', 'utf8'),
  readFile('src/components/SettingsWindow.tsx', 'utf8'),
  readFile('electron/preload.ts', 'utf8'),
  readFile('src/vite-env.d.ts', 'utf8'),
  readFile('src/types/terminay.ts', 'utf8'),
])

test('Task 19 remote access controls and status use one validated narrow host', () => {
  assert.match(controller, /statusClient\.subscribe\(/u)
  assert.doesNotMatch(controller, /window\.terminayRemoteAccessStatusHost/u)
  assert.match(app, /useRemoteAccessController\(\s*window\.terminayRemotePairingPinHost,\s*window\.terminayRemoteAccessStatusHost,/u)
  assert.match(settings, /remoteAccessStatusClient\.subscribe\(/u)
  assert.doesNotMatch(settings, /window\.terminayRemoteAccessStatusHost/u)
  for (const method of ['getStatus', 'toggleServer', 'setPairingAddress']) {
    assert.match(controller, new RegExp(`statusClient\\.${method}\\(`, 'u'))
  }
  for (const method of ['getStatus', 'toggleServer', 'revokeDevice', 'closeConnection']) {
    assert.match(settings, new RegExp(`remoteAccessStatusClient\\.${method}\\(`, 'u'))
  }
  const broadMethods = /window\.terminay\.(?:getRemoteAccessStatus|toggleRemoteAccessServer|revokeRemoteAccessDevice|closeRemoteAccessConnection|setRemoteAccessPairingAddress)\(/u
  assert.doesNotMatch(app, broadMethods)
  assert.doesNotMatch(controller, broadMethods)
  assert.doesNotMatch(settings, broadMethods)
  assert.doesNotMatch(app, /window\.terminay\.onRemoteAccessStatusChanged\(/u)
  assert.doesNotMatch(settings, /window\.terminay\.onRemoteAccessStatusChanged\(/u)
  assert.match(preload, /exposeInMainWorld\(\s*'terminayRemoteAccessStatusHost'/u)
  assert.match(preload, /DESKTOP_REMOTE_ACCESS_STATUS_HOST_BRIDGE_VERSION = 1/u)
  assert.match(preload, /status\.connections\.length > 1_024/u)
  assert.match(preload, /status\.auditEvents\.length > 10_000/u)
  assert.doesNotMatch(preload, /onRemoteAccessStatusChanged:/u)
  assert.match(declarations, /terminayRemoteAccessStatusHost:/u)
  assert.doesNotMatch(compatibility, /^ {2}onRemoteAccessStatusChanged:/mu)
})

test('connected browser fails closed when Desktop remote-access hosts are absent', () => {
  assert.match(controller, /statusClient: RemoteAccessStatusClient \| undefined/u)
  assert.match(controller, /pairingPinClient: RemotePairingPinClient \| undefined/u)
  assert.match(controller, /if \(statusClient === undefined\) \{\s*setStatus\(null\);\s*return;/u)
  assert.match(controller, /Remote access controls are unavailable in this host\./u)
  assert.match(controller, /Remote access pairing is unavailable in this host\./u)
  assert.doesNotMatch(controller, /window\.terminayRemoteAccessStatusHost/u)
})
