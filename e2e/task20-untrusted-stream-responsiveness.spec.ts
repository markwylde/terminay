import { expect, test, type Page } from '@playwright/test'
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
  test(`untrusted stream pressure stays inert and interactive (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto(fixture.url)
    await page.getByLabel('Viewport width model').fill(String(viewport.width))
    await expect(page.locator('[data-shared-ui="responsive-workspace"]')).toBeVisible()

    await startUntrustedStreamPressure(page)

    const startedAt = await page.evaluate(() => performance.now())
    await page.getByRole('tab', { name: 'Settings', exact: true }).click()
    await expect(page.locator('[data-shared-ui="responsive-workspace"]')).toHaveAttribute(
      'data-shared-route',
      'settings',
    )
    const routeLatency = await page.evaluate(started => performance.now() - started, startedAt)

    const result = await waitForUntrustedStream(page)

    expect(routeLatency).toBeLessThan(500)
    expect(result).toEqual({ frames: 120, running: false, scriptElements: 0 })
    await expect(page.locator('[data-task20-untrusted-stream] script')).toHaveCount(0)
    await expect(page.locator('[data-task20-untrusted-stream] img')).toHaveCount(0)
  })
}

async function waitForUntrustedStream(page: Page) {
  // 120 rAF frames can take longer than two seconds on a loaded CI runner.
  // Keep the interactivity bound and only wait for the probe to finish.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const probe = (
            window as typeof window & {
              __terminayTask20UntrustedStream?: { running: boolean }
            }
          ).__terminayTask20UntrustedStream
          return probe?.running === false
        }),
      { timeout: 10_000 },
    )
    .toBe(true)

  return page.evaluate(() => {
    return (
      window as typeof window & {
        __terminayTask20UntrustedStream?: {
          frames: number
          running: boolean
          scriptElements: number
        }
      }
    ).__terminayTask20UntrustedStream
  })
}

async function startUntrustedStreamPressure(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = document.createElement('output')
    target.hidden = true
    target.setAttribute('aria-hidden', 'true')
    target.setAttribute('data-task20-untrusted-stream', 'true')
    document.body.append(target)

    const payload = '<img src=x onerror=window.__task20xss=1><script>window.__task20xss=1</script>'
    const probe = { frames: 0, running: true, scriptElements: 0 }
    ;(window as typeof window & { __terminayTask20UntrustedStream?: typeof probe }).__terminayTask20UntrustedStream = probe

    const runFrame = () => {
      probe.frames += 1
      // textContent is intentional: high-frequency server data must not become DOM markup.
      target.textContent = `${payload}:${probe.frames}:${'x'.repeat(8_192)}`
      probe.scriptElements = target.querySelectorAll('script').length
      if (probe.frames < 120) requestAnimationFrame(runFrame)
      else probe.running = false
    }
    requestAnimationFrame(runFrame)
  })
}
