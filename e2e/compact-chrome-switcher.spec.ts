import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { cancelEditWindow, longPress } from './support/ui';
import { createStartedProject } from './support/project-start';

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

const homeToggleOf = (page: Page) =>
	page.locator('[data-compact-home-toggle="true"]');

/** Home is one press away on the compact row. */
async function goHome(page: Page) {
	await homeToggleOf(page).click();
	await expect(page.locator('.app-shell')).toHaveAttribute(
		'data-terminay-selected-view',
		'home',
	);
}

async function openDrawer(page: Page) {
	await page.locator('[data-compact-breadcrumb="true"]').click();
	const drawer = switcherOf(page);
	await expect(drawer).toBeVisible();
	// A press measured mid-entrance lands where the row used to be.
	await drawer.evaluate((element) =>
		Promise.all(element.getAnimations().map((animation) => animation.finished)),
	);
	return drawer;
}

const activeProjectId = (page: Page) =>
	page.locator('.app-shell').getAttribute('data-terminay-active-project-id');

const railProject = (page: Page, projectId: string | null) =>
	switcherOf(page).locator(
		`.compact-drawer__rail-item[data-project-id="${projectId}"]`,
	);

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

const rowTitles = (drawer: import('@playwright/test').Locator) =>
	drawer
		.locator('[data-compact-switcher-terminal] .compact-drawer__row-title')
		.allInnerTexts();

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
		await expect(mainWindow.getByLabel('Open command bar')).toBeVisible();
		await expect(
			mainWindow.locator('[data-compact-breadcrumb="true"]'),
		).toBeVisible();
		await expect(homeToggleOf(mainWindow)).toBeVisible();
		await expect(
			mainWindow.locator('[data-compact-connection="true"]'),
		).toBeVisible();
	});

	test('the title block names the terminal over its project and folder', async ({
		electronApp,
		mainWindow,
	}) => {
		await resize(mainWindow, electronApp, PHONE);
		const breadcrumb = mainWindow.locator('[data-compact-breadcrumb="true"]');
		await expect(
			breadcrumb.locator('[data-compact-breadcrumb-segment="terminal"]'),
		).not.toBeEmpty();
		await expect(
			breadcrumb.locator('[data-compact-breadcrumb-segment="project"]'),
		).not.toBeEmpty();
		await expect(breadcrumb.locator('.compact-title__folder')).toHaveText(
			'General',
		);
		await expect(breadcrumb).toHaveAccessibleName(
			/^Switch terminal — .+, General in .+$/,
		);
	});

	test('the Home toggle goes Home and back to the same project', async ({
		electronApp,
		mainWindow,
	}) => {
		await resize(mainWindow, electronApp, PHONE);
		const project = await activeProjectId(mainWindow);
		const toggle = homeToggleOf(mainWindow);
		await expect(toggle).toHaveAttribute('aria-pressed', 'false');

		await toggle.click();
		await expect(mainWindow.locator('.app-shell')).toHaveAttribute(
			'data-terminay-selected-view',
			'home',
		);
		await expect(toggle).toHaveAttribute('aria-pressed', 'true');
		await expect(toggle).toHaveAccessibleName('Back to project');
		// The title block names the Home tab over Home.
		await expect(mainWindow.locator('.compact-title__where')).toHaveText(
			'Home',
		);

		await toggle.click();
		await expect(mainWindow.locator('.app-shell')).toHaveAttribute(
			'data-terminay-selected-view',
			'project',
		);
		await expect.poll(() => activeProjectId(mainWindow)).toBe(project);
	});

	test('Home leads the drawer rail and lists its sections', async ({
		electronApp,
		mainWindow,
	}) => {
		await resize(mainWindow, electronApp, PHONE);
		const drawer = await openDrawer(mainWindow);
		const home = drawer.locator('[data-compact-switcher-home="true"]');
		await expect(home).toHaveAttribute('aria-pressed', 'false');
		// The drawer opens on the project in front.
		await expect(
			drawer.locator('[data-compact-switcher-terminal]'),
		).not.toHaveCount(0);

		// Selecting Home in the rail presents Home without leaving the project.
		await home.click();
		await expect(home).toHaveAttribute('aria-pressed', 'true');
		await expect(
			drawer.locator('[data-compact-home-panel="true"]'),
		).toBeVisible();
		await expect(mainWindow.locator('.app-shell')).toHaveAttribute(
			'data-terminay-selected-view',
			'project',
		);
		const sections = drawer.locator('[data-compact-home-section]');
		await expect(sections).toHaveCount(8);
		await drawer.locator('[data-compact-home-section="workflows"]').click();
		await expect(drawer).toHaveCount(0);
		await expect(mainWindow.locator('.app-shell')).toHaveAttribute(
			'data-terminay-selected-view',
			'home',
		);
		await expect(mainWindow.locator('.compact-title__primary')).toHaveText(
			'Workflows',
		);

		// Opened on Home, the drawer presents Home with that section current.
		const again = await openDrawer(mainWindow);
		await expect(
			again.locator('[data-compact-home-section="workflows"]'),
		).toHaveAttribute('aria-current', 'page');
	});

	test('the command bar opens from the row, with no key to press', async ({
		electronApp,
		mainWindow,
	}) => {
		await resize(mainWindow, electronApp, PHONE);
		const control = mainWindow.locator('[data-compact-command-bar="true"]');
		await expect(control).toBeVisible();
		await expect(control).toBeEnabled();
		await control.click();

		const commandBar = mainWindow.getByRole('dialog', { name: 'Command bar' });
		await expect(commandBar).toBeVisible();
		// It opened the command bar and nothing else.
		await expect(switcherOf(mainWindow)).toHaveCount(0);

		// And it reaches a command the collapsed chrome draws no control for.
		await mainWindow
			.getByRole('searchbox', { name: 'Search commands' })
			.fill('edit tab');
		await expect(
			commandBar.getByText('Edit tab settings', { exact: true }),
		).toBeVisible();
		await mainWindow.keyboard.press('Escape');
		await expect(commandBar).toHaveCount(0);
	});

	test('the command bar opens on Home, without a project in front', async ({
		electronApp,
		mainWindow,
	}) => {
		await resize(mainWindow, electronApp, PHONE);
		await goHome(mainWindow);
		const control = mainWindow.locator('[data-compact-command-bar="true"]');
		await expect(control).toBeEnabled();
		await control.click();
		const commandBar = mainWindow.getByRole('dialog', { name: 'Command bar' });
		await expect(commandBar).toBeVisible();
		// It lists what belongs to the workspace view, and nothing that needs
		// the project behind Home.
		await expect(
			commandBar.getByText('Show dashboard', { exact: true }),
		).toBeVisible();
		await expect(
			commandBar.getByText('Edit tab settings', { exact: true }),
		).toHaveCount(0);
		await mainWindow.keyboard.press('Escape');
		await expect(commandBar).toHaveCount(0);
	});

	test('long-pressing a terminal row opens its menu, and Rename opens the editor', async ({
		electronApp,
		mainWindow,
	}) => {
		await resize(mainWindow, electronApp, PHONE);
		const drawer = await openDrawer(mainWindow);
		const terminalRow = drawer
			.locator('[data-compact-switcher-terminal]')
			.first();
		await expect(terminalRow).toBeVisible();
		// The tab strip that used to carry this gesture is not drawn here.
		await expect(
			mainWindow.locator('.dv-tabs-and-actions-container:visible'),
		).toHaveCount(0);
		const menu = drawer.getByRole('menu');
		await longPress(terminalRow, menu);
		await expect(menu.getByRole('menuitem')).toHaveText([
			'Open',
			'Rename',
			'Close',
		]);

		// Escape closes the menu alone; the drawer stays.
		await mainWindow.keyboard.press('Escape');
		await expect(menu).toHaveCount(0);
		await expect(drawer).toBeVisible();

		await longPress(terminalRow, menu);
		await menu.getByRole('menuitem', { name: 'Rename' }).click();
		await expect(
			mainWindow.getByRole('heading', { name: 'Edit Terminal Tab' }),
		).toBeVisible();
		await cancelEditWindow(mainWindow);
	});

	test('a short press on a terminal row still activates it', async ({
		electronApp,
		mainWindow,
	}) => {
		await resize(mainWindow, electronApp, PHONE);
		const drawer = await openDrawer(mainWindow);
		await drawer.locator('[data-compact-switcher-terminal]').first().click();

		// Activation, not a menu: the press is short.
		await expect(drawer).toHaveCount(0);
		await expect(
			mainWindow.getByRole('heading', { name: 'Edit Terminal Tab' }),
		).toHaveCount(0);
	});

	test('the drawer overlays the terminal rather than resizing it', async ({
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

		const drawer = await openDrawer(mainWindow);
		const during = await terminal.boundingBox();
		if (!before || !during) throw new Error('Expected terminal geometry');
		expect(Math.round(during.height)).toBe(beforeHeight);
		expect(Math.round(during.width)).toBe(Math.round(before.width));

		// Every create action the collapsed chrome absorbed is reachable here.
		await expect(
			drawer.locator('[data-compact-switcher-new-terminal]'),
		).toBeVisible();
		await expect(
			drawer.getByRole('button', { name: /^New terminal in / }),
		).not.toHaveCount(0);
		await expect(
			drawer.getByRole('button', { name: 'New project' }),
		).not.toHaveCount(0);
		await drawer.locator('[data-compact-switcher-server="true"]').click();
		await expect(
			drawer.getByRole('menuitem', { name: 'Add connection' }),
		).toBeVisible();
	});

	test('Escape and an outside press both dismiss and return focus', async ({
		electronApp,
		mainWindow,
	}) => {
		await resize(mainWindow, electronApp, PHONE);
		const breadcrumb = mainWindow.locator('[data-compact-breadcrumb="true"]');
		const connection = mainWindow.locator('[data-compact-connection="true"]');
		const drawer = switcherOf(mainWindow);

		await breadcrumb.click();
		await expect(drawer).toBeVisible();
		await mainWindow.keyboard.press('Escape');
		await expect(drawer).toHaveCount(0);
		await expect(breadcrumb).toBeFocused();

		// The connection glyph opens the same surface, and focus returns there.
		await connection.click();
		await expect(drawer).toBeVisible();
		const scrim = mainWindow.locator('.compact-drawer-scrim');
		const box = await scrim.boundingBox();
		if (!box) throw new Error('Expected the drawer scrim');
		// The drawer slides in from the leading edge; the trailing strip is scrim.
		await mainWindow.mouse.click(
			box.x + box.width - 12,
			box.y + box.height / 2,
		);
		await expect(drawer).toHaveCount(0);
		await expect(connection).toBeFocused();
	});

	test('activates a terminal that belongs to a background project', async ({
		electronApp,
		mainWindow,
	}) => {
		await expect(mainWindow.locator('.project-tab')).not.toHaveCount(0);
		const firstProject = await activeProjectId(mainWindow);
		const firstSession = await activeSessionId(mainWindow);

		await createStartedProject(mainWindow);
		await expect(mainWindow.locator('[data-pending-project-id]')).toHaveCount(
			0,
		);
		await expect(mainWindow.locator('.project-tab')).toHaveCount(2);
		const secondProject = await activeProjectId(mainWindow);
		expect(secondProject).not.toBe(firstProject);

		await resize(mainWindow, electronApp, PHONE);
		const drawer = await openDrawer(mainWindow);

		// Both projects sit on the rail; one connection draws no group heading.
		await expect(drawer.locator('[data-compact-switcher-project]')).toHaveCount(
			2,
		);
		await expect(drawer.locator('.compact-drawer__rail-heading')).toHaveCount(
			0,
		);
		// The drawer opened on the project in front.
		await expect(railProject(mainWindow, secondProject)).toHaveAttribute(
			'aria-pressed',
			'true',
		);

		// Selecting a rail project presents it without activating it.
		await railProject(mainWindow, firstProject).click();
		await expect.poll(() => activeProjectId(mainWindow)).toBe(secondProject);
		const backgroundRow = drawer
			.locator(
				`[data-compact-switcher-terminal][data-project-id="${firstProject}"]`,
			)
			.first();
		await expect(backgroundRow).toBeVisible();
		await backgroundRow.click();

		await expect(drawer).toHaveCount(0);
		await expect.poll(() => activeProjectId(mainWindow)).toBe(firstProject);
		await expect.poll(() => activeSessionId(mainWindow)).toBe(firstSession);
		// The title block followed.
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
		const drawer = await openDrawer(mainWindow);
		const preview = drawer.locator('.compact-drawer__row-sub').first();
		await expect(preview).toBeVisible();
		await expect(preview).not.toBeEmpty();
	});

	test('filters to a terminal and reports when nothing matches', async ({
		electronApp,
		mainWindow,
	}) => {
		await resize(mainWindow, electronApp, PHONE);
		const drawer = await openDrawer(mainWindow);

		const rows = drawer.locator('[data-compact-switcher-terminal]');
		const firstTitle = (
			await rows.first().locator('.compact-drawer__row-title').textContent()
		)?.trim();
		if (!firstTitle) throw new Error('Expected a terminal row');

		// The filter is collapsed until it is asked for, and nothing in the
		// drawer holds focus in it before then.
		await expect(drawer.locator('input')).toHaveCount(0);
		await drawer
			.getByRole('button', { name: 'Search terminals and projects' })
			.click();
		const filter = drawer.getByLabel('Search terminals and projects');
		await expect(filter).toBeFocused();
		await filter.fill(firstTitle);
		await expect(rows).not.toHaveCount(0);

		await filter.fill('no-terminal-has-this-name');
		await expect(rows).toHaveCount(0);
		await expect(drawer.getByText(/^Nothing matches/)).toBeVisible();
		// The rail and its Home survive an empty result.
		await expect(
			drawer.locator('[data-compact-switcher-home="true"]'),
		).toBeVisible();

		// Escape collapses the filter first, and the drawer stays.
		await mainWindow.keyboard.press('Escape');
		await expect(drawer.locator('input')).toHaveCount(0);
		await expect(drawer).toBeVisible();
		await expect(rows).not.toHaveCount(0);
	});

	test('the filter is sized so iOS has no reason to zoom', async ({
		electronApp,
		mainWindow,
	}) => {
		await resize(mainWindow, electronApp, PHONE);
		const row = mainWindow.locator('[data-compact-chrome="true"]');
		const before = await row.boundingBox();
		const drawer = await openDrawer(mainWindow);
		await drawer
			.getByRole('button', { name: 'Search terminals and projects' })
			.click();
		const field = drawer.locator('.compact-drawer__field input');
		await expect(field).toBeFocused();
		const rendered = await field.evaluate((element) => {
			const style = getComputedStyle(element);
			const declared = Number.parseFloat(style.fontSize);
			const scale = new DOMMatrixReadOnly(style.transform).a;
			return { declared, rendered: declared * scale };
		});
		expect(rendered.declared).toBeGreaterThanOrEqual(16);
		expect(rendered.rendered).toBeCloseTo(13.5, 1);

		// Focusing the filter must not move the chrome row or change its size.
		const after = await row.boundingBox();
		if (!before || !after) throw new Error('Expected the compact row');
		expect(Math.round(after.y)).toBe(Math.round(before.y));
		expect(Math.round(after.width)).toBe(Math.round(before.width));
	});

	test('edit mode closes a terminal and keeps the drawer open', async ({
		appHarness,
		electronApp,
		mainWindow,
	}) => {
		await appHarness.sendAppCommand('new-terminal');
		await expect(mainWindow.getByLabel('Close terminal')).toHaveCount(2);

		await resize(mainWindow, electronApp, PHONE);
		const drawer = await openDrawer(mainWindow);
		const rows = drawer.locator('[data-compact-switcher-terminal]');
		await expect(rows).toHaveCount(2);
		// Out of edit mode a row carries no close control or grip.
		await expect(drawer.locator('.compact-drawer__row-close')).toHaveCount(0);
		await expect(drawer.locator('[data-compact-switcher-grip]')).toHaveCount(0);

		const edit = drawer.locator('[data-compact-switcher-edit="true"]');
		await edit.click();
		await expect(edit).toHaveText('Done');
		// The create bar gives way to edit mode.
		await expect(
			drawer.locator('[data-compact-switcher-new-terminal]'),
		).toHaveCount(0);
		const closedTitle = (
			await rows.first().locator('.compact-drawer__row-title').innerText()
		).trim();
		await drawer.getByRole('button', { name: `Close ${closedTitle}` }).click();
		await expect(rows).toHaveCount(1);
		await expect(drawer).toBeVisible();
		await edit.click();
		await expect(edit).toHaveText('Edit');
	});

	test('edit mode reorders terminals from the keyboard', async ({
		appHarness,
		electronApp,
		mainWindow,
	}) => {
		await appHarness.sendAppCommand('new-terminal');
		await expect(mainWindow.getByLabel('Close terminal')).toHaveCount(2);

		await resize(mainWindow, electronApp, PHONE);
		const drawer = await openDrawer(mainWindow);
		const before = await rowTitles(drawer);
		expect(before).toHaveLength(2);
		await drawer.locator('[data-compact-switcher-edit="true"]').click();
		const grip = drawer
			.locator('.compact-drawer__row [data-compact-switcher-grip]')
			.first();
		await grip.focus();
		await mainWindow.keyboard.press('ArrowDown');
		await expect.poll(() => rowTitles(drawer)).toEqual([...before].reverse());
		await expect(drawer.locator('.compact-drawer__live')).toContainText(
			'moved to position 2 of 2',
		);
		// The order is the server's: a reload reads it back.
		await mainWindow.reload();
		await expect(mainWindow.locator('[data-compact-chrome="true"]')).toBeVisible(
			{ timeout: 15_000 },
		);
		const reopened = await openDrawer(mainWindow);
		await expect
			.poll(() => rowTitles(reopened))
			.toEqual([...before].reverse());
	});

	test('edit mode closes a project from the rail', async ({
		electronApp,
		mainWindow,
	}) => {
		await expect(mainWindow.locator('.project-tab')).not.toHaveCount(0);
		await createStartedProject(mainWindow);
		await expect(mainWindow.locator('[data-pending-project-id]')).toHaveCount(
			0,
		);
		await expect(mainWindow.locator('.project-tab')).toHaveCount(2);

		await resize(mainWindow, electronApp, PHONE);
		const drawer = await openDrawer(mainWindow);
		const projects = drawer.locator('[data-compact-switcher-project]');
		await expect(projects).toHaveCount(2);
		await expect(
			drawer.locator('[data-compact-switcher-close-project]'),
		).toHaveCount(0);
		await drawer.locator('[data-compact-switcher-edit="true"]').click();
		const close = drawer
			.locator('[data-compact-switcher-close-project]')
			.last();
		await close.click();
		await expect(projects).toHaveCount(1);
		await expect(drawer).toBeVisible();
	});

	test('the split control creates in the target folder and shows the new terminal', async ({
		electronApp,
		mainWindow,
	}) => {
		await resize(mainWindow, electronApp, PHONE);
		await expect(mainWindow.locator('.terminal-panel')).toHaveCount(1);
		const originalSessionId = await activeSessionId(mainWindow);

		const drawer = await openDrawer(mainWindow);
		// The control names its launcher and says where the terminal will land.
		const create = drawer.locator('[data-compact-switcher-new-terminal]');
		await expect(create.locator('.compact-drawer__split-label')).toHaveText(
			'Terminal',
		);
		await expect(create.locator('.compact-drawer__split-target')).toHaveText(
			'in General',
		);
		await expect(create).toHaveAccessibleName(
			/^New Terminal terminal in General of .+/,
		);
		await create.click();
		await expect(drawer).toHaveCount(0);

		// The terminal on screen is the one just created, not the one the user
		// was looking at when they asked for it.
		await expect(mainWindow.getByLabel('Close terminal')).toHaveCount(2);
		await expect
			.poll(() => activeSessionId(mainWindow))
			.not.toBe(originalSessionId);

		// And the drawer agrees with the screen about which one is current.
		const again = await openDrawer(mainWindow);
		const rows = again.locator('[data-compact-switcher-terminal]');
		await expect(rows).toHaveCount(2);
		await expect(rows.last()).toHaveAttribute('aria-current', 'true');
	});

	test('the dropup offers the launchers and the folder to open in', async ({
		electronApp,
		mainWindow,
	}) => {
		await resize(mainWindow, electronApp, PHONE);
		const drawer = await openDrawer(mainWindow);
		const more = drawer.locator('[data-compact-switcher-launchers="true"]');
		await more.click();
		await expect(more).toHaveAttribute('aria-expanded', 'true');
		const dropup = drawer.getByRole('menu', { name: 'New terminal' });
		await expect(dropup).toBeVisible();
		await expect(dropup.getByRole('menuitem').first()).toHaveText(/Terminal/);
		await expect(
			drawer.getByRole('radiogroup', { name: 'Folder' }).getByRole('radio'),
		).not.toHaveCount(0);
		await expect(
			drawer.getByRole('radio', { name: 'General' }),
		).toHaveAttribute('aria-checked', 'true');

		// Escape closes the dropup and leaves the drawer.
		await mainWindow.keyboard.press('Escape');
		await expect(dropup).toHaveCount(0);
		await expect(drawer).toBeVisible();

		// A folder's own + opens the same dropup aimed at that folder.
		await drawer
			.getByRole('button', { name: /^New terminal in General of / })
			.click();
		await expect(
			drawer.getByRole('radio', { name: 'General' }),
		).toHaveAttribute('aria-checked', 'true');
		await dropup.getByRole('menuitem').first().click();
		await expect(drawer).toHaveCount(0);
		await expect(mainWindow.getByLabel('Close terminal')).toHaveCount(2);
	});

	test('creating a terminal in a background project shows it there', async ({
		electronApp,
		mainWindow,
	}) => {
		await expect(mainWindow.locator('.project-tab')).not.toHaveCount(0);
		const firstProject = await activeProjectId(mainWindow);
		const firstSession = await activeSessionId(mainWindow);

		await createStartedProject(mainWindow);
		await expect(mainWindow.locator('[data-pending-project-id]')).toHaveCount(
			0,
		);
		await expect(mainWindow.locator('.project-tab')).toHaveCount(2);
		const secondSession = await activeSessionId(mainWindow);

		await resize(mainWindow, electronApp, PHONE);
		const drawer = await openDrawer(mainWindow);
		await railProject(mainWindow, firstProject).click();
		await drawer.locator('[data-compact-switcher-new-terminal]').click();

		await expect(drawer).toHaveCount(0);
		await expect.poll(() => activeProjectId(mainWindow)).toBe(firstProject);
		// Neither terminal that existed before is the one on screen.
		await expect
			.poll(async () => {
				const shown = await activeSessionId(mainWindow);
				return (
					shown !== null && shown !== firstSession && shown !== secondSession
				);
			})
			.toBe(true);
	});

	test('with Home presented New project is the wide create control', async ({
		electronApp,
		mainWindow,
	}) => {
		await resize(mainWindow, electronApp, PHONE);
		await goHome(mainWindow);
		const drawer = await openDrawer(mainWindow);
		await expect(
			drawer.locator('[data-compact-home-panel="true"]'),
		).toBeVisible();
		// Nothing offers a terminal "here" when here is not a project.
		await expect(
			drawer.locator('[data-compact-switcher-new-terminal]'),
		).toHaveCount(0);
		await expect(drawer.locator('.compact-drawer__create-wide')).toHaveText(
			'New project',
		);
		await expect(drawer.locator('[data-compact-switcher-edit]')).toHaveCount(0);
	});

	test('drawer controls are thumb-sized, and dials share one column', async ({
		electronApp,
		mainWindow,
	}) => {
		await resize(mainWindow, electronApp, { ...PHONE, width: 320 });
		const drawer = await openDrawer(mainWindow);
		await expect(drawer.locator('.compact-drawer__folder-label')).toHaveText([
			'General',
		]);
		await expect(drawer.getByText('No panels')).toHaveCount(0);

		const row = drawer.locator('.compact-drawer__row-main').first();
		const rowBox = await row.boundingBox();
		if (!rowBox) throw new Error('Expected a drawer row');
		expect(rowBox.height).toBeGreaterThanOrEqual(44);
		for (const control of [
			drawer.locator('.compact-drawer__folder-add').first(),
			drawer.locator('.compact-drawer__folder-more').first(),
			drawer.locator('[data-compact-switcher-project]').first(),
		]) {
			const box = await control.boundingBox();
			if (!box) throw new Error('Expected a drawer control');
			expect(box.width).toBeGreaterThanOrEqual(28);
			expect(box.height).toBeGreaterThanOrEqual(28);
		}

		// The folder's ⋯ and every row's dial slot share one trailing column.
		const lefts = await drawer
			.locator('.compact-drawer__wslot')
			.evaluateAll((slots) =>
				slots.map((slot) => Math.round(slot.getBoundingClientRect().left)),
			);
		expect(lefts.length).toBeGreaterThanOrEqual(2);
		expect(new Set(lefts).size).toBe(1);

		// The drawer leaves a strip of scrim to press, and never scrolls sideways.
		const drawerBox = await drawer.boundingBox();
		if (!drawerBox) throw new Error('Expected the drawer');
		expect(drawerBox.width).toBeLessThan(320);
		const overflow = await drawer.evaluate(
			(element) => element.scrollWidth - element.clientWidth,
		);
		expect(overflow).toBeLessThanOrEqual(1);
	});

	test('a project header counts what its rows show', async ({
		appHarness,
		electronApp,
		mainWindow,
	}) => {
		const idleSession = await activeSessionId(mainWindow);
		await appHarness.sendAppCommand('new-terminal');
		await expect(mainWindow.getByLabel('Close terminal')).toHaveCount(2);
		await expect.poll(() => activeSessionId(mainWindow)).not.toBe(idleSession);
		const agentSession = await activeSessionId(mainWindow);
		if (!agentSession) throw new Error('Expected the new terminal session');

		// A live agent session owned by the second terminal's own shell.
		const publish = async (fields: Record<string, unknown>) => {
			const accepted = await mainWindow.evaluate(
				async ({ sessionId, extra }) => {
					const seam = window.terminayAgentStatusTest;
					if (!seam) throw new Error('Agent status test seam is unavailable');
					const pid = await seam.terminalShellPid(sessionId);
					if (pid === null)
						throw new Error('Terminal shell pid is unavailable');
					return await seam.publishSessions({
						sourceId: 'com.terminay.e2e/agents',
						harnesses: [{ id: 'codex', displayName: 'Codex' }],
						publication: {
							upserts: [
								{
									harness: 'codex',
									pid,
									cwd: '/tmp',
									id: 'codex-e2e-switcher-summary',
									title: 'Summarise the switcher',
									...extra,
								},
							],
						},
					});
				},
				{ sessionId: agentSession, extra: fields },
			);
			if (!accepted)
				throw new Error('Agent session publication was not accepted');
		};
		await publish({ status: 'running' });

		await resize(mainWindow, electronApp, PHONE);
		const drawer = await openDrawer(mainWindow);
		const summary = drawer.locator('[data-compact-switcher-summary]');
		await expect(summary).toHaveText('1 working · 1 idle');
		await expect(summary).toHaveAttribute('aria-label', '1 working, 1 idle');
		// The rail item for the project carries the working badge.
		await expect(
			drawer
				.locator('[data-compact-switcher-project]')
				.first()
				.locator('.compact-drawer__badge--working'),
		).toHaveText('1');

		// What the header says is what its rows show, state for state.
		const fromRows = () =>
			drawer.evaluate((element) => {
				const counts = { attention: 0, working: 0, done: 0, idle: 0 };
				for (const row of element.querySelectorAll(
					'[data-compact-switcher-terminal]',
				)) {
					const state =
						row
							.querySelector('.agent-status-indicator')
							?.getAttribute('data-agent-state') ?? 'idle';
					if (state === 'waiting' || state === 'blocked') counts.attention += 1;
					else counts[state as 'working' | 'done' | 'idle'] += 1;
				}
				const word = (group: string, count: number) =>
					group !== 'attention'
						? `${count} ${group}`
						: count === 1
							? '1 needs you'
							: `${count} need you`;
				return Object.entries(counts)
					.filter(([, count]) => count > 0)
					.slice(0, 2)
					.map(([group, count]) => word(group, count))
					.join(' · ');
			});
		expect(await fromRows()).toBe('1 working · 1 idle');

		// The leading group is drawn in the colour its row's indicator uses.
		const colours = await drawer.evaluate((element) => {
			const lead = element.querySelector('.compact-drawer__summary-group');
			const indicator = element.querySelector(
				'.agent-status-indicator[data-agent-state="working"]',
			);
			if (!lead || !indicator) throw new Error('Expected a working row');
			return {
				indicator: getComputedStyle(indicator).color,
				lead: getComputedStyle(lead).color,
			};
		});
		expect(colours.lead).toBe(colours.indicator);

		// The agent finishes while its terminal is in front, so the finish is
		// already seen: the row goes quiet and the header follows it.
		await publish({
			status: 'idle',
			lastTurn: 'completed',
			lastTurnEndedAt: Date.now(),
		});
		await expect(
			drawer.locator('.agent-status-indicator[data-agent-state="working"]'),
		).toHaveCount(0);
		await expect.poll(fromRows).not.toContain('working');
		await expect
			.poll(async () => (await summary.innerText()).trim())
			.toBe(await fromRows());
	});

	test('the drawer offers Tabs and Agents for the project in front', async ({
		appHarness,
		electronApp,
		mainWindow,
	}) => {
		// An agent in a second terminal, with the first terminal in front.
		await resize(mainWindow, electronApp, {
			x: 40,
			y: 40,
			width: 1280,
			height: 800,
		});
		const firstSession = await activeSessionId(mainWindow);
		await appHarness.sendAppCommand('new-terminal');
		await expect.poll(() => activeSessionId(mainWindow)).not.toBe(firstSession);
		const agentSession = await activeSessionId(mainWindow);
		if (agentSession === null) throw new Error('Expected a second terminal');
		await mainWindow.evaluate(async (terminalSessionId) => {
			const seam = window.terminayAgentStatusTest;
			if (!seam) throw new Error('Agent status test seam is unavailable');
			const pid = await seam.terminalShellPid(terminalSessionId);
			if (pid === null) throw new Error('Terminal shell pid is unavailable');
			const accepted = await seam.publishSessions({
				sourceId: 'com.terminay.e2e/agents',
				harnesses: [{ id: 'codex', displayName: 'Codex' }],
				publication: {
					upserts: [
						{
							harness: 'codex',
							pid,
							cwd: '/tmp',
							id: 'codex-switcher',
							title: 'Agent reached from the switcher',
							status: 'running',
						},
					],
				},
			});
			if (!accepted) throw new Error('Agent publication was not accepted');
		}, agentSession);
		await mainWindow
			.locator('.terminal-tab-content')
			.filter({ hasText: 'Terminal 1' })
			.click();
		await expect.poll(() => activeSessionId(mainWindow)).toBe(firstSession);

		await resize(mainWindow, electronApp, PHONE);
		const drawer = await openDrawer(mainWindow);

		// Opens on Tabs: the tree and its create bar.
		const tabsTab = drawer.getByRole('tab', { name: 'Tabs' });
		const agentsTab = drawer.getByRole('tab', { name: 'Agents' });
		await expect(drawer.getByRole('tab')).toHaveCount(2);
		await expect(tabsTab).toHaveAttribute('aria-selected', 'true');
		await expect(
			drawer.locator('[data-compact-switcher-terminal]'),
		).not.toHaveCount(0);
		const create = drawer.locator('[data-compact-switcher-new-terminal]');
		await expect(create).toBeVisible();

		// Agents shows the project's agent in place of all of that, and
		// raises no keyboard.
		await agentsTab.click();
		await expect(agentsTab).toHaveAttribute('aria-selected', 'true');
		const agent = drawer.locator('.agents-sidebar__agent');
		await expect(agent).toHaveCount(1);
		await expect(drawer.locator('.agents-sidebar__name')).toContainText(
			'Agent reached from the switcher',
		);
		await expect(
			drawer.locator('[data-compact-switcher-terminal]'),
		).toHaveCount(0);
		await expect(create).toHaveCount(0);
		await expect(drawer.locator('input')).toHaveCount(0);

		// Pressing the agent shows its terminal and dismisses the drawer.
		await agent.click();
		await expect(drawer).toHaveCount(0);
		await expect.poll(() => activeSessionId(mainWindow)).toBe(agentSession);

		// Every open starts on Tabs.
		await openDrawer(mainWindow);
		await expect(tabsTab).toHaveAttribute('aria-selected', 'true');

		// Home in the rail has no agents to show.
		await drawer.locator('[data-compact-switcher-home="true"]').click();
		await expect(drawer.getByRole('tab')).toHaveCount(0);
		await mainWindow.keyboard.press('Escape');
		await expect(drawer).toHaveCount(0);
	});
});
