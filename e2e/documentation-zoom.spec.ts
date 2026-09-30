import type { ElectronApplication } from '@playwright/test'
import { expect, test } from './fixtures'
import { fileExplorerItem, openFileExplorer, setProjectRoot } from './support/ui'

async function clickViewMenuItem(electronApp: ElectronApplication, label: string): Promise<void> {
  await electronApp.evaluate(({ Menu }, itemLabel) => {
    const view = Menu.getApplicationMenu()?.items.find((item) => item.label === 'View')
    const item = view?.submenu?.items.find((entry) => entry.label === itemLabel)
    if (!item) throw new Error(`Unable to find View menu item: ${itemLabel}`)
    item.click()
  }, label)
}

test('the documentation editor follows View zoom like terminals do', async ({
  createWorkspace,
  electronApp,
  mainWindow,
}) => {
  const workspace = await createWorkspace({
    name: 'documentation-zoom',
    seed: {
      files: {
        'README.md': '# Read me\n\nZoomable body.\n',
        'NOTES.md': '# Notes\n\nOpened while zoomed.\n',
      },
    },
  })
  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)
  await fileExplorerItem(mainWindow, 'README.md').dblclick()

  const content = mainWindow
    .locator('.documentation-editor:visible')
    .getByRole('textbox', { name: 'editable markdown' })
  await expect(content).toContainText('Zoomable body.')
  const fontSize = () => content.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize))
  const base = await fontSize()

  await clickViewMenuItem(electronApp, 'Zoom In')
  await clickViewMenuItem(electronApp, 'Zoom In')
  await expect.poll(fontSize).toBeGreaterThan(base)

  await clickViewMenuItem(electronApp, 'Reset Zoom')
  await clickViewMenuItem(electronApp, 'Zoom Out')
  await expect.poll(fontSize).toBeLessThan(base)

  // A document opened while zoomed starts at the current level.
  await fileExplorerItem(mainWindow, 'NOTES.md').dblclick()
  await expect(content).toContainText('Opened while zoomed.')
  await expect.poll(fontSize).toBeLessThan(base)

  await clickViewMenuItem(electronApp, 'Reset Zoom')
  await expect.poll(fontSize).toBe(base)
})
