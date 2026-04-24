import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test } from './fixtures'
import { contextMenuItem, fileExplorerItem, openFileExplorer, setProjectRoot } from './support/ui'

const execFileAsync = promisify(execFile)

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

test('file explorer colors git new and modified files like VS Code', async ({ createWorkspace, mainWindow }) => {
  const workspace = await createWorkspace({
    name: 'sidebar-git-status',
    seed: {
      directories: ['src/components', 'docs'],
      files: {
        'README.md': 'initial readme\n',
        'src/components/Button.tsx': 'export const Button = () => null\n',
        'docs/guide.md': 'tracked guide\n',
      },
    },
  })

  await execFileAsync('git', ['init'], { cwd: workspace.rootDir })
  await execFileAsync('git', ['config', 'user.name', 'Termide E2E'], { cwd: workspace.rootDir })
  await execFileAsync('git', ['config', 'user.email', 'termide@example.com'], { cwd: workspace.rootDir })
  await execFileAsync('git', ['add', '.'], { cwd: workspace.rootDir })
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: workspace.rootDir })

  await workspace.writeText('README.md', 'initial readme\nwith edits\n')
  await workspace.writeText('docs/guide.md', 'tracked guide\nupdated\n')
  await workspace.writeText('src/components/NewBadge.tsx', 'export const NewBadge = () => null\n')

  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)

  const readme = fileExplorerItem(mainWindow, 'README.md')
  const srcFolder = fileExplorerItem(mainWindow, 'src')
  const docsFolder = fileExplorerItem(mainWindow, 'docs')

  await expect(readme).toBeVisible()
  await expect(readme.locator('.file-explorer-tree-name')).toHaveCSS('color', 'rgb(226, 192, 141)')
  await expect(srcFolder.locator('.file-explorer-tree-name')).toHaveCSS('color', 'rgb(115, 201, 145)')
  await expect(docsFolder.locator('.file-explorer-tree-name')).toHaveCSS('color', 'rgb(226, 192, 141)')
})

test('file explorer refreshes git colors after external changes', async ({ createWorkspace, mainWindow }) => {
  const workspace = await createWorkspace({
    name: 'sidebar-git-status-refresh',
    seed: {
      files: {
        'README.md': 'initial readme\n',
      },
    },
  })

  await execFileAsync('git', ['init'], { cwd: workspace.rootDir })
  await execFileAsync('git', ['config', 'user.name', 'Termide E2E'], { cwd: workspace.rootDir })
  await execFileAsync('git', ['config', 'user.email', 'termide@example.com'], { cwd: workspace.rootDir })
  await execFileAsync('git', ['add', '.'], { cwd: workspace.rootDir })
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: workspace.rootDir })

  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)

  const readmeName = fileExplorerItem(mainWindow, 'README.md').locator('.file-explorer-tree-name')
  await expect(readmeName).toBeVisible()
  await expect(readmeName).not.toHaveCSS('color', 'rgb(226, 192, 141)')

  await workspace.writeText('README.md', 'initial readme\nwith external edits\n')

  await expect(readmeName).toHaveCSS('color', 'rgb(226, 192, 141)', { timeout: 6000 })
})
