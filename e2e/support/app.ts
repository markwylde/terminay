import type { ElectronApplication, Page } from '@playwright/test'
import type { AppCommand } from '../../src/types/terminay'
import { ensureDialogStubs } from './dialogs'

export async function prepareWindow(page: Page): Promise<Page> {
  await page.waitForLoadState('domcontentloaded')
  await ensureDialogStubs(page)
  return page
}

export async function sendAppCommand(page: Page, command: AppCommand): Promise<void> {
  await page.evaluate(async (nextCommand) => {
    const bridge = window.terminayTest

    if (!bridge) {
      throw new Error('terminayTest bridge is unavailable')
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
  // Consume the initial Desktop window before listening for an auxiliary one.
  // On slower Linux runners the launch event can otherwise satisfy this wait.
  await electronApp.firstWindow()
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
      await window.terminaySettingsWindowHost?.open(nextOptions?.sectionId)
    }, options ?? null)
  })
}

export async function openMacrosWindow(
  electronApp: ElectronApplication,
  _page: Page,
): Promise<Page> {
  return openChildWindow(electronApp, async () => {
    await electronApp.evaluate(({ Menu }) => {
      const visit = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
        for (const item of items) {
          if (item.label === 'Macros') return item
          const nested = item.submenu == null ? undefined : visit(item.submenu.items)
          if (nested !== undefined) return nested
        }
        return undefined
      }
      visit(Menu.getApplicationMenu()?.items ?? [])?.click()
    })
  })
}
