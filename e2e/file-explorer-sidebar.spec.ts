import { execFile } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { promisify } from 'node:util'
import { expect, test } from './fixtures'
import {
  contextMenuItem,
  fileExplorerItem,
  openFileExplorer,
  setProjectRoot,
  submitFileExplorerNameModal,
} from './support/ui'

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

test('file explorer opens dragged files on the dock tab bar', async ({ createWorkspace, mainWindow }) => {
  const workspace = await createWorkspace({
    name: 'sidebar-drag-tabbar',
    seed: {
      files: {
        'drag-me.txt': 'opened from a tab bar drop\n',
      },
    },
  })

  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)

  const fileItem = fileExplorerItem(mainWindow, 'drag-me.txt')
  const tabBar = mainWindow.locator('.project-workspace--active .dv-tabs-and-actions-container').first()
  await expect(fileItem).toBeVisible()
  await expect(tabBar).toBeVisible()

  const sourceBox = await fileItem.boundingBox()
  const targetBox = await tabBar.boundingBox()
  if (!sourceBox || !targetBox) {
    throw new Error('Expected file explorer item and dock tab bar to have layout boxes')
  }

  await mainWindow.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await mainWindow.mouse.down()
  await mainWindow.mouse.move(sourceBox.x + sourceBox.width / 2 + 18, sourceBox.y + sourceBox.height / 2 + 18)
  await mainWindow.mouse.move(targetBox.x + targetBox.width - 24, targetBox.y + targetBox.height / 2)
  await expect(mainWindow.locator('.file-explorer-tab-drop-ghost')).toContainText('drag-me.txt')
  await mainWindow.mouse.up()

  await expect(mainWindow.locator('.file-preview-text')).toContainText('opened from a tab bar drop')
  await expect(mainWindow.getByLabel('Close file tab')).toHaveCount(1)
})

test('file explorer opens dragged folders on the dock tab bar', async ({ createWorkspace, mainWindow }) => {
  const workspace = await createWorkspace({
    name: 'sidebar-drag-folder-tabbar',
    seed: {
      directories: ['drag-folder'],
      files: {
        'drag-folder/inside.txt': 'opened from a dragged folder\n',
      },
    },
  })

  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)

  const folderItem = fileExplorerItem(mainWindow, 'drag-folder')
  const tabBar = mainWindow.locator('.project-workspace--active .dv-tabs-and-actions-container').first()
  await expect(folderItem).toBeVisible()
  await expect(tabBar).toBeVisible()

  const sourceBox = await folderItem.boundingBox()
  const targetBox = await tabBar.boundingBox()
  if (!sourceBox || !targetBox) {
    throw new Error('Expected file explorer folder and dock tab bar to have layout boxes')
  }

  await mainWindow.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await mainWindow.mouse.down()
  await mainWindow.mouse.move(sourceBox.x + sourceBox.width / 2 + 18, sourceBox.y + sourceBox.height / 2 + 18)
  await mainWindow.mouse.move(targetBox.x + targetBox.width - 24, targetBox.y + targetBox.height / 2)
  await expect(mainWindow.locator('.file-explorer-tab-drop-ghost')).toContainText('drag-folder')
  await mainWindow.mouse.up()

  await expect(mainWindow.locator('.folder-viewer__title')).toHaveText('drag-folder')
  await expect(mainWindow.getByLabel('Close folder tab')).toHaveCount(1)
  await expect(mainWindow.locator('.folder-viewer__tree-file').filter({ hasText: 'inside.txt' })).toBeVisible()
})

test('file explorer refreshes after external filesystem changes', async ({ createWorkspace, mainWindow }) => {
  const workspace = await createWorkspace({
    name: 'sidebar-external-refresh',
    seed: {
      directories: ['nested'],
      files: {
        'old.txt': 'old file\n',
      },
    },
  })

  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)

  await expect(fileExplorerItem(mainWindow, 'old.txt')).toBeVisible()
  await fileExplorerItem(mainWindow, 'nested').click()

  await workspace.writeText('created.txt', 'created externally\n')
  await workspace.writeText('nested/deep-created.txt', 'created externally\n')
  await rm(workspace.path('old.txt'))

  await expect(fileExplorerItem(mainWindow, 'created.txt')).toBeVisible()
  await expect(fileExplorerItem(mainWindow, 'deep-created.txt')).toBeVisible()
  await expect(fileExplorerItem(mainWindow, 'old.txt')).toHaveCount(0)
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

  await fileExplorerItem(mainWindow, 'target-dir').click({ button: 'right' })
  await expect(contextMenuItem(mainWindow, 'New File')).toBeVisible()
  await contextMenuItem(mainWindow, 'New File').click()
  await submitFileExplorerNameModal(mainWindow, 'File name', 'created.txt')
  await fileExplorerItem(mainWindow, 'target-dir').click()
  await expect(fileExplorerItem(mainWindow, 'created.txt')).toBeVisible()
  await expect.poll(() => workspace.readText('target-dir/created.txt')).toBe('')

  await fileExplorerItem(mainWindow, 'target-dir').click({ button: 'right' })
  await expect(contextMenuItem(mainWindow, 'New Folder')).toBeVisible()
  await contextMenuItem(mainWindow, 'New Folder').click()
  await submitFileExplorerNameModal(mainWindow, 'Folder name', 'created-folder')
  await expect(fileExplorerItem(mainWindow, 'created-folder')).toBeVisible()

  await fileExplorerItem(mainWindow, 'alpha.txt').click({ button: 'right' })
  await expect(contextMenuItem(mainWindow, 'Rename')).toBeVisible()
  await contextMenuItem(mainWindow, 'Rename').click()
  await submitFileExplorerNameModal(mainWindow, 'Name', 'renamed.txt')
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
  await execFileAsync('git', ['config', 'user.name', 'Terminay E2E'], { cwd: workspace.rootDir })
  await execFileAsync('git', ['config', 'user.email', 'terminay@example.com'], { cwd: workspace.rootDir })
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

test('git sidebar pane lists grouped working tree changes and opens a diff', async ({
  createWorkspace,
  mainWindow,
}) => {
  const workspace = await createWorkspace({
    name: 'git-pane-changes',
    seed: {
      directories: ['docs'],
      files: {
        'README.md': 'initial readme\n',
        'docs/guide.md': 'tracked guide\n',
      },
    },
  })

  await execFileAsync('git', ['init'], { cwd: workspace.rootDir })
  await execFileAsync('git', ['config', 'user.name', 'Terminay E2E'], { cwd: workspace.rootDir })
  await execFileAsync('git', ['config', 'user.email', 'terminay@example.com'], { cwd: workspace.rootDir })
  await execFileAsync('git', ['add', '.'], { cwd: workspace.rootDir })
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: workspace.rootDir })

  // A staged new file, an unstaged modification, and an untracked file.
  await workspace.writeText('staged-new.txt', 'staged\n')
  await execFileAsync('git', ['add', 'staged-new.txt'], { cwd: workspace.rootDir })
  await workspace.writeText('README.md', 'initial readme\nwith edits\n')
  await workspace.writeText('untracked.txt', 'brand new\n')

  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)

  const gitPane = mainWindow
    .locator('.sidebar-pane')
    .filter({ has: mainWindow.locator('.sidebar-pane__title', { hasText: 'Git' }) })

  // The Staged Changes group lists the added file with an "A" badge.
  const stagedGroup = gitPane.locator('.git-panel__group').filter({ hasText: 'Staged Changes' })
  const stagedRow = stagedGroup.locator('.git-panel__row').filter({ hasText: 'staged-new.txt' })
  await expect(stagedRow).toBeVisible({ timeout: 6000 })
  await expect(stagedRow.locator('.git-panel__badge')).toHaveText('A')

  // The Changes group lists the modified and untracked files.
  const changesGroup = gitPane.locator('.git-panel__group').filter({ hasText: /^Changes/ })
  const modifiedRow = changesGroup.locator('.git-panel__row').filter({ hasText: 'README.md' })
  const untrackedRow = changesGroup.locator('.git-panel__row').filter({ hasText: 'untracked.txt' })
  await expect(modifiedRow.locator('.git-panel__badge')).toHaveText('M')
  await expect(untrackedRow.locator('.git-panel__badge')).toHaveText('U')

  // Modified files are colour-coded amber, matching the file tree.
  await expect(modifiedRow.locator('.git-panel__icon')).toHaveCSS('color', 'rgb(226, 192, 141)')

  // The pane header shows the branch name and a total change count of 3.
  await expect(gitPane.locator('.sidebar-pane__count')).toHaveText('3')
  await expect(gitPane.locator('.sidebar-pane__branch')).toHaveText(/^(main|master)$/)

  // Clicking a tracked change opens it in the file viewer.
  await modifiedRow.click()
  await expect(mainWindow.getByLabel('Close file tab')).toHaveCount(1)

  // Collapsing the Git pane hides the change list.
  await gitPane.locator('.sidebar-pane__header').click()
  await expect(gitPane.locator('.git-panel__row')).toHaveCount(0)
})

test('git sidebar pane shows no changes for a clean repository', async ({ createWorkspace, mainWindow }) => {
  const workspace = await createWorkspace({
    name: 'git-pane-clean',
    seed: {
      files: {
        'README.md': 'initial readme\n',
      },
    },
  })

  await execFileAsync('git', ['init'], { cwd: workspace.rootDir })
  await execFileAsync('git', ['config', 'user.name', 'Terminay E2E'], { cwd: workspace.rootDir })
  await execFileAsync('git', ['config', 'user.email', 'terminay@example.com'], { cwd: workspace.rootDir })
  await execFileAsync('git', ['add', '.'], { cwd: workspace.rootDir })
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: workspace.rootDir })

  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)

  const gitPane = mainWindow
    .locator('.sidebar-pane')
    .filter({ has: mainWindow.locator('.sidebar-pane__title', { hasText: 'Git' }) })

  await expect(gitPane.locator('.git-panel__message')).toHaveText('No changes', { timeout: 6000 })
  await expect(gitPane.locator('.git-panel__row')).toHaveCount(0)
})

test('git sidebar pane renders a nested tree and offers a push menu', async ({
  createWorkspace,
  mainWindow,
}) => {
  const workspace = await createWorkspace({
    name: 'git-pane-tree',
    seed: {
      directories: ['src/lib'],
      files: {
        'src/lib/util.ts': 'export const x = 1\n',
      },
    },
  })

  await execFileAsync('git', ['init'], { cwd: workspace.rootDir })
  await execFileAsync('git', ['config', 'user.name', 'Terminay E2E'], { cwd: workspace.rootDir })
  await execFileAsync('git', ['config', 'user.email', 'terminay@example.com'], { cwd: workspace.rootDir })
  await execFileAsync('git', ['add', '.'], { cwd: workspace.rootDir })
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: workspace.rootDir })

  await workspace.writeText('src/lib/util.ts', 'export const x = 2\n')
  await workspace.writeText('src/lib/new.ts', 'export const y = 3\n')

  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)

  const gitPane = mainWindow
    .locator('.sidebar-pane')
    .filter({ has: mainWindow.locator('.sidebar-pane__title', { hasText: 'Git' }) })

  // Tree is the default view: nested folder rows are rendered.
  const utilRow = gitPane.locator('.git-panel__row').filter({ hasText: 'util.ts' })
  await expect(utilRow).toBeVisible({ timeout: 6000 })
  // A single section has no redundant group header (the "Git" pane header covers it).
  await expect(gitPane.locator('.git-panel__group-header')).toHaveCount(0)
  await expect(gitPane.locator('.git-panel__folder-name').filter({ hasText: 'src' })).toBeVisible()
  await expect(gitPane.locator('.git-panel__folder-name').filter({ hasText: 'lib' })).toBeVisible()
  // In tree mode the row does not repeat the directory path.
  await expect(utilRow.locator('.git-panel__dir')).toHaveCount(0)

  // Collapsing the "lib" folder hides its files.
  await gitPane.locator('.git-panel__folder').filter({ hasText: 'lib' }).click()
  await expect(utilRow).toHaveCount(0)
  // Re-expand.
  await gitPane.locator('.git-panel__folder').filter({ hasText: 'lib' }).click()
  await expect(utilRow).toBeVisible()

  // The sidebar header exposes a push-agent menu (replacing the old
  // tree/list toggle) offering the four commit-and-push actions.
  const pushButton = gitPane.getByLabel('Commit and push with an AI agent')
  await expect(pushButton).toBeVisible()
  await pushButton.click()

  const pushMenu = mainWindow.locator('.context-menu')
  await expect(pushMenu.getByText('Push to current branch', { exact: true })).toBeVisible()
  await expect(pushMenu.getByText('Push to current branch + PR')).toBeVisible()
  await expect(pushMenu.getByText('Push to new branch', { exact: true })).toBeVisible()
  await expect(pushMenu.getByText('Push to new branch + PR')).toBeVisible()

  await mainWindow.keyboard.press('Escape')
  await expect(pushMenu).toHaveCount(0)
})

test('collapsing a pane seeds new projects but leaves open projects untouched', async ({
  createWorkspace,
  mainWindow,
}) => {
  const workspace = await createWorkspace({
    name: 'sidebar-default-state',
    seed: {
      files: {
        'README.md': 'initial\n',
      },
    },
  })

  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)

  // The Git pane lives in whichever project workspace is currently active.
  const activeGitPane = () =>
    mainWindow
      .locator('.project-workspace--active .sidebar-pane')
      .filter({ has: mainWindow.locator('.sidebar-pane__title', { hasText: 'Git' }) })

  // Collapse the Git pane in project 1.
  const gitPane1 = activeGitPane()
  await expect(gitPane1).toBeVisible()
  await expect(gitPane1).not.toHaveClass(/sidebar-pane--collapsed/)
  await gitPane1.locator('.sidebar-pane__header').click()
  await expect(gitPane1).toHaveClass(/sidebar-pane--collapsed/)
  // Let the updated default-state setting persist/broadcast before creating a project.
  await mainWindow.waitForTimeout(400)

  // A newly created project inherits the collapsed-by-default Git pane.
  await mainWindow.getByLabel('Add project tab').click()
  await setProjectRoot(mainWindow, workspace.rootDir)
  await mainWindow.getByLabel('Toggle file explorer').click()
  const gitPane2 = activeGitPane()
  await expect(gitPane2).toBeVisible()
  await expect(gitPane2).toHaveClass(/sidebar-pane--collapsed/)

  // Expanding Git in project 2 flips the default back to expanded...
  await gitPane2.locator('.sidebar-pane__header').click()
  await expect(gitPane2).not.toHaveClass(/sidebar-pane--collapsed/)

  // ...but project 1, already open, keeps its own collapsed Git pane.
  await mainWindow.locator('.project-tab').first().click()
  await expect(activeGitPane()).toHaveClass(/sidebar-pane--collapsed/)
})

test('git sidebar pane reports when the folder is not a git repository', async ({
  createWorkspace,
  mainWindow,
}) => {
  const workspace = await createWorkspace({
    name: 'git-pane-non-repo',
    seed: {
      files: {
        'README.md': 'no git here\n',
      },
    },
  })

  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)

  const gitPane = mainWindow
    .locator('.sidebar-pane')
    .filter({ has: mainWindow.locator('.sidebar-pane__title', { hasText: 'Git' }) })

  await expect(gitPane.locator('.git-panel__message')).toHaveText('Not a git repository', { timeout: 6000 })
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
  await execFileAsync('git', ['config', 'user.name', 'Terminay E2E'], { cwd: workspace.rootDir })
  await execFileAsync('git', ['config', 'user.email', 'terminay@example.com'], { cwd: workspace.rootDir })
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
