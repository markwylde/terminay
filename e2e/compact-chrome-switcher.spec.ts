import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const PHONE = { x: 40, y: 40, width: 390, height: 740 } as const;

async function resize(
	page: Page,
	electronApp: import('@playwright/test').ElectronApplication,
	bounds: { x: number; y: number; width: number; height: number },
): Promise<void> {
	const nativeWindow = await electronApp.browserWindow(page);
	await nativeWindow.evaluate((window, next) => {
		window.setBounds(next);
	}, bounds);
}

const switcherOf = (page: Page) =>
	page.getByRole('dialog', { name: 'Switch terminal' });

const activeProjectId = (page: Page) =>
	page.locator('.app-shell').getAttribute('data-terminay-active-project-id');

async function settledHeight(
	locator: import('@playwright/test').Locator,
): Promise<number> {
	let previous = -1;
	await expect
		.poll(async () => {
			const box = await locator.boundingBox();
			const height = Math.round(box?.height ?? 0);
			const settled = height > 0 && height === previous;
			previous = height;
			return settled;
		})
		.toBe(true);
	return previous;
}

const activeSessionId = (page: Page) =>
	page
		.locator('.project-workspace--active .terminal-panel:visible')
		.getAttribute('data-terminay-terminal-session-id');

test.describe('compact chrome', () => {
	test('collapses to one row and hides the panel tab strip', async ({
		electronApp,
		mainWindow,
	}) => {
		await expect(
			mainWindow.locator('[data-terminay-app-component]'),
		).toBeVisible();
		await expect(mainWindow.locator('.project-tab')).not.toHaveCount(0);

		// Wide: today's chrome, untouched.
		await resize(mainWindow, electronApp, {
			x: 40,
			y: 40,
			width: 1280,
			height: 800,
		});
		await expect(mainWindow.locator('.project-tabbar-projects')).toBeVisible();
		await expect(
			mainWindow.locator('.dv-tabs-and-actions-container').first(),
		).toBeVisible();
		await expect(
			mainWindow.locator('[data-compact-chrome="true"]'),
		).toHaveCount(0);

		await resize(mainWindow, electronApp, PHONE);
		const row = mainWindow.locator('[data-compact-chrome="true"]');
		await expect(row).toBeVisible();
		await expect(mainWindow.locator('.project-tabbar-projects')).toHaveCount(0);
		// The strip is hidden, not unmounted: Dockview keeps its layout.
		await expect(
			mainWindow.locator('.dv-tabs-and-actions-container').first(),
		).toBeHidden();
		await expect(mainWindow.locator('.terminal-panel')).not.toHaveCount(0);

		const rowBox = await row.boundingBox();
		if (!rowBox) throw new Error('Expected the compact row');
		expect(Math.round(rowBox.height)).toBeLessThanOrEqual(40);

		// Back to wide, and the original chrome returns.
		await resize(mainWindow, electronApp, {
			x: 40,
			y: 40,
			width: 1280,
			height: 800,
		});
		await expect(mainWindow.locator('.project-tabbar-projects')).toBeVisible();
		await expect(
			mainWindow.locator('[data-compact-chrome="true"]'),
		).toHaveCount(0);
	});

	test('the chrome row never scrolls sideways at 320px', async ({
		electronApp,
		mainWindow,
	}) => {
		await resize(mainWindow, electronApp, {
			x: 40,
			y: 40,
			width: 320,
			height: 720,
		});
		const row = mainWindow.locator('[data-compact-chrome="true"]');
		await expect(row).toBeVisible();
		const overflow = await row.evaluate(
			(element) => element.scrollWidth - element.clientWidth,
		);
		expect(overflow).toBeLessThanOrEqual(1);
		// Every control is still on the row.
		await expect(mainWindow.getByLabel('Toggle file explorer')).toBeVisible();
		await expect(mainWindow.getByLabel('Show dashboard')).toBeVisible();
		await expect(
			mainWindow.locator('[data-compact-breadcrumb="true"]'),
		).toBeVisible();
		await expect(
			mainWindow.locator('[data-compact-connection="true"]'),
		).toBeVisible();
	});

	test('the switcher overlays the terminal rather than resizing it', async ({
		electronApp,
		mainWindow,
	}) => {
		await resize(mainWindow, electronApp, PHONE);
		const terminal = mainWindow
			.locator('.project-workspace--active .terminal-panel:visible')
			.first();
		await expect(terminal).toBeVisible();
		const beforeHeight = await settledHeight(terminal);
		const before = await terminal.boundingBox();

		await mainWindow.locator('[data-compact-breadcrumb="true"]').click();
		const switcher = switcherOf(mainWindow);
		await expect(switcher).toBeVisible();

		const during = await terminal.boundingBox();
		if (!before || !during) throw new Error('Expected terminal geometry');
		expect(Math.round(during.height)).toBe(beforeHeight);
		expect(Math.round(during.width)).toBe(Math.round(before.width));

		// Every create action the collapsed chrome absorbed is here.
		await expect(
			switcher.getByRole('button', { name: /^New terminal in / }),
		).not.toHaveCount(0);
		await expect(
			switcher.getByRole('button', { name: 'New project' }),
		).toBeVisible();
		await expect(
			switcher.getByRole('button', { name: 'Add connection' }),
		).toBeVisible();
	});

	test('Escape and an outside press both dismiss and return focus', async ({
		electronApp,
		mainWindow,
	}) => {
		await resize(mainWindow, electronApp, PHONE);
		const breadcrumb = mainWindow.locator('[data-compact-breadcrumb="true"]');
		const connection = mainWindow.locator('[data-compact-connection="true"]');
		const switcher = switcherOf(mainWindow);

		await breadcrumb.click();
		await expect(switcher).toBeVisible();
		await mainWindow.keyboard.press('Escape');
		await expect(switcher).toHaveCount(0);
		await expect(breadcrumb).toBeFocused();

		// The connection glyph opens the same surface, and focus returns there.
		await connection.click();
		await expect(switcher).toBeVisible();
		const scrim = mainWindow.locator('.compact-switcher-scrim');
		const box = await scrim.boundingBox();
		if (!box) throw new Error('Expected the switcher scrim');
		await mainWindow.mouse.click(box.x + box.width / 2, box.y + 12);
		await expect(switcher).toHaveCount(0);
		await expect(connection).toBeFocused();
	});

	test('activates a terminal that belongs to a background project', async ({
		electronApp,
		mainWindow,
	}) => {
		await expect(mainWindow.locator('.project-tab')).not.toHaveCount(0);
		const firstProject = await activeProjectId(mainWindow);
		const firstSession = await activeSessionId(mainWindow);

		await mainWindow.getByLabel('Create project').click();
		await expect(mainWindow.locator('[data-pending-project-id]')).toHaveCount(
			0,
		);
		await expect(mainWindow.locator('.project-tab')).toHaveCount(2);
		const secondProject = await activeProjectId(mainWindow);
		expect(secondProject).not.toBe(firstProject);

		await resize(mainWindow, electronApp, PHONE);
		await mainWindow.locator('[data-compact-breadcrumb="true"]').click();
		const switcher = switcherOf(mainWindow);
		await expect(switcher).toBeVisible();

		// Both projects are listed under their connection heading.
		await expect(
			switcher.locator('[data-compact-switcher-project]'),
		).toHaveCount(2);
		await expect(
			switcher.locator('.compact-switcher__connection-name'),
		).toHaveCount(1);

		// The terminal of the project that is not in front.
		const backgroundRow = switcher
			.locator(`.compact-switcher__terminal[data-project-id="${firstProject}"]`)
			.first();
		await expect(backgroundRow).toBeVisible();
		await backgroundRow.click();

		await expect(switcher).toHaveCount(0);
		await expect.poll(() => activeProjectId(mainWindow)).toBe(firstProject);
		await expect.poll(() => activeSessionId(mainWindow)).toBe(firstSession);
		// The breadcrumb followed.
		await expect(
			mainWindow.locator('[data-compact-breadcrumb-segment="terminal"]'),
		).toBeVisible();
	});

	test('a live terminal row shows its own last line', async ({
		electronApp,
		mainWindow,
	}) => {
		// The preview is a read of the buffer this window is already rendering.
		// Only a running app can prove that registry is actually wired up.
		const terminal = mainWindow
			.locator('.project-workspace--active .terminal-panel:visible')
			.first();
		await expect(terminal).toBeVisible();
		await terminal.click();
		await mainWindow.keyboard.type('echo switcher-preview-marker');
		await mainWindow.keyboard.press('Enter');
		await expect(
			mainWindow.locator('.project-workspace--active .xterm-rows'),
		).toContainText('switcher-preview-marker');

		await resize(mainWindow, electronApp, PHONE);
		await mainWindow.locator('[data-compact-breadcrumb="true"]').click();
		const switcher = switcherOf(mainWindow);
		await expect(switcher).toBeVisible();
		const preview = switcher
			.locator('.compact-switcher__terminal-preview')
			.first();
		await expect(preview).toBeVisible();
		await expect(preview).not.toBeEmpty();
	});

	test('filters to a terminal and reports when nothing matches', async ({
		electronApp,
		mainWindow,
	}) => {
		await resize(mainWindow, electronApp, PHONE);
		await mainWindow.locator('[data-compact-breadcrumb="true"]').click();
		const switcher = switcherOf(mainWindow);
		await expect(switcher).toBeVisible();

		const rows = switcher.locator('.compact-switcher__terminal');
		const firstTitle = (
			await rows
				.first()
				.locator('.compact-switcher__terminal-title')
				.textContent()
		)?.trim();
		if (!firstTitle) throw new Error('Expected a terminal row');

		// The filter is collapsed until it is asked for, and nothing in the sheet
		// holds focus before then.
		await expect(switcher.locator('input')).toHaveCount(0);
		await expect(
			mainWindow.locator('.compact-switcher input:focus'),
		).toHaveCount(0);
		await switcher
			.locator('.compact-switcher__search-open')
			.click();
		const filter = switcher.getByLabel('Search terminals and projects');
		await expect(filter).toBeFocused();
		await filter.fill(firstTitle);
		await expect(rows).not.toHaveCount(0);

		await filter.fill('no-terminal-has-this-name');
		await expect(rows).toHaveCount(0);
		await expect(switcher.getByText(/^Nothing matches/)).toBeVisible();
		// Create actions survive an empty result.
		await expect(
			switcher.getByRole('button', { name: 'New project' }),
		).toBeVisible();

		// Collapsing clears the filter and restores every group.
		await switcher.getByLabel('Close search').click();
		await expect(switcher.locator('input')).toHaveCount(0);
		await expect(rows).not.toHaveCount(0);
	});

	test('the workspace document forbids the scale change iOS makes on focus', async ({
		electronApp,
		mainWindow,
	}) => {
		await resize(mainWindow, electronApp, PHONE);
		// The filter declares the size iOS demands and renders at the sheet's own,
		// so there is nothing for the platform to zoom.
		await mainWindow.locator('[data-compact-breadcrumb="true"]').click();
		await expect(switcherOf(mainWindow)).toBeVisible();
		await mainWindow.locator('.compact-switcher__search-open').click();
		const field = mainWindow.locator('.compact-switcher__field input');
		const rendered = await field.evaluate((element) => {
			const style = getComputedStyle(element);
			const declared = Number.parseFloat(style.fontSize);
			const scale = new DOMMatrixReadOnly(style.transform).a;
			return { declared, rendered: declared * scale };
		});
		expect(rendered.declared).toBeGreaterThanOrEqual(16);
		expect(rendered.rendered).toBeCloseTo(13.5, 1);
		await mainWindow.keyboard.press('Escape');

		// Focusing the filter must not move the chrome row or change its size —
		// the failure mode being guarded is the page scaling and scrolling the
		// header away.
		const row = mainWindow.locator('[data-compact-chrome="true"]');
		const before = await row.boundingBox();
		await mainWindow.locator('[data-compact-breadcrumb="true"]').click();
		const switcher = switcherOf(mainWindow);
		await expect(switcher).toBeVisible();
		await switcher.locator('.compact-switcher__search-open').click();
		await expect(
			switcher.getByLabel('Search terminals and projects'),
		).toBeFocused();
		const after = await row.boundingBox();
		if (!before || !after) throw new Error('Expected the compact row');
		expect(Math.round(after.y)).toBe(Math.round(before.y));
		expect(Math.round(after.width)).toBe(Math.round(before.width));
	});
});
