import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

type UpdateStatus = { channel: string; checkedAt: string | null };

/** The updater's status, as a renderer reads it after asking for a check. */
async function checkForUpdate(page: Page): Promise<UpdateStatus> {
	return await page.evaluate(async () => {
		const host = window.terminayHost;
		if (!host) throw new Error('canonical Terminay host is unavailable');
		const context = await host.getContext();
		const result = (await host.requestAction({
			bridgeVersion: context.hostBridgeVersion,
			profileId: context.profileId,
			schemaVersion: context.schemaVersion,
			serverId: context.serverId,
			sourceId: context.sourceId,
			userGesture: true,
			windowId: context.windowId,
			action: { type: 'updater.check' },
		})) as { channel: string; checkedAt: string | null };
		return { channel: result.channel, checkedAt: result.checkedAt };
	});
}

test('selecting each update channel starts a check on that channel', async ({
	appHarness,
	mainWindow,
}) => {
	const settingsWindow = await appHarness.openSettingsWindow({
		page: mainWindow,
		sectionId: 'update-channel',
	});
	const select = settingsWindow
		.locator('.settings-row', {
			has: settingsWindow.locator('.settings-row-label', {
				hasText: /^Update channel$/u,
			}),
		})
		.locator('select');
	await expect(settingsWindow.locator('.settings-status')).toHaveText('Saved');
	await expect(select).toHaveValue('stable');
	await expect(select.locator('option')).toHaveText([
		'Stable',
		'Nightly',
		'Canary',
	]);

	let previous = (await checkForUpdate(mainWindow)).checkedAt;
	for (const channel of ['canary', 'nightly', 'stable']) {
		await select.selectOption(channel);
		await expect(settingsWindow.locator('.settings-status')).toHaveText(
			'Saved',
		);
		// Switching channel restarts the check on the new one; a development
		// build reads no network, so the check completes at once.
		let status: UpdateStatus = { channel: '', checkedAt: null };
		await expect
			.poll(
				async () => {
					status = await checkForUpdate(mainWindow);
					return status.channel === channel && status.checkedAt !== previous;
				},
				{ message: `a check should start on the ${channel} channel` },
			)
			.toBe(true);
		previous = status.checkedAt;
	}
	await settingsWindow.close();
});

test('a development build shows Install latest disabled, and the host refuses it', async ({
	appHarness,
	mainWindow,
}) => {
	const settingsWindow = await appHarness.openSettingsWindow({
		page: mainWindow,
		sectionId: 'update-channel',
	});
	const row = settingsWindow.locator('[data-install-latest]');
	await expect(row).toHaveAttribute('data-install-latest', 'disabled');
	await expect(row.locator('.settings-row-label')).toHaveText(
		'Install latest on Stable',
	);
	await expect(row).toContainText('A development build has no release version.');
	await expect(row.getByRole('button', { name: 'Install latest…' })).toBeDisabled();

	// The host resolves the build itself, so even a well-formed request from
	// the renderer installs nothing on a build that cannot update in place.
	const refusal = await mainWindow.evaluate(async () => {
		const host = window.terminayHost;
		if (!host) throw new Error('canonical Terminay host is unavailable');
		const context = await host.getContext();
		try {
			await host.requestAction({
				bridgeVersion: context.hostBridgeVersion,
				profileId: context.profileId,
				schemaVersion: context.schemaVersion,
				serverId: context.serverId,
				sourceId: context.sourceId,
				userGesture: true,
				windowId: context.windowId,
				action: { type: 'updater.install-latest', version: '1.0.0' },
			});
			return null;
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
	});
	expect(refusal).toMatch(/cannot install updates in place|development build/u);
	await settingsWindow.close();
});
