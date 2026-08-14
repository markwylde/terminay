import { expect, test } from './fixtures';
import { openRemoteMenu } from './support/ui';

test('fails a hosted pairing closed when Desktop has no selected server-owned WebRTC runtime', async ({
	mainWindow,
}) => {
	const runtimeError =
		'Desktop WebRTC Relay is unavailable in this build because its authenticated hosted signaling runtime is not installed.';
	await openRemoteMenu(mainWindow);
	const expose = mainWindow.getByRole('button', {
		name: /Expose this server/u,
	});
	await expect(expose).toBeDisabled();
	await expect(expose).toContainText('Unavailable in this build');
	const openMenu = mainWindow
		.locator('[role="menu"][aria-label="Connection menu"]:visible')
		.first();
	await expect(
		openMenu.getByText(runtimeError, {
			exact: true,
		}),
	).toBeVisible();
});
