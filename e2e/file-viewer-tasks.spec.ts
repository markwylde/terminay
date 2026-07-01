import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test } from './fixtures'
import { fileExplorerItem, openFileExplorer, setProjectRoot } from './support/ui'

const execFileAsync = promisify(execFile)

const INITIAL_PLAN = [
  '# Project Plan',
  '',
  '## Phase 1',
  '',
  '- [x] Scaffold the module',
  '- [ ] Wire up the gateway',
  '- [ ] Write the tests',
  '',
  '## Phase 2',
  '',
  '- [ ] Ship it',
  '',
].join('\n')

const PROGRESSED_PLAN = [
  '# Project Plan',
  '',
  '## Phase 1',
  '',
  '- [x] Scaffold the module',
  '- [x] Wire up the gateway',
  '- [ ] Write the tests',
  '',
  '## Phase 2',
  '',
  '- [ ] Ship it',
  '',
].join('\n')

test('markdown files expose a Tasks tab with grouped stats and diff progress', async ({ createWorkspace, mainWindow }) => {
  const workspace = await createWorkspace({
    name: 'file-viewer-tasks',
    seed: {
      files: {
        'plan.md': INITIAL_PLAN,
        'notes.txt': 'plain text, no tasks tab here\n',
      },
    },
  })

  await execFileAsync('git', ['init'], { cwd: workspace.rootDir })
  await execFileAsync('git', ['config', 'user.email', 'e2e@example.com'], { cwd: workspace.rootDir })
  await execFileAsync('git', ['config', 'user.name', 'E2E'], { cwd: workspace.rootDir })
  await execFileAsync('git', ['add', 'plan.md'], { cwd: workspace.rootDir })
  await execFileAsync('git', ['commit', '-m', 'initial plan'], { cwd: workspace.rootDir })

  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)

  // Non-markdown files do not get a Tasks tab.
  await fileExplorerItem(mainWindow, 'notes.txt').dblclick()
  await expect(mainWindow.getByRole('tab', { name: 'Tasks' })).toHaveCount(0)

  await fileExplorerItem(mainWindow, 'plan.md').dblclick()
  await mainWindow.getByRole('tab', { name: 'Tasks' }).click()

  // One done, three remaining overall.
  await expect(mainWindow.locator('.file-tasks__summary')).toContainText('1 done')
  await expect(mainWindow.locator('.file-tasks__summary')).toContainText('3 remaining')

  // Grouped under headings with per-group counts. Target the section header (its
  // text is just the title) so "Phase 1" doesn't also match the enclosing H1 section.
  const phase1Badge = mainWindow
    .locator('.file-tasks__section-header', { hasText: 'Phase 1' })
    .locator('.file-tasks__badge-count')
  await expect(phase1Badge).toHaveText('1/3')
  await expect(mainWindow.locator('.file-tasks__item')).toHaveCount(4)

  // Completing a task in the working tree surfaces a diff badge.
  await workspace.writeText('plan.md', PROGRESSED_PLAN)
  await expect(mainWindow.locator('.file-tasks__summary')).toContainText('2 done')
  await expect(mainWindow.locator('.file-tasks__chip--diff')).toContainText('+1 in diff')
  await expect(phase1Badge).toHaveText('2/3')

  // Filtering to "Remaining" hides completed tasks but keeps the real group counts.
  await mainWindow.getByRole('tab', { name: 'Remaining' }).click()
  await expect(mainWindow.locator('.file-tasks__item')).toHaveCount(2)
  await expect(mainWindow.locator('.file-tasks__item--checked')).toHaveCount(0)
  await expect(phase1Badge).toHaveText('2/3')

  // "Done" shows the two completed items.
  await mainWindow.getByRole('tab', { name: 'Done' }).click()
  await expect(mainWindow.locator('.file-tasks__item')).toHaveCount(2)
  await expect(mainWindow.locator('.file-tasks__item:not(.file-tasks__item--checked)')).toHaveCount(0)
})

test('file task groups can be sorted recursively', async ({ createWorkspace, mainWindow }) => {
  const workspace = await createWorkspace({
    name: 'file-viewer-task-sort',
    seed: {
      files: {
        'sorted.md': [
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
  await fileExplorerItem(mainWindow, 'sorted.md').dblclick()
  await mainWindow.getByRole('tab', { name: 'Tasks' }).click()

  const titles = mainWindow.locator('.file-tasks__section-title')
  await expect(titles.filter({ hasText: 'Zebra' })).toBeVisible()
  await expect(titles.filter({ hasText: 'Alpha' })).toBeVisible()
  let sectionTitles = await titles.allTextContents()
  expect(sectionTitles.indexOf('Zebra')).toBeLessThan(sectionTitles.indexOf('Alpha'))

  await mainWindow.getByLabel('Sort task groups').selectOption('name')
  sectionTitles = await titles.allTextContents()
  expect(sectionTitles.indexOf('Alpha')).toBeLessThan(sectionTitles.indexOf('Zebra'))
})
