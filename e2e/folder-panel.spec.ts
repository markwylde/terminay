import { stat } from 'node:fs/promises'
import { expect, test } from './fixtures'
import { contextMenuItem, fileExplorerItem, openFileExplorer, setProjectRoot } from './support/ui'

function folderViewButton(page: Parameters<typeof test>[0]['mainWindow'], name: string) {
  return page.locator('.folder-viewer__view-button').filter({ hasText: name }).first()
}

test('folder panel supports view modes navigation and refresh', async ({ createWorkspace, mainWindow }) => {
  const workspace = await createWorkspace({
    name: 'folder-panel',
    seed: {
      directories: ['gallery-folder'],
      files: {
        'gallery-folder/inner.txt': 'inside folder\n',
        'list-file.txt': 'folder row\n',
        'tiny.png': Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pJsteUAAAAASUVORK5CYII=',
          'base64',
        ),
      },
    },
  })

  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)

  await fileExplorerItem(mainWindow, 'gallery-folder').dblclick()
  await expect(mainWindow.locator('.folder-viewer__title')).toHaveText('gallery-folder')
  await expect(mainWindow.getByLabel('Close folder tab')).toHaveCount(1)

  await folderViewButton(mainWindow, 'List').click()
  await expect(mainWindow.locator('.folder-viewer__list')).toBeVisible()

  await folderViewButton(mainWindow, 'Tree').click()
  await expect(mainWindow.locator('.folder-viewer__tree')).toBeVisible()
  await expect(mainWindow.locator('.folder-viewer__tree-file').filter({ hasText: 'inner.txt' })).toBeVisible()

  await folderViewButton(mainWindow, 'Thumbnail').click()
  await expect(mainWindow.locator('.folder-viewer__grid--thumbnail')).toBeVisible()

  await folderViewButton(mainWindow, 'Gallery').click()
  await expect(mainWindow.locator('.folder-viewer__grid--gallery')).toBeVisible()

  await workspace.writeText('gallery-folder/fresh.txt', 'after refresh\n')
  await mainWindow.getByRole('button', { name: 'Refresh' }).click()
  await expect(mainWindow.locator('.folder-viewer__card').filter({ hasText: 'fresh.txt' })).toBeVisible()

  await folderViewButton(mainWindow, 'List').click()
  await mainWindow.locator('.folder-viewer__list-row').filter({ hasText: 'fresh.txt' }).dblclick()
  await expect(mainWindow.locator('.file-preview-text')).toContainText('after refresh')
})

test('folder panel context menu mirrors file operations', async ({ appHarness, createWorkspace, mainWindow }) => {
  const workspace = await createWorkspace({
    name: 'folder-panel-ops',
    seed: {
      directories: ['ops-folder', 'ops-folder/actions-dir'],
      files: {
        'ops-folder/folder-file.txt': 'folder file\n',
      },
    },
  })
  const dialogs = await appHarness.dialogs()

  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)
  await fileExplorerItem(mainWindow, 'ops-folder').dblclick()
  await expect(mainWindow.locator('.folder-viewer__title')).toHaveText('ops-folder')
  const actionsDirSummary = mainWindow.locator('.folder-viewer__tree-summary').filter({ hasText: 'actions-dir' })
  const refreshButton = mainWindow.locator('.folder-viewer__action').filter({ hasText: 'Refresh' }).first()
  await actionsDirSummary.click()

  await dialogs.queuePrompt('panel-created.txt')
  await actionsDirSummary.click({ button: 'right' })
  await expect(contextMenuItem(mainWindow, 'New File')).toBeVisible()
  await contextMenuItem(mainWindow, 'New File').click()
  await expect.poll(() => workspace.readText('ops-folder/actions-dir/panel-created.txt')).toBe('')
  await mainWindow.getByLabel('Close file tab').click()

  await dialogs.queuePrompt('panel-created-folder')
  await actionsDirSummary.click({ button: 'right' })
  await expect(contextMenuItem(mainWindow, 'New Folder')).toBeVisible()
  await contextMenuItem(mainWindow, 'New Folder').click()
  await expect.poll(async () => (await stat(workspace.path('ops-folder', 'actions-dir', 'panel-created-folder'))).isDirectory()).toBe(true)

  await dialogs.queuePrompt('folder-file-renamed.txt')
  await mainWindow.locator('.folder-viewer__tree-file').filter({ hasText: 'folder-file.txt' }).click({ button: 'right' })
  await expect(contextMenuItem(mainWindow, 'Rename')).toBeVisible()
  await contextMenuItem(mainWindow, 'Rename').click()
  await expect.poll(() => workspace.readText('ops-folder/folder-file-renamed.txt')).toBe('folder file\n')
  await refreshButton.click()
  await expect(mainWindow.locator('.folder-viewer__tree-file').filter({ hasText: 'folder-file-renamed.txt' })).toBeVisible()

  const terminalCloses = mainWindow.getByLabel('Close terminal')
  await expect(terminalCloses).toHaveCount(1)
  await actionsDirSummary.click({ button: 'right' })
  await expect(contextMenuItem(mainWindow, 'Open terminal here')).toBeVisible()
  await contextMenuItem(mainWindow, 'Open terminal here').click()
  await expect(terminalCloses).toHaveCount(2)
})
