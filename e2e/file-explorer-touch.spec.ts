import type { CDPSession, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { contextMenuItem, fileExplorerItem, openFileExplorer, setProjectRoot } from './support/ui'

const HOLD_MS = 1_200

type Point = { x: number; y: number }

async function touchSession(page: Page): Promise<CDPSession> {
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  return session
}

async function touch(session: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', point?: Point) {
  await session.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: point ? [{ x: point.x, y: point.y, id: 1 }] : [],
  })
}

async function touchMoveTo(session: CDPSession, from: Point, to: Point, steps = 12): Promise<void> {
  for (let step = 1; step <= steps; step += 1) {
    await touch(session, 'touchMove', {
      x: from.x + ((to.x - from.x) * step) / steps,
      y: from.y + ((to.y - from.y) * step) / steps,
    })
  }
}

async function centerOf(page: Page, name: string): Promise<Point> {
  const box = await fileExplorerItem(page, name).boundingBox()
  if (!box) throw new Error(`Expected ${name} to have a layout box`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function explorerScrollTop(page: Page): Promise<number> {
  return page.locator('.project-workspace--active .file-explorer-tree').evaluate((tree) => {
    for (let node: HTMLElement | null = tree; node; node = node.parentElement) {
      if (node.scrollHeight > node.clientHeight && getComputedStyle(node).overflowY !== 'visible') {
        return node.scrollTop
      }
    }
    return -1
  })
}

function manyFiles(): Record<string, string> {
  const files: Record<string, string> = {}
  for (let index = 0; index < 120; index += 1) {
    files[`file-${String(index).padStart(3, '0')}.txt`] = `touch file ${index}\n`
  }
  return files
}

test('a touch that moves within a second scrolls the explorer instead of dragging', async ({
  createWorkspace,
  mainWindow,
}) => {
  const workspace = await createWorkspace({ name: 'explorer-touch-scroll', seed: { files: manyFiles() } })
  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)
  await expect(fileExplorerItem(mainWindow, 'file-010.txt')).toBeVisible()
  expect(await explorerScrollTop(mainWindow)).toBe(0)

  const session = await touchSession(mainWindow)
  const start = await centerOf(mainWindow, 'file-010.txt')
  await touch(session, 'touchStart', start)
  await touchMoveTo(session, start, { x: start.x, y: start.y - 200 })
  await expect(mainWindow.locator('.file-explorer-tree-drag-preview')).toHaveCount(0)
  await touch(session, 'touchEnd')

  await expect.poll(() => explorerScrollTop(mainWindow)).toBeGreaterThan(0)
  await expect(mainWindow.locator('.file-explorer-tree-item--dragging')).toHaveCount(0)
  await expect(mainWindow.getByLabel('Close file tab')).toHaveCount(0)
})

test('a touch held still for a second drags the entry to the tab bar', async ({ createWorkspace, mainWindow }) => {
  const workspace = await createWorkspace({
    name: 'explorer-touch-drag',
    seed: { files: { 'touch-drag.txt': 'opened by a touch drag\n' } },
  })
  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)
  const item = fileExplorerItem(mainWindow, 'touch-drag.txt')
  await expect(item).toBeVisible()

  const tabBar = mainWindow.locator('.project-workspace--active .dv-tabs-and-actions-container').first()
  const tabBox = await tabBar.boundingBox()
  if (!tabBox) throw new Error('Expected the dock tab bar to have a layout box')

  const session = await touchSession(mainWindow)
  const start = await centerOf(mainWindow, 'touch-drag.txt')
  await touch(session, 'touchStart', start)
  await mainWindow.waitForTimeout(HOLD_MS)
  await expect(item).toHaveClass(/file-explorer-tree-item--drag-armed/)
  const end = { x: tabBox.x + tabBox.width - 24, y: tabBox.y + tabBox.height / 2 }
  await touchMoveTo(session, start, end, 20)
  await expect(mainWindow.locator('.file-explorer-tree-drag-preview')).toBeVisible()
  await touch(session, 'touchEnd')

  await expect(mainWindow.locator('.file-preview-text')).toContainText('opened by a touch drag')
})

test('a touch held still for a second and released opens the entry menu', async ({
  createWorkspace,
  mainWindow,
}) => {
  const workspace = await createWorkspace({
    name: 'explorer-touch-menu',
    seed: { files: { 'touch-menu.txt': 'menu\n' } },
  })
  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)
  await expect(fileExplorerItem(mainWindow, 'touch-menu.txt')).toBeVisible()

  const session = await touchSession(mainWindow)
  await touch(session, 'touchStart', await centerOf(mainWindow, 'touch-menu.txt'))
  await mainWindow.waitForTimeout(HOLD_MS)
  await touch(session, 'touchEnd')

  await expect(contextMenuItem(mainWindow, 'Rename')).toBeVisible()
  await expect(mainWindow.getByLabel('Close file tab')).toHaveCount(0)
})

test('a quick touch tap still activates the entry', async ({ createWorkspace, mainWindow }) => {
  const workspace = await createWorkspace({
    name: 'explorer-touch-tap',
    seed: { directories: ['tap-folder'], files: { 'tap-folder/inside.txt': 'inside\n' } },
  })
  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)
  await expect(fileExplorerItem(mainWindow, 'tap-folder')).toBeVisible()

  const session = await touchSession(mainWindow)
  await touch(session, 'touchStart', await centerOf(mainWindow, 'tap-folder'))
  await touch(session, 'touchEnd')

  await expect(fileExplorerItem(mainWindow, 'inside.txt')).toBeVisible()
  await expect(mainWindow.locator('.context-menu__item')).toHaveCount(0)
})
