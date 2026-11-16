import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// Issue #593: Desktop cancels browser downloads, so the workspace saves files
// through the host save (ADR-0130). These drive it through the real preload
// bridge of the workspace window, with only the native dialog stubbed.

type Action = Record<string, unknown> & { type: string };

function hostAction(page: Page, action: Action): Promise<unknown> {
	return page.evaluate(async (action) => {
		const host = window.terminayHost as unknown as {
			getContext(): Promise<Record<string, string>>;
			requestAction(request: unknown): Promise<unknown>;
		};
		const context = await host.getContext();
		try {
			return {
				ok: true,
				value: await host.requestAction({
					schemaVersion: 1,
					bridgeVersion: 1,
					sourceId: context.sourceId,
					windowId: context.windowId,
					profileId: context.profileId,
					serverId: context.serverId,
					userGesture: true,
					action,
				}),
			};
		} catch (error) {
			return { ok: false, error: String((error as Error).message) };
		}
	}, action);
}

test('a host save writes the streamed bytes to the chosen file, and nothing on cancel', async ({
	electronApp,
	mainWindow,
	tempDir: root,
}) => {
	const tempDir = path.join(root, 'saves');
	await mkdir(tempDir);
	const destination = path.join(tempDir, 'notes.txt');
	await electronApp.evaluate(({ dialog }, filePath) => {
		const state = globalThis as unknown as { suggested?: string };
		dialog.showSaveDialog = (async (_window: unknown, options: { defaultPath?: string }) => {
			state.suggested = options?.defaultPath;
			return { canceled: false, filePath };
		}) as typeof dialog.showSaveDialog;
	}, destination);

	const opened = (await hostAction(mainWindow, {
		type: 'file.save.open',
		filename: 'notes.txt',
	})) as { ok: boolean; value: { canceled: boolean; token: string } };
	expect(opened.ok).toBe(true);
	expect(opened.value.canceled).toBe(false);
	expect(JSON.stringify(opened.value)).not.toContain(tempDir);
	const suggested = await electronApp.evaluate(
		() => (globalThis as unknown as { suggested?: string }).suggested,
	);
	expect(path.basename(suggested ?? '')).toBe('notes.txt');

	const { token } = opened.value;
	for (const text of ['hello ', 'world'])
		expect(
			await hostAction(mainWindow, {
				type: 'file.save.write',
				token,
				bytesBase64: Buffer.from(text).toString('base64'),
			}),
		).toMatchObject({ ok: true });
	expect(await readdir(tempDir)).not.toContain('notes.txt');
	expect(
		await hostAction(mainWindow, { type: 'file.save.close', token, commit: true }),
	).toEqual({ ok: true, value: { saved: true } });
	expect(await readFile(destination, 'utf8')).toBe('hello world');

	// A finished save's token is refused, without naming any path.
	const refused = (await hostAction(mainWindow, {
		type: 'file.save.write',
		token,
		bytesBase64: Buffer.from('x').toString('base64'),
	})) as { ok: boolean; error: string };
	expect(refused.ok).toBe(false);
	expect(refused.error).toContain('This save has ended.');
	expect(refused.error).not.toContain(tempDir);

	await electronApp.evaluate(({ dialog }) => {
		dialog.showSaveDialog = (async () => ({
			canceled: true,
			filePath: '',
		})) as typeof dialog.showSaveDialog;
	});
	expect(
		await hostAction(mainWindow, { type: 'file.save.open', filename: 'other.txt' }),
	).toEqual({ ok: true, value: { canceled: true } });
	expect((await readdir(tempDir)).sort()).toEqual(['notes.txt']);
});

test('an abandoned host save leaves nothing beside the destination', async ({
	electronApp,
	mainWindow,
	tempDir: root,
}) => {
	const tempDir = path.join(root, 'saves');
	await mkdir(tempDir);
	const destination = path.join(tempDir, 'project.tar');
	await electronApp.evaluate(({ dialog }, filePath) => {
		dialog.showSaveDialog = (async () => ({
			canceled: false,
			filePath,
		})) as typeof dialog.showSaveDialog;
	}, destination);
	const opened = (await hostAction(mainWindow, {
		type: 'file.save.open',
		filename: 'project.tar',
	})) as { value: { token: string } };
	const { token } = opened.value;
	await hostAction(mainWindow, {
		type: 'file.save.write',
		token,
		bytesBase64: Buffer.from('partial').toString('base64'),
	});
	expect(
		await hostAction(mainWindow, { type: 'file.save.close', token, commit: false }),
	).toEqual({ ok: true, value: { saved: false } });
	expect(await readdir(tempDir)).toEqual([]);
});
