import { expect, test } from './fixtures'

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
})
