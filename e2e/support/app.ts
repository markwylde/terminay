import type { ElectronApplication, Page } from '@playwright/test'
import type { AppCommand } from '../../src/types/termide'
import { ensureDialogStubs } from './dialogs'

export async function prepareWindow(page: Page): Promise<Page> {
  await page.waitForLoadState('domcontentloaded')
  await ensureDialogStubs(page)
  return page
}

export async function sendAppCommand(page: Page, command: AppCommand): Promise<void> {
  await page.evaluate(async (nextCommand) => {
    const bridge = window.termideTest

    if (!bridge) {
      throw new Error('termideTest bridge is unavailable')
    }

    await bridge.sendAppCommand(nextCommand)
  }, command)
}

export async function openMacroLauncher(page: Page, options?: { attempts?: number }): Promise<void> {
  const launcher = page.getByRole('dialog', { name: 'Command bar' })
  const attempts = options?.attempts ?? 3

  for (let attempt = 0; attempt < attempts; attempt++) {
    await sendAppCommand(page, 'open-command-bar')

    try {
      await launcher.waitFor({ state: 'visible', timeout: 2_000 })
      return
    } catch (error) {
      if (attempt === attempts - 1) {
        throw error
      }
    }
  }
}

export async function openChildWindow(
  electronApp: ElectronApplication,
  action: () => Promise<void>,
): Promise<Page> {
  const nextWindowPromise = electronApp.waitForEvent('window')
  await action()
  const nextWindow = await nextWindowPromise
  return prepareWindow(nextWindow)
}

export async function openSettingsWindow(
  electronApp: ElectronApplication,
  page: Page,
  options?: { sectionId?: string },
): Promise<Page> {
  return openChildWindow(electronApp, async () => {
    await page.evaluate(async (nextOptions) => {
      await window.termide.openSettingsWindow(nextOptions)
    }, options ?? null)
  })
}

export async function openMacrosWindow(
  electronApp: ElectronApplication,
  page: Page,
): Promise<Page> {
  return openChildWindow(electronApp, async () => {
    await page.evaluate(async () => {
      await window.termide.openMacrosWindow()
    })
  })
}
