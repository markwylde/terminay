import { expect, test } from './fixtures';
import { prepareWindow, presentNativeRoute } from './support/app';

type AuxiliaryLoad = { url: string; visible: boolean };
type AuxiliaryLoadRecord = { id: number; loads: AuxiliaryLoad[] };

test('Settings is on screen while it connects, takes the latest request, and opens once', async ({
	electronApp,
	mainWindow,
}) => {
	// Record, from main, every main-frame document each new window starts to
	// load and whether the window was visible at that moment, so the order is
	// seen even when the loading document is replaced quickly.
	await electronApp.evaluate(({ app, BrowserWindow }) => {
		const records: AuxiliaryLoadRecord[] = [];
		(
			globalThis as { __auxiliaryLoads?: AuxiliaryLoadRecord[] }
		).__auxiliaryLoads = records;
		app.on('browser-window-created', (_event, window) => {
			const record: AuxiliaryLoadRecord = {
				id: window.webContents.id,
				loads: [],
			};
			records.push(record);
			// Hold completion of the loader so the repeat request is guaranteed
			// to arrive during launch, even on a fast Local connection.
			const loadURL = window.loadURL.bind(window);
			window.loadURL = async (url, options) => {
				await loadURL(url, options);
				if (url.startsWith('data:text/html')) {
					await new Promise<void>((resolve) => {
						(
							globalThis as { __releaseAuxiliaryLoad?: () => void }
						).__releaseAuxiliaryLoad = resolve;
					});
				}
			};
			window.webContents.on(
				'did-start-navigation',
				(details: { url: string; isMainFrame: boolean }) => {
					if (!details.isMainFrame) return;
					const owner = BrowserWindow.fromWebContents(window.webContents);
					record.loads.push({
						url: details.url,
						visible: owner?.isVisible() ?? false,
					});
				},
			);
		});
	});
	const windowsBefore = electronApp.windows().length;

	const nextWindow = electronApp.waitForEvent('window');
	await presentNativeRoute(mainWindow, '/?auxiliary=settings', 'settings');
	const settingsWindow = await nextWindow;
	try {
		await expect
			.poll(() =>
				electronApp.evaluate(
					() =>
						typeof (globalThis as { __releaseAuxiliaryLoad?: () => void })
							.__releaseAuxiliaryLoad === 'function',
				),
			)
			.toBe(true);
		expect(settingsWindow.url().startsWith('data:')).toBe(true);
		await presentNativeRoute(
			mainWindow,
			'/?auxiliary=settings&section=extensions',
			'settings',
		);
		expect(electronApp.windows().length).toBe(windowsBefore + 1);
	} finally {
		await electronApp.evaluate(() => {
			(
				globalThis as { __releaseAuxiliaryLoad?: () => void }
			).__releaseAuxiliaryLoad?.();
		});
	}
	await settingsWindow.waitForURL(
		(url) => url.protocol !== 'data:' && url.protocol !== 'about:',
	);
	await prepareWindow(settingsWindow);

	await expect(
		settingsWindow.locator('.settings-list-item', {
			hasText: 'Built-in Agents',
		}),
	).toBeVisible();
	expect(new URL(settingsWindow.url()).searchParams.get('section')).toBe(
		'extensions',
	);
	expect(electronApp.windows().length).toBe(windowsBefore + 1);

	const records = await electronApp.evaluate(
		() =>
			(globalThis as { __auxiliaryLoads?: AuxiliaryLoadRecord[] })
				.__auxiliaryLoads ?? [],
	);
	expect(records).toHaveLength(1);
	const loads = records[0]?.loads ?? [];
	expect(loads[0]?.url.startsWith('data:text/html')).toBe(true);
	const workspaceLoad = loads.find((load) => load.url.startsWith('file:'));
	expect(workspaceLoad).toBeDefined();
	// The window was already on screen, on the loader, when its page began.
	expect(workspaceLoad?.visible).toBe(true);
	await settingsWindow.close();
});

for (const phase of ['before commit', 'after commit']) {
	test(`a request ${phase} during the first workspace navigation selects the latest section`, async ({
		electronApp,
		mainWindow,
	}) => {
		await electronApp.evaluate(({ app }, phase) => {
			app.once('browser-window-created', (_event, window) => {
				const loadURL = window.loadURL.bind(window);
				let firstWorkspace = true;
				window.loadURL = async (url, options) => {
					if (url.startsWith('file:') && firstWorkspace) {
						firstWorkspace = false;
						if (phase === 'after commit') await loadURL(url, options);
						await new Promise<void>((resolve) => {
							(
								globalThis as { __releaseWorkspaceLoad?: () => void }
							).__releaseWorkspaceLoad = resolve;
						});
						if (phase === 'after commit') return;
					}
					await loadURL(url, options);
				};
			});
		}, phase);
		const nextWindow = electronApp.waitForEvent('window');
		await presentNativeRoute(mainWindow, '/?auxiliary=settings', 'settings');
		const settingsWindow = await nextWindow;
		try {
			await expect
				.poll(() =>
					electronApp.evaluate(
						() =>
							typeof (globalThis as { __releaseWorkspaceLoad?: () => void })
								.__releaseWorkspaceLoad === 'function',
					),
				)
				.toBe(true);
			await presentNativeRoute(
				mainWindow,
				'/?auxiliary=settings&section=extensions',
				'settings',
			);
		} finally {
			await electronApp.evaluate(() => {
				(
					globalThis as { __releaseWorkspaceLoad?: () => void }
				).__releaseWorkspaceLoad?.();
			});
		}
		await expect(settingsWindow).toHaveURL(/section=extensions/);
		await expect(
			settingsWindow.locator('.settings-list-item', {
				hasText: 'Built-in Agents',
			}),
		).toBeVisible();
		await settingsWindow.close();
	});
}
