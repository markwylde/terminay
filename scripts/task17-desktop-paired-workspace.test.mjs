import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Desktop pairing immediately exchanges the protected reconnect grant for the application transport', async () => {
  const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
  const pairingStart = main.indexOf('const paired = await establishDesktopDevicePairing')
  const reconnectStart = main.indexOf('const connected = await createDesktopReconnectTransport', pairingStart)
  const transportStart = main.indexOf('await connectRemoteByteTransport(', reconnectStart)

  assert.ok(pairingStart >= 0, 'Desktop must complete canonical device pairing')
  assert.ok(reconnectStart > pairingStart, 'Desktop must exchange the stored reconnect grant after pairing')
  assert.ok(transportStart > reconnectStart, 'Desktop must attach the authenticated application transport')
  assert.doesNotMatch(
    main.slice(pairingStart, transportStart),
    /return Object\.freeze\(\{ kind: 'paired'/u,
    'pairing must not stop in a false paired-without-workspace state',
  )
})

test('Desktop never downgrades a supplied WebRTC bootstrap to HTTP', async () => {
  const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
  const branch = main.indexOf('if (connected.signalingBootstrap !== undefined)')
  const webrtc = main.indexOf('createDesktopBootstrappedWebRtcTransport', branch)
  const closeHttp = main.indexOf("connected.transport.close({ code: 'normal' })", webrtc)
  const branchReturn = main.indexOf('return;', closeHttp)
  const httpAttach = main.indexOf('connected.transport,', branchReturn)
  assert.ok(branch >= 0)
  assert.ok(webrtc > branch)
  assert.ok(closeHttp > webrtc)
  assert.ok(branchReturn > closeHttp)
  assert.ok(httpAttach > branchReturn)
})

test('Desktop renderer no longer presents pairing as a transport migration blocker', async () => {
  const [app, preload, types] = await Promise.all([
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8'),
  ])

  assert.doesNotMatch(app, /WebRTC workspace transport will be available once/u)
  assert.match(preload, /as Promise<void>/u)
  assert.match(types, /open\(url: string, pairingPin\?: string\): Promise<void>/u)
})
