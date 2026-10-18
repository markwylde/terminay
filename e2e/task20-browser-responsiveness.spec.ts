import { expect, test, type Browser, type Page } from '@playwright/test'
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

type PressureProbe = { frames: number; running: boolean }
const PROBE = '__terminayTask20Pressure'
const PRESSURE_FRAMES = 120

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
    const shell = page.locator('[data-shared-ui="responsive-workspace"]')
    await expect(shell).toBeVisible()

    // The background stream does one frame per step of the held clock, so
    // each input below lands with the stream provably mid-flight, however
    // long the runner takes to deliver it.
    await holdRendererClock(page)
    await startBackgroundPressure(page)
    const framesAtInput: number[] = []
    for (const route of ['Connections', 'Settings', 'Recordings', 'Macros', 'File', 'Git', 'Workspace']) {
      await runBackgroundFrames(page, 10)
      const at = await expectEffectAheadOfBackground<PressureProbe>(
        page,
        PROBE,
        () => page.getByRole('tab', { name: route, exact: true }).click(),
        () => expect(shell).toHaveAttribute('data-shared-route', route.toLowerCase()),
      )
      framesAtInput.push(at.frames)
    }

    await runBackgroundFrames(page, 10)
    const at = await expectEffectAheadOfBackground<PressureProbe>(
      page,
      PROBE,
      () => page.getByLabel('Viewport width model').fill(String(viewport.width - 1)),
      () =>
        expect(shell).toHaveClass(
          new RegExp(`workspace-shell--${viewport.width - 1 < 720 ? 'narrow' : 'wide'}`),
        ),
    )
    framesAtInput.push(at.frames)

    expectInterleaved(framesAtInput)
    expect(await finishPressure(page)).toEqual({ frames: PRESSURE_FRAMES, running: false })
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
    await holdRendererClock(page)
    await startBackgroundPressure(page)

    const framesAtInput: number[] = []
    for (const route of ['Settings', 'Recordings', 'Workspace'] as const) {
      await runBackgroundFrames(page, 10)
      const at = await expectEffectAheadOfBackground<PressureProbe>(
        page,
        PROBE,
        () => page.getByRole('tab', { name: route, exact: true }).tap(),
        () => expect(shell).toHaveAttribute('data-shared-route', route.toLowerCase()),
      )
      framesAtInput.push(at.frames)
    }

    expectInterleaved(framesAtInput)
    expect(await finishPressure(page)).toEqual({ frames: PRESSURE_FRAMES, running: false })
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

/**
 * The stream advanced between every pair of inputs: they were handled
 * interleaved with it, not all before it started or after it finished.
 */
function expectInterleaved(framesAtInput: readonly number[]) {
  for (let index = 1; index < framesAtInput.length; index += 1)
    expect(framesAtInput[index]).toBeGreaterThan(framesAtInput[index - 1])
}

/** Run the rest of the stream on the held clock and read what it did. */
async function finishPressure(page: Page): Promise<PressureProbe> {
  const { frames } = await readBackgroundProbe<PressureProbe>(page, PROBE)
  await runBackgroundFrames(page, PRESSURE_FRAMES - frames + 1)
  return readBackgroundProbe<PressureProbe>(page, PROBE)
}

async function startBackgroundPressure(page: Page): Promise<void> {
  await page.evaluate(({ frameCount, probeName }) => {
    const target = document.createElement('output')
    target.setAttribute('aria-hidden', 'true')
    target.hidden = true
    document.body.append(target)
    const streamNames = ['terminal-output', 'agent-events', 'file-watch', 'transfer-progress']
    const probe = { frames: 0, running: true }
    ;(window as unknown as Record<string, typeof probe>)[probeName] = probe

    const runFrame = () => {
      probe.frames += 1
      const values = streamNames.map((name, index) => `${name}:${probe.frames * (index + 1)}`)
      // Coalescing mirrors the stream boundary: each source yields one latest value per frame.
      target.textContent = values.join('|')
      if (probe.frames < frameCount) requestAnimationFrame(runFrame)
      else probe.running = false
    }
    requestAnimationFrame(runFrame)
  }, { frameCount: PRESSURE_FRAMES, probeName: PROBE })
}
