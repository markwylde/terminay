import { expect, test } from './fixtures'
import { openFileExplorer, setProjectRoot } from './support/ui'

test('Documentation groups Markdown by folder and opens the rich document surface', async ({ createWorkspace, mainWindow }) => {
  const workspace = await createWorkspace({
    name: 'documentation-sidebar-editor',
    seed: {
      directories: ['docs/guides'],
      files: {
        'README.md': '# Read me',
        'docs/guides/getting-started.md': '---\ntitle: Getting Started\n---\n\n# Hello',
      },
    },
  })
  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)
  const documentationPane = mainWindow.locator('.project-workspace--active .sidebar-pane').filter({
    has: mainWindow.locator('.sidebar-pane__title', { hasText: 'Documentation' }),
  })
  await documentationPane.locator('.sidebar-pane__header').click()
  await expect(mainWindow.getByRole('tree')).toBeVisible()
  await mainWindow.getByRole('treeitem', { name: /docs/ }).click()
  await mainWindow.getByRole('treeitem', { name: /guides/ }).click()
  await mainWindow.getByRole('treeitem', { name: /Getting Started/ }).click()
  await expect(mainWindow.locator('.documentation-editor')).toBeVisible()
})
