import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  expectEffectAheadOfBackground,
  readBackgroundProbe,
} from './support/background-pressure'

type DesktopPressureProbe = {
  frames: number
  running: boolean
  maxQueueDepth: number
  retained: number
}
const PROBE = '__terminayTask20DesktopPressure'
const PRESSURE_FRAMES = 120

test('Desktop shared routes remain responsive while background streams run', async ({ mainWindow }) => {
  await mainWindow.setViewportSize({ width: 1280, height: 820 })
  await expect(mainWindow.locator('[data-terminay-app-component]')).toBeVisible()

  // The background streams draw a frame only when the test grants one, so
  // each input below lands with them mid-flight and its effect must be on
  // screen before their next frame, however long the runner takes to deliver
  // it. The window's own clock runs freely: opening a terminal waits on the
  // server and on the window's timers, and nothing here holds those.
  await startDesktopBackgroundPressure(mainWindow)
  const connectionMenu = mainWindow.getByRole('menu', { name: 'Connection menu' })

  await grantBackgroundFrames(mainWindow, 10)
  const atMenu = await expectEffectAheadOfBackground<DesktopPressureProbe>(
    mainWindow,
    PROBE,
    () => mainWindow.getByLabel('Open connection menu').click(),
    () => expect(connectionMenu).toBeVisible(),
  )
  await mainWindow.keyboard.press('Escape')
  await expect(connectionMenu).toBeHidden()

  await grantBackgroundFrames(mainWindow, 10)
  const atTerminal = await expectEffectAheadOfBackground<DesktopPressureProbe>(
    mainWindow,
    PROBE,
    () => mainWindow.getByRole('button', { name: 'New terminal tab' }).click(),
    () => expect(mainWindow.getByRole('button', { name: 'Close terminal' })).toHaveCount(2),
  )
  // The streams advanced between the inputs: they were handled interleaved
  // with it, not before it started or after it finished.
  expect(atTerminal.frames).toBeGreaterThan(atMenu.frames)

  await grantBackgroundFrames(mainWindow, PRESSURE_FRAMES - atTerminal.frames)
  expect(await readBackgroundProbe<DesktopPressureProbe>(mainWindow, PROBE)).toEqual({
    frames: PRESSURE_FRAMES,
    running: false,
    maxQueueDepth: 4,
    retained: 0,
  })
})

/** Let the streams draw this many more frames, and wait until they have. */
async function grantBackgroundFrames(page: Page, frames: number): Promise<void> {
  await page.evaluate(
    async ({ count, probeName }) => {
      const pressure = (window as unknown as Record<string, { grant(frames: number): Promise<void> }>)[
        `${probeName}Control`
      ]
      await pressure.grant(count)
    },
    { count: frames, probeName: PROBE },
  )
}

async function startDesktopBackgroundPressure(page: Page): Promise<void> {
  await page.evaluate(({ frameCount, probeName }) => {
    const target = document.createElement('output')
    target.hidden = true
    target.setAttribute('aria-hidden', 'true')
    target.setAttribute('data-task20-desktop-pressure', 'true')
    document.body.append(target)
    const lanes = ['terminal-output', 'agent-event', 'file-watch', 'transfer-progress']
    const queue = new Map<string, string>()
    const probe = { frames: 0, running: true, maxQueueDepth: 0, retained: 0 }
    let granted = 0
    let drained: (() => void) | undefined
    const scope = window as unknown as Record<string, unknown>
    scope[probeName] = probe
    scope[`${probeName}Control`] = {
      grant(frames: number) {
        granted += frames
        return new Promise<void>(resolve => {
          drained = resolve
        })
      },
    }

    const runFrame = () => {
      if (granted > 0) {
        granted -= 1
        probe.frames += 1
        for (const lane of lanes) queue.set(lane, `${lane}:${probe.frames}:${'x'.repeat(2_048)}`)
        probe.maxQueueDepth = Math.max(probe.maxQueueDepth, queue.size)
        target.textContent = [...queue.values()].join('|')
        queue.clear()
        probe.retained = queue.size
        if (probe.frames >= frameCount) probe.running = false
        if (granted === 0 || !probe.running) drained?.()
      }
      if (probe.running) requestAnimationFrame(runFrame)
    }
    requestAnimationFrame(runFrame)
  }, { frameCount: PRESSURE_FRAMES, probeName: PROBE })
}
