import { expect, test } from './fixtures'
import { contextMenuItem, fileExplorerItem, openFileExplorer, setProjectRoot } from './support/ui'

test('file explorer can browse folders and open files', async ({ createWorkspace, mainWindow }) => {
  const workspace = await createWorkspace({
    name: 'sidebar-browse',
    seed: {
      directories: ['nested'],
      files: {
        'nested/deep.txt': 'deep file\n',
        'notes.txt': 'sidebar preview text\n',
      },
    },
  })

  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)

  await expect(fileExplorerItem(mainWindow, 'nested')).toBeVisible()
  await fileExplorerItem(mainWindow, 'nested').click()
  await expect(fileExplorerItem(mainWindow, 'deep.txt')).toBeVisible()

  await fileExplorerItem(mainWindow, 'notes.txt').dblclick()
  await expect(mainWindow.locator('.file-preview-text')).toContainText('sidebar preview text')
  await expect(mainWindow.getByLabel('Close file tab')).toHaveCount(1)
})

test('file explorer context menu supports create rename delete and open terminal here', async ({
  appHarness,
  createWorkspace,
  mainWindow,
}) => {
  const workspace = await createWorkspace({
    name: 'sidebar-ops',
    seed: {
      directories: ['target-dir'],
      files: {
        'target-dir/alpha.txt': 'alpha\n',
      },
    },
  })
  const dialogs = await appHarness.dialogs()

  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)

  await dialogs.queuePrompt('created.txt')
  await fileExplorerItem(mainWindow, 'target-dir').click({ button: 'right' })
  await expect(contextMenuItem(mainWindow, 'New File')).toBeVisible()
  await contextMenuItem(mainWindow, 'New File').click()
  await fileExplorerItem(mainWindow, 'target-dir').click()
  await expect(fileExplorerItem(mainWindow, 'created.txt')).toBeVisible()
  await expect.poll(() => workspace.readText('target-dir/created.txt')).toBe('')

  await dialogs.queuePrompt('created-folder')
  await fileExplorerItem(mainWindow, 'target-dir').click({ button: 'right' })
  await expect(contextMenuItem(mainWindow, 'New Folder')).toBeVisible()
  await contextMenuItem(mainWindow, 'New Folder').click()
  await expect(fileExplorerItem(mainWindow, 'created-folder')).toBeVisible()

  await dialogs.queuePrompt('renamed.txt')
  await fileExplorerItem(mainWindow, 'alpha.txt').click({ button: 'right' })
  await expect(contextMenuItem(mainWindow, 'Rename')).toBeVisible()
  await contextMenuItem(mainWindow, 'Rename').click()
  await expect.poll(() => workspace.readText('target-dir/renamed.txt')).toBe('alpha\n')

  await dialogs.queueConfirm(true)
  await fileExplorerItem(mainWindow, 'created.txt').click({ button: 'right' })
  await expect(contextMenuItem(mainWindow, 'Delete')).toBeVisible()
  await contextMenuItem(mainWindow, 'Delete').click()
  await expect(fileExplorerItem(mainWindow, 'created.txt')).toHaveCount(0)

  const terminalCloses = mainWindow.getByLabel('Close terminal')
  await expect(terminalCloses).toHaveCount(1)
  await fileExplorerItem(mainWindow, 'created-folder').click({ button: 'right' })
  await expect(contextMenuItem(mainWindow, 'Open terminal here')).toBeVisible()
  await contextMenuItem(mainWindow, 'Open terminal here').click()
  await expect(terminalCloses).toHaveCount(2)
})
