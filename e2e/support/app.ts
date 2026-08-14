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
    const host = window.terminayHost
    if (!host) throw new Error('canonical Terminay host is unavailable')
    const context = await host.getContext()
    await host.requestAction({
      bridgeVersion: context.hostBridgeVersion,
      profileId: context.profileId,
      schemaVersion: context.schemaVersion,
      serverId: context.serverId,
      sourceId: context.sourceId,
      userGesture: true,
      windowId: context.windowId,
      action: { command: nextCommand, type: 'menu.invoke' },
    })
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

export async function presentNativeRoute(
  page: Page,
  route: string,
  logicalViewId: string,
): Promise<void> {
  await page.evaluate(async ({ nextLogicalViewId, nextRoute }) => {
    const host = window.terminayHost
    if (!host) throw new Error('canonical Terminay host is unavailable')
    const context = await host.getContext()
    await host.requestAction({
      bridgeVersion: context.hostBridgeVersion,
      profileId: context.profileId,
      schemaVersion: context.schemaVersion,
      serverId: context.serverId,
      sourceId: context.sourceId,
      userGesture: true,
      windowId: context.windowId,
      action: {
        disposition: 'native-window',
        logicalViewId: nextLogicalViewId,
        route: nextRoute,
        type: 'route.present',
      },
    })
  }, { nextLogicalViewId: logicalViewId, nextRoute: route })
}

export async function openSettingsWindow(
  electronApp: ElectronApplication,
  page: Page,
  options?: { sectionId?: string },
): Promise<Page> {
  return openChildWindow(electronApp, async () => {
    const section = options?.sectionId
    await presentNativeRoute(
      page,
      section ? `/settings/${encodeURIComponent(section)}` : '/settings',
      'settings',
    )
  })
}

export async function openProjectEnvironmentsWindow(
  electronApp: ElectronApplication,
  page: Page,
): Promise<Page> {
  return openChildWindow(electronApp, () =>
    presentNativeRoute(page, '/project-environments', 'project-environments'),
  )
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
