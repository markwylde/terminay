import type { Locator, Page } from '@playwright/test'
import { expect } from '../fixtures'

export async function longPress(locator: Locator, durationMs = 600): Promise<void> {
  const box = await locator.boundingBox()
  if (!box) throw new Error('Expected a layout box for long-press')
  const page = locator.page()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(durationMs)
  await page.mouse.up()
}

async function closeEditWindowWithButton(editWindow: Page, label: 'Save' | 'Cancel'): Promise<void> {
  const editor = editWindow.getByRole('dialog').filter({
    has: editWindow.getByRole('heading', { name: /Edit (Project|Terminal) Tab/ }),
  })
  await editor.getByRole('button', { name: label }).click()
  await expect(editor).toHaveCount(0)
}

export async function openProjectEditWindow(page: Page): Promise<Page> {
  await page.locator('.project-tab--active').evaluate((element) => {
    element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }))
  })
  await expect(page.getByRole('heading', { name: 'Edit Project Tab' })).toBeVisible()
  return page
}

export async function openTerminalEditWindow(page: Page): Promise<Page> {
  await page.locator('.project-workspace--active .terminal-tab-content--active').evaluate((element) => {
    element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }))
  })
  await expect(page.getByRole('heading', { name: 'Edit Terminal Tab' })).toBeVisible()
  return page
}

export async function setProjectRoot(page: Page, rootPath: string): Promise<void> {
  const editWindow = await openProjectEditWindow(page)
  await expect(editWindow.getByRole('heading', { name: 'Edit Project Tab' })).toBeVisible()
  await editWindow.getByPlaceholder('Enter folder path').fill(rootPath)
  await closeEditWindowWithButton(editWindow, 'Save')
}

export async function submitEditWindow(editWindow: Page): Promise<void> {
  await closeEditWindowWithButton(editWindow, 'Save')
}

export async function cancelEditWindow(editWindow: Page): Promise<void> {
  await closeEditWindowWithButton(editWindow, 'Cancel')
}

export async function openFileExplorer(page: Page): Promise<void> {
  await expect(page.locator('.project-workspace--active')).toBeVisible()
  const sidebar = page.locator(
    '.project-workspace--active .file-explorer-sidebar',
  )
  if (!(await sidebar.isVisible())) {
    const toggle = page.getByLabel('Toggle file explorer')
    await expect(toggle).toBeVisible()
    await toggle.click()
  }

  await expect(sidebar).toBeVisible()
}

export async function selectSidebarGroup(
  page: Page,
  group: 'explorer' | 'documentation' | 'agents',
): Promise<void> {
  await openFileExplorer(page)
  const label =
    group === 'explorer'
      ? 'Explorer'
      : group === 'documentation'
        ? 'Documentation'
        : 'Agents'
  const tab = page
    .locator('.project-workspace--active')
    .getByRole('tab', { name: label })
  await expect(tab).toBeVisible()
  await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
}

export function fileExplorerItem(page: Page, name: string) {
  return page.locator('.file-explorer-tree-item').filter({ hasText: name }).first()
}

export async function activateDockTab(page: Page, title: string): Promise<void> {
  const tab = page
    .locator('.terminal-tab-content')
    .filter({ has: page.locator('.terminal-tab-title', { hasText: title }) })
    .first()

  await tab.click()
  await expect(tab).toHaveClass(/terminal-tab-content--active/)
}

export function contextMenuItem(page: Page, name: string) {
  return page.locator('.context-menu__item').filter({ hasText: name }).first()
}

export async function submitFileExplorerNameModal(page: Page, label: string, value: string): Promise<void> {
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox', { name: label }).fill(value)
  await dialog.getByRole('button', { name: /^(Create File|Create Folder|Rename)$/ }).click()
  await expect(dialog).toHaveCount(0)
}

export async function setMonacoValue(page: Page, value: string): Promise<void> {
  await page.locator('.monaco-editor').click()
  await page.evaluate((nextValue) => {
    const monacoApi = (window as Window & {
      monaco?: {
        editor?: {
          getModels: () => Array<{ setValue: (value: string) => void }>
        }
      }
    }).monaco
    const model = monacoApi?.editor?.getModels()?.at(-1)

    if (!model) {
      throw new Error('No Monaco model is available')
    }

    model.setValue(nextValue)
  }, value)
}

export async function openRemoteMenu(page: Page): Promise<void> {
  // Responsive shells may retain an inactive copy of the workspace. Operate
  // only on the menu belonging to the currently visible shell.
  const menu = page.locator('[role="menu"][aria-label="Connection menu"]:visible').first()
  if (await menu.isVisible().catch(() => false)) {
    return
  }

  await page.getByLabel('Open connection menu').click()
  await expect(menu).toBeVisible()
}
