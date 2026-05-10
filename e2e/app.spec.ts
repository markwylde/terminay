import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test } from './fixtures'

async function sendAppCommand(page: Page, command: string): Promise<void> {
  await page.evaluate(async (nextCommand) => {
    const bridge = (window as Window & {
      terminayTest?: { sendAppCommand: (command: string) => Promise<void> }
    }).terminayTest

    if (!bridge) {
      throw new Error('terminayTest bridge is unavailable')
    }

    await bridge.sendAppCommand(nextCommand)
  }, command)
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

async function seedScrollTestMacros(page: Page, count = 20): Promise<void> {
  await page.evaluate(async (macroCount) => {
    const macros = await window.terminay.getMacros()
    const extraMacros = Array.from({ length: macroCount }, (_, index) => ({
      id: `scroll-test-macro-${index + 1}`,
      title: `Scroll test macro ${index + 1}`,
      description: 'Used to verify command bar scrolling during keyboard navigation.',
      template: `echo scroll test macro ${index + 1}`,
      submitMode: 'type-only' as const,
      steps: [
        {
          id: `scroll-test-step-${index + 1}`,
          type: 'type' as const,
          content: `echo scroll test macro ${index + 1}`,
        },
      ],
      fields: [],
    }))

    await window.terminay.updateMacros([...macros, ...extraMacros])
  }, count)
}


async function navigateToCommand(page: Page, direction: 'ArrowDown' | 'ArrowUp', title: string, maxSteps = 80): Promise<void> {
  for (let step = 0; step < maxSteps; step++) {
    const activeText = await page.locator('.macro-launcher-item--active').textContent()
    if (activeText?.includes(title)) {
      return
    }

    await page.keyboard.press(direction)
  }

  throw new Error(`Failed to navigate to command: ${title}`)
}

async function openChildWindow(
  electronApp: ElectronApplication,
  action: () => Promise<void>,
): Promise<Page> {
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
  const toggleButton = mainWindow.getByLabel('Toggle file explorer')
  const sidebar = mainWindow.locator('.file-explorer-sidebar')

  await expect(sidebar).toHaveCount(0)
  await toggleButton.click()
  await expect(sidebar).toBeVisible()

  await toggleButton.click()
  await expect(sidebar).toHaveCount(0)
})

test('opens the settings window', async ({ electronApp, mainWindow }) => {
  const settingsWindow = await openChildWindow(electronApp, async () => {
    await mainWindow.evaluate(async () => {
      await window.terminay.openSettingsWindow()
    })
  })

  await expect(settingsWindow.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(settingsWindow.getByPlaceholder('Search settings...')).toBeVisible()
})

test('captures and resets command shortcuts in settings', async ({ electronApp, mainWindow }) => {
  const settingsWindow = await openChildWindow(electronApp, async () => {
    await mainWindow.evaluate(async () => {
      await window.terminay.openSettingsWindow()
    })
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
    await mainWindow.evaluate(async () => {
      await window.terminay.openSettingsWindow()
    })
  })

  await settingsWindow.getByRole('button', { name: /Shortcuts/ }).click()

  const terminalShortcutRow = settingsWindow.locator('.settings-row').filter({ hasText: 'Create a new terminal tab' })
  const shortcutInput = terminalShortcutRow.locator('input')

  await expect(getAppMenuItemAccelerator(electronApp, 'Create a new terminal tab')).resolves.toBe('CmdOrCtrl+T')

  await terminalShortcutRow.getByRole('button', { name: 'Clear' }).click()
  await expect(shortcutInput).toHaveValue('')
  await expect(getAppMenuItemAccelerator(electronApp, 'Create a new terminal tab')).resolves.toBeNull()

  await settingsWindow.getByRole('button', { name: 'Reset All' }).click()
  await expect(shortcutInput).toHaveValue('CmdOrCtrl+T')
  await expect(getAppMenuItemAccelerator(electronApp, 'Create a new terminal tab')).resolves.toBe('CmdOrCtrl+T')
})

test('runs customized app shortcuts from the keyboard', async ({ mainWindow }) => {
  const isMac = await mainWindow.evaluate(() => navigator.platform.toLowerCase().includes('mac'))

  await mainWindow.evaluate(async () => {
    const settings = await window.terminay.getTerminalSettings()
    await window.terminay.updateTerminalSettings({
      ...settings,
      keyboardShortcuts: {
        ...settings.keyboardShortcuts,
        'new-terminal': 'CmdOrCtrl+Y',
      },
    })
  })

  await expect(mainWindow.locator('.terminal-tab-content')).toHaveCount(1)
  await mainWindow.bringToFront()
  await mainWindow.locator('.terminal-panel').first().click()
  await mainWindow.keyboard.press(isMac ? 'Meta+Y' : 'Control+Y')
  await expect(mainWindow.locator('.terminal-tab-content')).toHaveCount(2)
})

test('opens the macros window', async ({ electronApp, mainWindow }) => {
  const macrosWindow = await openChildWindow(electronApp, async () => {
    await mainWindow.evaluate(async () => {
      await window.terminay.openMacrosWindow()
    })
  })

  await expect(macrosWindow.getByRole('heading', { name: 'Macros' })).toBeVisible()
  await expect(macrosWindow.getByRole('button', { name: 'New Macro' })).toBeVisible()
  await expect(macrosWindow.getByText('Build reusable automation steps.')).toBeVisible()
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

test('shows current key bindings in the command bar', async ({ mainWindow }) => {
  await openMacroLauncher(mainWindow)

  const isMac = await mainWindow.evaluate(() => navigator.platform.toLowerCase().includes('mac'))
  const expectedTerminalShortcut = isMac ? '⌘T' : 'Ctrl+T'
  const expectedClearShortcut = isMac ? '⌘K' : 'Ctrl+K'

  await expect(mainWindow.getByRole('button', { name: /Create a new terminal tab/ })).toContainText(expectedTerminalShortcut)
  await expect(mainWindow.getByRole('button', { name: /Clear terminal/ })).toContainText(expectedClearShortcut)
})

test('scrolls the active command into view during keyboard navigation', async ({ mainWindow }) => {
  await seedScrollTestMacros(mainWindow)

  await openMacroLauncher(mainWindow)

  const commandList = mainWindow.locator('.macro-launcher-list')

  expect(await commandList.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)

  await navigateToCommand(mainWindow, 'ArrowDown', 'Scroll test macro 20')

  await expect(commandList.locator('.macro-launcher-item--active')).toContainText('Scroll test macro 20')
  await expect.poll(async () => commandList.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
})

test('scrolls the active command into view when navigating upward', async ({ mainWindow }) => {
  await seedScrollTestMacros(mainWindow)

  await openMacroLauncher(mainWindow)

  const commandList = mainWindow.locator('.macro-launcher-list')

  await navigateToCommand(mainWindow, 'ArrowDown', 'Scroll test macro 20')


  await navigateToCommand(mainWindow, 'ArrowUp', 'Scroll test macro 12')

  await expect(commandList.locator('.macro-launcher-item--active')).toContainText('Scroll test macro 12')
  await expect.poll(async () => commandList.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
})
