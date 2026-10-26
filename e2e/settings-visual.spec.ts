import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

// Screenshots for the Settings visual pass. They assert the shared layout
// lines (one header band height across columns) and attach images for review.

async function shoot(page: Page, name: string, testInfo: import('@playwright/test').TestInfo) {
  await page.waitForTimeout(250)
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

for (const scheme of ['dark', 'light'] as const) {
  test(`Settings categories in ${scheme} mode`, async ({ appHarness, mainWindow }, testInfo) => {
    for (const [sectionId, label] of [
      ['appearance', 'appearance'],
      ['remote', 'remote-access'],
      ['macros', 'macros'],
      ['extensions', 'extensions'],
    ] as const) {
      const settings = await appHarness.openSettingsWindow({ page: mainWindow, sectionId })
      await settings.emulateMedia({ colorScheme: scheme })
      await settings.setViewportSize({ width: 1280, height: 820 })
      await expect(settings.locator('.settings-shell')).toBeVisible()
      const headers = settings.locator('.settings-column-header')
      const boxes = await headers.evaluateAll((nodes) =>
        nodes
          .filter((node) => (node as HTMLElement).offsetParent !== null)
          .map((node) => node.getBoundingClientRect())
          .map((rect) => ({ top: Math.round(rect.top), height: Math.round(rect.height) })),
      )
      expect(new Set(boxes.map((box) => box.top)).size).toBe(1)
      expect(new Set(boxes.map((box) => box.height)).size).toBe(1)
      await shoot(settings, `${scheme}-${label}-1280`, testInfo)
      if (sectionId !== 'appearance') {
        await settings.setViewportSize({ width: 760, height: 820 })
        await expect(settings.locator('.settings-shell')).toHaveAttribute('data-settings-layout', 'narrow')
        await shoot(settings, `${scheme}-${label}-narrow`, testInfo)
      }
      await settings.close()
    }
  })
}
