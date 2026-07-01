import { stat } from 'node:fs/promises'
import { expect, test } from './fixtures'
import {
  contextMenuItem,
  fileExplorerItem,
  openFileExplorer,
  setProjectRoot,
  submitFileExplorerNameModal,
} from './support/ui'

function folderViewButton(page: Parameters<typeof test>[0]['mainWindow'], name: string) {
  return page.locator('.folder-viewer__view-button').filter({ hasText: name }).first()
}

test('folder panel supports view modes navigation and refresh', async ({ createWorkspace, mainWindow }) => {
  const workspace = await createWorkspace({
    name: 'folder-panel',
    seed: {
      directories: ['gallery-folder', 'gallery-folder/sub'],
      files: {
        'gallery-folder/inner.txt': 'inside folder\n',
        'gallery-folder/sub/nested.txt': 'nested contents\n',
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
  const listHeader = mainWindow.locator('.folder-viewer__list-header')
  await expect(listHeader).toContainText('Name')
  await expect(listHeader).toContainText('Type')
  await expect(listHeader).toContainText('Size')
  await expect(listHeader).toContainText('Date Modified')
  await expect(listHeader).toContainText('Date Created')
  await expect(listHeader).toContainText('Permissions')
  const innerRow = mainWindow.locator('.folder-viewer__list-row').filter({ hasText: 'inner.txt' })
  await expect(innerRow).toContainText('text/plain')
  await expect(innerRow).toContainText('14 B')
  await expect(innerRow).toContainText(/-r[w-][x-]/)
  const subRow = mainWindow.locator('.folder-viewer__list-row').filter({ hasText: 'sub' })
  await expect(subRow).toContainText('folder')
  await expect(subRow).toContainText('16 B')

  const upRow = mainWindow.locator('.folder-viewer__list-row--up')
  await expect(upRow).toBeVisible()
  await upRow.dblclick()
  const workspaceName = workspace.rootDir.split('/').filter(Boolean).pop() as string
  await expect(mainWindow.locator('.folder-viewer__title')).toHaveText(workspaceName)

  await mainWindow.locator('.folder-viewer__path-button').click()
  const pathInput = mainWindow.locator('.folder-viewer__path-input')
  await pathInput.fill(workspace.path('gallery-folder'))
  await pathInput.press('Enter')
  await expect(mainWindow.locator('.folder-viewer__title')).toHaveText('gallery-folder')

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
  const rowNames = mainWindow.locator(
    '.folder-viewer__list-row:not(.folder-viewer__list-header):not(.folder-viewer__list-row--up) .folder-viewer__list-name',
  )
  await expect(rowNames.nth(0)).toContainText('sub')
  await expect(rowNames.nth(1)).toContainText('fresh.txt')
  await mainWindow.locator('.folder-viewer__list-sort').filter({ hasText: 'Name' }).click()
  await expect(rowNames.nth(1)).toContainText('inner.txt')
  await mainWindow.locator('.folder-viewer__list-sort').filter({ hasText: 'Name' }).click()
  await expect(rowNames.nth(1)).toContainText('fresh.txt')

  await mainWindow.locator('.folder-viewer__list-row').filter({ hasText: 'fresh.txt' }).dblclick()
  await expect(mainWindow.locator('.file-preview-text')).toContainText('after refresh')
})

test('folder panel aggregates markdown tasks recursively', async ({ createWorkspace, mainWindow }) => {
  const workspace = await createWorkspace({
    name: 'folder-panel-tasks',
    seed: {
      directories: ['work/nested', 'work/dist'],
      files: {
        'work/plan.md': ['# Plan', '', '- [x] Root done', '- [ ] Root todo', ''].join('\n'),
        'work/nested/roadmap.md': [
          '# Roadmap',
          '',
          '## Phase 1',
          '',
          '- [ ] Nested todo',
          '- [x] Nested done',
          '',
        ].join('\n'),
        'work/dist/ignored.md': ['# Build output', '', '- [ ] Ignored todo', ''].join('\n'),
      },
    },
  })

  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)

  await fileExplorerItem(mainWindow, 'work').dblclick()
  await folderViewButton(mainWindow, 'Tasks').click()

  await expect(mainWindow.locator('.file-tasks__summary')).toContainText('2 done')
  await expect(mainWindow.locator('.file-tasks__summary')).toContainText('2 remaining')
  await expect(mainWindow.locator('.file-tasks__summary')).toContainText('2 files')
  await expect(mainWindow.locator('.folder-tasks__file-header').filter({ hasText: 'plan.md' })).toContainText('.')
  await expect(mainWindow.locator('.folder-tasks__file-header').filter({ hasText: 'roadmap.md' })).toContainText('nested')
  await expect(mainWindow.locator('.folder-tasks')).not.toContainText('Ignored todo')
  await mainWindow.locator('.folder-tasks__file-header').filter({ hasText: 'plan.md' }).click({ button: 'right' })
  await expect(contextMenuItem(mainWindow, 'Copy path')).toBeVisible()
  await expect(contextMenuItem(mainWindow, 'Copy relative path')).toBeVisible()
  await expect(contextMenuItem(mainWindow, 'Open shell in folder')).toBeVisible()
  await expect(contextMenuItem(mainWindow, 'Reveal in OS')).toBeVisible()
  await mainWindow.keyboard.press('Escape')

  await workspace.writeText('work/nested/fresh.md', ['# Fresh', '', '- [ ] Watched nested task', ''].join('\n'))
  await expect(mainWindow.locator('.file-tasks__summary')).toContainText('3 remaining')
  await expect(mainWindow.locator('.folder-tasks__file-header').filter({ hasText: 'fresh.md' })).toBeVisible()

  await mainWindow.locator('.folder-tasks__file-header').filter({ hasText: 'roadmap.md' }).dblclick()
  await expect(mainWindow.locator('.file-mode-switcher__button--active')).toHaveText('Tasks')
  await expect(mainWindow.locator('.file-tasks__summary')).toContainText('1 done')
  await expect(mainWindow.locator('.file-tasks__summary')).toContainText('1 remaining')
})

test('folder task groups can be sorted recursively', async ({ createWorkspace, mainWindow }) => {
  const workspace = await createWorkspace({
    name: 'folder-panel-task-sort',
    seed: {
      directories: ['work'],
      files: {
        'work/sorted.md': [
          '# Sortable Plan',
          '',
          '## Parent',
          '',
          '### Alpha',
          '',
          '- [ ] Alpha todo',
          '',
          '### Zebra',
          '',
          '- [x] Zebra done',
          '',
        ].join('\n'),
      },
    },
  })

  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)
  await fileExplorerItem(mainWindow, 'work').dblclick()
  await folderViewButton(mainWindow, 'Tasks').click()

  const titles = mainWindow.locator('.file-tasks__section-title')
  await expect(titles.filter({ hasText: 'Zebra' })).toBeVisible()
  await expect(titles.filter({ hasText: 'Alpha' })).toBeVisible()
  let sectionTitles = await titles.allTextContents()
  expect(sectionTitles.indexOf('Zebra')).toBeLessThan(sectionTitles.indexOf('Alpha'))

  await mainWindow.getByLabel('Sort task groups').selectOption('name')
  sectionTitles = await titles.allTextContents()
  expect(sectionTitles.indexOf('Alpha')).toBeLessThan(sectionTitles.indexOf('Zebra'))
})

test('folder panel context menu mirrors file operations', async ({ createWorkspace, mainWindow }) => {
  const workspace = await createWorkspace({
    name: 'folder-panel-ops',
    seed: {
      directories: ['ops-folder', 'ops-folder/actions-dir'],
      files: {
        'ops-folder/folder-file.txt': 'folder file\n',
      },
    },
  })
  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)
  await fileExplorerItem(mainWindow, 'ops-folder').dblclick()
  await expect(mainWindow.locator('.folder-viewer__title')).toHaveText('ops-folder')
  const actionsDirSummary = mainWindow.locator('.folder-viewer__tree-summary').filter({ hasText: 'actions-dir' })
  const refreshButton = mainWindow.locator('.folder-viewer__action').filter({ hasText: 'Refresh' }).first()
  await actionsDirSummary.click()

  await actionsDirSummary.click({ button: 'right' })
  await expect(contextMenuItem(mainWindow, 'Copy path')).toBeVisible()
  await expect(contextMenuItem(mainWindow, 'Copy relative path')).toBeVisible()
  await expect(contextMenuItem(mainWindow, 'Open shell in folder')).toBeVisible()
  await expect(contextMenuItem(mainWindow, 'New File')).toBeVisible()
  await contextMenuItem(mainWindow, 'New File').click()
  await submitFileExplorerNameModal(mainWindow, 'File name', 'panel-created.txt')
  await expect.poll(() => workspace.readText('ops-folder/actions-dir/panel-created.txt')).toBe('')
  await mainWindow.getByLabel('Close file tab').click()

  await actionsDirSummary.click({ button: 'right' })
  await expect(contextMenuItem(mainWindow, 'New Folder')).toBeVisible()
  await contextMenuItem(mainWindow, 'New Folder').click()
  await submitFileExplorerNameModal(mainWindow, 'Folder name', 'panel-created-folder')
  await expect.poll(async () => (await stat(workspace.path('ops-folder', 'actions-dir', 'panel-created-folder'))).isDirectory()).toBe(true)

  await mainWindow.locator('.folder-viewer__tree-file').filter({ hasText: 'folder-file.txt' }).click({ button: 'right' })
  await expect(contextMenuItem(mainWindow, 'Rename')).toBeVisible()
  await contextMenuItem(mainWindow, 'Rename').click()
  await submitFileExplorerNameModal(mainWindow, 'Name', 'folder-file-renamed.txt')
  await expect.poll(() => workspace.readText('ops-folder/folder-file-renamed.txt')).toBe('folder file\n')
  await refreshButton.click()
  await expect(mainWindow.locator('.folder-viewer__tree-file').filter({ hasText: 'folder-file-renamed.txt' })).toBeVisible()

  const terminalCloses = mainWindow.getByLabel('Close terminal')
  await expect(terminalCloses).toHaveCount(1)
  await actionsDirSummary.click({ button: 'right' })
  await expect(contextMenuItem(mainWindow, 'Open shell in folder')).toBeVisible()
  await contextMenuItem(mainWindow, 'Open shell in folder').click()
  await expect(terminalCloses).toHaveCount(2)
})
