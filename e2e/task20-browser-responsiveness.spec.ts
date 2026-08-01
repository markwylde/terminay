import { expect, test, type Browser, type Page } from '@playwright/test'
import {
  startSharedWebShellFixture,
  type SharedWebShellFixture,
} from './support/shared-web-shell-fixture'

let fixture: SharedWebShellFixture

test.beforeAll(async () => {
  fixture = await startSharedWebShellFixture()
})

test.afterAll(async () => {
  await fixture.close()
})

for (const viewport of [
  { name: 'wide browser', width: 1280, height: 820 },
  { name: 'narrow browser', width: 390, height: 740 },
] as const) {
  test(`shared shell remains interactive during bounded browser stream pressure (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto(fixture.url)
    await page.getByLabel('Viewport width model').fill(String(viewport.width))
    await expect(page.locator('[data-shared-ui="responsive-workspace"]')).toBeVisible()

    await startBackgroundPressure(page)
    const elapsedMs: number[] = []
    for (const route of ['Connections', 'Settings', 'Recordings', 'Macros', 'File', 'Git', 'Workspace']) {
      const startedAt = await page.evaluate(() => performance.now())
      await page.getByRole('tab', { name: route, exact: true }).click()
      await expect(page.locator('[data-shared-ui="responsive-workspace"]')).toHaveAttribute(
        'data-shared-route',
        route.toLowerCase(),
      )
      elapsedMs.push(await page.evaluate(started => performance.now() - started, startedAt))
    }

    const inputStartedAt = await page.evaluate(() => performance.now())
    await page.getByLabel('Viewport width model').fill(String(viewport.width - 1))
    await expect(page.locator('[data-shared-ui="responsive-workspace"]')).toHaveClass(
      new RegExp(`workspace-shell--${viewport.width - 1 < 720 ? 'narrow' : 'wide'}`),
    )
    elapsedMs.push(await page.evaluate(started => performance.now() - started, inputStartedAt))

    const result = await page.evaluate(async () => {
      const probe = window as typeof window & {
        __terminayTask20Pressure?: { frames: number; running: boolean }
      }
      const deadline = performance.now() + 2_000
      while (probe.__terminayTask20Pressure?.running && performance.now() < deadline) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      }
      return probe.__terminayTask20Pressure
    })

    expect(result?.running).toBe(false)
    expect(result?.frames).toBeGreaterThanOrEqual(90)
    expect(Math.max(...elapsedMs)).toBeLessThan(500)
  })
}

test('touch-mobile browser remains responsive during bounded background pressure', async ({ browser }) => {
  const context = await createMobileContext(browser)
  const page = await context.newPage()
  try {
    await page.goto(fixture.url)
    await page.getByLabel('Viewport width model').fill('390')
    const shell = page.locator('[data-shared-ui="responsive-workspace"]')
    await expect(shell).toBeVisible()
    await expect(shell).toHaveClass(/workspace-shell--narrow/)
    await startBackgroundPressure(page)

    const latencies: number[] = []
    for (const route of ['Settings', 'Recordings', 'Workspace'] as const) {
      const startedAt = await page.evaluate(() => performance.now())
      await page.getByRole('tab', { name: route, exact: true }).tap()
      await expect(shell).toHaveAttribute('data-shared-route', route.toLowerCase())
      latencies.push(await page.evaluate(started => performance.now() - started, startedAt))
    }

    const result = await waitForPressure(page)
    expect(result?.running).toBe(false)
    expect(result?.frames).toBeGreaterThanOrEqual(90)
    expect(Math.max(...latencies)).toBeLessThan(500)
  } finally {
    await context.close()
  }
})

function createMobileContext(browser: Browser) {
  return browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 740 },
  })
}

async function waitForPressure(page: Page) {
  return page.evaluate(async () => {
    const probe = window as typeof window & {
      __terminayTask20Pressure?: { frames: number; running: boolean }
    }
    const deadline = performance.now() + 2_000
    while (probe.__terminayTask20Pressure?.running && performance.now() < deadline) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    }
    return probe.__terminayTask20Pressure
  })
}

async function startBackgroundPressure(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = document.createElement('output')
    target.setAttribute('aria-hidden', 'true')
    target.hidden = true
    document.body.append(target)
    const streamNames = ['terminal-output', 'agent-events', 'file-watch', 'transfer-progress']
    const probe = { frames: 0, running: true }
    ;(window as typeof window & { __terminayTask20Pressure?: typeof probe }).__terminayTask20Pressure = probe

    const runFrame = () => {
      probe.frames += 1
      const values = streamNames.map((name, index) => `${name}:${probe.frames * (index + 1)}`)
      // Coalescing mirrors the stream boundary: each source yields one latest value per frame.
      target.textContent = values.join('|')
      if (probe.frames < 120) requestAnimationFrame(runFrame)
      else probe.running = false
    }
    requestAnimationFrame(runFrame)
  })
}
