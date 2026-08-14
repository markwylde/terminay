import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import test from 'node:test';
import { _electron as electron } from '@playwright/test';

const appPath = resolve(
	process.env.TERMINAY_PACKAGED_APP ?? 'release/0.0.0/mac-arm64/Terminay.app',
);

test('packaged macOS Desktop boots its real server workspace', {
	skip: process.platform !== 'darwin',
	timeout: 75_000,
}, async () => {
	const userData = await mkdtemp(join(tmpdir(), 'terminay-startup-smoke-'));
	const executablePath = join(
		appPath,
		'Contents',
		'MacOS',
		basename(appPath, '.app'),
	);
	const rendererFailures = [];
	let electronApp;
	try {
		electronApp = await electron.launch({
			executablePath,
			env: {
				...process.env,
				CI: '1',
				TERMINAY_TEST: '1',
				TERMINAY_USER_DATA_DIR: userData,
			},
		});
		const window = await electronApp.firstWindow({ timeout: 20_000 });
		window.on('console', (message) => {
			if (message.type() === 'error')
				rendererFailures.push(`console: ${message.text()}`);
		});
		window.on('pageerror', (error) =>
			rendererFailures.push(`page: ${error.message}`),
		);
		window.on('requestfailed', (request) =>
			rendererFailures.push(
				`request: ${request.url()} (${request.failure()?.errorText ?? 'failed'})`,
			),
		);

		await window.locator('.project-tabbar').waitFor({
			state: 'visible',
			timeout: 30_000,
		});
		if ((await window.locator('.terminal-tab-content').count()) === 0) {
			await window.getByLabel('Create project on This server').click();
		}
		await window.locator('.terminal-tab-content').first().waitFor({
			state: 'visible',
			timeout: 15_000,
		});
		assert.equal(
			await window
				.locator('body')
				.evaluate((body) => body.textContent?.trim().length === 0),
			false,
			'packaged renderer body must not be blank',
		);
		assert.deepEqual(rendererFailures, []);
	} catch (error) {
		const diagnostics = await readDiagnostics(userData);
		throw new Error(
			`${error instanceof Error ? error.message : String(error)}\n` +
				`Renderer failures:\n${rendererFailures.join('\n') || '(none)'}\n` +
				`Diagnostics:\n${diagnostics || '(none)'}`,
			{ cause: error },
		);
	} finally {
		if (electronApp !== undefined) await closeElectronApp(electronApp);
		await rm(userData, {
			recursive: true,
			force: true,
			maxRetries: 10,
			retryDelay: 100,
		});
	}
});

async function closeElectronApp(electronApp) {
	const process = electronApp.process();
	let timeout;
	try {
		await Promise.race([
			electronApp.close(),
			new Promise((resolve) => {
				timeout = setTimeout(resolve, 5_000);
			}),
		]);
	} finally {
		if (timeout !== undefined) clearTimeout(timeout);
		if (process.exitCode === null) process.kill('SIGKILL');
	}
}

async function readDiagnostics(userData) {
	const logDirectory = join(userData, 'logs');
	try {
		const { readdir } = await import('node:fs/promises');
		const files = (await readdir(logDirectory))
			.filter((name) => name.endsWith('.jsonl'))
			.sort();
		const contents = await Promise.all(
			files.map((name) => readFile(join(logDirectory, name), 'utf8')),
		);
		return contents.join('\n').slice(-32_000);
	} catch {
		return '';
	}
}
