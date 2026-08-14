import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

test.describe.configure({ timeout: 180_000 });

async function reserveLoopbackPort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	if (address === null || typeof address === 'string') throw new Error('Unable to reserve a loopback port.');
	await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
	return address.port;
}

async function expectMixedInventory(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'Choose project environment' }).click();
	const menu = page.getByRole('menu', { name: 'Choose project environment' });
	await expect(menu).toBeVisible();
	await expect(menu.getByRole('menuitem', { name: /This server/u })).toBeVisible();
	await expect(menu.getByRole('menuitem', { name: /CI SSH/u })).toContainText('ssh-ci:22');
	await expect(menu.getByRole('menuitem', { name: /CI Puzed VM/u })).toContainText('puzed-ci:22');
	await page.keyboard.press('Escape');
}

async function readReadiness(child: ChildProcessWithoutNullStreams): Promise<{ pairing: { pairingUrl: string }; serverId: string }> {
	child.stdout.setEncoding('utf8');
	let output = '';
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('standalone server readiness timed out')), 15_000);
		child.stdout.on('data', (chunk: string) => {
			output += chunk;
			const newline = output.indexOf('\n');
			if (newline < 0) return;
			clearTimeout(timer);
			resolve(JSON.parse(output.slice(0, newline)) as { pairing: { pairingUrl: string }; serverId: string });
		});
		child.once('error', reject);
	});
}

async function stop(child: ChildProcessWithoutNullStreams): Promise<void> {
	if (child.exitCode !== null) return;
	child.kill('SIGTERM');
	await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 2_000))]);
	if (child.exitCode === null) child.kill('SIGKILL');
}

test('Desktop preserves one This server, SSH and Puzed inventory across renderer restart', async ({
	mainWindow,
}) => {
	await expectMixedInventory(mainWindow);
	await mainWindow.reload();
	await expect(mainWindow.locator('.project-tabbar')).toBeVisible();
	await expectMixedInventory(mainWindow);
});

test('Desktop selects a standalone server and its canonical session survives renderer reconnect and server restart', async ({ mainWindow, tempDir }) => {
	const dataRoot = path.join(tempDir, 'standalone-mixed-data');
	const port = await reserveLoopbackPort();
	const launch = () => spawn(process.execPath, [
		path.resolve('apps/terminay-server/dist/cli.js'), '--server-id', 'standalone-mixed', '--data-root', dataRoot,
		'--project-root', tempDir, '--http-host', '127.0.0.1', '--http-port', String(port),
	], { cwd: process.cwd(), env: { ...process.env, TERMINAY_AGENT_INTEGRATION: 'disabled' }, stdio: ['ignore', 'pipe', 'pipe'] });

	let server = launch();
	try {
		let readiness = await readReadiness(server);
		await mainWindow.getByLabel('Open connection menu').click();
		await mainWindow.getByRole('button', { name: /Add connection/u }).click();
		const dialog = mainWindow.getByRole('dialog', { name: 'Connections' });
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Add connection…' }).click();
		await dialog.getByLabel('Pairing URL').fill(readiness.pairing.pairingUrl);
		await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
		await expect(mainWindow.getByLabel('Open connection menu')).toContainText('127.0.0.1');
		const before = await mainWindow.locator('.terminal-panel:visible').getAttribute('data-terminay-terminal-session-id');
		expect(before).toBeTruthy();
		expect(readiness.serverId).toBe('standalone-mixed');
		await mainWindow.reload();
		await expect(mainWindow.getByLabel('Open connection menu')).toContainText('127.0.0.1', { timeout: 20_000 });
		await expect(mainWindow.locator(`.terminal-panel[data-terminay-terminal-session-id="${before}"]`)).toBeVisible({ timeout: 20_000 });

		await stop(server);
		server = launch();
		readiness = await readReadiness(server);
		expect(readiness.serverId).toBe('standalone-mixed');
		await mainWindow.reload();
		await expect(mainWindow.getByLabel('Open connection menu')).toContainText('127.0.0.1', { timeout: 20_000 });
		await expect(mainWindow.locator(`.terminal-panel[data-terminay-terminal-session-id="${before}"]`)).toBeVisible({ timeout: 20_000 });
	} finally {
		await stop(server);
		await writeFile(path.join(tempDir, 'standalone-mixed-proof.txt'), 'standalone restart exercised\n');
	}
});
