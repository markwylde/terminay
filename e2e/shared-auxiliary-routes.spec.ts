import { expect, test } from '@playwright/test'
import { startSharedWebShellFixture, type SharedWebShellFixture } from './support/shared-web-shell-fixture'

let fixture: SharedWebShellFixture
test.beforeAll(async () => { fixture = await startSharedWebShellFixture() })
test.afterAll(async () => { await fixture.close() })

for (const viewport of [
  { name: 'wide', width: 1280, height: 900 },
  { name: 'narrow', width: 390, height: 844 },
]) {
  test(`all shared auxiliary route bodies render at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto(`${fixture.origin}/e2e/fixtures/shared-auxiliary-routes.html`)
    for (const route of ['settings', 'macros', 'recordings', 'edit-tab']) {
      await expect(page.locator(`[data-shared-route-body="${route}"]`)).toHaveCount(1)
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
}
