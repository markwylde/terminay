import { expect} from '@playwright/test';
import { test } from './support/isolated-test';
import { startSharedWebShellFixture, type SharedWebShellFixture } from './support/shared-web-shell-fixture'

let fixture: SharedWebShellFixture
// One fixture instance owns this file; keep its tests in declaration order
// when other independent files share the container's worker pool.
test.describe.configure({ mode: 'default' });

test.beforeAll(async () => { fixture = await startSharedWebShellFixture() })
test.afterAll(async () => { await fixture.close() })

for (const viewport of [
  { name: 'wide', width: 1280, height: 900 },
  { name: 'narrow', width: 390, height: 844 },
]) {
  test(`all shared auxiliary route bodies render at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto(`${fixture.origin}/e2e/fixtures/shared-auxiliary-routes.html`)
    // Macros is a Settings collection category, not a route body of its own.
    await expect(page.locator('[data-shared-route-body="settings"]')).toHaveCount(2)
    await expect(page.locator('[data-shared-route-body="macros"]')).toHaveCount(0)
    for (const route of ['recordings', 'edit-tab']) {
      await expect(page.locator(`[data-shared-route-body="${route}"]`)).toHaveCount(1)
    }
    const collection = page.locator('[data-proof="collection"] .settings-shell')
    await expect(collection).toHaveAttribute('data-settings-layout', viewport.name === 'wide' ? 'columns' : 'narrow')
    if (viewport.name === 'wide') {
      await expect(collection.locator('.settings-list-column')).toBeVisible()
      await expect(collection.getByRole('button', { name: /Deploy/ })).toHaveAttribute('aria-current', 'true')
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
}
