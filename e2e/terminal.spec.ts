import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { sendAppCommand } from './support/app'
import { cancelEditWindow, contextMenuItem, openTerminalEditWindow, submitEditWindow } from './support/ui'

async function getActiveSessionId(page: Page): Promise<string> {
  const sessionId = await page.locator('.terminal-panel').first().getAttribute('data-termide-terminal-session-id')

  if (!sessionId) {
    throw new Error('Active terminal session id is unavailable')
  }

  return sessionId
}

async function writeToTerminal(page: Page, data: string): Promise<void> {
  const sessionId = await getActiveSessionId(page)
  await writeToTerminalSession(page, sessionId, data)
}

async function writeToTerminalSession(page: Page, sessionId: string, data: string): Promise<void> {
  await page.evaluate(({ nextData, nextSessionId }) => {
    window.termide.writeTerminal(nextSessionId, nextData)
  }, { nextData: data, nextSessionId: sessionId })
}

async function readCssVariableFromStyle(locator: ReturnType<Page['locator']>, variableName: string): Promise<string> {
  const style = await locator.getAttribute('style')
  const match = style?.match(new RegExp(`${variableName}:\\s*([^;]+)`))

  if (!match?.[1]) {
    throw new Error(`Missing ${variableName} in style attribute: ${style ?? '(none)'}`)
  }

  return match[1].trim()
}

test.describe('terminal behavior', () => {
  test('terminal tab context menu closes the selected tab', async ({ mainWindow }) => {
    await sendAppCommand(mainWindow, 'new-terminal')
    const terminalTabs = mainWindow.locator('.project-workspace--active .terminal-tab-content')
    await expect(terminalTabs).toHaveCount(2)

    await terminalTabs.nth(1).click({ button: 'right' })
    await expect(contextMenuItem(mainWindow, 'Close')).toBeVisible()
    await expect(contextMenuItem(mainWindow, 'Open Settings')).toBeVisible()
    await expect(contextMenuItem(mainWindow, 'Move to project')).toBeVisible()

    await contextMenuItem(mainWindow, 'Close').click()
    await expect(terminalTabs).toHaveCount(1)
  })

  test('terminal tab context menu opens settings and moves a tab to another project', async ({
    appHarness,
    mainWindow,
  }) => {
    const settingsWindow = await appHarness.openChildWindow(async () => {
      await mainWindow.locator('.project-workspace--active .terminal-tab-content').first().click({ button: 'right' })
      await contextMenuItem(mainWindow, 'Open Settings').click()
    })

    await expect(settingsWindow.getByRole('heading', { name: 'Edit Terminal Tab' })).toBeVisible()
    await settingsWindow.getByPlaceholder('Terminal name').fill('Move Me')
    await submitEditWindow(settingsWindow)
    await expect(mainWindow.locator('.project-workspace--active .terminal-tab-title')).toHaveText('Move Me')

    await mainWindow.getByLabel('Add project tab').click()
    await expect(mainWindow.locator('.project-tab--active')).toContainText('Project 2')
    await expect(mainWindow.locator('.project-workspace--active .terminal-tab-content')).toHaveCount(1)

    await mainWindow.locator('.project-tab').filter({ hasText: 'Project 1' }).click()
    const tabToMove = mainWindow
      .locator('.project-workspace--active .terminal-tab-content')
      .filter({ hasText: 'Move Me' })
      .first()
    await expect(tabToMove).toBeVisible()

    await tabToMove.click({ button: 'right' })
    await contextMenuItem(mainWindow, 'Move to project').click()
    await expect(contextMenuItem(mainWindow, 'Project 2')).toBeVisible()
    await contextMenuItem(mainWindow, 'Project 2').click()

    await expect(mainWindow.locator('.project-tab')).toHaveCount(2)
    await expect(mainWindow.locator('.project-tab--active')).toContainText('Project 2')
    await expect(mainWindow.locator('.project-workspace--active .terminal-tab-content')).toHaveCount(2)
    await expect(
      mainWindow.locator('.project-workspace--active .terminal-tab-content').filter({ hasText: 'Move Me' }),
    ).toHaveCount(1)
  })

  test('new terminals inherit the active project tab color by default', async ({ mainWindow }) => {
    const activeProjectTab = mainWindow.locator('.project-tab--active')
    const terminalTabs = mainWindow.locator('.terminal-tab-content')
    const initialTerminal = terminalTabs.first()

    const projectColor = await readCssVariableFromStyle(activeProjectTab, '--project-color')
    const initialTerminalColor = await readCssVariableFromStyle(initialTerminal, '--tab-color')

    expect(initialTerminalColor).toBe(projectColor)

    await sendAppCommand(mainWindow, 'new-terminal')
    await expect(terminalTabs).toHaveCount(2)

    const secondTerminalColor = await readCssVariableFromStyle(terminalTabs.nth(1), '--tab-color')
    expect(secondTerminalColor).toBe(projectColor)
  })

  test('edits the active terminal tab title and hue', async ({ mainWindow }) => {
    const terminalTabs = mainWindow.locator('.terminal-tab-content')
    const initialTabCount = await terminalTabs.count()

    const editWindow = await openTerminalEditWindow(mainWindow)
    await expect(editWindow.getByRole('heading', { name: 'Edit Terminal Tab' })).toBeVisible()
    await expect(terminalTabs).toHaveCount(initialTabCount)

    await editWindow.getByPlaceholder('Terminal name').fill('Build Shell')
    await editWindow.getByLabel('Tab icon').fill('B')
    await editWindow.locator('.hue-slider').fill('30')
    await submitEditWindow(editWindow)

    const updatedTab = mainWindow.locator('.terminal-tab-content').first()
    await expect(updatedTab.locator('.terminal-tab-title')).toHaveText('Build Shell')
    await expect(updatedTab.locator('.terminal-tab-emoji')).toHaveText('B')
    await expect(updatedTab).toHaveAttribute('data-has-color', 'true')
  })

  test('terminal edit window focuses the title and saves it with Enter', async ({ mainWindow }) => {
    const editWindow = await openTerminalEditWindow(mainWindow)
    const titleInput = editWindow.getByPlaceholder('Terminal name')

    await expect(editWindow.getByRole('heading', { name: 'Edit Terminal Tab' })).toBeVisible()
    await expect(titleInput).toBeFocused()
    await expect
      .poll(async () =>
        titleInput.evaluate((input) => {
          const title = input as HTMLInputElement
          return title.selectionStart === 0 && title.selectionEnd === title.value.length
        }),
      )
      .toBe(true)

    await titleInput.fill('Keyboard Shell')
    const closePromise = editWindow.waitForEvent('close')
    try {
      await titleInput.press('Enter')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('Target page, context or browser has been closed')) {
        throw error
      }
    }
    await closePromise

    await expect(mainWindow.locator('.terminal-tab-content').first().locator('.terminal-tab-title')).toHaveText(
      'Keyboard Shell',
    )
  })

  test('terminal edit window keeps the icon input to one character and cancel leaves the tab unchanged', async ({ mainWindow }) => {
    const firstTab = mainWindow.locator('.terminal-tab-content').first()
    const originalTitle = (await firstTab.locator('.terminal-tab-title').textContent())?.trim() ?? 'Terminal 1'
    const originalIcon = ((await firstTab.locator('.terminal-tab-emoji').textContent().catch(() => null)) ?? '').trim()

    const editWindow = await openTerminalEditWindow(mainWindow)
    const iconInput = editWindow.getByLabel('Tab icon')

    await expect(editWindow.getByRole('heading', { name: 'Edit Terminal Tab' })).toBeVisible()
    await iconInput.fill('ZZ')
    await expect(iconInput).toHaveValue('Z')
    await editWindow.getByPlaceholder('Terminal name').fill('Should Not Save')
    await cancelEditWindow(editWindow)

    await expect(firstTab.locator('.terminal-tab-title')).toHaveText(originalTitle)
    if (originalIcon) {
      await expect(firstTab.locator('.terminal-tab-emoji')).toHaveText(originalIcon)
    } else {
      await expect(firstTab.locator('.terminal-tab-emoji')).toHaveCount(0)
    }
  })

  test('double-clicking a terminal tab opens one edit window for the active project tab', async ({
    appHarness,
    electronApp,
    mainWindow,
  }) => {
    const firstProjectEditWindow = await openTerminalEditWindow(mainWindow)
    await firstProjectEditWindow.getByPlaceholder('Terminal name').fill('Wrong Project Shell')
    await submitEditWindow(firstProjectEditWindow)

    await mainWindow.getByLabel('Add project tab').click()
    await expect(mainWindow.locator('.project-tab--active')).toContainText('Project 2')

    const activeTerminalTab = mainWindow.locator('.project-workspace--active .terminal-tab-content').first()
    await expect(activeTerminalTab.locator('.terminal-tab-title')).toHaveText('Terminal 1')

    const windowCountBeforeEdit = await electronApp.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
    )

    const editWindow = await appHarness.openChildWindow(async () => {
      await activeTerminalTab.dblclick()
    })

    await expect(editWindow.getByRole('heading', { name: 'Edit Terminal Tab' })).toBeVisible()
    await expect(editWindow.getByPlaceholder('Terminal name')).toHaveValue('Terminal 1')
    await mainWindow.waitForTimeout(500)
    await expect
      .poll(async () => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
      .toBe(windowCountBeforeEdit + 1)

    await cancelEditWindow(editWindow)
  })

  test('opens terminal search and navigates between matches', async ({ mainWindow }) => {
    await mainWindow.locator('.terminal-panel').first().click()
    await writeToTerminal(
      mainWindow,
      "printf '\\164\\145\\162\\155\\151\\144\\145\\055\\163\\145\\141\\162\\143\\150\\055\\150\\151\\164\\nother-line\\n\\164\\145\\162\\155\\151\\144\\145\\055\\163\\145\\141\\162\\143\\150\\055\\150\\151\\164\\n'\r",
    )

    await mainWindow.locator('.terminal-panel').first().click()
    await mainWindow.keyboard.press('Meta+F')

    const search = mainWindow.getByRole('search', { name: 'Search terminal output' })
    await expect(search).toBeVisible()

    const input = search.getByLabel('Find in terminal')
    await input.fill('termide-search-hit')

    const initialCount = await expect
      .poll(async () => await search.locator('.terminal-search-count').textContent())
      .toMatch(/^[12]\/2$/)
      .then(() => search.locator('.terminal-search-count').textContent())

    const currentMatch = initialCount ?? '1/2'
    const nextMatch = currentMatch === '1/2' ? '2/2' : '1/2'

    await search.getByLabel('Next match').click()
    await expect(search.locator('.terminal-search-count')).toHaveText(nextMatch)

    await search.getByLabel('Previous match').click()
    await expect(search.locator('.terminal-search-count')).toHaveText(currentMatch)

    await search.getByLabel('Close search').click()
    await expect(search).toBeHidden()
  })

  test('terminal activity overview jumps to inactive terminals across projects', async ({ mainWindow }) => {
    await sendAppCommand(mainWindow, 'new-terminal')
    await expect(mainWindow.locator('.project-workspace--active .terminal-tab-content')).toHaveCount(2)
    const backgroundSessionId = await getActiveSessionId(mainWindow)

    await mainWindow
      .locator('.project-workspace--active .terminal-tab-content')
      .filter({ hasText: 'Terminal 1' })
      .click()

    await mainWindow.getByLabel('Add project tab').click()
    await expect(mainWindow.locator('.project-tab--active')).toContainText('Project 2')
    await expect(mainWindow.locator('.project-workspace--active .terminal-tab-content')).toHaveCount(1)

    await mainWindow.waitForTimeout(1_100)
    await writeToTerminalSession(mainWindow, backgroundSessionId, "printf 'overview-activity-hit\\n'\r")

    const activityButton = mainWindow.getByRole('button', { name: 'Open terminal activity menu' })
    await expect(activityButton).toBeVisible()
    await expect(mainWindow.locator('.terminal-activity-pill--recent')).toHaveText('1')

    await expect(mainWindow.locator('.terminal-activity-pill--unviewed')).toHaveText('1')
    await expect(mainWindow.locator('.terminal-activity-pill--recent')).toHaveCount(0)

    await activityButton.click()
    const activityMenu = mainWindow.getByRole('menu', { name: 'Terminal activity menu' })
    await expect(activityMenu).toBeVisible()

    const backgroundItem = activityMenu.locator('.terminal-activity-menu__item').filter({
      hasText: 'Terminal 2',
    })
    await expect(backgroundItem).toContainText('Project 1')
    await expect(backgroundItem.locator('.terminal-activity-menu__state--unviewed')).toBeVisible()

    await backgroundItem.click()

    await expect(mainWindow.locator('.project-tab--active')).toContainText('Project 1')
    await expect(
      mainWindow.locator('.project-workspace--active .terminal-tab-content--active .terminal-tab-title'),
    ).toHaveText('Terminal 2')
    await expect(activityMenu).toHaveCount(0)
    await expect(activityButton).toHaveCount(0)
  })

  test('auto-closes a terminal tab on successful exit when enabled', async ({ mainWindow }) => {
    await mainWindow.evaluate(async () => {
      const settings = await window.termide.getTerminalSettings()
      await window.termide.updateTerminalSettings({
        ...settings,
        autoCloseTerminalOnExitZero: true,
      })
    })

    await sendAppCommand(mainWindow, 'new-terminal')
    await expect(mainWindow.locator('.terminal-tab-content')).toHaveCount(2)

    await writeToTerminal(mainWindow, 'exit\r')

    await expect(mainWindow.locator('.terminal-tab-content')).toHaveCount(1)
  })
})
