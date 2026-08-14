import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { presentNativeRoute, sendAppCommand as sendCanonicalAppCommand } from './support/app'

async function sendAppCommand(page: Page, command: string): Promise<void> {
  await sendCanonicalAppCommand(page, command as import('../src/types/terminay').AppCommand)
}

async function openMacroLauncher(page: Page): Promise<void> {
  const launcher = page.getByRole('dialog', { name: 'Command bar' })

  for (let attempt = 0; attempt < 3; attempt++) {
    await sendAppCommand(page, 'open-command-bar')

    try {
      await expect(launcher).toBeVisible({ timeout: 2_000 })
      return
    } catch (error) {
      if (attempt === 2) {
        throw error
      }
    }
  }
}

async function navigateToCommand(page: Page, direction: 'ArrowDown' | 'ArrowUp', title: string, maxSteps = 80): Promise<void> {
	const activeCommand = page.locator('.macro-launcher-item--active')

  for (let step = 0; step < maxSteps; step++) {
		const activeText = await activeCommand.textContent()
    if (activeText?.includes(title)) {
      return
    }

		await page.keyboard.press(direction)
		await page.evaluate(
			() => new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
		)
  }

  throw new Error(`Failed to navigate to command: ${title}`)
}

async function openChildWindow(
  electronApp: ElectronApplication,
  action: () => Promise<void>,
): Promise<Page> {
  await electronApp.firstWindow()
  const nextWindowPromise = electronApp.waitForEvent('window')
  await action()
  const nextWindow = await nextWindowPromise
  await nextWindow.waitForLoadState('domcontentloaded')
  return nextWindow
}

async function getAppMenuItemAccelerator(electronApp: ElectronApplication, label: string): Promise<string | null> {
  return electronApp.evaluate(({ Menu }, itemLabel) => {
    const findItem = (items: Electron.MenuItem[]): Electron.MenuItem | null => {
      for (const item of items) {
        if (item.label === itemLabel) {
          return item
        }

        const child = item.submenu ? findItem(item.submenu.items) : null
        if (child) {
          return child
        }
      }

      return null
    }

    const item = Menu.getApplicationMenu() ? findItem(Menu.getApplicationMenu()!.items) : null
    if (!item) {
      throw new Error(`Unable to find menu item: ${itemLabel}`)
    }

    return item.accelerator ?? null
  }, label)
}

test('opens and closes terminal tabs', async ({ mainWindow }) => {
  const closeButtons = mainWindow.getByLabel('Close terminal')
  await expect(closeButtons).toHaveCount(1)

  await expect(mainWindow.locator('.terminay-add-tab-button').first()).toBeVisible()
  await mainWindow.locator('.terminay-add-tab-button').first().click()
  await expect(closeButtons).toHaveCount(2)

  await closeButtons.nth(1).click()
  await expect(closeButtons).toHaveCount(1)
})

test('opens and closes the file explorer sidebar', async ({ mainWindow }) => {
  const isMac = await mainWindow.evaluate(() => navigator.platform.toLowerCase().includes('mac'))
  const toggleButton = mainWindow.getByLabel('Toggle file explorer')
  const sidebar = mainWindow.locator('.file-explorer-sidebar')

  await expect(sidebar).toHaveCount(0)
  await toggleButton.click()
  await expect(sidebar).toBeVisible()

  await mainWindow.keyboard.press(isMac ? 'Meta+O' : 'Control+O')
  await expect(sidebar).toHaveCount(0)
})

test('opens the settings window', async ({ electronApp, mainWindow }) => {
  const settingsWindow = await openChildWindow(electronApp, async () => {
    await presentNativeRoute(mainWindow, '/?auxiliary=settings', 'settings')
  })

  await expect(settingsWindow.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(settingsWindow.getByPlaceholder('Search settings...')).toBeVisible()
})

test('captures and resets command shortcuts in settings', async ({ electronApp, mainWindow }) => {
  const settingsWindow = await openChildWindow(electronApp, async () => {
    await presentNativeRoute(mainWindow, '/?auxiliary=settings', 'settings')
  })

  await settingsWindow.getByRole('button', { name: /Shortcuts/ }).click()

  const isMac = await settingsWindow.evaluate(() => navigator.platform.toLowerCase().includes('mac'))
  const terminalShortcutRow = settingsWindow.locator('.settings-row').filter({ hasText: 'Create a new terminal tab' })
  const shortcutInput = terminalShortcutRow.locator('input')

  await terminalShortcutRow.getByRole('button', { name: 'Listen' }).click()
  await settingsWindow.keyboard.press(isMac ? 'Meta+Y' : 'Control+Y')
  await expect(shortcutInput).toHaveValue('CmdOrCtrl+Y')

  await terminalShortcutRow.getByRole('button', { name: 'Reset' }).click()
  await expect(shortcutInput).toHaveValue('CmdOrCtrl+T')

  await terminalShortcutRow.getByRole('button', { name: 'Clear' }).click()
  await expect(shortcutInput).toHaveValue('')
  await expect(terminalShortcutRow.locator('.settings-shortcut-chip')).toHaveText('Disabled')

  await settingsWindow.getByRole('button', { name: 'Reset All' }).click()
  await expect(shortcutInput).toHaveValue('CmdOrCtrl+T')

  await terminalShortcutRow.getByRole('button', { name: 'Listen' }).click()
  await expect(shortcutInput).toHaveValue('Listening...')
  await settingsWindow.keyboard.press('Escape')
  await expect(shortcutInput).toHaveValue('CmdOrCtrl+T')

  const projectShortcutRow = settingsWindow.locator('.settings-row').filter({ hasText: 'Create a new project' })
  await projectShortcutRow.getByRole('button', { name: 'Listen' }).click()
  await settingsWindow.keyboard.press(isMac ? 'Meta+T' : 'Control+T')
  await expect(projectShortcutRow.locator('input')).toHaveValue('CmdOrCtrl+T')
  await expect(projectShortcutRow.locator('.settings-shortcut-warning')).toHaveText('Also used by new terminal')
})

test('updates menu accelerators when command shortcuts are cleared and reset', async ({ electronApp, mainWindow }) => {
  const settingsWindow = await openChildWindow(electronApp, async () => {
    await presentNativeRoute(mainWindow, '/?auxiliary=settings', 'settings')
  })

  await settingsWindow.getByRole('button', { name: /Shortcuts/ }).click()

  const terminalShortcutRow = settingsWindow.locator('.settings-row').filter({ hasText: 'Create a new terminal tab' })
  const shortcutInput = terminalShortcutRow.locator('input')

  await expect(getAppMenuItemAccelerator(electronApp, 'Create a new terminal tab')).resolves.toBe('CmdOrCtrl+T')

  await terminalShortcutRow.getByRole('button', { name: 'Clear' }).click()
  await expect(shortcutInput).toHaveValue('')
  await expect.poll(() => getAppMenuItemAccelerator(electronApp, 'Create a new terminal tab')).toBeNull()

  await settingsWindow.getByRole('button', { name: 'Reset All' }).click()
  await expect(shortcutInput).toHaveValue('CmdOrCtrl+T')
  await expect.poll(() => getAppMenuItemAccelerator(electronApp, 'Create a new terminal tab')).toBe('CmdOrCtrl+T')
})

test('exposes a Window menu for multi-window management', async ({ electronApp }) => {
  const hasWindowMenu = await electronApp.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu()
    if (!menu) {
      return false
    }
    return menu.items.some((item) => item.role === 'windowMenu' || item.label === 'Window')
  })

  expect(hasWindowMenu).toBe(true)
})

test('runs customized app shortcuts from the keyboard', async ({ appHarness, mainWindow }) => {
  // Match the renderer's platform branch exactly. Chromium may report a
  // reduced navigator.platform while Electron's user agent still identifies
  // macOS, which otherwise makes this test send Control instead of Command.
  const isMac = await mainWindow.evaluate(() => navigator.userAgent.includes('Mac'))

  const settingsWindow = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'keyboard-shortcuts' })
  const terminalShortcutRow = settingsWindow.locator('.settings-row').filter({
    hasText: 'Create a new terminal tab',
  })
  await terminalShortcutRow.getByRole('button', { name: 'Listen' }).click()
  await settingsWindow.keyboard.press(isMac ? 'Meta+Y' : 'Control+Y')
  await expect(terminalShortcutRow.locator('input')).toHaveValue('CmdOrCtrl+Y')
  // The shortcut value is commit-gated: once visible, both the selected-server
  // settings and the isolated Desktop device-host projection have completed.
  await expect(settingsWindow.getByText('Saved', { exact: true })).toBeVisible()
  await settingsWindow.close()

  await expect(mainWindow.locator('.project-workspace--active')).toHaveAttribute(
    'data-new-terminal-shortcut',
    'CmdOrCtrl+Y',
  )
  await expect(mainWindow.locator('.terminal-tab-content')).toHaveCount(1)
  await mainWindow.bringToFront()
  await mainWindow.locator('.terminal-panel').first().click()
  await mainWindow.keyboard.press(isMac ? 'Meta+Y' : 'Control+Y')
  await expect(mainWindow.locator('.terminal-tab-content')).toHaveCount(2)
})

test('opens the macros window', async ({ electronApp }) => {
  const macrosWindow = await openChildWindow(electronApp, async () => {
    await electronApp.evaluate(({ Menu }) => {
      const visit = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
        for (const item of items) {
          if (item.label === 'Macros') return item
          const nested = item.submenu == null ? undefined : visit(item.submenu.items)
          if (nested !== undefined) return nested
        }
        return undefined
      }
      visit(Menu.getApplicationMenu()?.items ?? [])?.click()
    })
  })

  await expect(macrosWindow.getByRole('heading', { name: 'Macros' })).toBeVisible()
  await expect(macrosWindow.getByRole('button', { name: 'New Macro' })).toBeVisible()
  await expect(macrosWindow.getByText('Build reusable automation steps.')).toBeVisible()
})

test('persists server-owned macro edits across child-window reopen', async ({ electronApp }) => {
  const openMacros = () => openChildWindow(electronApp, async () => {
    await electronApp.evaluate(({ Menu }) => {
      const visit = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
        for (const item of items) {
          if (item.label === 'Macros') return item
          const nested = item.submenu == null ? undefined : visit(item.submenu.items)
          if (nested !== undefined) return nested
        }
        return undefined
      }
      visit(Menu.getApplicationMenu()?.items ?? [])?.click()
    })
  })
  const title = `Persistent Macro ${Date.now()}`
  const firstWindow = await openMacros()
  await firstWindow.getByRole('button', { name: 'New Macro' }).click()
  await firstWindow.getByPlaceholder('Macro Title').fill(title)
  await firstWindow.getByRole('button', { name: 'Save Changes' }).click()
  await expect(firstWindow.getByRole('button', { name: 'Save Changes' })).toBeEnabled()
  await firstWindow.close()

  const reopenedWindow = await openMacros()
  await reopenedWindow.getByRole('button', { name: title }).click()
  await expect(reopenedWindow.getByPlaceholder('Macro Title')).toHaveValue(title)
})

test('runs a macro from the launcher and records the completed run', async ({ mainWindow }) => {
  await openMacroLauncher(mainWindow)
  await mainWindow.getByRole('button', { name: 'Create a pull request' }).click()

  const macroQueueTrigger = mainWindow.getByLabel('Show macro queue (1)')
  await expect(macroQueueTrigger).toBeVisible()
  await macroQueueTrigger.click()

  const macroQueue = mainWindow.getByRole('menu', { name: 'Macro queue' })
  await expect(macroQueue).toBeVisible()
  await expect(macroQueue.locator('.terminal-tab-macro-run__title')).toHaveText('Create a pull request')
  await expect(macroQueue.locator('.terminal-tab-macro-run__status')).toHaveText('completed')
})

test('prioritizes direct title matches in command bar search', async ({ mainWindow }) => {
  await openMacroLauncher(mainWindow)

  await mainWindow.getByPlaceholder('Search commands...').fill('root')

  const commandButtons = mainWindow.locator('.macro-launcher-list button')
  await expect(commandButtons.first()).toContainText('Set project root folder to working directory')
  await expect(commandButtons.nth(1)).toContainText('Edit project settings')
})

test('preserves macro library order in command bar search', async ({ mainWindow }) => {
  await openMacroLauncher(mainWindow)
  await mainWindow.getByPlaceholder('Search commands...').fill('example')

  const macroButtons = mainWindow.locator('.macro-launcher-group', { hasText: 'Macros' }).locator('.macro-launcher-item')
  await expect(macroButtons.first()).toContainText('Update OS')
  await expect(macroButtons.nth(1)).toContainText('Say hello to person')
})

test('shows current key bindings in the command bar', async ({ mainWindow }) => {
  await openMacroLauncher(mainWindow)

  const isMac = await mainWindow.evaluate(() => navigator.platform.toLowerCase().includes('mac'))
  const expectedTerminalShortcut = isMac ? '⌘T' : 'Ctrl+T'
  const expectedClearShortcut = isMac ? '⌘K' : 'Ctrl+K'

  await expect(mainWindow.getByRole('button', { name: /Create a new terminal tab/ })).toContainText(expectedTerminalShortcut)
  await expect(mainWindow.getByRole('button', { name: /Clear terminal/ })).toContainText(expectedClearShortcut)
})

test('scrolls the active command into view during keyboard navigation', async ({ mainWindow }) => {
  await openMacroLauncher(mainWindow)

  const commandList = mainWindow.locator('.macro-launcher-list')
	await commandList.evaluate((element) => { element.style.maxHeight = '120px' })

  expect(await commandList.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)

  await navigateToCommand(mainWindow, 'ArrowDown', 'Say hello to person')

  await expect(commandList.locator('.macro-launcher-item--active')).toContainText('Say hello to person')
  await expect.poll(async () => commandList.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
})

test('scrolls the active command into view when navigating upward', async ({ mainWindow }) => {
  await openMacroLauncher(mainWindow)

  const commandList = mainWindow.locator('.macro-launcher-list')
	await commandList.evaluate((element) => { element.style.maxHeight = '120px' })

  await navigateToCommand(mainWindow, 'ArrowDown', 'Say hello to person')
	const downwardScrollTop = await commandList.evaluate((element) => element.scrollTop)

  await navigateToCommand(mainWindow, 'ArrowUp', 'Update OS')

  await expect(commandList.locator('.macro-launcher-item--active')).toContainText('Update OS')
  await expect.poll(async () => commandList.evaluate((element) => element.scrollTop)).toBeLessThan(downwardScrollTop)
})
