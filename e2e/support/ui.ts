import type { Page } from '@playwright/test'
import { expect } from '../fixtures'

export async function setProjectRoot(page: Page, rootPath: string): Promise<void> {
  await page.locator('.project-tab--active').dblclick()
  const modal = page.locator('.project-edit-modal')
  await expect(modal).toBeVisible()
  await modal.locator('label', { hasText: 'Root Folder' }).locator('input').fill(rootPath)
  await modal.getByRole('button', { name: 'Save' }).click()
  await expect(modal).toHaveCount(0)
}

export async function openFileExplorer(page: Page): Promise<void> {
  const sidebar = page.locator('.file-explorer-sidebar')
  if (!(await sidebar.count())) {
    await page.getByLabel('Toggle file explorer').click()
  }

  await expect(sidebar).toBeVisible()
}

export function fileExplorerItem(page: Page, name: string) {
  return page.locator('.file-explorer-tree-item').filter({ hasText: name }).first()
}

export function contextMenuItem(page: Page, name: string) {
  return page.locator('.context-menu__item').filter({ hasText: name }).first()
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
  const menu = page.getByRole('menu', { name: 'Remote access menu' })
  if (await menu.isVisible().catch(() => false)) {
    return
  }

  await page.getByLabel('Open remote access menu').click()
  await expect(menu).toBeVisible()
}
