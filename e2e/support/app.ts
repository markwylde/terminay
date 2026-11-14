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
  options?: { sectionId?: string; itemId?: string },
): Promise<Page> {
  return openChildWindow(electronApp, async () => {
    const section = options?.sectionId
    const params = new URLSearchParams({ auxiliary: 'settings' })
    if (section) params.set('section', section)
    if (options?.itemId) params.set('item', options.itemId)
    await presentNativeRoute(
      page,
      `/?${params.toString()}`,
      'settings',
    )
  })
}

/** Settings › Macros, where macros are managed. */
export async function openMacrosSettings(
  electronApp: ElectronApplication,
  page: Page,
): Promise<Page> {
  return openSettingsWindow(electronApp, page, { sectionId: 'macros' })
}

/** Settings at one place's category. `place` is `device` for this device's
 * tile, or a server's name for its tile. The request opens the place that has
 * the category; the rail then moves to the named place when it differs. */
export async function openSettingsAt(
  electronApp: ElectronApplication,
  page: Page,
  place: 'device' | string,
  categoryId: string,
): Promise<Page> {
  const settings = await openSettingsWindow(electronApp, page, { sectionId: categoryId })
  const tile =
    place === 'device'
      ? settings.locator('[data-settings-place="device"]')
      : settings.locator(`[data-settings-place-name="${place}"]`)
  await tile.waitFor({ state: 'visible' })
  if ((await tile.getAttribute('aria-pressed')) !== 'true') await tile.click()
  return settings
}

/** Settings › This device › Servers, where saved servers are managed. */
export async function openServersSettings(
  electronApp: ElectronApplication,
  page: Page,
): Promise<Page> {
  return openSettingsWindow(electronApp, page, { sectionId: 'servers' })
}

/** Settings › a server › Remote Access, where that server's exposure is managed. */
export async function openRemoteAccessSettings(
  electronApp: ElectronApplication,
  page: Page,
): Promise<Page> {
  return openSettingsWindow(electronApp, page, { sectionId: 'remote' })
}
