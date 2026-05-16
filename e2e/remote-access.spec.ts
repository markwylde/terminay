import { request as httpsRequest } from 'node:https'
import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import { openRemoteMenu } from './support/ui'

function remoteOriginInput(page: Page) {
  return page.locator('#section-remote-access-host .settings-row').filter({ hasText: 'Remote origin' }).locator('input')
}

function toLoopbackPairingUrl(pairingUrl: string): string {
  const url = new URL(pairingUrl)
  url.hostname = '127.0.0.1'
  return url.toString()
}

async function postRemoteJson<TResponse>(
  pairingUrl: string,
  pathname: string,
  body: Record<string, unknown>,
): Promise<{ body: TResponse & { error?: string }; status: number }> {
  const url = new URL(pathname, pairingUrl)
  const origin = new URL(pairingUrl).origin
  const payload = JSON.stringify(body)

  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        headers: {
          'content-length': Buffer.byteLength(payload),
          'content-type': 'application/json',
          origin,
        },
        method: 'POST',
        rejectUnauthorized: false,
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          resolve({
            body: text ? JSON.parse(text) : {},
            status: response.statusCode ?? 0,
          })
        })
      },
    )

    request.on('error', reject)
    request.end(payload)
  })
}

test('opens remote access settings from the host menu', async ({ appHarness, mainWindow }) => {
  await openRemoteMenu(mainWindow)

  const settingsWindow = await appHarness.openChildWindow(async () => {
    await mainWindow.getByRole('button', { name: 'Remote Access Settings' }).click()
  })

  await expect(settingsWindow.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(settingsWindow.getByRole('heading', { name: 'Host & Origin' })).toBeVisible()
  await expect(remoteOriginInput(settingsWindow)).toHaveValue('https://localhost:9443')
})

test('starts remote access from the host menu and shows a pairing qr modal', async ({ mainWindow }) => {
  await openRemoteMenu(mainWindow)
  await mainWindow.getByRole('button', { name: 'Start Server & Show QR' }).click()

  const pairingDialog = mainWindow.getByRole('dialog', { name: 'Pair device' })
  await expect(pairingDialog).toBeVisible()
  await expect(pairingDialog.getByRole('heading', { name: 'Pair Device' })).toBeVisible()
  await expect(pairingDialog.getByAltText('Remote pairing QR code')).toBeVisible()
  await expect(
    pairingDialog.getByText('Scan this QR code to add or re-add a browser to this Terminay host.'),
  ).toBeVisible()
  await expect(
    pairingDialog.getByText(/Saved WebRTC sessions can reconnect later while their grant is valid\./),
  ).toBeVisible()
  await expect(pairingDialog.getByRole('button', { name: 'Local Network' })).toBeVisible()
  await expect(pairingDialog.getByRole('button', { name: 'WebRTC Relay' })).toBeVisible()
  await expect(pairingDialog.getByRole('button', { name: 'Copy Link' })).toBeVisible()

  await pairingDialog.getByRole('button', { name: 'Close Pair Device' }).click()
  await expect(pairingDialog).toHaveCount(0)

  await openRemoteMenu(mainWindow)
  await expect(mainWindow.getByRole('button', { name: 'Show Pairing QR' })).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: 'Stop Server' })).toBeVisible()
  await mainWindow.getByRole('button', { name: 'Stop Server' }).click()
  await openRemoteMenu(mainWindow)
  await expect(mainWindow.locator('.remote-access-menu__item').filter({ hasText: 'Start Server' }).first()).toBeVisible()
})

test('asks for a WebRTC pairing PIN before generating the QR code', async ({ mainWindow }) => {
  await openRemoteMenu(mainWindow)
  await mainWindow.getByRole('button', { name: 'WebRTC Relay' }).click()
  await mainWindow.getByRole('button', { name: 'Start Server & Show QR' }).click()

  const pinDialog = mainWindow.getByRole('dialog', { name: 'Remote Pairing PIN' })
  await expect(pinDialog).toBeVisible()
  await pinDialog.getByRole('textbox', { name: 'Pairing PIN' }).fill('123456')
  await pinDialog.getByRole('button', { name: 'Save PIN' }).click()
  await expect(pinDialog).toHaveCount(0)

  const pairingDialog = mainWindow.getByRole('dialog', { name: 'Pair device' })
  await expect(pairingDialog).toBeVisible()
  await expect(pairingDialog.getByAltText('Remote pairing QR code')).toBeVisible()
  const pairingDialogMetrics = await pairingDialog.evaluate((dialog) => {
    const rect = dialog.getBoundingClientRect()
    const copyButton = dialog.querySelector('.remote-pairing-modal__copy-btn')
    const copyButtonRect = copyButton?.getBoundingClientRect()
    const closeButton = dialog.querySelector('button.project-edit-modal-close')
    const closeButtonRect = closeButton?.getBoundingClientRect()
    const toggle = dialog.querySelector('.remote-pairing-modal__toggle')
    const toggleRect = toggle?.getBoundingClientRect()
    const style = window.getComputedStyle(dialog)

    return {
      bottom: rect.bottom,
      closeButtonBottom: closeButtonRect?.bottom ?? 0,
      closeButtonRight: closeButtonRect?.right ?? 0,
      copyButtonRight: copyButtonRect?.right ?? 0,
      overflowY: style.overflowY,
      right: rect.right,
      toggleRight: toggleRect?.right ?? 0,
      viewportHeight: window.innerHeight,
    }
  })

  expect(pairingDialogMetrics.overflowY).toBe('auto')
  expect(pairingDialogMetrics.bottom).toBeLessThanOrEqual(pairingDialogMetrics.viewportHeight)
  expect(pairingDialogMetrics.closeButtonBottom).toBeLessThanOrEqual(pairingDialogMetrics.viewportHeight)
  expect(pairingDialogMetrics.closeButtonRight).toBeLessThanOrEqual(pairingDialogMetrics.right)
  expect(pairingDialogMetrics.copyButtonRight).toBeLessThanOrEqual(pairingDialogMetrics.right)
  expect(pairingDialogMetrics.toggleRight).toBeLessThanOrEqual(pairingDialogMetrics.right)

  const settings = await mainWindow.evaluate(() => window.terminay.getTerminalSettings())
  expect(settings.remoteAccess.pairingPinHash).toMatch(/^scrypt-v1:/)
  expect(settings.remoteAccess.pairingPinHash).not.toContain('123456')

  await pairingDialog.getByRole('button', { name: 'Close Pair Device' }).click()
  await expect(pairingDialog).toHaveCount(0)

  await openRemoteMenu(mainWindow)
  await mainWindow.getByRole('button', { name: 'Stop Server' }).click()

  await openRemoteMenu(mainWindow)
  await mainWindow.getByRole('button', { name: 'Start Server & Show QR' }).click()
  const secondPairingDialog = mainWindow.getByRole('dialog', { name: 'Pair device' })
  await expect(secondPairingDialog).toBeVisible()
  await expect(mainWindow.getByRole('dialog', { name: 'Remote Pairing PIN' })).toHaveCount(0)

  await secondPairingDialog.getByRole('button', { name: 'Close Pair Device' }).click()
  await openRemoteMenu(mainWindow)
  await mainWindow.getByRole('button', { name: 'Stop Server' }).click()
})

test('starts WebRTC remote access from the host menu start button', async ({ mainWindow }) => {
  await openRemoteMenu(mainWindow)
  await mainWindow.getByRole('button', { name: 'WebRTC Relay' }).click()
  await mainWindow.locator('.remote-access-menu__item').filter({ hasText: /^Start ServerOffline$/ }).click()

  const pinDialog = mainWindow.getByRole('dialog', { name: 'Remote Pairing PIN' })
  await expect(pinDialog).toBeVisible()
  await pinDialog.getByRole('textbox', { name: 'Pairing PIN' }).fill('123456')
  await pinDialog.getByRole('button', { name: 'Save PIN' }).click()
  await expect(pinDialog).toHaveCount(0)

  await expect
    .poll(async () => {
      const status = await mainWindow.evaluate(() => window.terminay.getRemoteAccessStatus())
      return status.isRunning && status.pairingMode === 'webrtc' && Boolean(status.webRtcPairingUrl)
    })
    .toBe(true)

  const status = await mainWindow.evaluate(() => window.terminay.getRemoteAccessStatus())
  expect(status.pairingMode).toBe('webrtc')
  const webRtcPairingUrl = new URL(status.webRtcPairingUrl!)
  expect(webRtcPairingUrl.protocol).toBe('https:')
  expect(webRtcPairingUrl.hostname).toMatch(/^[a-f0-9]{32}\.terminay\.com$/)
  expect(webRtcPairingUrl.pathname).toBe('/v1/')
  expect(webRtcPairingUrl.hash.length).toBeGreaterThan(20)
  expect(webRtcPairingUrl.searchParams.has('relayJoinToken')).toBe(false)
  expect(webRtcPairingUrl.searchParams.has('pairingToken')).toBe(false)
  expect(webRtcPairingUrl.searchParams.has('signalingAuthToken')).toBe(false)

  await openRemoteMenu(mainWindow)
  await expect(mainWindow.locator('.remote-access-menu__item').filter({ hasText: /^Stop ServerLive$/ })).toBeVisible()
  await expect(mainWindow.getByText('Start remote access to generate a relay pairing link.')).toHaveCount(0)
  await mainWindow.locator('.remote-access-menu__item').filter({ hasText: /^Stop ServerLive$/ }).click()
})

test('rejects pairing when the configured PIN is wrong', async ({ mainWindow }) => {
  await mainWindow.evaluate(() => window.terminay.setRemoteAccessPairingPin('654321'))

  await openRemoteMenu(mainWindow)
  await mainWindow.getByRole('button', { name: 'Start Server & Show QR' }).click()

  await expect
    .poll(async () => {
      const status = await mainWindow.evaluate(() => window.terminay.getRemoteAccessStatus())
      return status.lanPairingUrl
    })
    .toBeTruthy()

  const status = await mainWindow.evaluate(() => window.terminay.getRemoteAccessStatus())
  const pairingUrl = status.lanPairingUrl!
  const reachablePairingUrl = toLoopbackPairingUrl(pairingUrl)
  const pairingParams = new URL(pairingUrl).searchParams
  const response = await postRemoteJson<{ provisionalDeviceId?: string }>(reachablePairingUrl, '/api/pairing/start', {
    deviceName: 'Wrong PIN Browser',
    pairingPin: '000000',
    pairingSessionId: pairingParams.get('pairingSessionId'),
    pairingToken: pairingParams.get('pairingToken'),
    publicKeyPem: '-----BEGIN PUBLIC KEY-----\ninvalid-for-pin-test\n-----END PUBLIC KEY-----',
  })

  expect(response.status).toBe(400)
  expect(response.body.error).toBe('Pairing failed. Check the PIN and try a fresh QR code.')

  await mainWindow
    .getByRole('dialog', { name: 'Pair device' })
    .getByRole('button', { name: 'Close Pair Device' })
    .click()
  await openRemoteMenu(mainWindow)
  await mainWindow.getByRole('button', { name: 'Stop Server' }).click()
})

test('manages remote access from the settings window host section', async ({ appHarness, mainWindow }) => {
  const settingsWindow = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'remote-access-host' })

  await expect(settingsWindow.getByRole('heading', { name: 'Pair Device & Live Access' })).toBeVisible()
  await expect(settingsWindow.getByText('Click Pair Device to start remote access and generate a fresh pairing QR code for browsers.')).toBeVisible()

  await settingsWindow.getByRole('button', { name: 'Pair Device' }).click()

  await expect(settingsWindow.getByText('Trusted Browsers')).toBeVisible()
  await expect(settingsWindow.getByText('Saved reconnect', { exact: true })).toBeVisible()
  await expect(settingsWindow.getByText('Needs cleanup', { exact: true })).toBeVisible()
  await expect(settingsWindow.getByAltText('Remote pairing QR code')).toBeVisible()
  await expect(settingsWindow.getByText('No paired browsers yet.')).toBeVisible()
  await expect(settingsWindow.getByText('No live remote connections.')).toBeVisible()
  await expect(settingsWindow.getByText('No remote access events yet.')).toBeVisible()

  await settingsWindow.getByRole('button', { name: 'Stop Remote Access' }).click()
  await expect(settingsWindow.getByRole('button', { name: 'Pair Device' })).toBeVisible()
})
