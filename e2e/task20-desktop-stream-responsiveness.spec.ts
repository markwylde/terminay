import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'

test('Desktop shared routes remain responsive while background streams run', async ({ mainWindow }) => {
  await mainWindow.setViewportSize({ width: 1280, height: 820 })
  await expect(mainWindow.locator('[data-shared-ui="responsive-workspace"]')).toBeVisible()
  await startDesktopBackgroundPressure(mainWindow)

  const latencies: number[] = []
  const menuStartedAt = await mainWindow.evaluate(() => performance.now())
  await mainWindow.getByLabel('Open connection menu').click()
  await expect(mainWindow.getByRole('menu', { name: 'Connection menu' })).toBeVisible()
  latencies.push(await mainWindow.evaluate(started => performance.now() - started, menuStartedAt))
  await mainWindow.keyboard.press('Escape')
  await expect(mainWindow.getByRole('menu', { name: 'Connection menu' })).toBeHidden()

  const terminalStartedAt = await mainWindow.evaluate(() => performance.now())
  await mainWindow.getByRole('button', { name: 'New terminal tab' }).click()
  await expect(mainWindow.getByRole('button', { name: 'Close terminal' })).toHaveCount(2)
  latencies.push(await mainWindow.evaluate(started => performance.now() - started, terminalStartedAt))

  const result = await mainWindow.evaluate(async () => {
    const probe = window as typeof window & {
      __terminayTask20DesktopPressure?: {
        frames: number
        running: boolean
        maxQueueDepth: number
        retained: number
      }
    }
    const deadline = performance.now() + 3_000
    while (probe.__terminayTask20DesktopPressure?.running && performance.now() < deadline) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    }
    return probe.__terminayTask20DesktopPressure
  })

  expect(result).toEqual({ frames: 120, running: false, maxQueueDepth: 4, retained: 0 })
  expect(Math.max(...latencies)).toBeLessThan(500)
})

async function startDesktopBackgroundPressure(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = document.createElement('output')
    target.hidden = true
    target.setAttribute('aria-hidden', 'true')
    target.setAttribute('data-task20-desktop-pressure', 'true')
    document.body.append(target)
    const lanes = ['terminal-output', 'agent-event', 'file-watch', 'transfer-progress']
    const queue = new Map<string, string>()
    const probe = { frames: 0, running: true, maxQueueDepth: 0, retained: 0 }
    ;(window as typeof window & { __terminayTask20DesktopPressure?: typeof probe })
      .__terminayTask20DesktopPressure = probe

    const runFrame = () => {
      probe.frames += 1
      for (const lane of lanes) queue.set(lane, `${lane}:${probe.frames}:${'x'.repeat(2_048)}`)
      probe.maxQueueDepth = Math.max(probe.maxQueueDepth, queue.size)
      target.textContent = [...queue.values()].join('|')
      queue.clear()
      probe.retained = queue.size
      if (probe.frames < 120) requestAnimationFrame(runFrame)
      else probe.running = false
    }
    requestAnimationFrame(runFrame)
  })
}
