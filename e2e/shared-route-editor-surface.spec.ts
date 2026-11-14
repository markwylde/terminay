import { expect} from '@playwright/test';
import { test } from './support/isolated-test';
import { startSharedWebShellFixture, type SharedWebShellFixture } from './support/shared-web-shell-fixture'

let fixture: SharedWebShellFixture
// One fixture instance owns this file; keep its tests in declaration order
// when other independent files share the container's worker pool.
test.describe.configure({ mode: 'default' });

test.beforeAll(async () => { fixture = await startSharedWebShellFixture() })
test.afterAll(async () => { await fixture.close() })

for (const viewport of [{ name: 'wide', width: 1280, height: 900, layout: 'wide' }, { name: 'medium', width: 900, height: 900, layout: 'medium' }, { name: 'narrow', width: 390, height: 820, layout: 'narrow' }] as const) {
	test(`shared route editors are host-neutral at ${viewport.name} width`, async ({ page }) => {
		await page.setViewportSize(viewport)
		await page.goto(`${fixture.origin}/e2e/fixtures/shared-route-editor-surface.html`)
		const editors = page.locator('[data-shared-route-editor]')
		await expect(editors).toHaveCount(3)
		await expect(editors.evaluateAll(items => items.map(item => item.getAttribute('data-shared-route-editor-layout')))).resolves.toEqual([viewport.layout, viewport.layout, viewport.layout])
		await expect(editors.locator('form')).toHaveCount(2)
		await expect(editors.locator('[role="status"]')).toHaveCount(3)
		await page.locator('[data-shared-route-editor="recording-detail"] [data-shared-route-editor-action="replay-recording"]').click()
		await expect(page.locator('[data-shared-route-editor-intent]')).toHaveText('recording-detail:replay-recording')
		expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
	})
}
