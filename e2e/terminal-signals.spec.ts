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

    // The active project tab counts its own finished terminal.
    const projectBadge = mainWindow.locator('.project-tab--active .project-tab-activity-badge')
    await expect(projectBadge).toHaveText('1')
    await expect(projectBadge).toHaveClass(/project-tab-activity-badge--unviewed/)
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

    // Attention wins the project badge colour and the badge hides once viewed.
    const projectBadge = mainWindow.locator('.project-tab--active .project-tab-activity-badge')
    await expect(projectBadge).toHaveText('1')
    await expect(projectBadge).toHaveClass(/project-tab-activity-badge--attention/)
    await expect(projectBadge).toHaveAttribute('aria-label', '1 terminal, needs attention')

    // Viewing the tab acknowledges the attention request.
    await tab.click()
    await expect(tab).toHaveAttribute('data-terminal-activity', 'viewed')
    await expect(projectBadge).toHaveCount(0)
  })

  test('focusing a finished terminal dismisses the tab and project indicators', async ({
    mainWindow,
  }) => {
    const { tab } = await withBackgroundTerminal(mainWindow)

    await writeToBackgroundSession(
      mainWindow,
      tab,
      "sleep 2.1; printf '\\033]9;4;3;\\007'; printf '\\033]9;4;0;\\007'\r",
    )

    await expect(tab).toHaveAttribute('data-terminal-activity', 'unviewed')
    const projectBadge = mainWindow.locator('.project-tab--active .project-tab-activity-badge')
    await expect(projectBadge).toHaveText('1')
    await expect(projectBadge).toHaveClass(/project-tab-activity-badge--unviewed/)
    await expect(mainWindow.locator('.terminal-activity-pill--unviewed')).toHaveText('1')

    await tab.click()

    await expect(tab).toHaveAttribute('data-terminal-activity', 'viewed')
    await expect(tab.locator('.agent-status-indicator[data-agent-state="done"]')).toHaveCount(0)
    await expect(projectBadge).toHaveCount(0)
    await expect(mainWindow.locator('.terminal-activity-pill--unviewed')).toHaveCount(0)
  })

  test('a focused terminal that finishes does not keep the finished indicator', async ({
    mainWindow,
  }) => {
    const activeTab = mainWindow
      .locator('.project-workspace--active .terminal-tab-content--active')
      .first()

    await mainWindow.locator('.terminal-panel').first().click()
    await mainWindow.keyboard.type("sleep 2.1; printf '\\033]9;4;3;\\007'; printf '\\033]9;4;0;\\007'")
    await mainWindow.keyboard.press('Enter')

    await expect(activeTab).toHaveAttribute('data-terminal-activity', 'viewed')
    await expect(activeTab.locator('.agent-status-indicator[data-agent-state="done"]')).toHaveCount(0)
    await expect(
      mainWindow.locator('.project-tab--active .project-tab-activity-badge'),
    ).toHaveCount(0)
    await expect(mainWindow.locator('.terminal-activity-pill--unviewed')).toHaveCount(0)
  })

  test('activating a project does not dismiss a finished terminal until that terminal is clicked', async ({
    mainWindow,
  }) => {
    test.setTimeout(60_000)
    const { tab } = await withBackgroundTerminal(mainWindow)

    await writeToBackgroundSession(
      mainWindow,
      tab,
      "sleep 2.1; printf '\\033]9;4;3;\\007'; printf '\\033]9;4;0;\\007'\r",
    )

    await expect(tab).toHaveAttribute('data-terminal-activity', 'unviewed')
    await expect(mainWindow.locator('.project-tab--active .project-tab-activity-badge')).toHaveText('1')

    await mainWindow.getByLabel('Create project on This server').click()
    await expect(mainWindow.locator('.project-tab--active')).toContainText('Project 2')
    await expect(
      mainWindow.locator('.project-tab:not(.project-tab--active) .project-tab-activity-badge'),
    ).toHaveText('1')

    await mainWindow.locator('.project-tab:not(.project-tab--active)').click()
    await expect(mainWindow.locator('.project-tab--active')).not.toContainText('Project 2')

    const finishedTab = mainWindow
      .locator('.project-workspace--active .terminal-tab-content')
      .filter({ hasText: 'Terminal 2' })
    await expect(finishedTab).toHaveAttribute('data-terminal-activity', 'unviewed')
    await expect(mainWindow.locator('.project-tab--active .project-tab-activity-badge')).toHaveText('1')

    await finishedTab.click()
    await expect(finishedTab).toHaveAttribute('data-terminal-activity', 'viewed')
    await expect(mainWindow.locator('.project-tab--active .project-tab-activity-badge')).toHaveCount(0)
  })
})
