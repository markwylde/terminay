import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { cancelEditWindow, longPress } from './support/ui';

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
		await expect(mainWindow.getByRole('button', { name: 'Home', exact: true })).toBeVisible();
		await expect(mainWindow.getByLabel('Open command bar')).toBeVisible();
		await expect(
			mainWindow.locator('[data-compact-breadcrumb="true"]'),
		).toBeVisible();
		await expect(
			mainWindow.locator('[data-compact-connection="true"]'),
		).toBeVisible();
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
		await mainWindow.getByRole('button', { name: 'Home', exact: true }).click();
		await expect(mainWindow.locator('.app-shell')).toHaveAttribute(
			'data-terminay-selected-view',
			'home',
		);
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

	test('long-pressing a switcher terminal row opens that terminal editor', async ({
		electronApp,
		mainWindow,
	}) => {
		await resize(mainWindow, electronApp, PHONE);
		await mainWindow.locator('[data-compact-breadcrumb="true"]').click();
		const switcher = switcherOf(mainWindow);
		await expect(switcher).toBeVisible();

		const terminalRow = switcher
			.locator('[data-compact-switcher-terminal]')
			.first();
		await expect(terminalRow).toBeVisible();
		// The tab strip that used to carry this gesture is not drawn here.
		await expect(
			mainWindow.locator('.dv-tabs-and-actions-container:visible'),
		).toHaveCount(0);
		await longPress(terminalRow);

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
		await mainWindow.locator('[data-compact-breadcrumb="true"]').click();
		const switcher = switcherOf(mainWindow);
		await expect(switcher).toBeVisible();
		await switcher.locator('[data-compact-switcher-terminal]').first().click();

		// Activation, not editing: the press is short.
		await expect(switcher).toHaveCount(0);
		await expect(
			mainWindow.getByRole('heading', { name: 'Edit Terminal Tab' }),
		).toHaveCount(0);
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

	test('closes a terminal from the switcher and keeps the sheet open', async ({
		appHarness,
		electronApp,
		mainWindow,
	}) => {
		await appHarness.sendAppCommand('new-terminal');
		await expect(
			mainWindow.getByLabel('Close terminal'),
		).toHaveCount(2);

		await resize(mainWindow, electronApp, PHONE);
		await mainWindow.locator('[data-compact-breadcrumb="true"]').click();
		const switcher = switcherOf(mainWindow);
		await expect(switcher).toBeVisible();
		const rows = switcher.locator('[data-compact-switcher-terminal]');
		await expect(rows).toHaveCount(2);
		const closedTitle = (
			await rows.first().locator('.compact-switcher__terminal-title').innerText()
		).trim();
		await switcher
			.locator('.compact-switcher__row')
			.first()
			.getByRole('button', { name: `Close ${closedTitle}` })
			.click();
		await expect(rows).toHaveCount(1);
		await expect(switcher).toBeVisible();
	});

	test('closes a project from the switcher heading', async ({
		electronApp,
		mainWindow,
	}) => {
		await expect(mainWindow.locator('.project-tab')).not.toHaveCount(0);
		await mainWindow.getByLabel('Create project').click();
		await expect(mainWindow.locator('[data-pending-project-id]')).toHaveCount(
			0,
		);
		await expect(mainWindow.locator('.project-tab')).toHaveCount(2);

		await resize(mainWindow, electronApp, PHONE);
		await mainWindow.locator('[data-compact-breadcrumb="true"]').click();
		const switcher = switcherOf(mainWindow);
		await expect(switcher).toBeVisible();
		const headings = switcher.locator('[data-compact-switcher-project]');
		await expect(headings).toHaveCount(2);
		const closedTitle = (
			await headings
				.last()
				.locator('.compact-switcher__project-name')
				.innerText()
		).trim();
		await switcher.getByRole('button', { name: `Close ${closedTitle}` }).click();
		await expect(headings).toHaveCount(1);
		await expect(switcher).toBeVisible();
	});

	test('creating a terminal from the switcher shows the new terminal', async ({
		electronApp,
		mainWindow,
	}) => {
		await resize(mainWindow, electronApp, PHONE);
		await expect(mainWindow.locator('.terminal-panel')).toHaveCount(1);
		const originalSessionId = await activeSessionId(mainWindow);

		await mainWindow.locator('[data-compact-breadcrumb="true"]').click();
		const switcher = switcherOf(mainWindow);
		await expect(switcher).toBeVisible();
		// The bar says where the terminal will land before it is pressed.
		const create = switcher.locator('[data-compact-switcher-new-terminal]');
		await expect(create).toHaveText(/^Terminal in .+ › General$/);
		await expect(create).toHaveAccessibleName(/^New terminal in General of .+/);
		await create.click();
		await expect(switcher).toHaveCount(0);

		// The terminal on screen is the one just created, not the one the user
		// was looking at when they asked for it.
		await expect(mainWindow.getByLabel('Close terminal')).toHaveCount(2);
		await expect
			.poll(() => activeSessionId(mainWindow))
			.not.toBe(originalSessionId);

		// And the switcher agrees with the screen about which one is current.
		await mainWindow.locator('[data-compact-breadcrumb="true"]').click();
		const rows = switcherOf(mainWindow).locator(
			'[data-compact-switcher-terminal]',
		);
		await expect(rows).toHaveCount(2);
		await expect(rows.last()).toHaveAttribute('aria-current', 'true');
	});

	test('creating a terminal in a background project shows it there', async ({
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
		const secondSession = await activeSessionId(mainWindow);

		await resize(mainWindow, electronApp, PHONE);
		await mainWindow.locator('[data-compact-breadcrumb="true"]').click();
		const switcher = switcherOf(mainWindow);
		await expect(switcher).toBeVisible();
		await switcher
			.locator('.compact-switcher__card')
			.filter({
				has: mainWindow.locator(
					`.compact-switcher__terminal[data-project-id="${firstProject}"]`,
				),
			})
			.locator('.compact-switcher__add')
			.click();

		await expect(switcher).toHaveCount(0);
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

	test('with the dashboard in front New project is the wide create control', async ({
		electronApp,
		mainWindow,
	}) => {
		await resize(mainWindow, electronApp, PHONE);
		await mainWindow.getByRole('button', { name: 'Home', exact: true }).click();
		await expect(mainWindow.locator('.app-shell')).toHaveAttribute(
			'data-terminay-selected-view',
			'home',
		);
		await mainWindow.locator('[data-compact-breadcrumb="true"]').click();
		const switcher = switcherOf(mainWindow);
		await expect(switcher).toBeVisible();
		// Nothing offers a terminal "here" when here is not a project.
		await expect(
			switcher.locator('[data-compact-switcher-new-terminal]'),
		).toHaveCount(0);
		await expect(switcher.locator('.compact-switcher__create-main')).toHaveText(
			'New project',
		);
		await expect(
			switcher.getByRole('button', { name: 'Add connection' }),
		).toBeVisible();
	});

	test('a project is one card, and its small controls are still thumb-sized', async ({
		electronApp,
		mainWindow,
	}) => {
		await resize(mainWindow, electronApp, { ...PHONE, width: 320 });
		await mainWindow.locator('[data-compact-breadcrumb="true"]').click();
		const switcher = switcherOf(mainWindow);
		await expect(switcher).toBeVisible();
		const card = switcher.locator('.compact-switcher__card').first();
		// Header, folder label, and row all sit inside the card.
		await expect(card.locator('[data-compact-switcher-project]')).toHaveCount(1);
		await expect(card.locator('.compact-switcher__folder-name')).toHaveText([
			'General',
		]);
		await expect(card.locator('[data-compact-switcher-terminal]')).toHaveCount(
			1,
		);
		await expect(switcher.getByText('No panels')).toHaveCount(0);

		for (const control of [
			card.locator('.compact-switcher__project .compact-switcher__close'),
			card.locator('.compact-switcher__row .compact-switcher__close'),
			card.locator('.compact-switcher__folder-line .compact-switcher__add'),
		]) {
			const box = await control.boundingBox();
			if (!box) throw new Error('Expected a switcher control');
			expect(box.width).toBeGreaterThanOrEqual(28);
			expect(box.height).toBeGreaterThanOrEqual(28);
		}

		// The edge of a card is an edge even for a project coloured black.
		const colours = await card.evaluate((element) => {
			(element as HTMLElement).style.setProperty(
				'--compact-switcher-project',
				'#000000',
			);
			const sheet = element.closest('.compact-switcher');
			if (!sheet) throw new Error('Expected the switcher sheet');
			return {
				border: getComputedStyle(element).borderTopColor,
				sheet: getComputedStyle(sheet).backgroundColor,
			};
		});
		expect(colours.border).not.toBe(colours.sheet);
		expect(colours.border).not.toBe('rgba(0, 0, 0, 0)');

		// A press in the middle of the folder's small control still creates.
		const add = card.locator('.compact-switcher__folder-line .compact-switcher__add');
		const box = await add.boundingBox();
		if (!box) throw new Error('Expected the folder new-terminal control');
		await mainWindow.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
		await expect(switcher).toHaveCount(0);
		await expect(mainWindow.getByLabel('Close terminal')).toHaveCount(2);
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
					if (pid === null) throw new Error('Terminal shell pid is unavailable');
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
			if (!accepted) throw new Error('Agent session publication was not accepted');
		};
		await publish({ status: 'running' });

		await resize(mainWindow, electronApp, PHONE);
		await mainWindow.locator('[data-compact-breadcrumb="true"]').click();
		const switcher = switcherOf(mainWindow);
		await expect(switcher).toBeVisible();
		const card = switcher.locator('.compact-switcher__card').first();
		const summary = card.locator('[data-compact-switcher-summary]');
		await expect(summary).toHaveText('1 working · 1 idle');
		await expect(summary).toHaveAttribute('aria-label', '1 working, 1 idle');
		await expect(card.locator('.project-tab-activity-dot')).toHaveCount(0);

		// What the header says is what its rows show, state for state.
		const fromRows = () =>
			card.evaluate((element) => {
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
		const colours = await card.evaluate((element) => {
			const lead = element.querySelector('.compact-switcher__summary-group');
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
			card.locator('.agent-status-indicator[data-agent-state="working"]'),
		).toHaveCount(0);
		await expect.poll(fromRows).not.toContain('working');
		await expect.poll(async () => (await summary.innerText()).trim()).toBe(
			await fromRows(),
		);
	});

	test('the compact switcher offers Tabs and Agents', async ({
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
		await expect
			.poll(() => activeSessionId(mainWindow))
			.not.toBe(firstSession);
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
		const breadcrumb = mainWindow.locator('[data-compact-breadcrumb="true"]');
		await breadcrumb.click();
		const switcher = switcherOf(mainWindow);
		await expect(switcher).toBeVisible();

		// Opens on Tabs: the list, its filter, and its create bar.
		const tabsTab = switcher.getByRole('tab', { name: 'Tabs' });
		const agentsTab = switcher.getByRole('tab', { name: 'Agents' });
		await expect(switcher.getByRole('tab')).toHaveCount(2);
		await expect(tabsTab).toHaveAttribute('aria-selected', 'true');
		await expect(
			switcher.locator('[data-compact-switcher-terminal]'),
		).not.toHaveCount(0);
		const filter = switcher.getByRole('button', {
			name: 'Search terminals and projects',
		});
		const addConnection = switcher.getByRole('button', {
			name: 'Add connection',
		});
		await expect(filter).toBeVisible();
		await expect(addConnection).toBeVisible();

		// Agents shows the project's agent in place of all of that, and
		// raises no keyboard.
		await agentsTab.click();
		await expect(agentsTab).toHaveAttribute('aria-selected', 'true');
		const agent = switcher.locator('.agents-sidebar__agent');
		await expect(agent).toHaveCount(1);
		await expect(switcher.locator('.agents-sidebar__name')).toContainText(
			'Agent reached from the switcher',
		);
		await expect(
			switcher.locator('[data-compact-switcher-terminal]'),
		).toHaveCount(0);
		await expect(filter).toHaveCount(0);
		await expect(addConnection).toHaveCount(0);
		await expect(switcher.locator('input')).toHaveCount(0);

		// Pressing the agent shows its terminal and dismisses the sheet.
		await agent.click();
		await expect(switcher).toHaveCount(0);
		await expect.poll(() => activeSessionId(mainWindow)).toBe(agentSession);

		// Every open starts on Tabs.
		await breadcrumb.click();
		await expect(switcher).toBeVisible();
		await expect(tabsTab).toHaveAttribute('aria-selected', 'true');
		await mainWindow.keyboard.press('Escape');
		await expect(switcher).toHaveCount(0);

		// With the dashboard in front there is no project whose agents to show.
		await mainWindow.getByRole('button', { name: 'Home', exact: true }).click();
		await mainWindow.locator('[data-compact-connection="true"]').click();
		await expect(switcher).toBeVisible();
		await expect(switcher.getByRole('tab')).toHaveCount(0);
		await expect(
			switcher.locator('[data-compact-switcher-terminal]'),
		).not.toHaveCount(0);
	});
});
