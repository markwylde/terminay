import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'

const { RemoteAccessService } = await importRemoteAccessService()

test('RemoteAccessService rotates WebRTC QR rooms without closing existing host peers', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-webrtc-service-test-'))
  const hostWindows = []
  const statuses = []
  let nextWebContentsId = 1

  const service = new RemoteAccessService({
    app: {
      getPath: () => tempDir,
    },
    createWebRtcHostWindow: () => {
      const hostWindow = {
        closed: false,
        configs: [],
        sentSignalMessages: [],
        sentTerminalMessages: [],
        webContentsId: nextWebContentsId,
        close() {
          this.closed = true
        },
        closeTerminal() {},
        sendConfig(config) {
          this.configs.push(config)
        },
        sendSignalMessage(message) {
          this.sentSignalMessages.push(message)
        },
        sendTerminalMessage(channelId, message) {
          this.sentTerminalMessages.push({ channelId, message })
        },
      }
      nextWebContentsId += 1
      hostWindows.push(hostWindow)
      return hostWindow
    },
    getControllableSession: () => null,
    getRemoteAccessSettings: () => ({
      bindAddress: '127.0.0.1',
      origin: 'https://127.0.0.1:9443',
      pairingMode: 'webrtc',
      pairingPinHash: 'configured-pin-hash',
      tlsCertPath: '',
      tlsKeyPath: '',
      webRtcHostedDomain: 'remote.example.com',
      webRtcIceServers: '',
    }),
    notifyTerminalRemoteSizeOverride: () => {},
    onStatusChanged: (status) => statuses.push(status),
    publicDir: tempDir,
    rendererDistDir: tempDir,
    saveGeneratedTlsPaths: () => {},
  })

  await service.rotateWebRtcPairingCode()
  const firstWindow = hostWindows[0]
  const firstConfig = firstWindow.configs[0]

  await service.rotateWebRtcPairingCode()
  const secondWindow = hostWindows[1]
  const secondConfig = secondWindow.configs[0]

  assert.equal(hostWindows.length, 2)
  assert.equal(firstWindow.closed, false)
  assert.equal(secondWindow.closed, false)
  assert.equal(firstConfig.sessionId, secondConfig.sessionId)
  assert.notEqual(firstConfig.roomId, secondConfig.roomId)
  assert.equal(firstConfig.appOrigin, secondConfig.appOrigin)
  assert.equal(new URL(service.getStatus().webRtcPairingUrl).hostname, `${firstConfig.sessionId}.remote.example.com`)
  assert.equal(service.getStatus().webRtcRoomId, secondConfig.roomId)

  service.handleWebRtcHostStatus(firstWindow.webContentsId, { type: 'host-registered' })
  assert.equal(service.getStatus().webRtcStatus, 'peer-handler-unavailable')

  service.handleWebRtcHostStatus(secondWindow.webContentsId, { type: 'host-registered' })
  assert.equal(service.getStatus().webRtcStatus, 'pairing-ready')
  assert.equal(statuses.at(-1).webRtcRoomId, secondConfig.roomId)
})

async function importRemoteAccessService() {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-remote-service-test-'))
  const outputPath = join(tempDir, 'service.cjs')
  await build({
    bundle: true,
    entryPoints: [new URL('../electron/remote/service.ts', import.meta.url).pathname],
    format: 'cjs',
    outfile: outputPath,
    platform: 'node',
    target: 'node20',
  })
  return import(outputPath)
}
