import { expect, test, type Page } from '@playwright/test'
import {
  expectEffectAheadOfBackground,
  readBackgroundProbe,
  runBackgroundFrames,
} from './support/background-pressure'
import { holdRendererClock } from './support/renderer-clock'
import {
  startSharedWebShellFixture,
  type SharedWebShellFixture,
} from './support/shared-web-shell-fixture'

const PROBE = '__terminayTask20QueueBounds'
const QUEUE_LIMIT = 8

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
    const shell = page.locator('[data-shared-ui="responsive-workspace"]')
    await expect(shell).toBeVisible()

    // The queue drains one message per step of the held clock: each route
    // switch lands while it still holds undelivered messages, and must be on
    // screen before the next one is drawn.
    await holdRendererClock(page)
    await startBoundedQueuePressure(page)

    const deliveredAtInput: number[] = []
    for (const route of ['Settings', 'Workspace', 'Connections'] as const) {
      const at = await expectEffectAheadOfBackground<QueueBoundsProbe>(
        page,
        PROBE,
        () => page.getByRole('tab', { name: route, exact: true }).click(),
        () => expect(shell).toHaveAttribute('data-shared-route', route.toLowerCase()),
      )
      deliveredAtInput.push(at.delivered)
      await runBackgroundFrames(page, 2)
    }
    // The queue drained between the inputs: they were handled interleaved
    // with it, not all before it started or after it finished.
    for (let index = 1; index < deliveredAtInput.length; index += 1)
      expect(deliveredAtInput[index]).toBeGreaterThan(deliveredAtInput[index - 1])

    await runBackgroundFrames(page, QUEUE_LIMIT + 1)
    expect(await readBackgroundProbe<QueueBoundsProbe>(page, PROBE)).toEqual({
      accepted: 10_000,
      delivered: 8,
      dropped: 9_992,
      maxQueueDepth: 8,
      maxRetainedBytes: 8 * 2_048,
      retainedBytes: 0,
      domNodes: 1,
      running: false,
    })
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
  await page.evaluate(({ probeName, queueLimit }) => {
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
    ;(window as unknown as Record<string, QueueBoundsProbe>)[probeName] = probe

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
  }, { probeName: PROBE, queueLimit: QUEUE_LIMIT })
}
