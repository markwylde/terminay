import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { settledTerminalSessionId } from './support/terminal-session'
import { sendAppCommand } from './support/app'
import { submitTerminalCommand } from './support/terminal'

/**
 * Sends one request on the terminal's own control socket with its own
 * capability, framed as the stdio adapter frames it, so a notification is sent
 * by the same path an agent or a command-line tool uses.
 */
const CONTROL_SCRIPT = `
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
const [op, paramsFile] = process.argv.slice(2);
const params = JSON.parse(readFileSync(paramsFile, 'utf8'));
const socket = connect(process.env.TERMINAY_CONTROL_SOCKET);
let buffer = '';
socket.on('connect', () => {
	socket.write(JSON.stringify({ id: 'n-1', token: process.env.TERMINAY_CONTROL_TOKEN, version: 1, op, params }) + '\\n');
});
socket.on('data', (chunk) => {
	buffer += chunk;
	const end = buffer.indexOf('\\n');
	if (end < 0) return;
	const response = JSON.parse(buffer.slice(0, end));
	console.log(['RESULT', op, response.ok ? 'ok' : response.error.code].join(' '));
	socket.end();
});
socket.on('error', (error) => { console.error(error.message); process.exit(2); });
`

/** The shell command that sends one notification from the terminal it runs in. */
async function sendNotificationCommand(
  userDataDir: string,
  params: { title?: string; body: string },
): Promise<string> {
  const script = path.join(userDataDir, 'send-notification-e2e.mjs')
  const paramsFile = path.join(userDataDir, 'send-notification-params.json')
  await writeFile(script, CONTROL_SCRIPT)
  await writeFile(paramsFile, JSON.stringify(params))
  return `'${process.execPath}' '${script}' send_notification '${paramsFile}'`
}

/** Read the header count repeatedly, so a number that appears and goes is seen. */
async function expectNoNotificationFor(page: Page, milliseconds: number): Promise<void> {
  const deadline = Date.now() + milliseconds
  while (Date.now() < deadline) {
    await expect(page.locator('.notifications-count')).toHaveCount(0)
    await page.waitForTimeout(150)
  }
}

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
    await expect(mainWindow.locator('.notifications-count')).toHaveText('1')

    // The active project tab shows a dot for its own finished terminal.
    const projectBadge = mainWindow.locator('.project-tab--active .project-tab-activity-dot')
    await expect(projectBadge).toHaveCount(1)
    await expect(projectBadge).toHaveClass(/project-tab-activity-dot--unviewed/)
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
    await expect(mainWindow.locator('.notifications-count')).toHaveText('1')

    // Attention colours the project dot, and the dot hides once viewed.
    const projectBadge = mainWindow.locator('.project-tab--active .project-tab-activity-dot')
    await expect(projectBadge).toHaveCount(1)
    await expect(projectBadge).toHaveClass(/project-tab-activity-dot--attention/)
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
    const projectBadge = mainWindow.locator('.project-tab--active .project-tab-activity-dot')
    await expect(projectBadge).toHaveCount(1)
    await expect(projectBadge).toHaveClass(/project-tab-activity-dot--unviewed/)
    await expect(mainWindow.locator('.notifications-count')).toHaveText('1')

    await tab.click()

    await expect(tab).toHaveAttribute('data-terminal-activity', 'viewed')
    await expect(tab.locator('.agent-status-indicator[data-agent-state="done"]')).toHaveCount(0)
    await expect(projectBadge).toHaveCount(0)
    await expect(mainWindow.locator('.notifications-count')).toHaveCount(0)
  })

  test('work that finishes in the terminal the user is in stays until they do something in it', async ({
    mainWindow,
  }) => {
    const activeTab = mainWindow
      .locator('.project-workspace--active .terminal-tab-content--active')
      .first()
    const panel = mainWindow.locator('.project-workspace--active .terminal-panel:visible')

    await panel.click()
    await mainWindow.keyboard.type("sleep 2.1; printf '\\033]9;4;3;\\007'; printf '\\033]9;4;0;\\007'")
    await mainWindow.keyboard.press('Enter')

    // Being in the terminal when it finishes is not having seen it.
    await expect(activeTab).toHaveAttribute('data-terminal-activity', 'unviewed')
    await expect(
      mainWindow.locator('.project-tab--active .project-tab-activity-dot'),
    ).toHaveCount(1)

    // Clicking into it is.
    await panel.click()

    await expect(activeTab).toHaveAttribute('data-terminal-activity', 'viewed')
    await expect(
      mainWindow.locator('.project-tab--active .project-tab-activity-dot'),
    ).toHaveCount(0)
    await expectNoNotificationFor(mainWindow, 6_000)
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
    await expect(mainWindow.locator('.project-tab--active .project-tab-activity-dot')).toHaveCount(1)

    await mainWindow.getByLabel('Create project').click()
    await expect(mainWindow.locator('.project-tab--active')).toContainText('Project 2')
    await expect(
      mainWindow.locator('.project-tab:not(.project-tab--active) .project-tab-activity-dot'),
    ).toHaveCount(1)

    await mainWindow.locator('.project-tab:not(.project-tab--active)').click()
    await expect(mainWindow.locator('.project-tab--active')).not.toContainText('Project 2')

    const finishedTab = mainWindow
      .locator('.project-workspace--active .terminal-tab-content')
      .filter({ hasText: 'Terminal 2' })
    await expect(finishedTab).toHaveAttribute('data-terminal-activity', 'unviewed')
    await expect(mainWindow.locator('.project-tab--active .project-tab-activity-dot')).toHaveCount(1)

    await finishedTab.click()
    await expect(finishedTab).toHaveAttribute('data-terminal-activity', 'viewed')
    await expect(mainWindow.locator('.project-tab--active .project-tab-activity-dot')).toHaveCount(0)
  })

  test('work finishing in a terminal the user has moved away from is still announced', async ({
    mainWindow,
  }) => {
    const firstTab = mainWindow
      .locator('.project-workspace--active .terminal-tab-content')
      .filter({ hasText: 'Terminal 1' })

    // Type in the first terminal, then open a second without clicking or typing
    // anywhere else: the first is no longer the one being looked at.
    await submitTerminalCommand(
      mainWindow,
      "sleep 3.1; printf '\\033]9;4;3;\\007'; printf '\\033]9;4;0;\\007'\r",
    )
    await sendAppCommand(mainWindow, 'new-terminal')
    await expect(
      mainWindow.locator('.project-workspace--active .terminal-tab-content'),
    ).toHaveCount(2)

    await expect(firstTab).toHaveAttribute('data-terminal-activity', 'unviewed', {
      timeout: 15_000,
    })
    await expect(mainWindow.locator('.notifications-count')).toHaveText('1')
    await expect(
      mainWindow.locator('.project-tab--active .project-tab-activity-dot'),
    ).toHaveCount(1)
  })

  test('the Notifications control stays in the header with nothing to show', async ({
    mainWindow,
  }) => {
    const button = mainWindow.getByRole('button', { name: 'Notifications', exact: true })
    await expect(button).toBeVisible()
    await expect(mainWindow.locator('.notifications-count')).toHaveCount(0)

    await button.click()
    const menu = mainWindow.getByRole('menu', { name: 'Notifications' })
    await expect(menu).toContainText('No notifications')
    await expect(menu.getByRole('button', { name: 'Clear all' })).toHaveCount(0)
  })

  test('dismissing a notification acknowledges the terminal without selecting it', async ({
    electronApp,
    mainWindow,
  }) => {
    // The application icon badge carries the same number as the header.
    const badgeTotal = () =>
      electronApp.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              __terminayTestAppBadgeTotal?: () => number
            }
          ).__terminayTestAppBadgeTotal?.() ?? -1,
      )
    const { tab } = await withBackgroundTerminal(mainWindow)
    await expect.poll(badgeTotal).toBe(0)

    await writeToBackgroundSession(
      mainWindow,
      tab,
      "sleep 2.1; printf '\\033]9;4;3;\\007'; printf '\\033]9;4;0;\\007'\r",
    )

    await expect(tab).toHaveAttribute('data-terminal-activity', 'unviewed')
    const projectDot = mainWindow.locator('.project-tab--active .project-tab-activity-dot')
    await expect(projectDot).toHaveCount(1)
    await expect(mainWindow.locator('.notifications-count')).toHaveText('1')
    await expect.poll(badgeTotal).toBe(1)

    await mainWindow.getByRole('button', { name: /^Notifications/ }).click()
    const menu = mainWindow.getByRole('menu', { name: 'Notifications' })
    await menu.getByRole('button', { name: /^Dismiss / }).click()

    // The same acknowledgement as viewing: every surface clears together.
    await expect(tab).toHaveAttribute('data-terminal-activity', 'viewed')
    await expect(projectDot).toHaveCount(0)
    await expect(mainWindow.locator('.notifications-count')).toHaveCount(0)
    await expect.poll(badgeTotal).toBe(0)

    // Nothing was selected, and the list stays open on its empty state.
    await expect(tab).not.toHaveClass(/terminal-tab-content--active/)
    await expect(menu).toContainText('No notifications')
  })

  test('Clear all dismisses every notification', async ({ mainWindow }) => {
    const { tab } = await withBackgroundTerminal(mainWindow)

    await writeToBackgroundSession(mainWindow, tab, "sleep 1.1; printf 'ding\\007\\n'\r")

    await expect(tab).toHaveAttribute('data-terminal-activity', 'attention')
    await expect(mainWindow.locator('.notifications-count')).toHaveText('1')

    await mainWindow.getByRole('button', { name: /^Notifications/ }).click()
    const menu = mainWindow.getByRole('menu', { name: 'Notifications' })
    await menu.getByRole('button', { name: 'Clear all' }).click()

    await expect(tab).toHaveAttribute('data-terminal-activity', 'viewed')
    await expect(mainWindow.locator('.notifications-count')).toHaveCount(0)
    await expect(
      mainWindow.locator('.project-tab--active .project-tab-activity-dot'),
    ).toHaveCount(0)
    await expect(menu.getByRole('button', { name: 'Clear all' })).toHaveCount(0)
  })
  test('a tab indicator shows at once and the header count follows after the settle period', async ({
    electronApp,
    mainWindow,
  }) => {
    const badgeTotal = () =>
      electronApp.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              __terminayTestAppBadgeTotal?: () => number
            }
          ).__terminayTestAppBadgeTotal?.() ?? -1,
      )
    const { tab } = await withBackgroundTerminal(mainWindow)

    await writeToBackgroundSession(mainWindow, tab, "sleep 1.1; printf 'ding\\007\\n'\r")

    // The terminal's own state is live.
    await expect(tab).toHaveAttribute('data-terminal-activity', 'attention')
    await expect(
      mainWindow.locator('.project-tab--active .project-tab-activity-dot'),
    ).toHaveCount(1)

    // The notification is not announced until it has stayed for the settle period.
    await expectNoNotificationFor(mainWindow, 2_000)
    await expect.poll(badgeTotal).toBe(0)

    await expect(mainWindow.locator('.notifications-count')).toHaveText('1', { timeout: 10_000 })
    await expect.poll(badgeTotal).toBe(1)
  })

  test('a notification dealt with inside the settle period never reaches the header', async ({
    mainWindow,
  }) => {
    const { tab } = await withBackgroundTerminal(mainWindow)

    await writeToBackgroundSession(mainWindow, tab, "sleep 1.1; printf 'ding\\007\\n'\r")
    await expect(tab).toHaveAttribute('data-terminal-activity', 'attention')

    // Viewing the terminal is the acknowledgement; it lands well inside the period.
    await tab.click()
    await expect(tab).toHaveAttribute('data-terminal-activity', 'viewed')

    await expectNoNotificationFor(mainWindow, 6_000)
  })

  test('a notification a process sends is listed with its text and dismissed on its own', async ({
    mainWindow,
    userDataDir,
  }) => {
    const send = await sendNotificationCommand(userDataDir, {
      title: 'Review ready',
      body: 'Three files changed',
    })
    const { tab } = await withBackgroundTerminal(mainWindow)

    // A bell and a sent notification, both from the terminal nobody is in.
    await writeToBackgroundSession(mainWindow, tab, `sleep 2.1; printf 'ding\\007\\n'; ${send}\r`)

    await expect(mainWindow.locator('.notifications-count')).toHaveText('2', { timeout: 15_000 })

    await mainWindow.getByRole('button', { name: /^Notifications/ }).click()
    const menu = mainWindow.getByRole('menu', { name: 'Notifications' })
    const sent = menu.locator('.terminal-activity-menu__row', { hasText: 'Review ready' })
    await expect(sent).toHaveCount(1)
    await expect(sent).toContainText('Three files changed')
    await expect(sent).toContainText('Terminal 2')

    await sent.getByRole('button', { name: /^Dismiss / }).click()

    // Only that row leaves. The terminal still needs attention.
    await expect(menu.locator('.terminal-activity-menu__row')).toHaveCount(1)
    await expect(menu).not.toContainText('Review ready')
    await expect(mainWindow.locator('.notifications-count')).toHaveText('1')
    await expect(tab).toHaveAttribute('data-terminal-activity', 'attention')

    await menu.getByRole('button', { name: 'Clear all' }).click()
    await expect(mainWindow.locator('.notifications-count')).toHaveCount(0)
    await expect(menu).toContainText('No notifications')
  })

  test('typing in a terminal clears a notification a process sent to it', async ({
    mainWindow,
    userDataDir,
  }) => {
    const send = await sendNotificationCommand(userDataDir, { body: 'Build finished' })
    const { tab } = await withBackgroundTerminal(mainWindow)

    await writeToBackgroundSession(mainWindow, tab, `sleep 2.1; ${send}\r`)
    await expect(mainWindow.locator('.notifications-count')).toHaveText('1', { timeout: 15_000 })

    await tab.click()
    await submitTerminalCommand(mainWindow, 'true\r')
    await expect(mainWindow.locator('.notifications-count')).toHaveCount(0)
  })

  test('a notification sent from the terminal the user is in is shown when they do nothing in it', async ({
    mainWindow,
    userDataDir,
  }) => {
    const send = await sendNotificationCommand(userDataDir, { body: 'Come back when you can' })

    await submitTerminalCommand(mainWindow, `${send}\r`)

    await expect(mainWindow.locator('.notifications-count')).toBeVisible({ timeout: 15_000 })
    await mainWindow.getByRole('button', { name: /^Notifications/ }).click()
    await expect(
      mainWindow
        .getByRole('menu', { name: 'Notifications' })
        .locator('.terminal-activity-menu__row', { hasText: 'Come back when you can' }),
    ).toHaveCount(1)
  })

  test('typing in the terminal a notification was sent from, inside the settle period, means it is never shown', async ({
    mainWindow,
    userDataDir,
  }) => {
    const send = await sendNotificationCommand(userDataDir, { body: 'You are already here' })

    await submitTerminalCommand(mainWindow, `${send}\r`)
    await expect(
      mainWindow.locator('.project-workspace--active .terminal-panel:visible .xterm-rows'),
    ).toContainText('RESULT send_notification ok')
    await submitTerminalCommand(mainWindow, 'true\r')

    await expectNoNotificationFor(mainWindow, 6_000)
  })
})
