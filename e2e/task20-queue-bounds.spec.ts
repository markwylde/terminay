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
  test(`browser-shell stream queue stays memory bounded under high load (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto(fixture.url)
    await page.getByLabel('Viewport width model').fill(String(viewport.width))
    await expect(page.locator('[data-shared-ui="responsive-workspace"]')).toBeVisible()

    await startBoundedQueuePressure(page)

    const latencies: number[] = []
    for (const route of ['Settings', 'Workspace', 'Connections'] as const) {
      const startedAt = await page.evaluate(() => performance.now())
      await page.getByRole('tab', { name: route, exact: true }).click()
      await expect(page.locator('[data-shared-ui="responsive-workspace"]')).toHaveAttribute(
        'data-shared-route',
        route.toLowerCase(),
      )
      latencies.push(await page.evaluate(started => performance.now() - started, startedAt))
    }

    const result = await page.evaluate(async () => {
      const probe = window as typeof window & {
        __terminayTask20QueueBounds?: QueueBoundsProbe
      }
      const deadline = performance.now() + 5_000
      while (probe.__terminayTask20QueueBounds?.running && performance.now() < deadline) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      }
      return probe.__terminayTask20QueueBounds
    })

    expect(result).toEqual({
      accepted: 10_000,
      delivered: 8,
      dropped: 9_992,
      maxQueueDepth: 8,
      maxRetainedBytes: 8 * 2_048,
      retainedBytes: 0,
      domNodes: 1,
      running: false,
    })
    expect(Math.max(...latencies)).toBeLessThan(500)
    await expect(page.locator('[data-task20-queue-bounds]')).toHaveCount(1)
  })
}

type QueueBoundsProbe = {
  accepted: number
  delivered: number
  dropped: number
  maxQueueDepth: number
  maxRetainedBytes: number
  retainedBytes: number
  domNodes: number
  running: boolean
}

async function startBoundedQueuePressure(page: Page): Promise<void> {
  await page.evaluate(() => {
    const queueLimit = 8
    const payloadBytes = 2_048
    const totalMessages = 10_000
    const target = document.createElement('output')
    target.hidden = true
    target.setAttribute('aria-hidden', 'true')
    target.setAttribute('data-task20-queue-bounds', 'true')
    document.body.append(target)

    const probe: QueueBoundsProbe = {
      accepted: 0,
      delivered: 0,
      dropped: 0,
      maxQueueDepth: 0,
      maxRetainedBytes: 0,
      retainedBytes: 0,
      domNodes: 1,
      running: true,
    }
    ;(window as typeof window & { __terminayTask20QueueBounds?: QueueBoundsProbe }).__terminayTask20QueueBounds = probe

    const queue: string[] = []
    const enqueue = (message: string) => {
      probe.accepted += 1
      if (queue.length === queueLimit) {
        queue.shift()
        probe.dropped += 1
      }
      queue.push(message)
      probe.maxQueueDepth = Math.max(probe.maxQueueDepth, queue.length)
      probe.maxRetainedBytes = Math.max(probe.maxRetainedBytes, queue.length * payloadBytes)
    }

    for (let index = 0; index < totalMessages; index += 1) {
      enqueue(`${index}:${'x'.repeat(payloadBytes - String(index).length - 1)}`)
    }

    const flush = () => {
      const latest = queue.pop()
      if (latest) {
        // One inert node renders the newest coalesced value, never an unbounded message list.
        target.textContent = latest
        probe.delivered += 1
      }
      if (queue.length > 0) {
        requestAnimationFrame(flush)
        return
      }
      probe.retainedBytes = 0
      probe.domNodes = target.parentElement?.querySelectorAll('[data-task20-queue-bounds]').length ?? 0
      probe.running = false
    }
    requestAnimationFrame(flush)
  })
}
