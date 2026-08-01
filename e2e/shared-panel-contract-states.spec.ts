import { expect, test, type Page } from '@playwright/test'
import { startSharedWebShellFixture, type SharedWebShellFixture } from './support/shared-web-shell-fixture'

let fixture: SharedWebShellFixture

test.beforeAll(async () => {
	fixture = await startSharedWebShellFixture()
})

test.afterAll(async () => {
	await fixture.close()
})

for (const viewport of [
	{ name: 'wide', width: 1280, height: 900, panelLayout: 'wide' },
	// Shared panel contracts deliberately have only wide and narrow densities.
	// At the medium route breakpoint they must retain the canonical wide panel
	// contract, rather than letting a host introduce an untested third density.
	{ name: 'medium', width: 900, height: 900, panelLayout: 'wide' },
	{ name: 'narrow', width: 390, height: 820, panelLayout: 'narrow' },
] as const) {
	test(`shared failure-state contracts render accessibly without overflow at ${viewport.name} width`, async ({ page }) => {
		await page.setViewportSize({ width: viewport.width, height: viewport.height })
		await page.goto(`${fixture.origin}/e2e/fixtures/shared-panel-contract-states.html`)

		await expect(page.locator('[data-shared-panel-contract-proof-layout]')).toHaveAttribute('data-shared-panel-contract-proof-layout', viewport.panelLayout)
		for (const id of ['terminal', 'file', 'git', 'agents', 'macros', 'recordings', 'settings', 'connection']) {
			await expect(page.locator(`[data-shared-panel-contract="${id}"]`)).toBeVisible()
			await expect(page.locator(`[data-shared-panel-contract="${id}"]`)).toHaveAttribute('data-shared-panel-layout', viewport.panelLayout)
		}
		await expect(page.locator('[data-shared-panel-contract="connection"]')).toHaveAttribute('role', 'alert')
		await expect(page.locator('[data-shared-panel-contract="terminal"] [role="status"]')).toHaveText('Connection failed')
		await expect(page.locator('[data-shared-panel-contract="agents"]')).toContainText('Failed')

		for (const action of await page.locator('[data-shared-panel-action]').all()) {
			const box = await action.boundingBox()
			expect(box?.height).toBeGreaterThanOrEqual(44)
			expect(box?.width).toBeGreaterThanOrEqual(44)
		}

		await page.locator('[data-shared-panel-contract="terminal"] [data-shared-panel-action="retry-terminal"]').click()
		await page.locator('[data-shared-panel-contract="agents"] [data-shared-panel-action="select-agent"]').click()
		await expect(page.locator('[data-shared-panel-intents]')).toHaveText('terminal:retry-terminal,agents:select-agent')
		await expectNoHorizontalOverflow(page)
	})
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
	const dimensions = await page.evaluate(() => ({
		body: document.body.scrollWidth,
		document: document.documentElement.scrollWidth,
		viewport: document.documentElement.clientWidth,
	}))
	expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport)
	expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport)
}
