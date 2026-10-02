import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from './fixtures';

type StandaloneServer = Readonly<{
	pairingUrl: string;
	stop: () => Promise<void>;
}>;

/** Start the compiled standalone server on a loopback HTTP port of its own
 * choosing and return the one-time pairing URL it advertises. */
async function startStandaloneServer(root: string): Promise<StandaloneServer> {
	const dataRoot = path.join(root, 'standalone-data');
	const projectRoot = path.join(root, 'standalone-project');
	await mkdir(dataRoot, { recursive: true });
	await mkdir(projectRoot, { recursive: true });
	const child: ChildProcess = spawn(
		process.execPath,
		[
			path.resolve('apps/terminay-server/dist/cli.js'),
			'--server-id',
			'build-box',
			'--data-root',
			dataRoot,
			'--project-root',
			projectRoot,
			'--http-host',
			'127.0.0.1',
			'--http-port',
			'0',
		],
		{ stdio: ['ignore', 'pipe', 'pipe'] },
	);
	let stderr = '';
	child.stderr?.on('data', (chunk) => {
		stderr += String(chunk);
	});
	const stop = async () => {
		if (child.exitCode !== null) return;
		child.kill('SIGTERM');
		await Promise.race([
			once(child, 'exit'),
			new Promise((resolve) => setTimeout(resolve, 5_000)),
		]);
		if (child.exitCode === null) child.kill('SIGKILL');
	};
	try {
		const pairingUrl = await new Promise<string>((resolve, reject) => {
			let buffered = '';
			const timeout = setTimeout(
				() => reject(new Error(`standalone server was not ready: ${stderr}`)),
				20_000,
			);
			child.once('exit', (code) => {
				clearTimeout(timeout);
				reject(new Error(`standalone server exited ${code}: ${stderr}`));
			});
			child.stdout?.on('data', (chunk) => {
				buffered += String(chunk);
				const lines = buffered.split('\n');
				buffered = lines.pop() ?? '';
				for (const line of lines) {
					try {
						const parsed = JSON.parse(line) as {
							ready?: unknown;
							pairing?: { pairingUrl?: unknown };
						};
						if (
							parsed.ready === true &&
							typeof parsed.pairing?.pairingUrl === 'string'
						) {
							clearTimeout(timeout);
							resolve(parsed.pairing.pairingUrl);
						}
					} catch {
						// Only the readiness line is protocol output.
					}
				}
			});
		});
		return { pairingUrl, stop };
	} catch (error) {
		await stop();
		throw error;
	}
}

test('Add connection pairs Desktop with a standalone server over loopback HTTP', async ({
	appHarness,
	mainWindow,
	tempDir,
}) => {
	test.setTimeout(90_000);
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	const server = await startStandaloneServer(tempDir);
	try {
		expect(new URL(server.pairingUrl).origin).toMatch(
			/^http:\/\/127\.0\.0\.1:\d+$/u,
		);
		const serverHost = new URL(server.pairingUrl).host;
		const connectionMenuButton = mainWindow.getByRole('button', {
			name: /Open connection menu/,
		});
		const menu = mainWindow
			.locator('[role="menu"][aria-label="Connection menu"]:visible')
			.first();

		const manager = await appHarness.openChildWindow(async () => {
			await connectionMenuButton.click();
			await mainWindow
				.getByRole('button', { name: 'Manage connections' })
				.click();
		});
		await manager.getByRole('button', { name: 'Add connection…' }).click();
		await manager.getByLabel('Pairing URL').fill(server.pairingUrl);
		await manager
			.getByRole('button', { name: 'Continue pairing', exact: true })
			.click();

		// Enrollment saved the server: the connection menu now offers it. The
		// menu asks the host for remembered connections each time it opens.
		const attach = menu.getByRole('button', {
			name: `Attach ${serverHost}`,
		});
		await expect(async () => {
			if (await menu.isVisible().catch(() => false))
				await mainWindow.keyboard.press('Escape');
			if (await menu.isVisible().catch(() => false))
				await connectionMenuButton.click();
			await connectionMenuButton.click();
			await expect(attach).toBeVisible({ timeout: 2_000 });
		}).toPass({ timeout: 30_000 });

		// Attaching authenticates with the enrolled device key and opens the
		// server's application stream; the menu then shows it connected.
		await attach.click();
		await expect(async () => {
			if (!(await menu.isVisible().catch(() => false)))
				await connectionMenuButton.click();
			const row = menu
				.locator('[data-connection-phase="ready"]')
				.filter({ hasText: serverHost });
			await expect(row).toBeVisible({ timeout: 2_000 });
			await expect(row).toContainText('Connected');
		}).toPass({ timeout: 30_000 });
	} finally {
		await server.stop();
	}
});
