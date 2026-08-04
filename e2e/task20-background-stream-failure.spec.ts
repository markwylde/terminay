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
  test(`background stream failure is contained without blocking the shared shell (${viewport.name})`, async ({ page }) => {
    const pageErrors: Error[] = []
    page.on('pageerror', error => pageErrors.push(error))

    await page.setViewportSize(viewport)
    await page.goto(fixture.url)
    await page.getByLabel('Viewport width model').fill(String(viewport.width))
    await expect(page.locator('[data-shared-ui="responsive-workspace"]')).toBeVisible()

    await startFailingBackgroundStream(page)

    const routeLatencies: number[] = []
    for (const route of ['Settings', 'Workspace', 'Connections'] as const) {
      const startedAt = await page.evaluate(() => performance.now())
      await page.getByRole('tab', { name: route, exact: true }).click()
      await expect(page.locator('[data-shared-ui="responsive-workspace"]')).toHaveAttribute(
        'data-shared-route',
        route.toLowerCase(),
      )
      routeLatencies.push(await page.evaluate(started => performance.now() - started, startedAt))
    }

    const result = await page.evaluate(async () => {
      const deadline = performance.now() + 2_000
      const probe = window as typeof window & {
        __terminayTask20BackgroundFailure?: { frames: number; settled: boolean; handled: boolean }
      }
      while (!probe.__terminayTask20BackgroundFailure?.settled && performance.now() < deadline) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      }
      return probe.__terminayTask20BackgroundFailure
    })

    expect(result).toEqual({ frames: 40, settled: true, handled: true })
    expect(Math.max(...routeLatencies)).toBeLessThan(500)
    expect(pageErrors).toEqual([])
    await expect(page.locator('[data-task20-background-failure] script')).toHaveCount(0)
    await expect(page.locator('[data-task20-background-failure] img')).toHaveCount(0)
  })
}

async function startFailingBackgroundStream(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = document.createElement('output')
    target.hidden = true
    target.setAttribute('aria-hidden', 'true')
    target.setAttribute('data-task20-background-failure', 'true')
    document.body.append(target)

    const probe = { frames: 0, settled: false, handled: false }
    ;(window as typeof window & { __terminayTask20BackgroundFailure?: typeof probe }).__terminayTask20BackgroundFailure = probe

    const stream = new ReadableStream<string>({
      start(controller) {
        let frame = 0
        const writeFrame = () => {
          frame += 1
          if (frame > 40) {
            controller.error(new Error('simulated background stream failure'))
            return
          }
          controller.enqueue(`<img src=x onerror=window.__task20xss=1>${frame}:${'x'.repeat(4_096)}`)
          requestAnimationFrame(writeFrame)
        }
        requestAnimationFrame(writeFrame)
      },
    })

    void (async () => {
      try {
        const reader = stream.getReader()
        for (;;) {
          const next = await reader.read()
          if (next.done) break
          probe.frames += 1
          // Server-originated data remains text even as the stream fails.
          target.textContent = next.value
        }
      } catch {
        probe.handled = true
      } finally {
        probe.settled = true
      }
    })()
  })
}
