import { expect, test } from './fixtures';
import { openSettingsWindow } from './support/app';

// The actual bound preload and main clipboard broker. Mac context-menu Paste
// against real Xvnc is also an explicit manual acceptance check for this change.
test('Desktop shares text without a paste shortcut, fences stale sessions, and stops on reload', async ({
	electronApp,
	mainWindow,
}) => {
	const previous = await electronApp.evaluate(({ clipboard }) =>
		clipboard.readText(),
	);
	try {
		await electronApp.evaluate(({ clipboard }) =>
			clipboard.writeText('host seed ✓'),
		);
		const seed = await mainWindow.evaluate(async () => {
			const host = window.terminayHost as unknown as {
				getContext(): Promise<{ capabilities: { clipboardSync?: number } }>;
				subscribeClipboardSync(listener: (s: unknown) => void): () => void;
				startClipboardSync(token: string): Promise<unknown>;
			};
			if ((await host.getContext()).capabilities.clipboardSync !== 1)
				throw new Error('missing clipboard sync capability');
			const state = window as unknown as { clipboardChanges: unknown[] };
			state.clipboardChanges = [];
			host.subscribeClipboardSync((s) => state.clipboardChanges.push(s));
			return host.startClipboardSync('first_clipboard_session');
		});
		expect(seed).toMatchObject({ active: true, text: 'host seed ✓' });
		// No key event or native paste: changing the native clipboard alone publishes.
		await electronApp.evaluate(({ clipboard }) =>
			clipboard.writeText('copy from another app'),
		);
		await expect
			.poll(() =>
				mainWindow.evaluate(
					() =>
						(
							window as unknown as { clipboardChanges: { text?: string }[] }
						).clipboardChanges.at(-1)?.text,
				),
			)
			.toBe('copy from another app');
		const update = await mainWindow.evaluate(async () => {
			const host = window.terminayHost as unknown as {
				writeClipboardSync(
					token: string,
					revision: number,
					text: string,
				): Promise<unknown>;
			};
			const last = (
				window as unknown as { clipboardChanges: { revision: number }[] }
			).clipboardChanges.at(-1)!;
			return host.writeClipboardSync(
				'first_clipboard_session',
				last.revision,
				'from bot ✓',
			);
		});
		expect(update).toMatchObject({ active: true, text: 'from bot ✓' });
		expect(
			await electronApp.evaluate(({ clipboard }) => clipboard.readText()),
		).toBe('from bot ✓');
		await mainWindow.reload();
		await expect
			.poll(() => mainWindow.evaluate(() => typeof window.terminayHost))
			.toBe('object');
		const refused = await mainWindow.evaluate(async () => {
			const host = window.terminayHost as unknown as {
				writeClipboardSync(
					token: string,
					revision: number,
					text: string,
				): Promise<unknown>;
				startClipboardSync(token: string): Promise<unknown>;
			};
			const failures: string[] = [];
			for (const action of [
				() => host.writeClipboardSync('first_clipboard_session', 3, 'stale'),
				() => host.startClipboardSync('invalid'),
			]) {
				try {
					await action();
				} catch (error) {
					failures.push(String(error));
				}
			}
			return failures;
		});
		expect(refused).toHaveLength(2);
		expect(
			await electronApp.evaluate(({ clipboard }) => clipboard.readText()),
		).toBe('from bot ✓');
	} finally {
		await electronApp.evaluate(
			({ clipboard }, value) => clipboard.writeText(value),
			previous,
		);
	}
});

test('clipboard ownership moves between bound windows and ends when the owner is hidden', async ({
	electronApp,
	mainWindow,
}) => {
	const original = await electronApp.evaluate(({ clipboard }) =>
		clipboard.readText(),
	);
	const second = await openSettingsWindow(electronApp, mainWindow);
	const start = (page: typeof mainWindow, token: string) =>
		page.evaluate(async (token) => {
			const host = window.terminayHost as unknown as {
				startClipboardSync(token: string): Promise<unknown>;
			};
			return host.startClipboardSync(token);
		}, token);
	const refused = (page: typeof mainWindow, token: string) =>
		page.evaluate(async (token) => {
			const host = window.terminayHost as unknown as {
				writeClipboardSync(
					token: string,
					revision: number,
					text: string,
				): Promise<unknown>;
			};
			try {
				await host.writeClipboardSync(token, 1, 'stale window');
				return false;
			} catch {
				return true;
			}
		}, token);
	try {
		await electronApp.evaluate(({ clipboard }) =>
			clipboard.writeText('two-window seed'),
		);
		expect(await start(mainWindow, 'main_window_clipboard')).toMatchObject({
			text: 'two-window seed',
			active: true,
		});
		expect(await start(second, 'second_window_clipboard')).toMatchObject({
			text: 'two-window seed',
			active: true,
		});
		expect(await refused(mainWindow, 'main_window_clipboard')).toBe(true);
		await electronApp.evaluate(({ BrowserWindow }) => {
			const owner = BrowserWindow.getAllWindows().find((w) =>
				w.webContents.getURL().includes('auxiliary=settings'),
			);
			if (!owner) throw new Error('settings owner not found');
			// Auxiliary Settings windows are not minimizable; hide is the real
			// window transition this fixture supports. Both lifecycle events retire sharing.
			owner.hide();
		});
		await expect
			.poll(() => refused(second, 'second_window_clipboard'))
			.toBe(true);
		// Ending the successor must not automatically resume the previous owner.
		expect(await refused(mainWindow, 'main_window_clipboard')).toBe(true);
	} finally {
		await second.close();
		await electronApp.evaluate(
			({ clipboard }, text) => clipboard.writeText(text),
			original,
		);
	}
});
