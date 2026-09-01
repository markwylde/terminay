import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { settledTerminalSessionId } from './support/terminal-session'
import { sendAppCommand } from './support/app'
import { submitTerminalCommand } from './support/terminal'

async function getActiveSessionId(page: Page): Promise<string> {
  const activePresentation = page.locator(
    '.project-workspace--active .terminal-panel:visible',
  )
  await expect(activePresentation).toHaveCount(1)
  const sessionId = await settledTerminalSessionId(activePresentation)

  return sessionId
}

async function writeToBackgroundSession(page: Page, tab: Locator, data: string): Promise<void> {
  await tab.click()
  await submitTerminalCommand(page, data)
  await page
    .locator('.project-workspace--active .terminal-tab-content')
    .filter({ hasText: 'Terminal 1' })
    .click()
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
    const { tab } = await withBackgroundTerminal(mainWindow)

    // Agent turn begins (progress indeterminate) then ends (progress cleared).
    await writeToBackgroundSession(
      mainWindow,
      tab,
      "sleep 2.1; printf '\\033]9;4;3;\\007'; printf '\\033]9;4;0;\\007'; sleep 1; printf 'Tip: try the thing\\n'; printf 'Tip: try the other thing\\n'\r",
    )

    await expect(tab).toHaveAttribute('data-terminal-activity', 'unviewed')

    // The agent keeps repainting a spinner / tips bar after the turn — a claimed
    // session must ignore that raw output and stay "finished", not flicker.
    await mainWindow.waitForTimeout(1_600)

    await expect(tab).toHaveAttribute('data-terminal-activity', 'unviewed')
    await expect(mainWindow.locator('.terminal-activity-pill--unviewed')).toHaveText('1')
  })

  test('OSC 133 command lifecycle shows finished with no trailing flicker', async ({
    mainWindow,
  }) => {
    const { tab } = await withBackgroundTerminal(mainWindow)

    await writeToBackgroundSession(
      mainWindow,
      tab,
      "sleep 2.1; printf '\\033]133;C\\007'; printf '\\033]133;D;0\\007'; sleep 1; printf 'trailing output\\n'\r",
    )

    await expect(tab).toHaveAttribute('data-terminal-activity', 'unviewed')

    await mainWindow.waitForTimeout(1_600)

    await expect(tab).toHaveAttribute('data-terminal-activity', 'unviewed')
  })

  test('a bell raises the attention indicator until the tab is viewed', async ({ mainWindow }) => {
    const { tab } = await withBackgroundTerminal(mainWindow)

    await writeToBackgroundSession(mainWindow, tab, "sleep 1.1; printf 'ding\\007\\n'\r")

    await expect(tab).toHaveAttribute('data-terminal-activity', 'attention')
    await expect(mainWindow.locator('.terminal-activity-pill--attention')).toHaveText('1')

    // Viewing the tab acknowledges the attention request.
    await tab.click()
    await expect(tab).toHaveAttribute('data-terminal-activity', 'viewed')
  })
})
