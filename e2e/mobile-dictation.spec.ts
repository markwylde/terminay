import { expect, test, type Page } from '@playwright/test'
import { startSharedWebShellFixture, type SharedWebShellFixture } from './support/shared-web-shell-fixture'

let fixture: SharedWebShellFixture
test.beforeAll(async () => { fixture = await startSharedWebShellFixture() })
test.afterAll(async () => { await fixture.close() })

test('touch-mobile dictation renders state, provider error, cancel, and submit through named clients', async ({ browser }) => {
	const context = await browser.newContext({
		hasTouch: true,
		isMobile: true,
		viewport: { width: 390, height: 844 },
	})
	const page = await context.newPage()
	// The shard can cold-compile this fixture while other Docker jobs are busy.
	// Navigation commit proves the fixture accepted the request; the semantic
	// surface assertion below remains the authoritative application readiness.
	await page.goto(`${fixture.origin}/e2e/fixtures/mobile-dictation.html`, {
		waitUntil: 'commit',
		timeout: 15_000,
	})
	const surface = page.getByRole('region', { name: 'Mobile dictation' })
	await expect(surface).toHaveAttribute('data-mobile-dictation-status', 'idle', {
		timeout: 15_000,
	})

	await page.getByRole('button', { name: 'Start dictation' }).tap()
	await expect(surface).toHaveAttribute('data-mobile-dictation-status', 'recording')
	await page.getByRole('button', { name: 'Submit dictation' }).tap()
	await expect(page.getByRole('alert')).toHaveText('Provider temporarily unavailable')
	await expect(surface).toHaveAttribute('data-mobile-dictation-status', 'idle')

	await page.getByRole('button', { name: 'Start dictation' }).tap()
	await page.getByRole('button', { name: 'Cancel dictation' }).tap()
	await expect(surface).toHaveAttribute('data-mobile-dictation-status', 'cancelled')

	await page.getByRole('button', { name: 'Start dictation' }).tap()
	await page.getByRole('button', { name: 'Submit dictation' }).tap()
	await expect(page.locator('[data-mobile-dictation-submitted]')).toHaveText('dictation:mobile:4:panel:terminal')
	await expect(surface).toHaveAttribute('data-mobile-dictation-status', 'ready')
	await expectNoHorizontalOverflow(page)
	for (const button of await page.getByRole('button').all()) {
		expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44)
	}
	await context.close()
})

async function expectNoHorizontalOverflow(page: Page) {
	const widths = await page.evaluate(() => ({
		body: document.body.scrollWidth,
		document: document.documentElement.scrollWidth,
		viewport: document.documentElement.clientWidth,
	}))
	expect(widths.body).toBeLessThanOrEqual(widths.viewport)
	expect(widths.document).toBeLessThanOrEqual(widths.viewport)
}
