import { expect, test } from './fixtures';
import { selectSidebarGroup, setProjectRoot } from './support/ui';

function seededDocuments(count: number): Record<string, string> {
	const files: Record<string, string> = { 'README.md': '# Read me' };
	for (let index = 0; index < count; index += 1) {
		const folder = `docs/section-${index % 12}`;
		files[`${folder}/note-${index}.md`] = `# Note ${index}\n\nBody.\n`;
	}
	return files;
}

function seededDirectories(count: number): string[] {
	return Array.from({ length: count }, (_, index) => `docs/section-${index}`);
}

test('Documentation expands itself on the first visit and indexes in the background', async ({
	createWorkspace,
	mainWindow,
}) => {
	const workspace = await createWorkspace({
		name: 'documentation-background-index',
		seed: {
			directories: seededDirectories(12),
			files: seededDocuments(240),
		},
	});
	await setProjectRoot(mainWindow, workspace.rootDir);

	await selectSidebarGroup(mainWindow, 'documentation');
	const pane = mainWindow
		.locator('.project-workspace--active .sidebar-pane')
		.filter({
			has: mainWindow.locator('.sidebar-pane__title', {
				hasText: 'Documentation',
			}),
		});
	// No header click: selecting the group is what expands the pane.
	await expect(pane).not.toHaveClass(/sidebar-pane--collapsed/);
	await expect(pane.getByRole('tree')).toBeVisible({ timeout: 15_000 });
	await expect(
		pane.getByRole('button', { name: 'Reload documentation' }),
	).toBeVisible({ timeout: 15_000 });
	await expect(pane.locator('.sidebar-pane__count')).toHaveText('241');

	// Switching group, hiding the sidebar, and collapsing the pane must all leave
	// the catalog intact rather than restarting the index.
	await selectSidebarGroup(mainWindow, 'explorer');
	await selectSidebarGroup(mainWindow, 'documentation');
	await expect(pane).not.toHaveClass(/sidebar-pane--collapsed/);
	await expect(pane.locator('.sidebar-pane__count')).toHaveText('241');

	await pane.locator('.sidebar-pane__header').click();
	await expect(pane).toHaveClass(/sidebar-pane--collapsed/);
	await expect(pane.locator('.sidebar-pane__count')).toHaveText('241');
	await pane.locator('.sidebar-pane__header').click();
	await expect(pane).not.toHaveClass(/sidebar-pane--collapsed/);
	await expect(pane.getByRole('tree')).toBeVisible();
	await expect(pane.getByText('Loading documentation…')).toHaveCount(0);

	// A manual collapse survives a later visit in the same app session.
	await pane.locator('.sidebar-pane__header').click();
	await expect(pane).toHaveClass(/sidebar-pane--collapsed/);
	await selectSidebarGroup(mainWindow, 'explorer');
	await selectSidebarGroup(mainWindow, 'documentation');
	await expect(pane).toHaveClass(/sidebar-pane--collapsed/);
});

test('A documentation index can be stopped from the pane header', async ({
	createWorkspace,
	mainWindow,
}) => {
	const workspace = await createWorkspace({
		name: 'documentation-index-stop',
		seed: {
			directories: seededDirectories(12),
			files: seededDocuments(240),
		},
	});
	await setProjectRoot(mainWindow, workspace.rootDir);

	await selectSidebarGroup(mainWindow, 'documentation');
	const pane = mainWindow
		.locator('.project-workspace--active .sidebar-pane')
		.filter({
			has: mainWindow.locator('.sidebar-pane__title', {
				hasText: 'Documentation',
			}),
		});
	const refresh = pane.getByRole('button', { name: 'Reload documentation' });
	const stop = pane.getByRole('button', {
		name: 'Stop indexing documentation',
	});
	await expect(refresh).toBeVisible({ timeout: 15_000 });
	await expect(pane.locator('.sidebar-pane__count')).toHaveText('241');

	// A rebuild of this fixture can settle between two Playwright polls, so the
	// page itself presses stop on the very commit that renders it.
	await mainWindow.evaluate(() => {
		const state = { stopped: false, sawSpinner: false };
		(window as unknown as { __docsStop: typeof state }).__docsStop = state;
		const observer = new MutationObserver(() => {
			const button = document.querySelector<HTMLButtonElement>(
				'.project-workspace--active button[aria-label="Stop indexing documentation"]',
			);
			if (button === null) return;
			state.sawSpinner =
				document.querySelector(
					'.project-workspace--active .sidebar-pane__action-spinner',
				) !== null;
			state.stopped = true;
			observer.disconnect();
			button.click();
		});
		observer.observe(document.body, { childList: true, subtree: true });
	});
	await refresh.click();
	await expect
		.poll(() =>
			mainWindow.evaluate(
				() =>
					(
						window as unknown as {
							__docsStop: { stopped: boolean; sawSpinner: boolean };
						}
					).__docsStop,
			),
		)
		.toEqual({ stopped: true, sawSpinner: true });
	await expect(refresh).toBeVisible();
	await expect(stop).toHaveCount(0);
	// Stopping keeps the catalog that was already loaded.
	await expect(pane.locator('.sidebar-pane__count')).toHaveText('241');
	await expect(pane.getByRole('tree')).toBeVisible();
});
