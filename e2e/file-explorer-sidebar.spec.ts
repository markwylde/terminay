import { execFile } from 'node:child_process'
import { rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { expect, test } from './fixtures'
import {
  contextMenuItem,
  fileExplorerItem,
  openFileExplorer,
  selectFileView,
  setProjectRoot,
  submitFileExplorerNameModal,
} from './support/ui'
import {
  activeFolderWorkspace,
  changesPane,
  folderGroup,
  folderNames,
  folderRow,
  foldersColumn,
  openFolderMenu,
  projectRootOnScreen,
  selectFolder,
} from './support/folders'
import { submitTerminalCommand } from './support/terminal'
import { readDiagnosticEvents } from './support/local-desktop-diagnostics'

const execFileAsync = promisify(execFile)

async function getActiveSessionId(page: Parameters<typeof openFileExplorer>[0]): Promise<string> {
  const sessionId = await page.locator('.terminal-panel').first().getAttribute('data-terminay-terminal-session-id')

  if (!sessionId) {
    throw new Error('Active terminal session id is unavailable')
  }

  return sessionId
}

async function writeToActiveTerminal(page: Parameters<typeof openFileExplorer>[0], data: string): Promise<void> {
  await submitTerminalCommand(page, data)
}

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
  await selectFileView(mainWindow, 'Preview')
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

  let fileViewerOpened = false
  for (let attempt = 0; attempt < 4 && !fileViewerOpened; attempt += 1) {
    const targetBox = await tabBar.boundingBox()
    if (!targetBox) {
      throw new Error('Expected file explorer item and dock tab bar to have layout boxes')
    }
    await fileItem.dragTo(tabBar, {
      force: true,
      targetPosition: { x: targetBox.width - 24, y: targetBox.height / 2 },
    })
    fileViewerOpened = await mainWindow
      .locator('.file-mode-switcher')
      .waitFor({ state: 'visible', timeout: 3_000 })
      .then(() => true, () => false)
  }

  await selectFileView(mainWindow, 'Preview')
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

  const dragFolderToTabBar = async (): Promise<void> => {
    const targetBox = await tabBar.boundingBox()
    if (!targetBox) {
      throw new Error('Expected file explorer folder and dock tab bar to have layout boxes')
    }
    await folderItem.dragTo(tabBar, {
      force: true,
      targetPosition: { x: targetBox.width - 24, y: targetBox.height / 2 },
    })
  }

  let folderViewerOpened = false
  for (let attempt = 0; attempt < 4 && !folderViewerOpened; attempt += 1) {
    await dragFolderToTabBar()
    folderViewerOpened = await mainWindow
      .locator('.folder-viewer__title')
      .waitFor({ state: 'visible', timeout: 3_000 })
      .then(() => true, () => false)
  }

  // Chromium can drop synthetic drag sequences while a sharded Electron
  // renderer is busy. Each retry is a complete user gesture with a fresh
  // target layout; the resulting panel contract remains strict.
  await expect(mainWindow.locator('.folder-viewer__title')).toHaveText('drag-folder', { timeout: 15_000 })
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

test('file explorer context menu supports create rename delete and path actions', async ({
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
  await expect(contextMenuItem(mainWindow, 'Copy path')).toBeVisible()
  await expect(contextMenuItem(mainWindow, 'Copy relative path')).toBeVisible()
  await expect(contextMenuItem(mainWindow, 'Open shell in folder')).toBeVisible()
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
  await expect(contextMenuItem(mainWindow, 'Open shell in folder')).toBeVisible()
  await contextMenuItem(mainWindow, 'Open shell in folder').click()
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

test('Changes pane lists grouped working tree changes and opens a diff', async ({
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
  const branch = (
    await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: workspace.rootDir })
  ).stdout.trim()

  // A staged new file, an unstaged modification, and an untracked file.
  await workspace.writeText('staged-new.txt', 'staged\n')
  await execFileAsync('git', ['add', 'staged-new.txt'], { cwd: workspace.rootDir })
  await workspace.writeText('README.md', 'initial readme\nwith edits\n')
  await workspace.writeText('untracked.txt', 'brand new\n')

  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)

  // General is the checkout at the project root: its row names the branch,
  // and Changes reports that one worktree.
  await expect(folderRow(mainWindow, 'General').locator('.folders-tree__branch')).toHaveText(branch, {
    timeout: 6000,
  })
  const changes = changesPane(mainWindow)
  await expect(changes.locator('.changes-pane__branch-name')).toHaveText(branch)

  // The Staged Changes group lists the added file with an "A" badge.
  const stagedGroup = changes.locator('.git-panel__group').filter({ hasText: 'Staged Changes' })
  const stagedRow = stagedGroup.locator('.git-panel__row').filter({ hasText: 'staged-new.txt' })
  await expect(stagedRow).toBeVisible({ timeout: 6000 })
  await expect(stagedRow.locator('.git-panel__badge')).toHaveText('A')
  await stagedRow.click({ button: 'right' })
  await expect(contextMenuItem(mainWindow, 'Copy path')).toBeVisible()
  await expect(contextMenuItem(mainWindow, 'Copy relative path')).toBeVisible()
  await expect(contextMenuItem(mainWindow, 'Open shell in folder')).toBeVisible()
  await expect(contextMenuItem(mainWindow, 'Rename')).toBeVisible()
  await expect(contextMenuItem(mainWindow, 'Delete')).toBeVisible()
  await expect(contextMenuItem(mainWindow, 'Reveal in OS')).toHaveCount(0)
  await expect(contextMenuItem(mainWindow, 'Create new file')).toHaveCount(0)
  await mainWindow.keyboard.press('Escape')

  // The Changes group lists the modified and untracked files.
  const changesGroup = changes.locator('.git-panel__group').filter({ hasText: /^Changes/ })
  const modifiedRow = changesGroup.locator('.git-panel__row').filter({ hasText: 'README.md' })
  const untrackedRow = changesGroup.locator('.git-panel__row').filter({ hasText: 'untracked.txt' })
  await expect(modifiedRow.locator('.git-panel__badge')).toHaveText('M')
  await expect(untrackedRow.locator('.git-panel__badge')).toHaveText('U')

  // Modified files are colour-coded amber, matching the file tree.
  await expect(modifiedRow.locator('.git-panel__icon')).toHaveCSS('color', 'rgb(226, 192, 141)')

  // The pane header counts the changes of this worktree. The sweep of clean
  // worktrees lives with the list of folders, and with only the main worktree
  // there is nothing it may target.
  await expect(changes.locator('.sidebar-pane__count')).toHaveText('3')
  await foldersColumn(mainWindow).getByRole('button', { name: 'Tabs actions' }).click()
  await expect(contextMenuItem(mainWindow, 'Delete all clean worktrees')).toBeDisabled()
  await mainWindow.keyboard.press('Escape')
  await expect(changes).not.toHaveClass(/sidebar-pane--collapsed/)

  // Clicking a tracked change opens it in the file viewer's Diff mode, even
  // for Markdown, which otherwise opens as a document.
  await modifiedRow.click()
  await expect(mainWindow.getByLabel('Close file tab')).toHaveCount(1)
  await expect(mainWindow.locator('.file-mode-switcher__button--active')).toHaveText('Diff')
  await expect(mainWindow.locator('.documentation-editor')).toHaveCount(0)

  // Collapsing the Changes pane hides the change list...
  await changes.locator('.sidebar-pane__header').click()
  await expect(changes.locator('.git-panel__row')).toHaveCount(0)
  await expect(changes).toHaveClass(/sidebar-pane--collapsed/)
})

test('Changes pane shows no changes for a clean repository', async ({ createWorkspace, mainWindow }) => {
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

  const changes = changesPane(mainWindow)
  await expect(changes.locator('.git-panel__message')).toHaveText('No changes', { timeout: 6000 })
  await expect(changes.locator('.git-panel__row')).toHaveCount(0)

  // The worktree actions of the root checkout are on General's own menu.
  await openFolderMenu(mainWindow, 'General')
  await expect(contextMenuItem(mainWindow, 'Pull from origin')).toBeVisible()
  await mainWindow.keyboard.press('Escape')
})

test('selecting a linked folder opens a file from its worktree without changing the project root', async ({
  createWorkspace,
  mainWindow,
}) => {
  const mainRepo = await createWorkspace({
    name: 'git-pane-cross-worktree-main',
    seed: { files: { 'README.md': 'main worktree\n' } },
  })
  const linkedWorktree = await createWorkspace({ name: 'git-pane-cross-worktree-linked' })
  // A linked folder is named by its worktree's branch.
  const linkedName = 'cross-worktree-file-open'

  await rm(linkedWorktree.rootDir, { recursive: true, force: true })
  await execFileAsync('git', ['init'], { cwd: mainRepo.rootDir })
  await execFileAsync('git', ['config', 'user.name', 'Terminay E2E'], { cwd: mainRepo.rootDir })
  await execFileAsync('git', ['config', 'user.email', 'terminay@example.com'], { cwd: mainRepo.rootDir })
  await execFileAsync('git', ['add', '.'], { cwd: mainRepo.rootDir })
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: mainRepo.rootDir })
  await execFileAsync('git', ['worktree', 'add', '-b', 'cross-worktree-file-open', linkedWorktree.rootDir], {
    cwd: mainRepo.rootDir,
  })
  await linkedWorktree.writeText('30-local-desktop-diagnostics.md', '# Worktree task\n\nOpened safely.\n')

  await setProjectRoot(mainWindow, mainRepo.rootDir)
  await openFileExplorer(mainWindow)
  await expect(folderRow(mainWindow, linkedName)).toBeVisible({ timeout: 6000 })
  const projectRoot = await projectRootOnScreen(mainWindow)

  // General reports the root checkout, which does not hold the worktree's file.
  const worktreeFile = () =>
    changesPane(mainWindow).locator('.git-panel__row').filter({ hasText: '30-local-desktop-diagnostics.md' })
  await expect(changesPane(mainWindow).locator('.git-panel__message')).toHaveText('No changes', {
    timeout: 6000,
  })
  await expect(worktreeFile()).toHaveCount(0)

  // Selecting the worktree's folder points Changes at that worktree.
  await selectFolder(mainWindow, linkedName)
  await expect(changesPane(mainWindow).locator('.changes-pane__branch-name')).toHaveText(
    'cross-worktree-file-open',
    { timeout: 6000 },
  )
  await worktreeFile().click()

  // An untracked file has no diff, so it opens for reading. In a linked
  // folder Markdown opens in the File Viewer: the Documentation presentation
  // reads the project root, and would show the root checkout's file of the
  // same name under this worktree's title.
  const opened = mainWindow.locator('.project-workspace--active .file-panel:visible')
  await expect(opened).toContainText('Opened safely.', { timeout: 6000 })
  await expect(mainWindow.locator('.file-mode-switcher__button--active:visible')).toHaveText('Preview')
  await expect(mainWindow.locator('.documentation-editor:visible')).toHaveCount(0)
  await expect(mainWindow.locator('.file-panel--loading')).toHaveCount(0)
  await expect(mainWindow.locator('.error-banner')).toHaveCount(0)
  // The file opened as a panel of the worktree's folder, and nothing moved the
  // project's root to reach it.
  await expect(activeFolderWorkspace(mainWindow)).toHaveAttribute('data-terminay-folder-kind', 'linked')
  expect(await projectRootOnScreen(mainWindow)).toBe(projectRoot)
})

test('a linked folder drops its delta when the default branch absorbs it, and diagnostics record why', async ({
  createWorkspace,
  mainWindow,
  userDataDir,
}) => {
  // A branch is merged and the main checkout catches up. Nothing touches the
  // linked worktree, so only the default-branch move can clear its delta.
  const mainRepo = await createWorkspace({
    name: 'git-pane-default-branch-move',
    seed: { files: { 'README.md': 'main worktree\n', '.gitignore': '.claude/\n' } },
  })
  const linkedRoot = join(mainRepo.rootDir, '.claude', 'worktrees', 'merged-feature')
  const git = (args: string[], cwd = mainRepo.rootDir) => execFileAsync('git', args, { cwd })

  await git(['init', '-b', 'main'])
  await git(['config', 'user.name', 'Terminay E2E'])
  await git(['config', 'user.email', 'terminay@example.com'])
  await git(['add', '.'])
  await git(['commit', '-m', 'initial'])
  await git(['worktree', 'add', '-b', 'merged-feature', linkedRoot])
  await writeFile(join(linkedRoot, 'feature.txt'), '1\n2\n3\n', 'utf8')
  await git(['add', '.'], linkedRoot)
  await git(['commit', '-m', 'feature'], linkedRoot)

  await setProjectRoot(mainWindow, mainRepo.rootDir)
  await openFileExplorer(mainWindow)

  // The worktree is a linked folder, and its row carries the size of its
  // change against the default branch.
  const linked = folderGroup(mainWindow, 'merged-feature')
  await expect(linked.locator('.folders-tree__delta--additions')).toHaveText('+3', { timeout: 10_000 })

  await git(['merge', '--ff-only', 'merged-feature'])
  await expect(linked.locator('.folders-tree__delta--additions')).toHaveCount(0, { timeout: 15_000 })
  await expect(linked.locator('[data-change="clean"]')).toBeVisible()

  // The user's own reload is measured rather than answered from the cache.
  await mainWindow.getByRole('button', { name: 'Reload explorer' }).click()

  type Fields = Record<string, unknown>
  const measurements = async () =>
    (await readDiagnosticEvents(userDataDir))
      .filter((event) => event.event === 'local-server.git.measurement.completed')
      .map((event) => event.fields as Fields)
  await expect
    .poll(async () => (await measurements()).some((fields) => fields.raisedBy === 'refresh'), { timeout: 10_000 })
    .toBe(true)

  const events = await readDiagnosticEvents(userDataDir)
  const completed = await measurements()
  const moved = completed.find(
    (fields) => ((fields.changes as { byClass: Record<string, number> }).byClass['default-branch-ref'] ?? 0) > 0,
  )
  expect(moved, 'the default-branch move was recorded').toBeDefined()
  // Whichever asks first takes the claim: the watch's own refresh, or the
  // pane's listing raised by the main worktree's status event.
  expect(moved).toMatchObject({ claim: 'all', carried: 0 })
  expect(['watch', 'request']).toContain(moved?.raisedBy)
  expect(events.filter((event) => event.event === 'local-server.git.watch.opened').length).toBeGreaterThanOrEqual(2)
  expect(events.filter((event) => event.event === 'local-server.git.watch.failed')).toHaveLength(0)
  expect(events.filter((event) => event.event === 'local-server.git.cache.mismatch')).toHaveLength(0)

  const sync = events.filter(
    (event) => event.event === 'renderer.console' && event.message?.startsWith('[terminay] git.pane.sync '),
  )
  expect(sync.length).toBeGreaterThan(0)
  // The reload changed nothing on screen, so the pane counts it rather than
  // writing it; the applied synchronisations are what it records.
  expect(sync.some((event) => event.message?.includes('"outcome":"applied"'))).toBe(true)

  // Neither side names the project, the worktree, or the branch.
  const recorded = JSON.stringify([
    ...events.filter((event) => event.event.startsWith('local-server.git.')),
    ...sync,
  ])
  for (const value of [mainRepo.rootDir, 'merged-feature', 'git-pane-default-branch-move', 'feature.txt'])
    expect(recorded).not.toContain(value)
})

test('a directory of a linked folder is deleted from Changes without changing the project root', async ({
  appHarness,
  createWorkspace,
  mainWindow,
}) => {
  const mainRepo = await createWorkspace({
    name: 'git-pane-cross-worktree-delete-main',
    seed: { files: { 'README.md': 'main worktree\n' } },
  })
  const linkedWorktree = await createWorkspace({ name: 'git-pane-cross-worktree-delete-linked' })
  // A linked folder is named by its worktree's branch.
  const linkedName = 'cross-worktree-folder-delete'
  const dialogs = await appHarness.dialogs()

  await rm(linkedWorktree.rootDir, { recursive: true, force: true })
  await execFileAsync('git', ['init'], { cwd: mainRepo.rootDir })
  await execFileAsync('git', ['config', 'user.name', 'Terminay E2E'], { cwd: mainRepo.rootDir })
  await execFileAsync('git', ['config', 'user.email', 'terminay@example.com'], { cwd: mainRepo.rootDir })
  await execFileAsync('git', ['add', '.'], { cwd: mainRepo.rootDir })
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: mainRepo.rootDir })
  await execFileAsync('git', ['worktree', 'add', '-b', 'cross-worktree-folder-delete', linkedWorktree.rootDir], {
    cwd: mainRepo.rootDir,
  })
  await linkedWorktree.writeText('prototypes/overflow/index.html', '<p>untracked</p>\n')

  await setProjectRoot(mainWindow, mainRepo.rootDir)
  await openFileExplorer(mainWindow)
  await expect(folderRow(mainWindow, linkedName)).toBeVisible({ timeout: 6000 })
  const projectRoot = await projectRootOnScreen(mainWindow)

  await selectFolder(mainWindow, linkedName)
  const folder = changesPane(mainWindow).locator('.git-panel__folder').filter({ hasText: 'prototypes' })
  await expect(folder).toBeVisible({ timeout: 6000 })

  await dialogs.queueConfirm(true)
  await folder.click({ button: 'right' })
  await expect(contextMenuItem(mainWindow, 'Delete')).toBeVisible()
  await contextMenuItem(mainWindow, 'Delete').click()

  await expect(folder).toHaveCount(0, { timeout: 6000 })
  await expect(mainWindow.locator('.error-banner')).toHaveCount(0)
  await expect.poll(async () => {
    try {
      await linkedWorktree.readText('prototypes/overflow/index.html')
      return 'exists'
    } catch {
      return 'missing'
    }
  }).toBe('missing')
  // The delete ran in the folder's worktree; the project is still rooted where it was.
  expect(await projectRootOnScreen(mainWindow)).toBe(projectRoot)
  expect(await mainRepo.readText('README.md')).toBe('main worktree\n')
})


test('deleting a sibling worktree does not request its parent through Explorer', async ({
  appHarness,
  createWorkspace,
  mainWindow,
  userDataDir,
}) => {
  const mainRepo = await createWorkspace({
    name: 'git-pane-delete-worktree-main',
    seed: { files: { 'README.md': 'main worktree\n' } },
  })
  const linkedWorktree = await createWorkspace({
    name: 'git-pane-delete-worktree-linked',
  })
  const linkedName = basename(linkedWorktree.rootDir)
  const dialogs = await appHarness.dialogs()

  await rm(linkedWorktree.rootDir, { recursive: true, force: true })
  await execFileAsync('git', ['init'], { cwd: mainRepo.rootDir })
  await execFileAsync('git', ['config', 'user.name', 'Terminay E2E'], { cwd: mainRepo.rootDir })
  await execFileAsync('git', ['config', 'user.email', 'terminay@example.com'], { cwd: mainRepo.rootDir })
  await execFileAsync('git', ['add', '.'], { cwd: mainRepo.rootDir })
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: mainRepo.rootDir })
  await execFileAsync('git', ['worktree', 'add', '-b', 'delete-sibling-worktree', linkedWorktree.rootDir], {
    cwd: mainRepo.rootDir,
  })

  await setProjectRoot(mainWindow, mainRepo.rootDir)
  await openFileExplorer(mainWindow)

  // The worktree is a linked folder; deleting it is that folder's action.
  // It is named by its branch.
  const linked = folderRow(mainWindow, 'delete-sibling-worktree')
  await expect(linked).toBeVisible({ timeout: 6000 })

  await openFolderMenu(mainWindow, 'delete-sibling-worktree')
  await expect(contextMenuItem(mainWindow, 'Delete worktree')).toBeEnabled()
  await dialogs.queueConfirm(true)
  await contextMenuItem(mainWindow, 'Delete worktree').click()

  await expect(linked).toHaveCount(0, { timeout: 6000 })
  // Worktree removal publishes Git status before the follow-up Explorer
  // refresh settles. Its file-operation diagnostic is durable even if another
  // successful Explorer request immediately clears the visible banner.
  await mainWindow.waitForTimeout(1000)
  const explorerFailures = (await readDiagnosticEvents(userDataDir)).filter(
    (event) => event.event === 'local-server.file-operation.failed',
  )
  expect(explorerFailures).toHaveLength(0)
  const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd: mainRepo.rootDir })
  expect(stdout).not.toContain(linkedName)
})

test('deletes a locked agent worktree whose folder was already removed', async ({
  appHarness,
  createWorkspace,
  mainWindow,
}) => {
  // An agent session creates `.claude/worktrees/<name>`, locks it, and dies.
  // Removing the directory by hand leaves Git holding a locked registration
  // with no working tree; its folder must still be able to delete it.
  const mainRepo = await createWorkspace({
    name: 'git-pane-delete-lost-worktree',
    seed: { files: { 'README.md': 'main worktree\n' } },
  })
  const agentWorktree = join(mainRepo.rootDir, '.claude', 'worktrees', 'agent-session')
  const dialogs = await appHarness.dialogs()

  await execFileAsync('git', ['init'], { cwd: mainRepo.rootDir })
  await execFileAsync('git', ['config', 'user.name', 'Terminay E2E'], { cwd: mainRepo.rootDir })
  await execFileAsync('git', ['config', 'user.email', 'terminay@example.com'], { cwd: mainRepo.rootDir })
  await execFileAsync('git', ['add', '.'], { cwd: mainRepo.rootDir })
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: mainRepo.rootDir })
  await execFileAsync('git', ['worktree', 'add', '-b', 'agent-session', agentWorktree], {
    cwd: mainRepo.rootDir,
  })
  await execFileAsync('git', ['worktree', 'lock', '--reason', 'claude session agent-session (pid 1)', agentWorktree], {
    cwd: mainRepo.rootDir,
  })
  await rm(join(mainRepo.rootDir, '.claude'), { recursive: true, force: true })

  await setProjectRoot(mainWindow, mainRepo.rootDir)
  await openFileExplorer(mainWindow)

  const lost = folderGroup(mainWindow, 'agent-session')
  await expect(lost).toBeVisible({ timeout: 6000 })
  // A registration with no working tree is not "clean"; it is missing.
  await expect(lost.locator('.folders-tree__change')).toHaveText('missing')
  await expect(lost.locator('[data-change="clean"]')).toHaveCount(0)

  // Selecting it says what is wrong and what to do about it.
  await selectFolder(mainWindow, 'agent-session')
  await expect(changesPane(mainWindow).locator('.git-panel__message')).toHaveText(
    "Working tree is missing. Delete it to remove Git's record.",
    { timeout: 6000 },
  )

  // Nothing can be opened in a directory that is not there, but the record of
  // it can still be deleted.
  await dialogs.clearCalls()
  await openFolderMenu(mainWindow, 'agent-session')
  await expect(contextMenuItem(mainWindow, 'Open shell in folder')).toBeDisabled()
  await expect(contextMenuItem(mainWindow, 'Delete worktree')).toBeEnabled()
  await dialogs.queueConfirm(true)
  await contextMenuItem(mainWindow, 'Delete worktree').click()

  await expect(lost).toHaveCount(0, { timeout: 6000 })
  const confirms = (await dialogs.getCalls()).filter((call) => call.kind === 'confirm')
  expect(confirms).toHaveLength(1)
  expect(confirms[0].message).toContain('nothing on disk is deleted')
  await expect(mainWindow.locator('.error-banner')).toHaveCount(0)
  const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd: mainRepo.rootDir })
  expect(stdout).not.toContain('agent-session')
})

test('the Folders menu deletes every clean worktree and leaves changed ones alone', async ({
  appHarness,
  createWorkspace,
  mainWindow,
}) => {
  const mainRepo = await createWorkspace({
    name: 'git-pane-sweep-main',
    seed: { files: { 'README.md': 'main worktree\n' } },
  })
  const cleanOne = await createWorkspace({ name: 'git-pane-sweep-clean-one' })
  const cleanTwo = await createWorkspace({ name: 'git-pane-sweep-clean-two' })
  const dirty = await createWorkspace({ name: 'git-pane-sweep-dirty' })
  const dialogs = await appHarness.dialogs()
  const git = (args: string[], cwd = mainRepo.rootDir) => execFileAsync('git', args, { cwd })

  await git(['init'])
  await git(['config', 'user.name', 'Terminay E2E'])
  await git(['config', 'user.email', 'terminay@example.com'])
  await git(['add', '.'])
  await git(['commit', '-m', 'initial'])
  const worktreeBranches = [
    ['sweep-clean-one', cleanOne],
    ['sweep-clean-two', cleanTwo],
    ['sweep-dirty', dirty],
  ] as const
  for (const [branch, worktree] of worktreeBranches) {
    await rm(worktree.rootDir, { recursive: true, force: true })
    await git(['worktree', 'add', '-b', branch, worktree.rootDir])
  }
  await dirty.writeText('untracked.txt', 'work in progress\n')
  // An agent session locks the worktree it creates and leaves the lock behind.
  await git(['worktree', 'lock', '--reason', 'claude session (pid 1)', cleanTwo.rootDir])

  await setProjectRoot(mainWindow, mainRepo.rootDir)
  await openFileExplorer(mainWindow)

  // Every worktree is a linked folder, and its row says whether it is clean.
  // Each is named by its branch.
  const group = (worktree: { rootDir: string }) =>
    folderGroup(mainWindow, worktreeBranches.find(([, candidate]) => candidate === worktree)?.[0] ?? '')
  const clean = (worktree: { rootDir: string }) => group(worktree).locator('[data-change="clean"]')
  await expect(clean(cleanOne)).toBeVisible({ timeout: 6000 })
  await expect(clean(cleanTwo)).toBeVisible()
  await expect(group(dirty).locator('.folders-tree__change')).toBeVisible({ timeout: 6000 })
  await expect(clean(dirty)).toHaveCount(0, { timeout: 6000 })

  const openFoldersMenu = () =>
    foldersColumn(mainWindow).getByRole('button', { name: 'Tabs actions' }).click()

  // Declining the confirmation removes nothing.
  await dialogs.clearCalls()
  await dialogs.queueConfirm(false)
  await openFoldersMenu()
  await contextMenuItem(mainWindow, 'Delete all clean worktrees').click()
  const [declined] = await dialogs.getCalls()
  expect(declined.message).toMatch(/^Delete 2 clean worktrees\?/)
  expect(declined.message).toContain('git-pane-sweep-clean-one')
  expect(declined.message).toMatch(/git-pane-sweep-clean-two\S* \(locked\)/)
  expect(declined.message).not.toMatch(/git-pane-sweep-clean-one\S* \(locked\)/)
  expect(declined.message).not.toContain('git-pane-sweep-dirty')
  expect(declined.message).not.toContain('git-pane-sweep-main')
  await expect(group(cleanOne)).toBeVisible()

  await dialogs.clearCalls()
  await dialogs.queueConfirm(true)
  await openFoldersMenu()
  await contextMenuItem(mainWindow, 'Delete all clean worktrees').click()

  // The folders of the removed worktrees go with them; the changed one and
  // General, the root checkout, stay.
  await expect(group(cleanOne)).toHaveCount(0, { timeout: 10000 })
  await expect(group(cleanTwo)).toHaveCount(0, { timeout: 10000 })
  await expect(group(dirty)).toBeVisible()
  await expect(folderRow(mainWindow, 'General')).toBeVisible()
  // A full success is silent, the dirty worktree keeps its file, and branches survive.
  expect((await dialogs.getCalls()).filter((call) => call.kind === 'alert')).toHaveLength(0)
  expect(await dirty.readText('untracked.txt')).toBe('work in progress\n')
  const branches = (await git(['branch', '--format=%(refname:short)'])).stdout
  expect(branches).toContain('sweep-clean-one')
  expect(branches).toContain('sweep-clean-two')
})

test('Changes pane renders a nested tree, and the folder menu offers a push menu', async ({
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
  const defaultBranch = (
    await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: workspace.rootDir })
  ).stdout.trim()
  const featureBranch = 'feature/push-menu'
  await execFileAsync('git', ['checkout', '-b', featureBranch], { cwd: workspace.rootDir })

  await workspace.writeText('src/lib/util.ts', 'export const x = 2\n')
  await workspace.writeText('src/lib/new.ts', 'export const y = 3\n')

  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)

  const changes = changesPane(mainWindow)
  await expect(changes.locator('.changes-pane__branch-name')).toHaveText(featureBranch, { timeout: 6000 })

  // Tree is the default view: nested folder rows are rendered.
  const utilRow = changes.locator('.git-panel__row').filter({ hasText: 'util.ts' })
  await expect(utilRow).toBeVisible({ timeout: 6000 })
  // A single section has no redundant group header (the pane header covers it).
  await expect(changes.locator('.git-panel__group-header')).toHaveCount(0)
  await expect(changes.locator('.git-panel__folder-name').filter({ hasText: 'src' })).toBeVisible()
  await expect(changes.locator('.git-panel__folder-name').filter({ hasText: 'lib' })).toBeVisible()
  // In tree mode the row does not repeat the directory path.
  await expect(utilRow.locator('.git-panel__dir')).toHaveCount(0)

  // Collapsing the "lib" folder hides its files.
  await changes.locator('.git-panel__folder').filter({ hasText: 'lib' }).click()
  await expect(utilRow).toHaveCount(0)
  // Re-expand.
  await changes.locator('.git-panel__folder').filter({ hasText: 'lib' }).click()
  await expect(utilRow).toBeVisible()

  // Double-clicking a changed directory mirrors Explorer by opening a Folder
  // tab while leaving its disclosure state unchanged.
  const libFolder = changes.locator('.git-panel__folder').filter({ hasText: 'lib' })
  await libFolder.dblclick()
  await expect(mainWindow.getByLabel('Close folder tab')).toHaveCount(1)
  await expect(utilRow).toBeVisible()

  await libFolder.click({ button: 'right' })
  await expect(contextMenuItem(mainWindow, 'Create new file')).toBeVisible()
  await expect(contextMenuItem(mainWindow, 'Create new folder')).toBeVisible()
  await expect(contextMenuItem(mainWindow, 'Rename')).toBeVisible()
  await expect(contextMenuItem(mainWindow, 'Delete')).toBeVisible()
  await expect(contextMenuItem(mainWindow, 'Copy path')).toBeVisible()
  await expect(contextMenuItem(mainWindow, 'Copy relative path')).toBeVisible()
  await expect(contextMenuItem(mainWindow, 'Open shell in folder')).toBeVisible()
  await expect(contextMenuItem(mainWindow, 'Reveal in OS')).toHaveCount(0)
  await mainWindow.keyboard.press('Escape')

  // General's actions menu leads to the push-agent menu offering the four
  // commit-and-push actions for the root checkout.
  const actionsButton = folderRow(mainWindow, 'General').getByLabel('Actions for General')
  await expect(actionsButton).toBeVisible()
  await actionsButton.click()
  await contextMenuItem(mainWindow, 'Commit & push with AI…').click()

  const pushMenu = mainWindow.locator('.context-menu')
  const pushMenuHeadings = pushMenu.locator('.context-menu__heading')
  await expect(pushMenuHeadings.getByText(`Current Branch (${featureBranch})`, { exact: true })).toBeVisible()
  await expect(pushMenu.getByText('Push to current branch', { exact: true })).toBeVisible()
  await expect(pushMenu.getByText('Push to current branch + create PR')).toBeVisible()
  await expect(pushMenuHeadings.getByText('New Branch', { exact: true })).toBeVisible()
  await expect(pushMenu.getByText('Push to new branch', { exact: true })).toBeVisible()
  await expect(pushMenu.getByText('Push to new branch + create PR')).toBeVisible()
  await expect(pushMenuHeadings.getByText(`Default Branch (${defaultBranch})`, { exact: true })).toBeVisible()
  await expect(pushMenu.getByText('Push to default branch')).toBeVisible()

  await mainWindow.keyboard.press('Escape')
  await expect(pushMenu).toHaveCount(0)
})

test('sidebar state persists independently for each project after renderer reload', async ({
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

  // The Changes pane lives in whichever project workspace is currently active.
  const activeChangesPane = () => changesPane(mainWindow)

  // Collapse Changes only in project 1.
  const changesPane1 = activeChangesPane()
  await expect(changesPane1).toBeVisible()
  await expect(changesPane1).not.toHaveClass(/sidebar-pane--collapsed/)
  await changesPane1.locator('.sidebar-pane__header').click()
  await expect(changesPane1).toHaveClass(/sidebar-pane--collapsed/)
  // Project 2 starts with its own default state rather than inheriting project 1.
  await mainWindow.getByLabel('Create project').click()
  await expect(mainWindow.locator('.project-tab')).toHaveCount(2)
  await expect(mainWindow.locator('.project-tab--active')).toContainText('Project 2')
  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)
  const changesPane2 = activeChangesPane()
  await expect(changesPane2).toBeVisible()
  await expect(changesPane2).not.toHaveClass(/sidebar-pane--collapsed/)

  // A renderer reload hydrates the canonical project-local state.
  await mainWindow.reload()
  await expect(mainWindow.locator('.project-tab')).toHaveCount(2)
  await expect(mainWindow.locator('.project-tab--active')).toContainText('Project 2')
  await expect(activeChangesPane()).not.toHaveClass(/sidebar-pane--collapsed/)

  // Project 1 retains its own collapsed Changes pane after that reload.
  await mainWindow.locator('.project-tab').first().click()
  await expect(activeChangesPane()).toHaveClass(/sidebar-pane--collapsed/)
})

test('Changes pane reports when the folder is not in a git repository', async ({
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

  await expect(changesPane(mainWindow).locator('.git-panel__message')).toHaveText(
    'This folder is not in a Git repository',
    { timeout: 6000 },
  )
  // No Git action is offered where there is no repository.
  await expect(changesPane(mainWindow).locator('.sidebar-pane__action-button')).toHaveCount(0)
  await expect(folderRow(mainWindow, 'General').locator('.folders-tree__branch, .folders-tree__facts')).toHaveCount(0)
})

test('Files, Changes, and the Folders tree refresh after setting project root from terminal cwd', async ({
  appHarness,
  createWorkspace,
  mainWindow,
}) => {
  const nonRepo = await createWorkspace({
    name: 'git-pane-root-before',
    seed: {
      files: {
        'README.md': 'not a git repository\n',
      },
    },
  })
  const mainRepo = await createWorkspace({
    name: 'git-pane-main-repo',
    seed: {
      files: {
        'README.md': 'tracked readme\n',
      },
    },
  })
  const linkedWorktree = await createWorkspace({ name: 'git-pane-linked-worktree' })
  const sessionId = await getActiveSessionId(mainWindow)

  await rm(linkedWorktree.rootDir, { recursive: true, force: true })
  await execFileAsync('git', ['init'], { cwd: mainRepo.rootDir })
  await execFileAsync('git', ['config', 'user.name', 'Terminay E2E'], { cwd: mainRepo.rootDir })
  await execFileAsync('git', ['config', 'user.email', 'terminay@example.com'], { cwd: mainRepo.rootDir })
  await execFileAsync('git', ['add', '.'], { cwd: mainRepo.rootDir })
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: mainRepo.rootDir })
  await execFileAsync('git', ['worktree', 'add', '-b', 'server-client-architecture', linkedWorktree.rootDir], {
    cwd: mainRepo.rootDir,
  })

  await setProjectRoot(mainWindow, nonRepo.rootDir)
  await openFileExplorer(mainWindow)

  const changes = changesPane(mainWindow)
  const notARepository = changes
    .locator('.git-panel__message')
    .filter({ hasText: 'This folder is not in a Git repository' })
  await expect(notARepository).toBeVisible({ timeout: 6000 })
  await expect(folderNames(mainWindow)).toHaveText(['General'])

  const cwdReady = `cwd-ready-${sessionId}`
  await writeToActiveTerminal(
    mainWindow,
    `cd ${JSON.stringify(linkedWorktree.rootDir)} && printf ${JSON.stringify(cwdReady)}\r`,
  )
  await expect(mainWindow.locator('.terminal-panel').filter({ hasText: cwdReady })).toBeVisible()

  await mainWindow.locator('.terminal-panel').first().click()
  await appHarness.sendAppCommand('set-project-root-folder-to-working-directory')

  // The project is now rooted at the linked worktree. General stands for that
  // checkout: Files lists it and Changes reports its branch.
  await expect(activeFolderWorkspace(mainWindow)).toHaveAttribute(
    'data-terminay-project-root',
    linkedWorktree.rootDir,
  )
  await expect(fileExplorerItem(mainWindow, 'README.md')).toBeVisible()
  await expect(changes.locator('.changes-pane__branch-name')).toHaveText('server-client-architecture', {
    timeout: 6000,
  })
  await expect(notARepository).toHaveCount(0)
  await expect(folderRow(mainWindow, 'General').locator('.folders-tree__branch')).toHaveText(
    'server-client-architecture',
  )
  // Every other worktree of the repository gains its folder without a
  // restart: here, the main checkout the project is no longer rooted at.
  // It is named by the branch it is on.
  const { stdout: mainBranch } = await execFileAsync('git', ['branch', '--show-current'], {
    cwd: mainRepo.rootDir,
  })
  await expect(folderRow(mainWindow, mainBranch.trim())).toBeVisible({ timeout: 6000 })
})

test('Changes pane refreshes after keyboard sidebar open and keyboard root update', async ({
  createWorkspace,
  mainWindow,
}) => {
  const nonRepo = await createWorkspace({
    name: 'git-pane-keyboard-before',
    seed: {
      files: {
        'plain.txt': 'not a git repository\n',
      },
    },
  })
  const repo = await createWorkspace({
    name: 'git-pane-keyboard-after',
    seed: {
      files: {
        'README.md': 'tracked readme\n',
        'src/app.ts': 'export const value = 1\n',
      },
    },
  })
  const sessionId = await getActiveSessionId(mainWindow)
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

  await execFileAsync('git', ['init'], { cwd: repo.rootDir })
  await execFileAsync('git', ['config', 'user.name', 'Terminay E2E'], { cwd: repo.rootDir })
  await execFileAsync('git', ['config', 'user.email', 'terminay@example.com'], { cwd: repo.rootDir })
  await execFileAsync('git', ['add', '.'], { cwd: repo.rootDir })
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: repo.rootDir })
  const branch = (
    await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo.rootDir })
  ).stdout.trim()

  await setProjectRoot(mainWindow, nonRepo.rootDir)
  await mainWindow.locator('.terminal-panel').first().click()

  const cwdReady = `cwd-ready-${sessionId}`
  await writeToActiveTerminal(
    mainWindow,
    `cd ${JSON.stringify(repo.rootDir)} && printf ${JSON.stringify(cwdReady)}\r`,
  )
  await expect(mainWindow.locator('.terminal-panel').filter({ hasText: cwdReady })).toBeVisible()

  await mainWindow.keyboard.press(`${modifier}+O`)

  const changes = changesPane(mainWindow)
  const notARepository = changes
    .locator('.git-panel__message')
    .filter({ hasText: 'This folder is not in a Git repository' })
  await expect(notARepository).toBeVisible({ timeout: 6000 })

  await mainWindow.keyboard.press(`${modifier}+R`)

  await expect(fileExplorerItem(mainWindow, 'src')).toBeVisible()
  await expect(changes.locator('.changes-pane__branch-name')).toHaveText(branch, { timeout: 6000 })
  await expect(notARepository).toHaveCount(0)
  // General gains its Git presentation without the project being reopened.
  await expect(folderRow(mainWindow, 'General').locator('.folders-tree__branch')).toHaveText(branch)
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
