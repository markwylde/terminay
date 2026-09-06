import { expect, type Page, test } from '@playwright/test'
import { startSharedWebShellFixture, type SharedWebShellFixture } from './support/shared-web-shell-fixture'

let fixture: SharedWebShellFixture
test.beforeAll(async () => { fixture = await startSharedWebShellFixture() })
test.afterAll(async () => { await fixture.close() })

type FixtureApi = Readonly<{
	getCanonicalWidth: () => number
	getCommitCount: () => number
	emitTerminalOutput: () => void
	focusTerminalSurface: () => void
	unmountLayout: () => void
}>

function api(page: Page) {
	const call = <T>(read: (api: FixtureApi) => T) =>
		page.evaluate(
			`(${String(read)})(window.terminaySidebarFixture)`,
		) as Promise<T>
	return {
		canonicalWidth: () => call((fixtureApi) => fixtureApi.getCanonicalWidth()),
		commitCount: () => call((fixtureApi) => fixtureApi.getCommitCount()),
		emitTerminalOutput: () => call((fixtureApi) => { fixtureApi.emitTerminalOutput() }),
		focusTerminalSurface: () => call((fixtureApi) => { fixtureApi.focusTerminalSurface() }),
		unmountLayout: () => call((fixtureApi) => { fixtureApi.unmountLayout() }),
	}
}

async function navigationWidth(page: Page): Promise<number> {
	const box = await page.locator('.workspace-split-layout__navigation').boundingBox()
	if (!box) throw new Error('The navigation region has no hit box.')
	return box.width
}

async function openFixture(page: Page): Promise<void> {
	await page.setViewportSize({ width: 1280, height: 900 })
	await page.goto(`${fixture.origin}/e2e/fixtures/workspace-sidebar-resize.html`)
	await expect(page.locator('.workspace-split-layout__separator')).toBeVisible()
}

/** Press the separator with a real pointer and leave the button held. */
async function grabSeparator(page: Page): Promise<{ x: number; y: number }> {
	const box = await page.locator('.workspace-split-layout__separator').boundingBox()
	if (!box) throw new Error('The separator has no hit box.')
	// Stay in the upper region of the workspace: the fixture's terminal surface
	// is a separate browsing context that would swallow uncaptured pointer moves.
	const point = { x: box.x + box.width / 2, y: box.y + box.height / 4 }
	await page.mouse.move(point.x, point.y)
	await page.mouse.down()
	return point
}

/**
 * The 6px handle travels with the live preview, so a quick pointer leaves its
 * box and Chromium releases the implicit capture while the button is held. This
 * delivers that exact signal without depending on pointer timing.
 */
async function loseCapture(page: Page): Promise<void> {
	await page.evaluate(() => {
		const separator = document.querySelector('.workspace-split-layout__separator') as HTMLElement
		separator.releasePointerCapture(1)
	})
}

test('a released sidebar drag commits its width', async ({ page }) => {
	await openFixture(page)
	const start = await navigationWidth(page)
	const { x, y } = await grabSeparator(page)
	for (const step of [40, 80, 120]) await page.mouse.move(x + step, y)
	expect(await navigationWidth(page)).toBeCloseTo(start + 120, 0)
	await page.mouse.up()
	await expect.poll(() => api(page).commitCount()).toBe(1)
	expect(await navigationWidth(page)).toBeCloseTo(start + 120, 0)
	expect(await api(page).canonicalWidth()).toBeCloseTo(start + 120, 0)
})

test('a released sidebar drag commits its width while a terminal writes output', async ({ page }) => {
	await openFixture(page)
	const start = await navigationWidth(page)
	const { x, y } = await grabSeparator(page)
	for (const step of [40, 80, 120]) {
		await page.mouse.move(x + step, y)
		await api(page).emitTerminalOutput()
	}
	expect(await navigationWidth(page)).toBeCloseTo(start + 120, 0)
	await page.mouse.up()
	await expect.poll(() => api(page).commitCount()).toBe(1)
	expect(await navigationWidth(page)).toBeCloseTo(start + 120, 0)
})

test('a sidebar drag that loses pointer capture keeps tracking the pointer and commits on release', async ({ page }) => {
	await openFixture(page)
	const start = await navigationWidth(page)
	const { x, y } = await grabSeparator(page)
	await page.mouse.move(x + 60, y)
	await loseCapture(page)
	await page.mouse.move(x + 120, y)
	expect(
		await navigationWidth(page),
		'the sidebar stopped following the pointer after the capture was lost',
	).toBeCloseTo(start + 120, 0)
	await page.mouse.up()
	await expect.poll(() => api(page).commitCount(), {
		message: 'the completed drag never reached the canonical width owner',
	}).toBe(1)
	expect(await navigationWidth(page)).toBeCloseTo(start + 120, 0)
	expect(await api(page).canonicalWidth()).toBeCloseTo(start + 120, 0)
})

test('a released sidebar drag commits its width when a terminal takes focus mid-drag', async ({ page }) => {
	await openFixture(page)
	const start = await navigationWidth(page)
	const { x, y } = await grabSeparator(page)
	await page.mouse.move(x + 60, y)
	await api(page).focusTerminalSurface()
	await page.mouse.move(x + 120, y)
	await page.mouse.up()
	await expect.poll(() => api(page).commitCount()).toBe(1)
	expect(await navigationWidth(page)).toBeCloseTo(start + 120, 0)
})

test('pointercancel abandons a sidebar drag and restores the pre-drag width', async ({ page }) => {
	await openFixture(page)
	const start = await navigationWidth(page)
	const { x, y } = await grabSeparator(page)
	await page.mouse.move(x + 120, y)
	await page.evaluate(() => {
		window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }))
	})
	await expect.poll(() => navigationWidth(page)).toBeCloseTo(start, 0)
	await page.mouse.up()
	expect(await api(page).commitCount()).toBe(0)
	expect(await navigationWidth(page)).toBeCloseTo(start, 0)
})

test('window blur abandons a sidebar drag and restores the pre-drag width', async ({ page }) => {
	await openFixture(page)
	const start = await navigationWidth(page)
	const { x, y } = await grabSeparator(page)
	await page.mouse.move(x + 120, y)
	await page.evaluate(() => { window.dispatchEvent(new FocusEvent('blur')) })
	await expect.poll(() => navigationWidth(page)).toBeCloseTo(start, 0)
	await page.mouse.up()
	expect(await api(page).commitCount()).toBe(0)
})

test('unmounting during a sidebar drag commits nothing', async ({ page }) => {
	await openFixture(page)
	const { x, y } = await grabSeparator(page)
	await page.mouse.move(x + 120, y)
	await api(page).unmountLayout()
	await expect(page.locator('[data-fixture-unmounted]')).toBeVisible()
	await page.mouse.up()
	expect(await api(page).commitCount()).toBe(0)
})
