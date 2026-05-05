import { realpath } from 'node:fs/promises'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { openProjectEditWindow } from './support/ui'

async function getActiveSessionId(page: Page): Promise<string> {
  const sessionId = await page.locator('.terminal-panel').first().getAttribute('data-termide-terminal-session-id')

  if (!sessionId) {
    throw new Error('Active terminal session id is unavailable')
  }

  return sessionId
}

async function writeToActiveTerminal(page: Page, data: string): Promise<void> {
  const sessionId = await getActiveSessionId(page)
  await page.evaluate(({ nextData, nextSessionId }) => {
    window.termide.writeTerminal(nextSessionId, nextData)
  }, { nextData: data, nextSessionId: sessionId })
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

    return item.accelerator
  }, label)
}

test.describe('workspace shell', () => {
  test('adds and closes terminal tabs from the workspace shell', async ({ appHarness, mainWindow }) => {
    const closeButtons = mainWindow.getByLabel('Close terminal')

    await expect(closeButtons).toHaveCount(1)
    await expect(mainWindow.locator('.dv-groupview')).toHaveCount(1)

    await appHarness.sendAppCommand('new-terminal')
    await expect(closeButtons).toHaveCount(2)

    await appHarness.sendAppCommand('close-active')
    await expect(closeButtons).toHaveCount(1)
  })

  test('closes the project when its last tab is closed', async ({ appHarness, mainWindow }) => {
    await appHarness.sendAppCommand('new-project')
    await expect(mainWindow.locator('.project-tab-title')).toHaveText(['Project 1', 'Project 2'])
    await expect(mainWindow.locator('.project-tab--active .project-tab-title')).toHaveText('Project 2')
    await expect(mainWindow.locator('.project-workspace--active .terminal-tab-content')).toHaveCount(1)

    await appHarness.sendAppCommand('close-active')

    await expect(mainWindow.locator('.project-tab-title')).toHaveText(['Project 1'])
    await expect(mainWindow.locator('.project-tab--active .project-tab-title')).toHaveText('Project 1')
  })

  test('keeps the app open when closing the first project while another project exists', async ({
    appHarness,
    mainWindow,
  }) => {
    await appHarness.sendAppCommand('new-project')
    await expect(mainWindow.locator('.project-tab-title')).toHaveText(['Project 1', 'Project 2'])

    await mainWindow.locator('.project-tab').first().click()
    await expect(mainWindow.locator('.project-tab--active .project-tab-title')).toHaveText('Project 1')

    await appHarness.sendAppCommand('close-active')

    await expect(mainWindow.locator('.project-tab-title')).toHaveText(['Project 2'])
    await expect(mainWindow.locator('.project-tab--active .project-tab-title')).toHaveText('Project 2')
  })

  test('splits the active terminal vertically', async ({ appHarness, mainWindow }) => {
    await mainWindow.locator('.terminal-panel').first().click()
    await appHarness.sendAppCommand('split-vertical')

    await expect(mainWindow.getByLabel('Close terminal')).toHaveCount(2)
    await expect(mainWindow.locator('.dv-groupview')).toHaveCount(2)
    await expect(mainWindow.locator('.terminal-tab-title')).toHaveText(['Terminal 1', 'Terminal 2'])
  })

  test('splits the active terminal horizontally', async ({ appHarness, mainWindow }) => {
    await mainWindow.locator('.terminal-panel').first().click()
    await appHarness.sendAppCommand('split-horizontal')

    await expect(mainWindow.getByLabel('Close terminal')).toHaveCount(2)
    await expect(mainWindow.locator('.dv-groupview')).toHaveCount(2)
    await expect(mainWindow.locator('.terminal-tab-title')).toHaveText(['Terminal 1', 'Terminal 2'])
  })

  test('pops out the active terminal panel into a new window', async ({ appHarness, mainWindow }) => {
    await mainWindow.locator('.terminal-panel').first().click()
    const popoutWindow = await appHarness.openChildWindow(async () => {
      await appHarness.sendAppCommand('popout-active')
    })

    await expect(popoutWindow.locator('.terminal-tab-title')).toContainText('Terminal 1')
    await expect(popoutWindow.getByLabel('Close terminal')).toHaveCount(1)
  })

  test('sets the project root from the active terminal working directory with the CmdOrCtrl+R menu command', async ({
    appHarness,
    createWorkspace,
    electronApp,
    mainWindow,
  }) => {
    const workspace = await createWorkspace({ name: 'shortcut-project-root' })
    const expectedRoot = await realpath(workspace.rootDir)
    const sessionId = await getActiveSessionId(mainWindow)

    await writeToActiveTerminal(mainWindow, `cd ${JSON.stringify(workspace.rootDir)}\r`)
    await expect
      .poll(async () => mainWindow.evaluate((id) => window.termide.getTerminalCwd(id), sessionId))
      .toBe(expectedRoot)

    await mainWindow.bringToFront()
    await mainWindow.locator('.terminal-panel').first().click()
    const accelerator = await getAppMenuItemAccelerator(electronApp, 'Set Project Root to Working Directory')
    expect(accelerator).toBe('CmdOrCtrl+R')
    await appHarness.sendAppCommand('set-project-root-folder-to-working-directory')
    await mainWindow.waitForTimeout(500)

    const editWindow = await openProjectEditWindow(mainWindow)
    await expect(editWindow.getByPlaceholder('Enter folder path')).toHaveValue(expectedRoot)
    await editWindow.close()
  })
})
