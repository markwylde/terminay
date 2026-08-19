import { expect, test } from './fixtures';

const VIEWPORTS = [
	{ name: 'wide', width: 1280, height: 900 },
	{ name: 'medium', width: 900, height: 760 },
	{ name: 'compact-desktop', width: 640, height: 720 },
] as const;

const ROUTES = [
	{ route: 'workspace', view: null },
	{ route: 'settings', view: 'settings' },
	{ route: 'macros', view: 'macros' },
	{ route: 'recordings', view: 'recordings' },
	{ route: 'file', view: 'edit-tab' },
	{ route: 'connections', view: 'connections' },
	{ route: 'git', view: 'git' },
	{ route: 'workspace', view: 'agents' },
	{ route: 'file', view: 'folder' },
	{ route: 'workspace', view: 'terminal' },
] as const;

test('real Desktop renderer presents every production-mapped shared route without overflow', async ({
	mainWindow,
}, testInfo) => {
	test.setTimeout(60_000);
	const rendererUrl = new URL(mainWindow.url());

	for (const viewport of VIEWPORTS) {
		await mainWindow.setViewportSize({
			width: viewport.width,
			height: viewport.height,
		});
		for (const route of ROUTES) {
			const target = new URL(rendererUrl);
			if (route.view !== null) target.searchParams.set('view', route.view);
			if (route.view === 'edit-tab')
				target.searchParams.set('kind', 'terminal');
			await mainWindow.goto(target.toString());

			const entry = mainWindow.locator(
				`[data-shared-ui="responsive-workspace"][data-shared-route="${route.route}"]`,
			);
			await expect(entry).toBeVisible();
			await expect(entry).toHaveAttribute('data-shared-route-count', '7');
			await expect(entry).toHaveAttribute(
				'data-shared-route-presentation',
				route.route === 'settings' ||
					route.route === 'macros' ||
					route.route === 'recordings' ||
					route.route === 'file' ||
					route.route === 'git'
					? 'native-auxiliary'
					: 'in-page',
			);
			if (route.route === 'connections') {
				await expect(
					entry.locator('[data-shared-route-body="connections"]'),
				).toBeVisible();
				await expect(
					entry.getByRole('listbox', { name: 'Saved Terminay servers' }),
				).toHaveCount(1);
			}
			if (route.route === 'git') {
				await expect(
					entry.locator('[data-shared-route-body="git"]'),
				).toBeVisible();
				await expect(
					entry.locator(
						'[role="status"], [role="listbox"], [role="alert"], [aria-label="Git worktrees"]',
					),
				).toHaveCount(1);
			}
			if (route.view === 'agents') {
				await expect(
					entry.locator('[data-shared-route-body="agents"]'),
				).toBeVisible();
				await expect(
					entry.locator('[role="status"], [role="list"], [role="alert"]'),
				).toHaveCount(1);
			}
			if (route.view === 'folder') {
				await expect(
					entry.locator('[data-shared-route-body="folder"]'),
				).toBeVisible();
				await expect(
					entry.locator('[role="status"], [role="tree"], [role="alert"]'),
				).toHaveCount(1);
			}
			if (route.view === 'terminal') {
				await expect(
					entry.locator('[data-shared-route-body="terminal"]'),
				).toBeVisible();
				await expect(
					entry.locator(
						'[role="status"], [aria-label="Terminal sessions"], [role="alert"]',
					),
				).toHaveCount(1);
			}

			const geometry = await mainWindow.evaluate(() => {
				const shared = document.querySelector<HTMLElement>(
					'[data-shared-ui="responsive-workspace"]',
				);
				const bounds = shared?.getBoundingClientRect();
				return {
					viewportWidth: document.documentElement.clientWidth,
					documentWidth: document.documentElement.scrollWidth,
					bodyWidth: document.body.scrollWidth,
					left: bounds?.left ?? -1,
					right: bounds?.right ?? Number.POSITIVE_INFINITY,
				};
			});
			expect(geometry.documentWidth).toBeLessThanOrEqual(
				geometry.viewportWidth,
			);
			expect(geometry.bodyWidth).toBeLessThanOrEqual(geometry.viewportWidth);
			expect(geometry.left).toBeGreaterThanOrEqual(0);
			expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);

			await mainWindow.screenshot({
				path: testInfo.outputPath(
					`desktop-${viewport.name}-${route.view ?? route.route}.png`,
				),
				animations: 'disabled',
			});
		}
	}
});
