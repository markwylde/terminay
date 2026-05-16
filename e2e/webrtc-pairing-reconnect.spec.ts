import net from 'node:net'
import type { BrowserContext, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { hasHostedServerSource, startHostedServer } from './support/hosted-server'

test.skip(!hasHostedServerSource(), 'requires sibling terminay.com checkout for real hosted WebRTC E2E')

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') {
          resolve(address.port)
        } else {
          reject(new Error('Unable to allocate a local port.'))
        }
      })
    })
  })
}

async function configureWebRtcRemoteAccess(page: Page, options: { hostedDomain: string; lanPort: number }) {
  await page.evaluate(async ({ hostedDomain, lanPort }) => {
    const settings = await window.terminay.getTerminalSettings()
    await window.terminay.updateTerminalSettings({
      ...settings,
      remoteAccess: {
        ...settings.remoteAccess,
        bindAddress: '127.0.0.1',
        origin: `https://127.0.0.1:${lanPort}`,
        pairingMode: 'webrtc',
        reconnectGrantLifetime: '24h',
        webRtcHostedDomain: hostedDomain,
      },
    })
    await window.terminay.setRemoteAccessPairingPin('123456')
  }, options)
}

async function startWebRtcRemoteAccess(page: Page): Promise<string> {
  await page.evaluate(async () => {
    const status = await window.terminay.getRemoteAccessStatus()
    if (!status.isRunning) {
      await window.terminay.toggleRemoteAccessServer()
    }
  })

  await expect
    .poll(async () => {
      const status = await page.evaluate(() => window.terminay.getRemoteAccessStatus())
      return [
        status.webRtcStatus,
        status.webRtcPairingUrl ?? '',
        status.webRtcStatusMessage ?? '',
        status.errorMessage ?? '',
      ].join('|')
    }, { timeout: 30_000 })
    .toMatch(/^pairing-ready\|http:\/\/[a-f0-9]{32}\.localhost:\d+\/v1\/#/)

  const status = await page.evaluate(() => window.terminay.getRemoteAccessStatus())
  if (!status.webRtcPairingUrl) {
    throw new Error('WebRTC pairing URL was not generated.')
  }
  return status.webRtcPairingUrl
}

async function pairBrowserFromQr(context: BrowserContext, pairingUrl: string): Promise<Page> {
  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') {
      console.error(`[remote page] ${message.text()}`)
    }
  })
  await page.goto(pairingUrl, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('textbox', { name: 'Pairing PIN' })).toBeVisible({ timeout: 45_000 })
  await page.getByRole('textbox', { name: 'Pairing PIN' }).fill('123456')
  await page.getByRole('button', { name: 'Pair Device' }).click()
  await expect(page.locator('.app-container')).toBeVisible({ timeout: 45_000 })
  return page
}

async function reconnectBrowser(context: BrowserContext, sessionOrigin: string): Promise<Page> {
  const page = await context.newPage()
  await page.goto(`${sessionOrigin}/v1/`, { waitUntil: 'domcontentloaded' })
  try {
    await expect(page.locator('.app-container')).toBeVisible({ timeout: 45_000 })
  } catch (error) {
    const details = await page.evaluate(() => ({
      status: document.querySelector('#status')?.textContent ?? '',
      wsLog: (window as Window & { __terminayWsLog?: unknown[] }).__terminayWsLog ?? [],
    })).catch(() => null)
    throw new Error(`${error instanceof Error ? error.message : 'Reconnect failed'}\n${JSON.stringify(details, null, 2)}`)
  }
  return page
}

async function reconnectBrowserWithPromptedPin(context: BrowserContext, sessionOrigin: string): Promise<Page> {
  const page = await context.newPage()
  await page.goto(`${sessionOrigin}/v1/`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('textbox', { name: 'Pairing PIN' })).toBeVisible({ timeout: 45_000 })
  await expect(page.getByRole('button', { name: 'Pair Device' })).toBeDisabled()
  await page.getByRole('textbox', { name: 'Pairing PIN' }).fill('123456')
  await expect(page.getByRole('button', { name: 'Pair Device' })).toBeEnabled()
  await page.getByRole('button', { name: 'Pair Device' }).click()
  await expect(page.locator('.app-container')).toBeVisible({ timeout: 45_000 })
  return page
}

async function readSavedReconnectState(page: Page, sessionOrigin: string) {
  return page.evaluate((origin) => new Promise<{
    grant: { expiresAt: string | null; issuedAt: string; origin: string; protocolVersion: string; sessionId: string } | null
    handle: { handle: string; origin: string; sessionId: string } | null
  }>((resolve, reject) => {
    const key = `${origin}#transport=webrtc:${origin}`
    const request = indexedDB.open('terminay-remote', 2)
    request.onerror = () => reject(request.error ?? new Error('Unable to open remote IndexedDB.'))
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction(['reconnectGrants', 'reconnectHandles'], 'readonly')
      const grantRequest = transaction.objectStore('reconnectGrants').get(key)
      const handleRequest = transaction.objectStore('reconnectHandles').get(key)
      transaction.onerror = () => {
        database.close()
        reject(transaction.error ?? new Error('Unable to read saved reconnect state.'))
      }
      transaction.oncomplete = () => {
        const grant = grantRequest.result
        const handle = handleRequest.result
        database.close()
        resolve({
          grant: grant
            ? {
                expiresAt: grant.expiresAt ?? null,
                issuedAt: String(grant.issuedAt ?? ''),
                origin: String(grant.origin ?? ''),
                protocolVersion: String(grant.protocolVersion ?? ''),
                sessionId: String(grant.sessionId ?? ''),
              }
            : null,
          handle: handle
            ? {
                handle: String(handle.handle ?? ''),
                origin: String(handle.origin ?? ''),
                sessionId: String(handle.sessionId ?? ''),
              }
            : null,
        })
      }
    }
  }), sessionOrigin)
}

async function waitForHostConnectionCount(page: Page, count: number) {
  await expect
    .poll(async () => {
      const status = await page.evaluate(() => window.terminay.getRemoteAccessStatus())
      return status.activeConnectionCount
    }, { timeout: 30_000 })
    .toBe(count)
}

async function readHostedMetrics(origin: string): Promise<string> {
  const response = await fetch(`${origin}/metrics`)
  return response.text()
}

async function getHostSessionId(page: Page): Promise<string> {
  const sessionId = await page.locator('.terminal-panel').first().getAttribute('data-terminay-terminal-session-id')
  if (!sessionId) throw new Error('Active terminal session id is unavailable.')
  return sessionId
}

async function writeHostTerminal(page: Page, data: string): Promise<void> {
  const sessionId = await getHostSessionId(page)
  await page.evaluate(({ sessionId: nextSessionId, data: nextData }) => {
    window.terminay.writeTerminal(nextSessionId, nextData)
  }, { data, sessionId })
}

test('pairs through the local hosted WebRTC app and reconnects the saved session without a QR', async ({
  browser,
  mainWindow,
}) => {
  test.setTimeout(180_000)

  const hostedServer = await startHostedServer()
  const browserContext = await browser.newContext()
  await browserContext.addInitScript(() => {
    const originalWebSocket = window.WebSocket
    const debugWindow = window as Window & { __terminayWsLog?: unknown[] }
    debugWindow.__terminayWsLog = []
    const log = debugWindow.__terminayWsLog
    window.WebSocket = class TerminayLoggedWebSocket extends originalWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols)
        this.addEventListener('message', (event) => {
          log.push({ data: event.data, direction: 'in', url: String(url) })
        })
      }

      send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        log.push({ data: typeof data === 'string' ? data : '[binary]', direction: 'out', url: this.url })
        return super.send(data)
      }
    }
  })
  try {
    await configureWebRtcRemoteAccess(mainWindow, {
      hostedDomain: hostedServer.hostedDomain,
      lanPort: await getFreePort(),
    })

    const pairingUrl = await startWebRtcRemoteAccess(mainWindow)
    const sessionOrigin = new URL(pairingUrl).origin
    const firstRemotePage = await pairBrowserFromQr(browserContext, pairingUrl)

    await waitForHostConnectionCount(mainWindow, 1)
    await expect
      .poll(async () => {
        const status = await mainWindow.evaluate(() => window.terminay.getRemoteAccessStatus())
        return {
          pairingReady: status.webRtcStatus === 'pairing-ready',
          rotated: Boolean(status.webRtcPairingUrl && status.webRtcPairingUrl !== pairingUrl),
        }
      }, { timeout: 30_000 })
      .toEqual({ pairingReady: true, rotated: true })
    const rotatedStatus = await mainWindow.evaluate(() => window.terminay.getRemoteAccessStatus())
    expect(rotatedStatus.webRtcStatusMessage ?? '').not.toMatch(/failed/i)

    await expect
      .poll(async () => {
        const status = await mainWindow.evaluate(() => window.terminay.getRemoteAccessStatus())
        return {
          pairedDeviceCount: status.pairedDeviceCount,
          reconnectGrantStatus: status.pairedDevices[0]?.reconnectGrantStatus,
        }
      })
      .toEqual({ pairedDeviceCount: 1, reconnectGrantStatus: 'valid' })
    await expect
      .poll(async () => readHostedMetrics(hostedServer.origin), { timeout: 10_000 })
      .toContain('terminay_signaling_reconnect_available_total 1')

    const expectedSessionId = new URL(sessionOrigin).hostname.replace(/\.localhost$/, '')
    const savedReconnectState = await readSavedReconnectState(firstRemotePage, sessionOrigin)
    expect(savedReconnectState.grant).toMatchObject({
      origin: `${sessionOrigin}#transport=webrtc:${sessionOrigin}`,
      protocolVersion: 'v1',
      sessionId: expectedSessionId,
    })
    expect(savedReconnectState.grant?.issuedAt).toBeTruthy()
    expect(savedReconnectState.handle).toMatchObject({
      origin: `${sessionOrigin}#transport=webrtc:${sessionOrigin}`,
      sessionId: expectedSessionId,
    })
    expect(savedReconnectState.handle?.handle).toBeTruthy()

    const hostToBrowserSentinel = `host-to-browser-${Date.now()}`
    await writeHostTerminal(mainWindow, `printf "\\n${hostToBrowserSentinel}\\n"\n`)
    await expect(firstRemotePage.locator('.xterm-rows')).toContainText(hostToBrowserSentinel, { timeout: 20_000 })

    const browserToHostSentinel = `browser-to-host-${Date.now()}`
    await firstRemotePage.locator('.terminal-area').click()
    await firstRemotePage.keyboard.type(`printf "\\n${browserToHostSentinel}\\n"`)
    await firstRemotePage.keyboard.press('Enter')
    await expect(mainWindow.locator('.xterm-rows')).toContainText(browserToHostSentinel, { timeout: 20_000 })

    await firstRemotePage.close()
    await waitForHostConnectionCount(mainWindow, 0)

    let reconnectPage: Page
    try {
      reconnectPage = await reconnectBrowser(browserContext, sessionOrigin)
    } catch (error) {
      const status = await mainWindow.evaluate(() => window.terminay.getRemoteAccessStatus())
      throw new Error(`${error instanceof Error ? error.message : 'Reconnect failed'}\nHost status: ${JSON.stringify({
        activeConnectionCount: status.activeConnectionCount,
        pairedDeviceCount: status.pairedDeviceCount,
        webRtcStatus: status.webRtcStatus,
        webRtcStatusMessage: status.webRtcStatusMessage,
      }, null, 2)}`)
    }
    await waitForHostConnectionCount(mainWindow, 1)
    await expect(reconnectPage.getByRole('textbox', { name: 'Pairing PIN' })).toHaveCount(0)

    const reconnectSentinel = `saved-reconnect-${Date.now()}`
    await reconnectPage.locator('.terminal-area').click()
    await reconnectPage.keyboard.type(`printf "\\n${reconnectSentinel}\\n"`)
    await reconnectPage.keyboard.press('Enter')
    await expect(mainWindow.locator('.xterm-rows')).toContainText(reconnectSentinel, { timeout: 20_000 })

    await reconnectPage.close()
    await waitForHostConnectionCount(mainWindow, 0)
    await browserContext.clearCookies()

    const promptedReconnectPage = await reconnectBrowserWithPromptedPin(browserContext, sessionOrigin)
    await waitForHostConnectionCount(mainWindow, 1)
    const promptedReconnectSentinel = `prompted-reconnect-${Date.now()}`
    await promptedReconnectPage.locator('.terminal-area').click()
    await promptedReconnectPage.keyboard.type(`printf "\\n${promptedReconnectSentinel}\\n"`)
    await promptedReconnectPage.keyboard.press('Enter')
    await expect(mainWindow.locator('.xterm-rows')).toContainText(promptedReconnectSentinel, { timeout: 20_000 })
  } finally {
    await browserContext.close().catch(() => undefined)
    await mainWindow.evaluate(async () => {
      const status = await window.terminay.getRemoteAccessStatus()
      if (status.isRunning) {
        await window.terminay.toggleRemoteAccessServer()
      }
    }).catch(() => undefined)
    await hostedServer.stop()
  }
})
