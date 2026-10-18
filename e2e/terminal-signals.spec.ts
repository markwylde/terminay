import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  commandArrived,
  commandGate,
  endSettlePeriod,
  INPUT_QUIET_MS,
  INPUT_WINDOW_MS,
  serverClock,
} from './support/server-clock'
import { settledTerminalSessionId, terminalPanelForSession } from './support/terminal-session'
import { sendAppCommand } from './support/app'
import { sendNotificationCommand } from './support/notifications'
import { submitTerminalCommand } from './support/terminal'
import { createStartedProject } from './support/project-start'

/*
 * Activity and notifications are specified in time, and this suite runs the
 * embedded server on a clock it holds (see e2e/fixtures.ts). The server's time
 * stands still until a test advances it, so a period ends exactly where the
 * test says and never while it is still acting. Where a terminal's output has
 * to come after something the test does, the command waits on a gate the test
 * opens, instead of sleeping and hoping the test is done by then.
 */

function appBadgeTotal(electronApp: ElectronApplication): Promise<number> {
  return electronApp.evaluate(
    () =>
      (
        globalThis as typeof globalThis & {
          __terminayTestAppBadgeTotal?: () => number
        }
      ).__terminayTestAppBadgeTotal?.() ?? -1,
  )
}

async function getActiveSessionId(page: Page): Promise<string> {
  const activePresentation = page.locator(
    '.project-workspace--active .terminal-panel:visible',
  )
  await expect(activePresentation).toHaveCount(1)
  const sessionId = await settledTerminalSessionId(activePresentation)

  return sessionId
}

function terminalTab(page: Page, title: string): Locator {
  return page
    .locator('.project-workspace--active .terminal-tab-content')
    .filter({ hasText: title })
}

/**
 * The terminal's input has focus. The window counts a terminal as the focused
 * one in the same turn its input takes focus, so from here on what that
 * terminal reports is judged with it focused, and any other terminal without.
 */
async function expectTerminalFocused(page: Page, sessionId: string): Promise<void> {
  await expect(
    terminalPanelForSession(page, sessionId).locator('.xterm-helper-textarea'),
  ).toBeFocused()
}

type BackgroundTerminal = { firstSessionId: string; sessionId: string; tab: Locator }

async function focusFirstTerminal(page: Page, terminals: BackgroundTerminal): Promise<void> {
  await terminalTab(page, 'Terminal 1').click()
  await expectTerminalFocused(page, terminals.firstSessionId)
}

async function writeToBackgroundSession(
  electronApp: ElectronApplication,
  page: Page,
  terminals: BackgroundTerminal,
  data: string,
): Promise<void> {
  await terminals.tab.click()
  await submitTerminalCommand(page, data)
  await commandArrived(electronApp, terminals.sessionId, data)
  await focusFirstTerminal(page, terminals)
}

/**
 * Creates a second terminal, returns its session id and tab locator, then
 * focuses the first terminal so the second is a background tab. Activity
 * indicators only surface on tabs the user is not currently looking at.
 */
async function withBackgroundTerminal(page: Page): Promise<BackgroundTerminal> {
  const firstSessionId = await getActiveSessionId(page)
  await sendAppCommand(page, 'new-terminal')
  await expect(page.locator('.project-workspace--active .terminal-tab-content')).toHaveCount(2)

  const sessionId = await getActiveSessionId(page)
  const terminals = { firstSessionId, sessionId, tab: terminalTab(page, 'Terminal 2') }

  await focusFirstTerminal(page, terminals)

  return terminals
}

/**
 * The OSC 9;4 sequence an agent turn begins and ends with, after the gate. The
 * server's clock first leaves the window in which output is the echo of the
 * user typing the command.
 */
const PROGRESS_TURN = "printf '\\033]9;4;3;\\007'; printf '\\033]9;4;0;\\007'"

test.describe('terminal activity signals', () => {
  test('OSC 9;4 progress shows finished and stays finished despite continued output', async ({
    electronApp,
    mainWindow,
    userDataDir,
  }) => {
    const clock = serverClock(electronApp)
    const turn = await commandGate(userDataDir)
    const tips = await commandGate(userDataDir)
    const background = await withBackgroundTerminal(mainWindow)
    const { sessionId, tab } = background

    await writeToBackgroundSession(
      electronApp,
      mainWindow,
      background,
      `${turn.wait}; ${PROGRESS_TURN}; ${tips.wait}; printf 'Tip: try the %s\\n' thing; printf 'Tip: try the %s\\n' 'other thing'\r`,
    )
    await clock.advance(INPUT_WINDOW_MS)

    // Agent turn begins (progress indeterminate) then ends (progress cleared).
    await turn.open()
    await expect(tab).toHaveAttribute('data-terminal-activity', 'unviewed')

    // The agent keeps repainting a spinner / tips bar after the turn — a claimed
    // session must ignore that raw output and stay "finished", not flicker.
    await tips.open()
    await expect.poll(() => clock.output(sessionId)).toContain('Tip: try the other thing')
    expect(await clock.activity(sessionId)).toMatchObject({ acknowledged: false, status: 'idle' })
    await expect(tab).toHaveAttribute('data-terminal-activity', 'unviewed')

    await endSettlePeriod(electronApp)
    expect(await clock.activity(sessionId)).toMatchObject({ acknowledged: false, status: 'idle' })
    await expect(tab).toHaveAttribute('data-terminal-activity', 'unviewed')
    await expect(mainWindow.locator('.notifications-count')).toHaveText('1')

    // The active project tab shows a dot for its own finished terminal.
    const projectBadge = mainWindow.locator('.project-tab--active .project-tab-activity-dot')
    await expect(projectBadge).toHaveCount(1)
    await expect(projectBadge).toHaveClass(/project-tab-activity-dot--unviewed/)
  })

  test('OSC 133 command lifecycle shows finished with no trailing flicker', async ({
    electronApp,
    mainWindow,
    userDataDir,
  }) => {
    const clock = serverClock(electronApp)
    const command = await commandGate(userDataDir)
    const trailing = await commandGate(userDataDir)
    const background = await withBackgroundTerminal(mainWindow)
    const { sessionId, tab } = background

    await writeToBackgroundSession(
      electronApp,
      mainWindow,
      background,
      `${command.wait}; printf '\\033]133;C\\007'; printf '\\033]133;D;0\\007'; ${trailing.wait}; printf 'trailing %s\\n' output\r`,
    )
    await clock.advance(INPUT_WINDOW_MS)

    await command.open()
    await expect(tab).toHaveAttribute('data-terminal-activity', 'unviewed')

    await trailing.open()
    await expect.poll(() => clock.output(sessionId)).toContain('trailing output')
    expect(await clock.activity(sessionId)).toMatchObject({ acknowledged: false, status: 'idle' })
    await expect(tab).toHaveAttribute('data-terminal-activity', 'unviewed')

    // No deadline the trailing output could have set turns it back either.
    await endSettlePeriod(electronApp)
    expect(await clock.activity(sessionId)).toMatchObject({ acknowledged: false, status: 'idle' })
    await expect(tab).toHaveAttribute('data-terminal-activity', 'unviewed')
  })

  test('a bell raises the attention indicator until the tab is viewed', async ({
    electronApp,
    mainWindow,
    userDataDir,
  }) => {
    const bell = await commandGate(userDataDir)
    const background = await withBackgroundTerminal(mainWindow)
    const { tab } = background

    await writeToBackgroundSession(electronApp, mainWindow, background, `${bell.wait}; printf 'ding\\007\\n'\r`)
    await bell.open()

    await expect(tab).toHaveAttribute('data-terminal-activity', 'attention')
    await endSettlePeriod(electronApp)
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
    electronApp,
    mainWindow,
    userDataDir,
  }) => {
    const clock = serverClock(electronApp)
    const turn = await commandGate(userDataDir)
    const background = await withBackgroundTerminal(mainWindow)
    const { tab } = background

    await writeToBackgroundSession(electronApp, mainWindow, background, `${turn.wait}; ${PROGRESS_TURN}\r`)
    await clock.advance(INPUT_WINDOW_MS)
    await turn.open()

    await expect(tab).toHaveAttribute('data-terminal-activity', 'unviewed')
    const projectBadge = mainWindow.locator('.project-tab--active .project-tab-activity-dot')
    await expect(projectBadge).toHaveCount(1)
    await expect(projectBadge).toHaveClass(/project-tab-activity-dot--unviewed/)
    await endSettlePeriod(electronApp)
    await expect(mainWindow.locator('.notifications-count')).toHaveText('1')

    await tab.click()

    await expect(tab).toHaveAttribute('data-terminal-activity', 'viewed')
    await expect(tab.locator('.agent-status-indicator[data-agent-state="done"]')).toHaveCount(0)
    await expect(projectBadge).toHaveCount(0)
    await expect(mainWindow.locator('.notifications-count')).toHaveCount(0)
  })

  test('a focused terminal that finishes does not keep the finished indicator', async ({
    electronApp,
    mainWindow,
    userDataDir,
  }) => {
    const clock = serverClock(electronApp)
    const turn = await commandGate(userDataDir)
    const activeTab = mainWindow
      .locator('.project-workspace--active .terminal-tab-content--active')
      .first()
    const sessionId = await getActiveSessionId(mainWindow)

    await mainWindow.locator('.terminal-panel').first().click()
    await mainWindow.keyboard.type(`${turn.wait}; ${PROGRESS_TURN}`)
    await mainWindow.keyboard.press('Enter')
    await commandArrived(electronApp, sessionId, `${turn.wait}; ${PROGRESS_TURN}`)
    const typed = (await clock.activity(sessionId))?.revision ?? 0
    const announced = (await clock.notifications()).revision

    // The shell's input goes quiet, which the reducer reports as a plain shell
    // finishing. The user is in this terminal, so the window acknowledges it
    // at once, without them doing anything more.
    await clock.advance(INPUT_QUIET_MS)
    await expect
      .poll(async () => {
        const now = await clock.activity(sessionId)
        return (
          now !== undefined &&
          now.revision > typed &&
          now.acknowledged &&
          now.source === 'structured:acknowledge'
        )
      })
      .toBe(true)
    const acknowledged = (await clock.activity(sessionId))?.revision ?? 0

    // The command's own completion follows while the user is still there.
    await turn.open()
    await expect
      .poll(async () => {
        const now = await clock.activity(sessionId)
        return (
          now !== undefined &&
          now.revision > acknowledged &&
          now.source === 'structured:progress' &&
          now.status === 'idle'
        )
      })
      .toBe(true)
    expect(await clock.activity(sessionId)).toMatchObject({ acknowledged: true })
    await expect(activeTab).toHaveAttribute('data-terminal-activity', 'viewed')
    await expect(activeTab.locator('.agent-status-indicator[data-agent-state="done"]')).toHaveCount(0)
    await expect(
      mainWindow.locator('.project-tab--active .project-tab-activity-dot'),
    ).toHaveCount(0)

    // Nothing is announced once the settle period is over either.
    await endSettlePeriod(electronApp)
    expect((await clock.notifications()).revision).toBe(announced)
    await expect(mainWindow.locator('.notifications-count')).toHaveCount(0)
  })

  test('a shell command that finishes after the user has left the window is announced, and coming back does not clear it', async ({
    electronApp,
    mainWindow,
    userDataDir,
  }) => {
    const clock = serverClock(electronApp)
    const turn = await commandGate(userDataDir)
    const activeTab = mainWindow
      .locator('.project-workspace--active .terminal-tab-content--active')
      .first()
    const sessionId = await getActiveSessionId(mainWindow)

    await mainWindow.locator('.terminal-panel').first().click()
    await mainWindow.keyboard.type(`${turn.wait}; ${PROGRESS_TURN}`)
    await mainWindow.keyboard.press('Enter')
    await commandArrived(electronApp, sessionId, `${turn.wait}; ${PROGRESS_TURN}`)
    // The user goes to another application. A test window cannot have its
    // focus taken by one, so the page is told it has none.
    await mainWindow.evaluate(() => {
      const page = document as Document & { hadFocus?: () => boolean }
      page.hadFocus = page.hasFocus
      page.hasFocus = () => false
    })
    await clock.advance(INPUT_WINDOW_MS)
    await turn.open()

    await expect(activeTab).toHaveAttribute('data-terminal-activity', 'unviewed')

    // They come back and touch nothing. The terminal's state changes again
    // while they are back (its input goes quiet), and the notification is
    // published, so the window judges it once more with focus.
    await mainWindow.evaluate(() => {
      const page = document as Document & { hadFocus?: () => boolean }
      if (page.hadFocus) page.hasFocus = page.hadFocus
    })
    const judged = (await clock.activity(sessionId))?.revision ?? 0
    await endSettlePeriod(electronApp)
    expect((await clock.activity(sessionId))?.revision).toBeGreaterThan(judged)
    await expect(mainWindow.locator('.notifications-count')).toHaveText('1')
    expect(await clock.activity(sessionId)).toMatchObject({ acknowledged: false })
    await expect(activeTab).toHaveAttribute('data-terminal-activity', 'unviewed')

    await mainWindow.locator('.project-workspace--active .terminal-panel:visible').click()
    await expect(activeTab).toHaveAttribute('data-terminal-activity', 'viewed')
    await expect(mainWindow.locator('.notifications-count')).toHaveCount(0)
  })

  test('activating a project does not dismiss a finished terminal until that terminal is clicked', async ({
    electronApp,
    mainWindow,
    userDataDir,
  }) => {
    test.setTimeout(60_000)
    const turn = await commandGate(userDataDir)
    const background = await withBackgroundTerminal(mainWindow)
    const { tab } = background

    await writeToBackgroundSession(electronApp, mainWindow, background, `${turn.wait}; ${PROGRESS_TURN}\r`)
    await serverClock(electronApp).advance(INPUT_WINDOW_MS)
    await turn.open()

    await expect(tab).toHaveAttribute('data-terminal-activity', 'unviewed')
    await expect(mainWindow.locator('.project-tab--active .project-tab-activity-dot')).toHaveCount(1)

    await createStartedProject(mainWindow)
    await expect(mainWindow.locator('.project-tab--active')).toContainText('Project 2')
    await expect(
      mainWindow.locator('.project-tab:not(.project-tab--active) .project-tab-activity-dot'),
    ).toHaveCount(1)

    await mainWindow.locator('.project-tab:not(.project-tab--active)').click()
    await expect(mainWindow.locator('.project-tab--active')).not.toContainText('Project 2')

    const finishedTab = terminalTab(mainWindow, 'Terminal 2')
    await expect(finishedTab).toHaveAttribute('data-terminal-activity', 'unviewed')
    await expect(mainWindow.locator('.project-tab--active .project-tab-activity-dot')).toHaveCount(1)

    await finishedTab.click()
    await expect(finishedTab).toHaveAttribute('data-terminal-activity', 'viewed')
    await expect(mainWindow.locator('.project-tab--active .project-tab-activity-dot')).toHaveCount(0)
  })

  test('work finishing in a terminal the user has moved away from is still announced', async ({
    electronApp,
    mainWindow,
    userDataDir,
  }) => {
    const turn = await commandGate(userDataDir)
    const firstTab = terminalTab(mainWindow, 'Terminal 1')

    // Type in the first terminal, then open a second without clicking or typing
    // anywhere else: the first is no longer the one being looked at.
    const firstSessionId = await getActiveSessionId(mainWindow)
    await submitTerminalCommand(mainWindow, `${turn.wait}; ${PROGRESS_TURN}\r`)
    await commandArrived(electronApp, firstSessionId, `${turn.wait}; ${PROGRESS_TURN}`)
    await sendAppCommand(mainWindow, 'new-terminal')
    await expect(
      mainWindow.locator('.project-workspace--active .terminal-tab-content'),
    ).toHaveCount(2)
    await expectTerminalFocused(mainWindow, await getActiveSessionId(mainWindow))
    await serverClock(electronApp).advance(INPUT_WINDOW_MS)
    await turn.open()

    await expect(firstTab).toHaveAttribute('data-terminal-activity', 'unviewed')
    await endSettlePeriod(electronApp)
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
    userDataDir,
  }) => {
    // The application icon badge carries the same number as the header.
    const badgeTotal = () => appBadgeTotal(electronApp)
    const turn = await commandGate(userDataDir)
    const background = await withBackgroundTerminal(mainWindow)
    const { tab } = background
    await expect.poll(badgeTotal).toBe(0)

    await writeToBackgroundSession(electronApp, mainWindow, background, `${turn.wait}; ${PROGRESS_TURN}\r`)
    await serverClock(electronApp).advance(INPUT_WINDOW_MS)
    await turn.open()

    await expect(tab).toHaveAttribute('data-terminal-activity', 'unviewed')
    const projectDot = mainWindow.locator('.project-tab--active .project-tab-activity-dot')
    await expect(projectDot).toHaveCount(1)
    await endSettlePeriod(electronApp)
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

  test('Clear all dismisses every notification', async ({
    electronApp,
    mainWindow,
    userDataDir,
  }) => {
    const bell = await commandGate(userDataDir)
    const background = await withBackgroundTerminal(mainWindow)
    const { tab } = background

    await writeToBackgroundSession(electronApp, mainWindow, background, `${bell.wait}; printf 'ding\\007\\n'\r`)
    await bell.open()

    await expect(tab).toHaveAttribute('data-terminal-activity', 'attention')
    await endSettlePeriod(electronApp)
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
    userDataDir,
  }) => {
    const clock = serverClock(electronApp)
    const badgeTotal = () => appBadgeTotal(electronApp)
    const bell = await commandGate(userDataDir)
    const background = await withBackgroundTerminal(mainWindow)
    const { tab } = background

    await writeToBackgroundSession(electronApp, mainWindow, background, `${bell.wait}; printf 'ding\\007\\n'\r`)
    await bell.open()

    // The terminal's own state is live.
    await expect(tab).toHaveAttribute('data-terminal-activity', 'attention')
    await expect(
      mainWindow.locator('.project-tab--active .project-tab-activity-dot'),
    ).toHaveCount(1)

    // The notification is held, and is not announced until it has stayed for
    // the whole settle period.
    await expect.poll(async () => (await clock.notifications()).pending).toBe(1)
    const settleMs = await clock.settleMs()
    await clock.advance(settleMs - 1)
    expect(await clock.notifications()).toMatchObject({ pending: 1, published: 0 })
    await expect(mainWindow.locator('.notifications-count')).toHaveCount(0)
    expect(await badgeTotal()).toBe(0)

    await clock.advance(1)
    expect(await clock.notifications()).toMatchObject({ pending: 0, published: 1 })
    await expect(mainWindow.locator('.notifications-count')).toHaveText('1')
    await expect.poll(badgeTotal).toBe(1)
  })

  test('a notification dealt with inside the settle period never reaches the header', async ({
    electronApp,
    mainWindow,
    userDataDir,
  }) => {
    const clock = serverClock(electronApp)
    const bell = await commandGate(userDataDir)
    const background = await withBackgroundTerminal(mainWindow)
    const { tab } = background

    await writeToBackgroundSession(electronApp, mainWindow, background, `${bell.wait}; printf 'ding\\007\\n'\r`)
    await bell.open()
    await expect(tab).toHaveAttribute('data-terminal-activity', 'attention')
    await expect.poll(async () => (await clock.notifications()).pending).toBe(1)

    // Viewing the terminal is the acknowledgement, and the server's clock has
    // not moved since the bell, so it lands inside the period.
    await tab.click()
    await expect(tab).toHaveAttribute('data-terminal-activity', 'viewed')
    await expect.poll(async () => (await clock.notifications()).pending).toBe(0)

    // The period ends with nothing held, so nothing was ever announced.
    const announced = (await clock.notifications()).revision
    await endSettlePeriod(electronApp)
    expect(await clock.notifications()).toMatchObject({ published: 0, revision: announced })
    await expect(mainWindow.locator('.notifications-count')).toHaveCount(0)
  })

  test('a notification a process sends is listed with its text and dismissed on its own', async ({
    electronApp,
    mainWindow,
    userDataDir,
  }) => {
    const clock = serverClock(electronApp)
    const send = await sendNotificationCommand(userDataDir, {
      title: 'Review ready',
      body: 'Three files changed',
    })
    const gate = await commandGate(userDataDir)
    const background = await withBackgroundTerminal(mainWindow)
    const { tab } = background

    // A bell and a sent notification, both from the terminal nobody is in.
    await writeToBackgroundSession(electronApp, mainWindow, background, `${gate.wait}; printf 'ding\\007\\n'; ${send}\r`)
    await gate.open()

    await expect.poll(async () => (await clock.notifications()).pending).toBe(2)
    await endSettlePeriod(electronApp)
    await expect(mainWindow.locator('.notifications-count')).toHaveText('2')

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
    electronApp,
    mainWindow,
    userDataDir,
  }) => {
    const clock = serverClock(electronApp)
    const send = await sendNotificationCommand(userDataDir, { body: 'Build finished' })
    const gate = await commandGate(userDataDir)
    const background = await withBackgroundTerminal(mainWindow)
    const { tab } = background

    await writeToBackgroundSession(electronApp, mainWindow, background, `${gate.wait}; ${send}\r`)
    await gate.open()
    await expect.poll(async () => (await clock.notifications()).pending).toBe(1)
    await endSettlePeriod(electronApp)
    await expect(mainWindow.locator('.notifications-count')).toHaveText('1')

    await tab.click()
    await submitTerminalCommand(mainWindow, 'true\r')
    await expect(mainWindow.locator('.notifications-count')).toHaveCount(0)
  })

  test('a notification sent from the terminal the user is in is shown when they do nothing in it', async ({
    electronApp,
    mainWindow,
    userDataDir,
  }) => {
    const clock = serverClock(electronApp)
    const send = await sendNotificationCommand(userDataDir, { body: 'Come back when you can' })

    await submitTerminalCommand(mainWindow, `${send}\r`)

    await expect.poll(async () => (await clock.notifications()).pending).toBe(1)
    await endSettlePeriod(electronApp)
    await expect(mainWindow.locator('.notifications-count')).toBeVisible()
    await mainWindow.getByRole('button', { name: /^Notifications/ }).click()
    await expect(
      mainWindow
        .getByRole('menu', { name: 'Notifications' })
        .locator('.terminal-activity-menu__row', { hasText: 'Come back when you can' }),
    ).toHaveCount(1)
  })

  test('typing in the terminal a notification was sent from, inside the settle period, means it is never shown', async ({
    electronApp,
    mainWindow,
    userDataDir,
  }) => {
    const clock = serverClock(electronApp)
    const send = await sendNotificationCommand(userDataDir, { body: 'You are already here' })

    await submitTerminalCommand(mainWindow, `${send}\r`)
    await expect(
      mainWindow.locator('.project-workspace--active .terminal-panel:visible .xterm-rows'),
    ).toContainText('RESULT send_notification ok')
    await expect.poll(async () => (await clock.notifications()).pending).toBe(1)

    // The server's clock has not moved since the send, so this is inside the period.
    await submitTerminalCommand(mainWindow, 'true\r')
    await expect.poll(async () => (await clock.notifications()).pending).toBe(0)

    const announced = (await clock.notifications()).revision
    await endSettlePeriod(electronApp)
    expect(await clock.notifications()).toMatchObject({ published: 0, revision: announced })
    await expect(mainWindow.locator('.notifications-count')).toHaveCount(0)
  })
})
