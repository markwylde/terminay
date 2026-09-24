import { expect, test } from './fixtures'
import { fileExplorerItem, openFileExplorer, setProjectRoot, viewDocumentSource } from './support/ui'

test('Explorer opens Markdown and MDX as documents and other files in the file viewer', async ({
  createWorkspace,
  mainWindow,
}) => {
  const workspace = await createWorkspace({
    name: 'markdown-opens-documentation',
    seed: {
      files: {
        'README.md': '# Read me\n\nPlain document body.\n',
        'guide.mdx': '# MDX guide\n\nAn MDX body.\n',
        'app.ts': 'export const answer = 42\n',
      },
    },
  })
  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)

  const editor = mainWindow.locator('.documentation-editor:visible')
  const switcher = mainWindow.locator('.file-mode-switcher:visible')

  await fileExplorerItem(mainWindow, 'README.md').dblclick()
  await expect(editor).toContainText('Plain document body.')
  await expect(switcher).toHaveCount(0)

  await fileExplorerItem(mainWindow, 'guide.mdx').dblclick()
  await expect(editor).toContainText('An MDX body.')
  await expect(switcher).toHaveCount(0)

  await fileExplorerItem(mainWindow, 'app.ts').dblclick()
  await expect(switcher).toBeVisible()
  await expect(editor).toHaveCount(0)
  await expect(mainWindow.getByRole('button', { name: 'Open as document' })).toHaveCount(0)
  await expect(mainWindow.getByLabel('Close file tab')).toHaveCount(3)
})

test('View source and Open as document switch the same panel, and reopening keeps the choice', async ({
  createWorkspace,
  mainWindow,
}) => {
  const workspace = await createWorkspace({
    name: 'markdown-view-source',
    seed: { files: { 'README.md': '# Read me\n\nSource toggle body.\n' } },
  })
  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)

  await fileExplorerItem(mainWindow, 'README.md').dblclick()
  await expect(mainWindow.locator('.documentation-editor')).toContainText('Source toggle body.')

  await viewDocumentSource(mainWindow)
  await expect(mainWindow.locator('.documentation-editor')).toHaveCount(0)
  await mainWindow.getByRole('tab', { name: 'Text' }).click()
  await expect(mainWindow.locator('.file-text-viewer')).toBeVisible()

  // Reopening from Explorer focuses the panel without undoing View source.
  await fileExplorerItem(mainWindow, 'README.md').dblclick()
  await expect(mainWindow.locator('.file-mode-switcher')).toBeVisible()
  await expect(mainWindow.locator('.documentation-editor')).toHaveCount(0)
  await expect(mainWindow.getByLabel('Close file tab')).toHaveCount(1)

  await mainWindow.getByRole('button', { name: 'Open as document' }).click()
  await expect(mainWindow.locator('.documentation-editor')).toContainText('Source toggle body.')
  await expect(mainWindow.getByLabel('Close file tab')).toHaveCount(1)
})
