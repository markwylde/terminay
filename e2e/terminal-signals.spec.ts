import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { sendAppCommand } from './support/app'

async function getActiveSessionId(page: Page): Promise<string> {
  const sessionId = await page
    .locator('.terminal-panel')
    .first()
    .getAttribute('data-terminay-terminal-session-id')

  if (!sessionId) {
    throw new Error('Active terminal session id is unavailable')
  }

  return sessionId
}

async function writeToSession(page: Page, sessionId: string, data: string): Promise<void> {
  await page.evaluate(
    ({ nextData, nextSessionId }) => {
      window.terminay.writeTerminal(nextSessionId, nextData)
    },
    { nextData: data, nextSessionId: sessionId },
  )
}

/**
 * Creates a second terminal, returns its session id and tab locator, then
 * focuses the first terminal so the second is a background tab. Activity
 * indicators only surface on tabs the user is not currently looking at.
 */
async function withBackgroundTerminal(
  page: Page,
): Promise<{ sessionId: string; tab: Locator }> {
  await sendAppCommand(page, 'new-terminal')
  await expect(page.locator('.project-workspace--active .terminal-tab-content')).toHaveCount(2)

  const sessionId = await getActiveSessionId(page)
  const tab = page
    .locator('.project-workspace--active .terminal-tab-content')
    .filter({ hasText: 'Terminal 2' })

  await page
    .locator('.project-workspace--active .terminal-tab-content')
    .filter({ hasText: 'Terminal 1' })
    .click()

  // Clear the tab-switch suppression window applied to the tab we just left.
  await page.waitForTimeout(1_100)

  return { sessionId, tab }
}

test.describe('terminal activity signals', () => {
  test('OSC 9;4 progress shows finished and stays finished despite continued output', async ({
    mainWindow,
  }) => {
    const { sessionId, tab } = await withBackgroundTerminal(mainWindow)

    // Agent turn begins (progress indeterminate) then ends (progress cleared).
    await writeToSession(mainWindow, sessionId, "printf '\\033]9;4;3;\\007'\r")
    await writeToSession(mainWindow, sessionId, "printf '\\033]9;4;0;\\007'\r")

    await expect(tab).toHaveAttribute('data-terminal-activity', 'unviewed')

    // The agent keeps repainting a spinner / tips bar after the turn — a claimed
    // session must ignore that raw output and stay "finished", not flicker.
    await writeToSession(mainWindow, sessionId, "printf 'Tip: try the thing\\n'\r")
    await writeToSession(mainWindow, sessionId, "printf 'Tip: try the other thing\\n'\r")
    await mainWindow.waitForTimeout(600)

    await expect(tab).toHaveAttribute('data-terminal-activity', 'unviewed')
    await expect(mainWindow.locator('.terminal-activity-pill--unviewed')).toHaveText('1')
  })

  test('OSC 133 command lifecycle shows finished with no trailing flicker', async ({
    mainWindow,
  }) => {
    const { sessionId, tab } = await withBackgroundTerminal(mainWindow)

    await writeToSession(mainWindow, sessionId, "printf '\\033]133;C\\007'\r")
    await writeToSession(mainWindow, sessionId, "printf '\\033]133;D;0\\007'\r")

    await expect(tab).toHaveAttribute('data-terminal-activity', 'unviewed')

    await writeToSession(mainWindow, sessionId, "printf 'trailing output\\n'\r")
    await mainWindow.waitForTimeout(600)

    await expect(tab).toHaveAttribute('data-terminal-activity', 'unviewed')
  })

  test('a bell raises the attention indicator until the tab is viewed', async ({ mainWindow }) => {
    const { sessionId, tab } = await withBackgroundTerminal(mainWindow)

    await writeToSession(mainWindow, sessionId, "printf 'ding\\007\\n'\r")

    await expect(tab).toHaveAttribute('data-terminal-activity', 'attention')
    await expect(mainWindow.locator('.terminal-activity-pill--attention')).toHaveText('1')

    // Viewing the tab acknowledges the attention request.
    await tab.click()
    await expect(tab).toHaveAttribute('data-terminal-activity', 'viewed')
  })
})
