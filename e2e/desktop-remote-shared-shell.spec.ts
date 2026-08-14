import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { expect, test } from './fixtures';
import { openRemoteMenu } from './support/ui';

type ServerReadiness = {
	pairing: { pairingUrl: string };
	protocolEndpoint: string;
	ready: boolean;
	serverId: string;
};

async function readReadiness(
	child: ChildProcessWithoutNullStreams,
): Promise<ServerReadiness> {
	child.stdout.setEncoding('utf8');
	child.stderr.setEncoding('utf8');
	let stdout = '';
	let stderr = '';
	child.stderr.on('data', (chunk) => {
		stderr += chunk;
	});

	return await new Promise<ServerReadiness>((resolve, reject) => {
		const timeout = setTimeout(
			() => reject(new Error(`remote Desktop server timed out: ${stderr}`)),
			10_000,
		);
		const onData = (chunk: string) => {
			stdout += chunk;
			const newline = stdout.indexOf('\n');
			if (newline < 0) return;
			clearTimeout(timeout);
			child.stdout.off('data', onData);
			try {
				resolve(JSON.parse(stdout.slice(0, newline)) as ServerReadiness);
			} catch (error) {
				reject(error);
			}
		};
		child.stdout.on('data', onData);
		child.once('error', reject);
		child.once('exit', (code, signal) => {
			clearTimeout(timeout);
			reject(
				new Error(
					`remote Desktop server exited before readiness: code=${code} signal=${signal} ${stderr}`,
				),
			);
		});
	});
}

async function stopServer(
	child: ChildProcessWithoutNullStreams,
): Promise<void> {
	if (child.exitCode !== null) return;
	child.kill('SIGTERM');
	await Promise.race([
		once(child, 'exit'),
		new Promise((resolve) => setTimeout(resolve, 2_000)),
	]);
	if (child.exitCode === null) child.kill('SIGKILL');
}

test('authenticated remote Desktop renders the project-scoped shared shell locally', async ({
	createWorkspace,
	mainWindow,
	tempDir,
}) => {
	const workspace = await createWorkspace({
		name: 'remote-desktop-project',
		seed: { files: { 'remote-proof.txt': 'remote Desktop scope' } },
	});
	const server = spawn(
		process.execPath,
		[
			path.resolve('apps/terminay-server/dist/cli.js'),
			'--server-id',
			'remote-desktop-rendered-proof',
			'--data-root',
			path.join(tempDir, 'remote-desktop-data'),
			'--project-root',
			workspace.rootDir,
			'--http-host',
			'127.0.0.1',
			'--http-port',
			'0',
		],
		{
			cwd: process.cwd(),
			env: {
				...process.env,
				TERMINAY_AGENT_INTEGRATION: 'disabled',
				TERMINAY_SERVER_VERSION: '1.0.0',
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		},
	);

	try {
		const readiness = await readReadiness(server);
		expect(readiness.ready).toBe(true);
		expect(readiness.serverId).toBe('remote-desktop-rendered-proof');

		await openRemoteMenu(mainWindow);
		await mainWindow
			.getByRole('button', { name: /Add connection/u })
			.click();
	const dialog = mainWindow.getByRole('dialog', {
			name: 'Connections',
		});
		await expect(dialog).toBeVisible();
		// This remote Desktop document owns only remembered remote profiles.
		// Local's immutable profile is covered by the Local connection-manager
		// journey; it is intentionally not imported into a remote host document.
		await dialog.getByRole('button', { name: 'Add connection…' }).click();
		await dialog.getByLabel('Pairing URL').fill(readiness.pairing.pairingUrl);
		await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
		await expect(dialog).toHaveCount(0);

		const remoteHost = new URL(readiness.protocolEndpoint).host;
		await expect(mainWindow.getByLabel('Open connection menu')).toContainText(
			remoteHost,
		);
		await openRemoteMenu(mainWindow);
		const currentRemoteProfile = mainWindow
			.getByRole('menu', { name: 'Connection menu' })
			.getByRole('menuitemradio', { checked: true });
		await expect(currentRemoteProfile).toContainText(remoteHost);
		await expect(currentRemoteProfile).toContainText('Current');

		const terminalRoute = new URL(mainWindow.url());
		terminalRoute.search = '?view=terminal';
		await mainWindow.goto(terminalRoute.toString());
		const shell = mainWindow.locator(
			'[data-shared-ui="responsive-workspace"][data-shared-route="workspace"]',
		);
		await expect(shell).toBeVisible();
		await expect(
			shell.locator('[data-shared-route-body="terminal"]'),
		).toBeVisible();
		const terminalSessions = shell.getByRole('list', {
			name: 'Terminal sessions',
		});
		const initialSessionCount = await terminalSessions
			.getByRole('listitem')
			.count();
		await shell.getByRole('button', { name: 'New terminal' }).click();
		await expect(terminalSessions.getByRole('listitem')).toHaveCount(
			initialSessionCount + 1,
		);
		await expect(shell.getByRole('alert')).toHaveCount(0);
	} finally {
		await stopServer(server);
	}
});
