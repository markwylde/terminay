import { access, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { fileExplorerItem, setProjectRoot } from './support/ui'

const TARGET_REPO = '/Users/mark/Documents/Projects/terminay/terminay'

async function targetRepoAvailable(): Promise<boolean> {
  try {
    await access(join(TARGET_REPO, '.git'))
    return true
  } catch {
    return false
  }
}

async function getActiveSessionId(page: Page): Promise<string> {
  const sessionId = await page.locator('.terminal-panel').first().getAttribute('data-terminay-terminal-session-id')

  if (!sessionId) {
    throw new Error('Active terminal session id is unavailable')
  }

  return sessionId
}

async function writeToActiveTerminal(page: Page, data: string): Promise<void> {
  const sessionId = await getActiveSessionId(page)
  await page.evaluate(async ({ nextData, nextSessionId }) => {
    await window.terminayTest!.writeServerTerminal(nextSessionId, nextData)
  }, { nextData: data, nextSessionId: sessionId })
}

test('local repro: git panel refreshes after Cmd+O then Cmd+R into the terminay main repo', async ({ mainWindow }) => {
  test.skip(!(await targetRepoAvailable()), `${TARGET_REPO} is not available on this machine`)

  const nonRepo = await mkdtemp(join(tmpdir(), 'terminay-local-git-panel-non-repo-'))
  try {
    await writeFile(join(nonRepo, 'plain.txt'), 'not a git repository\n', 'utf8')
    const expectedRoot = await realpath(TARGET_REPO)
    const sessionId = await getActiveSessionId(mainWindow)
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

    await setProjectRoot(mainWindow, nonRepo)

    await mainWindow.locator('.terminal-panel').first().click()
    const cwdReady = `cwd-ready-${sessionId}`
    await writeToActiveTerminal(
      mainWindow,
      `cd ${JSON.stringify(TARGET_REPO)} && printf ${JSON.stringify(cwdReady)}\r`,
    )
    await expect(mainWindow.locator('.terminal-panel').filter({ hasText: cwdReady })).toBeVisible()
    await expect
      .poll(async () => {
        return mainWindow.evaluate(async (nextSessionId) => {
          return window.terminayTest!.getServerTerminalCwd(nextSessionId)
        }, sessionId)
      })
      .toMatchObject({ cwd: expectedRoot, source: 'observed' })

    await mainWindow.keyboard.press(`${modifier}+O`)

    const gitPane = mainWindow
      .locator('.project-workspace--active .sidebar-pane')
      .filter({ has: mainWindow.locator('.sidebar-pane__title', { hasText: 'Git' }) })
    await expect(gitPane.locator('.git-panel__message')).toHaveText('Not a git repository', { timeout: 6000 })

    await mainWindow.keyboard.press(`${modifier}+R`)

    await expect
      .poll(async () => {
        return mainWindow.evaluate(async (nextSessionId) => {
          return window.terminayTest!.getServerGitWorkspace(nextSessionId)
        }, sessionId)
      })
      .toMatchObject({
        binding: {
          projectRoot: expectedRoot,
          repositoryRoot: expectedRoot,
          state: 'ready',
          worktreeRoot: expectedRoot,
        },
        projectRoot: expectedRoot,
        worktrees: {
          repositoryRoot: expectedRoot,
          state: 'ready',
        },
      })
    await expect(mainWindow.locator('.project-workspace--active')).toHaveAttribute('data-terminay-project-root', expectedRoot)
    await expect(fileExplorerItem(mainWindow, 'src')).toBeVisible()
    const worktree = gitPane.locator('.worktrees-panel__worktree').filter({ hasText: 'terminay' }).first()
    await expect(worktree).toBeVisible({ timeout: 6000 })
    await expect(gitPane.locator('.git-panel__message').filter({ hasText: 'Not a git repository' })).toHaveCount(0)
  } finally {
    await rm(nonRepo, { recursive: true, force: true })
  }
})
