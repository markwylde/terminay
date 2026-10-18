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

type UntrustedStreamProbe = { frames: number; running: boolean; scriptElements: number }
const PROBE = '__terminayTask20UntrustedStream'
const STREAM_FRAMES = 120

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
    const shell = page.locator('[data-shared-ui="responsive-workspace"]')
    await expect(shell).toBeVisible()

    // The stream does one frame per step of the held clock: the route switch
    // below lands with it mid-flight and must be on screen before its next
    // frame, however long the runner takes to deliver the click.
    await holdRendererClock(page)
    await startUntrustedStreamPressure(page)
    await runBackgroundFrames(page, 30)
    await expectEffectAheadOfBackground<UntrustedStreamProbe>(
      page,
      PROBE,
      () => page.getByRole('tab', { name: 'Settings', exact: true }).click(),
      () => expect(shell).toHaveAttribute('data-shared-route', 'settings'),
    )

    const { frames } = await readBackgroundProbe<UntrustedStreamProbe>(page, PROBE)
    await runBackgroundFrames(page, STREAM_FRAMES - frames + 1)
    expect(await readBackgroundProbe<UntrustedStreamProbe>(page, PROBE)).toEqual({
      frames: STREAM_FRAMES,
      running: false,
      scriptElements: 0,
    })
    await expect(page.locator('[data-task20-untrusted-stream] script')).toHaveCount(0)
    await expect(page.locator('[data-task20-untrusted-stream] img')).toHaveCount(0)
  })
}

async function startUntrustedStreamPressure(page: Page): Promise<void> {
  await page.evaluate(({ frameCount, probeName }) => {
    const target = document.createElement('output')
    target.hidden = true
    target.setAttribute('aria-hidden', 'true')
    target.setAttribute('data-task20-untrusted-stream', 'true')
    document.body.append(target)

    const payload = '<img src=x onerror=window.__task20xss=1><script>window.__task20xss=1</script>'
    const probe = { frames: 0, running: true, scriptElements: 0 }
    ;(window as unknown as Record<string, typeof probe>)[probeName] = probe

    const runFrame = () => {
      probe.frames += 1
      // textContent is intentional: high-frequency server data must not become DOM markup.
      target.textContent = `${payload}:${probe.frames}:${'x'.repeat(8_192)}`
      probe.scriptElements = target.querySelectorAll('script').length
      if (probe.frames < frameCount) requestAnimationFrame(runFrame)
      else probe.running = false
    }
    requestAnimationFrame(runFrame)
  }, { frameCount: STREAM_FRAMES, probeName: PROBE })
}
