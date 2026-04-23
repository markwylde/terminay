import type { Page } from '@playwright/test'
import { expect } from '../fixtures'
import { prepareWindow } from './app'

async function openChildWindowFromAction(page: Page, action: () => Promise<void>): Promise<Page> {
  const nextPagePromise = page.context().waitForEvent('page')
  await action()
  const nextPage = await nextPagePromise
  return prepareWindow(nextPage)
}

async function closeEditWindowWithButton(editWindow: Page, label: 'Save' | 'Cancel'): Promise<void> {
  const closePromise = editWindow.waitForEvent('close')
  try {
    await editWindow.getByRole('button', { name: label }).dispatchEvent('click')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('Target page, context or browser has been closed')) {
      throw error
    }
  }
  await closePromise
}

export async function openProjectEditWindow(page: Page): Promise<Page> {
  return openChildWindowFromAction(page, async () => {
    await page.locator('.project-tab--active').dblclick()
  })
}

export async function openTerminalEditWindow(page: Page): Promise<Page> {
  return openChildWindowFromAction(page, async () => {
    await page.locator('.terminal-tab-content').first().dblclick()
  })
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
  const sidebar = page.locator('.file-explorer-sidebar')
  if (!(await sidebar.count())) {
    await page.getByLabel('Toggle file explorer').click()
  }

  await expect(sidebar).toBeVisible()
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
