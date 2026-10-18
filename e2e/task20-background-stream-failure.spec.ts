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

type FailingStreamProbe = { frames: number; running: boolean; handled: boolean }
const PROBE = '__terminayTask20BackgroundFailure'
const FRAMES_BEFORE_FAILURE = 40

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
    const shell = page.locator('[data-shared-ui="responsive-workspace"]')
    await expect(shell).toBeVisible()

    // The stream writes one frame per step of the held clock: each route
    // switch lands with it mid-flight and must be on screen before its next
    // frame, however long the runner takes to deliver the click.
    await holdRendererClock(page)
    await startFailingBackgroundStream(page)

    const framesAtInput: number[] = []
    for (const route of ['Settings', 'Workspace', 'Connections'] as const) {
      await runBackgroundFrames(page, 10)
      const at = await expectEffectAheadOfBackground<FailingStreamProbe>(
        page,
        PROBE,
        () => page.getByRole('tab', { name: route, exact: true }).click(),
        () => expect(shell).toHaveAttribute('data-shared-route', route.toLowerCase()),
      )
      framesAtInput.push(at.frames)
    }
    for (let index = 1; index < framesAtInput.length; index += 1)
      expect(framesAtInput[index]).toBeGreaterThan(framesAtInput[index - 1])

    // Run the stream on to its failure, then use the shell once more: the
    // failure is contained, and the shell is as responsive after it.
    const { frames } = await readBackgroundProbe<FailingStreamProbe>(page, PROBE)
    await runBackgroundFrames(page, FRAMES_BEFORE_FAILURE - frames + 1)
    expect(await readBackgroundProbe<FailingStreamProbe>(page, PROBE)).toEqual({
      frames: FRAMES_BEFORE_FAILURE,
      running: false,
      handled: true,
    })
    await page.getByRole('tab', { name: 'Settings', exact: true }).click()
    await expect(shell).toHaveAttribute('data-shared-route', 'settings')

    expect(pageErrors).toEqual([])
    await expect(page.locator('[data-task20-background-failure] script')).toHaveCount(0)
    await expect(page.locator('[data-task20-background-failure] img')).toHaveCount(0)
  })
}

async function startFailingBackgroundStream(page: Page): Promise<void> {
  await page.evaluate(({ failAfter, probeName }) => {
    const target = document.createElement('output')
    target.hidden = true
    target.setAttribute('aria-hidden', 'true')
    target.setAttribute('data-task20-background-failure', 'true')
    document.body.append(target)

    const probe = { frames: 0, running: true, handled: false }
    ;(window as unknown as Record<string, typeof probe>)[probeName] = probe

    const stream = new ReadableStream<string>({
      start(controller) {
        let frame = 0
        const writeFrame = () => {
          frame += 1
          if (frame > failAfter) {
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
        probe.running = false
      }
    })()
  }, { failAfter: FRAMES_BEFORE_FAILURE, probeName: PROBE })
}
