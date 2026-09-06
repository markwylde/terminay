import { expect, test } from './fixtures';
import { openChildWindow, presentNativeRoute } from './support/app';

const ROUTE = '/?auxiliary=performance-log';

test('opens the Performance Log window and shows the startup breakdown', async ({
	electronApp,
	mainWindow,
}) => {
	const performanceWindow = await openChildWindow(electronApp, async () => {
		await presentNativeRoute(mainWindow, ROUTE, 'performance-log');
	});

	await expect(
		performanceWindow.getByRole('heading', { name: 'Startup' }),
	).toBeVisible();
	await expect(
		performanceWindow.getByRole('heading', { name: 'This application' }),
	).toBeVisible();
	await expect(
		performanceWindow.getByRole('heading', { name: 'Terminals' }),
	).toBeVisible();

	// Every startup phase Desktop recorded is present with a duration, and the
	// slowest one is named so a slow launch is identifiable without a log file.
	const phases = performanceWindow.locator('.perf-phase-row');
	await expect(phases.first()).toBeVisible();
	expect(await phases.count()).toBeGreaterThan(1);
	await expect(
		performanceWindow.locator('.perf-summary-stat--slow'),
	).toBeVisible();

	// The dominant phase is called out rather than left for the reader to find.
	await expect(
		performanceWindow.locator('.perf-phase-row--dominant'),
	).toHaveCount(1);
});

test('the Performance Log window is reused rather than duplicated', async ({
	electronApp,
	mainWindow,
}) => {
	const first = await openChildWindow(electronApp, async () => {
		await presentNativeRoute(mainWindow, ROUTE, 'performance-log');
	});
	await expect(first.getByRole('heading', { name: 'Startup' })).toBeVisible();

	const before = electronApp.windows().length;
	await presentNativeRoute(mainWindow, ROUTE, 'performance-log');
	await mainWindow.waitForTimeout(500);
	expect(electronApp.windows().length).toBe(before);
});

test('a startup sub-phase expands to its recorded detail', async ({
	electronApp,
	mainWindow,
}) => {
	const performanceWindow = await openChildWindow(electronApp, async () => {
		await presentNativeRoute(mainWindow, ROUTE, 'performance-log');
	});

	const expandable = performanceWindow
		.locator('.perf-phase-row[aria-expanded="false"]')
		.first();
	if ((await expandable.count()) === 0) {
		// Sub-phases are recorded opportunistically; nothing to expand is valid.
		return;
	}
	await expandable.click();
	await expect(
		performanceWindow.locator('.perf-subphases').first(),
	).toBeVisible();
});

test('live samples arrive without enabling the opt-in collector', async ({
	electronApp,
	mainWindow,
}) => {
	const performanceWindow = await openChildWindow(electronApp, async () => {
		await presentNativeRoute(mainWindow, ROUTE, 'performance-log');
	});

	// The process table is populated from the lightweight collector, which runs
	// only while this window is open and never writes an artifact.
	const processRows = performanceWindow
		.locator('.perf-section')
		.filter({ hasText: 'This application' })
		.locator('tbody tr');
	await expect(processRows.first()).toBeVisible({ timeout: 10_000 });

	// A second sample must replace the first rather than accumulate.
	const firstCount = await processRows.count();
	await performanceWindow.waitForTimeout(2_500);
	expect(await processRows.count()).toBe(firstCount);
});

test('a terminal without local usage states why instead of showing zero', async ({
	electronApp,
	mainWindow,
}) => {
	const performanceWindow = await openChildWindow(electronApp, async () => {
		await presentNativeRoute(mainWindow, ROUTE, 'performance-log');
	});

	const terminals = performanceWindow
		.locator('.perf-section')
		.filter({ hasText: 'Terminals' });
	await expect(terminals).toBeVisible();

	// Whatever the state, the section never presents an unmeasured terminal as
	// zero: an unavailable row states its reason and shows an em dash, never 0.
	const unavailable = terminals.locator('.perf-sub.perf-unavailable');
	for (let index = 0; index < (await unavailable.count()); index += 1) {
		const row = terminals.locator('tbody tr').filter({
			has: unavailable.nth(index),
		});
		await expect(row.locator('.perf-numeric').first()).toHaveText('—');
		await expect(unavailable.nth(index)).toContainText('·');
	}
});

test('a phase row with no sub-phases stays flat under the pointer', async ({
	electronApp,
	mainWindow,
}) => {
	const performanceWindow = await openChildWindow(electronApp, async () => {
		await presentNativeRoute(mainWindow, ROUTE, 'performance-log');
	});
	await expect(
		performanceWindow.locator('.perf-phase-row').first(),
	).toBeVisible();

	// The shared stylesheet paints a dark background on `button:hover` without
	// guarding against disabled buttons, so a row with nothing to expand must
	// explicitly stay transparent.
	const inert = performanceWindow.locator('.perf-phase-row:disabled').first();
	await inert.hover();
	await expect(inert).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});
