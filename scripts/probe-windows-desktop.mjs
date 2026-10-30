#!/usr/bin/env node
// The Windows Desktop probe's journey (native-windows-desktop, task 6.1), run
// by scripts/probe-windows-desktop.ps1 against an installed Terminay.exe:
//
//   1. launch with an isolated data directory and wait for the workspace;
//   2. PowerShell: input and output, then a window resize the shell sees;
//   3. Command Prompt, opened from the shell profile chooser: input, output,
//      and `exit` closing its terminal;
//   4. quit with the PowerShell terminal held, relaunch, and find the same
//      terminal, with its earlier output, still answering.
//
//   node scripts/probe-windows-desktop.mjs --executable <Terminay.exe> --data-dir <dir> --record <file>
//
// Every step is bounded and logged as it starts and ends. The record names each
// step and its outcome; the first failure ends the run, with a screenshot of
// the window beside the record.
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { _electron as electron } from '@playwright/test';

function argument(name) {
	const index = process.argv.indexOf(name);
	const value = index === -1 ? undefined : process.argv[index + 1];
	if (!value) throw new Error(`usage: probe-windows-desktop.mjs --executable <exe> --data-dir <dir> --record <file> (missing ${name})`);
	return value;
}

const executablePath = argument('--executable');
const dataDir = argument('--data-dir');
const recordPath = argument('--record');
const steps = [];
const STEP_TIMEOUT_MS = 180_000;
const ACTION_TIMEOUT_MS = 90_000;

function log(message) {
	console.log(`[${new Date().toISOString()}] ${message}`);
}

async function step(name, run) {
	const started = Date.now();
	log(`start: ${name}`);
	let timer;
	try {
		const detail = await Promise.race([
			run(),
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error(`${name} did not finish within ${STEP_TIMEOUT_MS} ms`)), STEP_TIMEOUT_MS);
			}),
		]);
		steps.push({ name, ok: true, ms: Date.now() - started, ...(detail ? { detail } : {}) });
		log(`ok: ${name} (${Date.now() - started} ms)`);
	} catch (error) {
		steps.push({ name, ok: false, ms: Date.now() - started, error: String(error?.stack ?? error).slice(0, 4000) });
		log(`FAILED: ${name}: ${error?.message ?? error}`);
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

async function launch() {
	const app = await electron.launch({
		timeout: ACTION_TIMEOUT_MS,
		executablePath,
		env: {
			...process.env,
			CI: '1',
			TERMINAY_TEST: '1',
			TERMINAY_USER_DATA_DIR: dataDir,
			VITE_DEV_SERVER_URL: '',
		},
	});
	app.process().stdout?.on('data', (chunk) => process.stdout.write(`[app] ${chunk}`));
	app.process().stderr?.on('data', (chunk) => process.stdout.write(`[app] ${chunk}`));
	app.context().setDefaultTimeout(ACTION_TIMEOUT_MS);
	const window = await app.firstWindow();
	await window.locator('[data-terminay-app-component]').waitFor({ state: 'visible' });
	await window.locator('.terminal-tab-content').first().waitFor({ state: 'visible' });
	return { app, window };
}

async function quit(app) {
	const child = app.process();
	await app.close();
	if (child.exitCode === null && child.signalCode === null)
		await new Promise((resolve) => child.once('exit', resolve));
	assert.equal(child.exitCode, 0, 'Terminay must exit cleanly');
}

function terminal(window) {
	return window.locator('.terminal-panel:visible');
}

async function type(window, line) {
	await terminal(window).locator('.xterm-helper-textarea').focus();
	await window.keyboard.type(line);
	await window.keyboard.press('Enter');
}

async function output(window, text) {
	await terminal(window).locator('.xterm-rows').getByText(text, { exact: true }).first().waitFor();
}

/** Asks the shell for its width, so the answer is what the PTY reports. */
async function columns(window, label) {
	await type(window, `Write-Output "${label}-$([Console]::WindowWidth)"`);
	const pattern = new RegExp(`^${label}-(\\d+)$`, 'u');
	const line = terminal(window).locator('.xterm-rows > div').filter({ hasText: pattern }).first();
	await line.waitFor();
	return Number(pattern.exec((await line.innerText()).trim())[1]);
}

async function diagnostics() {
	try {
		const directory = join(dataDir, 'logs');
		const files = (await readdir(directory)).filter((name) => name.endsWith('.jsonl')).sort();
		const text = (await Promise.all(files.map((name) => readFile(join(directory, name), 'utf8')))).join('\n');
		return text.slice(-16_000);
	} catch {
		return '';
	}
}

let session;
let failure;
try {
	await step('launch', async () => {
		session = await launch();
		assert.equal(await session.window.locator('.terminal-tab-content').count(), 1);
	});

	const marker = `probe-${Date.now()}`;
	await step('powershell input and output', async () => {
		await type(session.window, `Write-Output "${marker}-$(40+2)"`);
		await output(session.window, `${marker}-42`);
	});

	await step('powershell resize', async () => {
		const before = await columns(session.window, 'cols-before');
		await session.app.evaluate(({ BrowserWindow }) => {
			const [window] = BrowserWindow.getAllWindows();
			const [width, height] = window.getSize();
			window.setSize(Math.max(800, width - 240), height);
		});
		let after = before;
		for (let attempt = 0; attempt < 20 && after === before; attempt += 1)
			after = await columns(session.window, `cols-after-${attempt}`);
		assert.ok(after < before, `the shell saw ${before} columns before the resize and ${after} after`);
		return { before, after };
	});

	await step('command prompt input, output, and exit', async () => {
		const { window } = session;
		await window.keyboard.press('Control+L');
		await window.keyboard.type('New Terminal with Profile');
		await window.keyboard.press('Enter');
		const chooser = window.locator('.shell-profile-chooser');
		await chooser.waitFor({ state: 'visible' });
		await chooser.getByRole('button', { name: /Command Prompt/u }).first().click();
		await window.locator('.terminal-tab-content').nth(1).waitFor({ state: 'visible' });
		await type(window, 'echo probe-cmd-%OS%');
		await output(window, 'probe-cmd-Windows_NT');
		await type(window, 'exit');
		await window.waitForFunction(() => document.querySelectorAll('.terminal-tab-content').length === 1);
	});

	await step('server restart keeps the held terminal', async () => {
		await quit(session.app);
		session = await launch();
		await output(session.window, `${marker}-42`);
		await type(session.window, 'Write-Output "back-$(2+3)"');
		await output(session.window, 'back-5');
	});

	await step('quit', async () => {
		await quit(session.app);
		session = undefined;
	});
} catch (error) {
	failure = error;
} finally {
	if (session) {
		await session.window
			.screenshot({ path: join(dirname(recordPath), 'windows-probe-failure.png'), timeout: 10_000 })
			.catch(() => {});
		session.app.process().kill();
	}
	const failed = steps.find((entry) => !entry.ok);
	await writeFile(
		recordPath,
		`${JSON.stringify({ ok: failure === undefined, failedStep: failed?.name ?? null, steps, ...(failure ? { diagnostics: await diagnostics() } : {}) }, null, 2)}\n`,
	);
}

if (failure) {
	console.error(`Windows Desktop probe failed at: ${steps.find((entry) => !entry.ok)?.name}`);
	console.error(failure);
	process.exit(1);
}
console.log(`Windows Desktop probe passed: ${steps.map((entry) => entry.name).join(', ')}`);
// A held terminal's holder is not this process's to wait for.
process.exit(0);
