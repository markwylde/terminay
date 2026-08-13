import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { sendAppCommand } from './support/app'

async function getActiveSessionId(page: Page): Promise<string> {
  const activePresentation = page.locator(
    '.project-workspace--active .terminal-panel:visible',
  )
  await expect(activePresentation).toHaveCount(1)
  const sessionId = await activePresentation.getAttribute(
    'data-terminay-terminal-session-id',
  )

  if (!sessionId) {
    throw new Error('Active terminal session id is unavailable')
  }

  return sessionId
}

async function writeToSession(page: Page, sessionId: string, data: string): Promise<void> {
  await page.evaluate(
    async ({ nextData, nextSessionId }) => {
      await window.terminayTest!.writeServerTerminal(nextSessionId, nextData)
    },
    { nextData: data, nextSessionId: sessionId },
  )
}

async function serverActivity(page: Page, sessionId: string) {
  return page.evaluate(
    async (nextSessionId) =>
      window.terminayTest!.getServerTerminalActivity(nextSessionId),
    sessionId,
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
    await writeToSession(
      mainWindow,
      sessionId,
      "sleep 2.1; printf '\\033]9;4;3;\\007'; printf '\\033]9;4;0;\\007'; sleep 1; printf 'Tip: try the thing\\n'; printf 'Tip: try the other thing\\n'\r",
    )

    await expect.poll(() => serverActivity(mainWindow, sessionId)).toMatchObject({
      status: 'idle',
      acknowledged: false,
      claimed: true,
      source: 'structured:progress',
    })
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
    const { sessionId, tab } = await withBackgroundTerminal(mainWindow)

    await writeToSession(
      mainWindow,
      sessionId,
      "sleep 2.1; printf '\\033]133;C\\007'; printf '\\033]133;D;0\\007'; sleep 1; printf 'trailing output\\n'\r",
    )

    await expect.poll(() => serverActivity(mainWindow, sessionId)).toMatchObject({
      status: 'idle',
      acknowledged: false,
      claimed: true,
      source: 'structured:command',
    })
    await expect(tab).toHaveAttribute('data-terminal-activity', 'unviewed')

    await mainWindow.waitForTimeout(1_600)

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
