import { expect, test } from './fixtures'
import { fileExplorerItem, openFileExplorer, selectFileView, setProjectRoot } from './support/ui'

test('Explorer opens Markdown and MDX on the Document view and other files in Text', async ({
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
  const tabs = switcher.getByRole('tab')
  const activeTab = mainWindow.locator('.file-mode-switcher__button--active:visible')

  await fileExplorerItem(mainWindow, 'README.md').dblclick()
  await expect(editor).toContainText('Plain document body.')
  await expect(switcher).toBeVisible()
  await expect(tabs.first()).toHaveText('Document')
  await expect(activeTab).toHaveText('Document')

  await fileExplorerItem(mainWindow, 'guide.mdx').dblclick()
  await expect(editor).toContainText('An MDX body.')
  await expect(activeTab).toHaveText('Document')

  await fileExplorerItem(mainWindow, 'app.ts').dblclick()
  await expect(activeTab).toHaveText('Text')
  await expect(editor).toHaveCount(0)
  await expect(switcher.getByRole('tab', { name: 'Document' })).toHaveCount(0)
  await expect(mainWindow.getByLabel('Close file tab')).toHaveCount(3)
})

test('leaving Document saves its edits, and reopening keeps the chosen view', async ({
  createWorkspace,
  mainWindow,
}) => {
  const workspace = await createWorkspace({
    name: 'markdown-document-tab',
    seed: { files: { 'README.md': '# Read me\n\nSource toggle body.\n' } },
  })
  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)

  await fileExplorerItem(mainWindow, 'README.md').dblclick()
  const editor = mainWindow.locator('.documentation-editor:visible')
  await editor.getByText('Source toggle body.', { exact: true }).click()
  await mainWindow.keyboard.press('End')
  await mainWindow.keyboard.type(' Edited')

  // Text is reached from the same panel, after the edit is on disk.
  await selectFileView(mainWindow, 'Text')
  await expect(editor).toHaveCount(0)
  await expect(mainWindow.locator('.file-text-viewer')).toContainText('Source toggle body. Edited')
  expect(await workspace.readText('README.md')).toContain('Source toggle body. Edited')

  // Reopening from Explorer focuses the panel and keeps Text.
  await fileExplorerItem(mainWindow, 'README.md').dblclick()
  await expect(mainWindow.locator('.file-mode-switcher__button--active:visible')).toHaveText('Text')
  await expect(mainWindow.getByLabel('Close file tab')).toHaveCount(1)

  await selectFileView(mainWindow, 'Document')
  await expect(editor).toContainText('Source toggle body. Edited')
  await expect(mainWindow.getByLabel('Close file tab')).toHaveCount(1)
})
