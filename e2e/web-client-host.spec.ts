import { expect, test, type Frame, type Page } from '@playwright/test'
import {
  startWebClientHostFixture,
  type WebClientHostFixture,
} from './support/web-client-host-fixture'

let fixture: WebClientHostFixture

test.beforeAll(async () => {
  fixture = await startWebClientHostFixture()
})

test.afterAll(async () => {
  await fixture.close()
})

async function openHost(page: Page): Promise<{ sessionA: Frame; sessionB: Frame }> {
  // Under the sharded Docker run Chromium can be CPU-starved between receiving
  // the parent document and parsing its subresources.  Treat the HTTP response
  // as navigation readiness, then use the host's own frame/message contract
  // below as the authoritative application-readiness signal.
  await page.goto(fixture.parentOrigin, { waitUntil: 'commit' })
  await expect(page.locator('#session-a')).toBeVisible()
  await expect(page.locator('#session-b')).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const proof = (window as Window & {
          hostProof?: { state: { accepted: Array<{ type: string }> } }
        }).hostProof
        return proof?.state.accepted.filter(
          (message) => message.type === 'terminay-session-ready',
        ).length ?? 0
      }),
    )
    .toBe(2)

  const sessionA = page.frames().find((frame) => frame.url().startsWith(fixture.sessionAOrigin))
  const sessionB = page.frames().find((frame) => frame.url().startsWith(fixture.sessionBOrigin))
  if (!sessionA || !sessionB) {
    throw new Error('Both exact-origin session frames must load.')
  }
  return { sessionA, sessionB }
}

test('parent accepts only exact source, origin, version, and schema-bound session messages', async ({
  page,
}) => {
  const { sessionA, sessionB } = await openHost(page)

  await expect(
    sessionA.evaluate(() => {
      const proof = (window as Window & {
        sessionProof: { state: { accepted: unknown[] } }
      }).sessionProof
      return proof.state.accepted
    }),
  ).resolves.toEqual([
    {
      profile: { label: 'Local lab' },
      sessionId: 'session-a',
      type: 'terminay-host-context',
      version: 1,
    },
  ])

  await sessionB.evaluate(() => {
    ;(window as Window & {
      sessionProof: { attackParentAs: (sessionId: string) => void }
    }).sessionProof.attackParentAs('session-a')
  })
  await page.evaluate(() => {
    ;(window as Window & {
      hostProof: { sendInvalidTo: (sessionId: string) => void }
    }).hostProof.sendInvalidTo('session-a')
  })

  await expect
    .poll(() =>
      page.evaluate(() => {
        const proof = (window as Window & {
          hostProof: { state: { rejected: unknown[] } }
        }).hostProof
        return proof.state.rejected.length
      }),
    )
    .toBeGreaterThanOrEqual(1)
  await expect
    .poll(() =>
      sessionA.evaluate(() => {
        const proof = (window as Window & {
          sessionProof: { state: { rejected: unknown[] } }
        }).sessionProof
        return proof.state.rejected.length
      }),
    )
    .toBe(1)
})

test('exact origins isolate cookies, IndexedDB, Cache Storage, credentials, and workspace data', async ({
  context,
  page,
}) => {
  const { sessionA, sessionB } = await openHost(page)
  const expectedA = {
    cache: 'session-a-cached-workspace',
    cookie: 'terminay_session_cookie=session-a-cookie',
    deviceKey: 'session-a-device-key',
    reconnectGrant: 'session-a-reconnect-grant',
    workspace: 'session-a-workspace-state',
  }
  const expectedB = {
    cache: 'session-b-cached-workspace',
    cookie: 'terminay_session_cookie=session-b-cookie',
    deviceKey: 'session-b-device-key',
    reconnectGrant: 'session-b-reconnect-grant',
    workspace: 'session-b-workspace-state',
  }

  await expect
    .poll(() =>
      sessionA.evaluate(() =>
        (window as Window & { sessionProof: { readStorage: () => Promise<unknown> } })
          .sessionProof.readStorage(),
      ),
    )
    .toEqual(expectedA)
  await expect(
    sessionB.evaluate(() =>
      (window as Window & { sessionProof: { readStorage: () => Promise<unknown> } })
        .sessionProof.readStorage(),
    ),
  ).resolves.toEqual(expectedB)

  const parentAccess = await page.evaluate(() => {
    const results: Record<string, string> = {}
    for (const id of ['session-a', 'session-b']) {
      try {
        const frame = document.querySelector(`#${id}`) as HTMLIFrameElement
        results[id] = frame.contentWindow?.document.body.textContent ?? 'empty'
      } catch (error) {
        results[id] = error instanceof DOMException ? error.name : 'Error'
      }
    }
    return results
  })
  expect(parentAccess).toEqual({ 'session-a': 'SecurityError', 'session-b': 'SecurityError' })

  await expect(
    sessionB.evaluate(() =>
      (window as Window & {
        sessionProof: { readSibling: (index: number) => string }
      }).sessionProof.readSibling(0),
    ),
  ).resolves.toBe('SecurityError')

  const parentStorage = await page.evaluate(async () => ({
    cacheNames: await caches.keys(),
    cookie: document.cookie,
    databases: await indexedDB.databases(),
    workspace: localStorage.getItem('workspace-data'),
  }))
  expect(parentStorage).toEqual({
    cacheNames: [],
    cookie: '',
    databases: [],
    workspace: null,
  })

  const cookies = await context.cookies([
    fixture.parentOrigin,
    fixture.sessionAOrigin,
    fixture.sessionBOrigin,
  ])
  expect(
    cookies.map(({ domain, name, value }) => ({ domain, name, value })),
  ).toEqual(
    expect.arrayContaining([
      {
        domain: 'session-a.localhost',
        name: 'terminay_session_cookie',
        value: 'session-a-cookie',
      },
      {
        domain: 'session-b.localhost',
        name: 'terminay_session_cookie',
        value: 'session-b-cookie',
      },
    ]),
  )
  expect(cookies.some((cookie) => cookie.domain === 'web.localhost')).toBe(false)
})

test('iframe sizing, terminal focus, keyboard input, and clipboard permission delegation work', async ({
  context,
  page,
}) => {
  await context.grantPermissions(
    ['clipboard-read', 'clipboard-write'],
    { origin: fixture.sessionAOrigin },
  )
  const { sessionA } = await openHost(page)

  const frameBox = await page.locator('#session-a').boundingBox()
  const slotBox = await page.locator('#session-a').locator('..').boundingBox()
  expect(frameBox).not.toBeNull()
  expect(slotBox).not.toBeNull()
  expect(frameBox?.width).toBeCloseTo(slotBox?.width ?? 0, 0)
  expect(frameBox?.height).toBeCloseTo(slotBox?.height ?? 0, 0)

  const input = sessionA.getByRole('textbox', { name: 'Terminal input' })
  await input.click()
  await input.pressSequentially('echo keyboard-focus')
  await expect(input).toHaveValue('echo keyboard-focus')
  await expect(
    sessionA.evaluate(() =>
      (window as Window & { sessionProof: { state: { typed: string } } })
        .sessionProof.state.typed,
    ),
  ).resolves.toBe('echo keyboard-focus')

  await sessionA.getByRole('button', { name: 'Copy sentinel' }).click()
  await expect(sessionA.locator('#copy-result')).toHaveText('NotAllowedError')
  const parentClipboardPermission = await page.evaluate(async () =>
    (await navigator.permissions.query({
      name: 'clipboard-read' as PermissionName,
    })).state,
  )
  expect(parentClipboardPermission).not.toBe('granted')

  await context.grantPermissions(
    ['clipboard-read', 'clipboard-write'],
    { origin: fixture.parentOrigin },
  )
  await sessionA.getByRole('button', { name: 'Copy sentinel' }).click()
  await expect(sessionA.locator('#copy-result')).toHaveText('copied')
  await expect(
    sessionA.evaluate(() => navigator.clipboard.readText()),
  ).resolves.toBe('session-a-clipboard')

  await page.setViewportSize({ width: 390, height: 740 })
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = (window as Window & {
          hostProof: { state: { viewports: Record<string, { width: number }> } }
        }).hostProof.state
        return state.viewports['session-a']?.width ?? 0
      }),
    )
    .toBeLessThanOrEqual(390)
  const mobileFrameBox = await page.locator('#session-a').boundingBox()
  expect(mobileFrameBox?.width).toBeCloseTo(390, 0)
})

test('mobile probe route loads real xterm and reports focused input and geometry', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 600 })
  await page.goto(`${fixture.parentOrigin}/mobile-viewport-probe`)
  const session = page.frameLocator('#session-a')
  const terminal = session.locator('#terminal')

  await expect(terminal).toBeVisible()
  await expect(session.locator('.xterm-helper-textarea')).toHaveAttribute(
    'aria-label',
    'Terminay xterm input',
  )
  await terminal.click()
  await page.keyboard.type('chromium-probe')

  await expect
    .poll(() => {
      const sessionEvents = fixture
        .getMobileViewportProbeEvents()
        .filter((event) => event.source === 'session-a')
      return sessionEvents.some(
        (event) =>
          event.activeClass === 'xterm-helper-textarea' &&
          event.activeTag === 'TEXTAREA' &&
          event.typed === 'chromium-probe' &&
          event.terminalBottom !== null &&
          event.terminalBottom <= event.visualHeight,
      )
    })
    .toBe(true)
})

test('sandbox and CSP contain session navigation and reject unauthorized framing', async ({
  page,
  request,
}) => {
  const { sessionA } = await openHost(page)
  await expect(page.locator('#session-a')).toHaveAttribute(
    'sandbox',
    'allow-scripts allow-same-origin',
  )

  const sessionOrigin = new URL(fixture.sessionAOrigin)
  const sessionUrl = new URL('/session', sessionOrigin)
  sessionUrl.hostname = '127.0.0.1'
  const sessionResponse = await request.get(sessionUrl.toString(), {
    headers: { host: sessionOrigin.host },
  })
  expect(sessionResponse.headers()['content-security-policy']).toContain(
    `frame-ancestors ${fixture.parentOrigin}`,
  )
  const parentOrigin = new URL(fixture.parentOrigin)
  const parentUrl = new URL('/', parentOrigin)
  parentUrl.hostname = '127.0.0.1'
  const parentResponse = await request.get(parentUrl.toString(), {
    headers: { host: parentOrigin.host },
  })
  expect(parentResponse.headers()['content-security-policy']).toContain(
    `frame-src ${fixture.sessionAOrigin} ${fixture.sessionBOrigin}`,
  )

  const originalParentUrl = page.url()
  await sessionA.getByRole('button', { name: 'Navigate parent' }).click()
  await expect(sessionA.locator('#navigation-result')).toHaveText('SecurityError')
  expect(page.url()).toBe(originalParentUrl)

  await page.goto(fixture.attackerOrigin)
  await expect(page.locator('#forbidden-session')).toBeVisible()
  await expect
    .poll(() => {
      const frame = page.frames().find((candidate) =>
        candidate.url().startsWith(fixture.sessionAOrigin),
      )
      return frame ? frame.locator('#workspace').count() : 0
    })
    .toBe(0)
})
