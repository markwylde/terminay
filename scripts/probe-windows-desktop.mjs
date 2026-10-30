#!/usr/bin/env node
// The Windows Desktop probe's journey (native-windows-desktop, task 6.1), run
// by scripts/probe-windows-desktop.ps1 against an installed Terminay.exe:
//
//   1. launch with an isolated data directory and wait for the workspace;
//   2. PowerShell: input and output, then a window resize the shell sees;
//   3. parity: a split starts in the directory of the terminal it splits, a
//      foreground `node` is reported busy, the MCP pipe answers from inside a
//      terminal, and `git worktree add` moves its terminal into the new folder;
//   4. Command Prompt, opened from the shell profile chooser: input, output,
//      and `exit` ending it, then closing its tab;
//   5. quit with the PowerShell terminal held, relaunch, and find the same
//      terminal, with its earlier output, still answering.
//
//   node scripts/probe-windows-desktop.mjs --executable <Terminay.exe> --data-dir <dir> --record <file>
//
// Every step is bounded and logged as it starts and ends. The record names each
// step and its outcome. A failed parity check is recorded and the run goes on,
// so one run reports every one; any other failure ends the run, with a
// screenshot of the window beside the record.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
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

/** A parity check: recorded like a step, but a failure lets the run go on. */
async function check(name, run) {
	try {
		await step(name, run);
	} catch {
		// Recorded by step(); the run fails at the end.
	}
}

async function until(probe, message, timeout = ACTION_TIMEOUT_MS) {
	const deadline = Date.now() + timeout;
	while (!(await probe())) {
		if (Date.now() > deadline) throw new Error(message);
		await new Promise((resolve) => setTimeout(resolve, 250));
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
			// A test launch keeps no holder unless asked; the probe asks.
			TERMINAY_SESSION_HOLDER: '1',
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

/**
 * Quits the way the Quit menu item does, answering the quit confirmation with
 * "keep" (the terminals stay with their holder) or "end". Playwright's own
 * close() tears the windows down first, which is not a user quit.
 */
async function quit(app, choice) {
	await app.evaluate(({ dialog }, response) => {
		dialog.showMessageBox = async () => ({ checkboxChecked: false, response });
	}, choice === 'keep' ? 0 : 1);
	const child = app.process();
	const exited = new Promise((resolve) => {
		if (child.exitCode !== null || child.signalCode !== null) resolve();
		else child.once('exit', resolve);
	});
	await app.evaluate(({ app: electronApp }) => {
		setImmediate(() => electronApp.quit());
	}).catch(() => undefined);
	await exited;
	assert.equal(child.exitCode, 0, 'Terminay must exit cleanly');
}

/** One terminal's panel: the session's, or the first one on screen. */
function terminal(window, sessionId) {
	return sessionId === undefined
		? window.locator('.terminal-panel:visible').first()
		: window.locator(`.terminal-panel[data-terminay-terminal-session-id="${sessionId}"]`);
}

async function visibleSessions(window) {
	return window
		.locator('.terminal-panel:visible')
		.evaluateAll((panels) => panels.map((panel) => panel.getAttribute('data-terminay-terminal-session-id')));
}

async function type(window, line, sessionId) {
	await terminal(window, sessionId).locator('.xterm-helper-textarea').focus();
	await window.keyboard.type(line);
	await window.keyboard.press('Enter');
}

async function output(window, text, sessionId) {
	await terminal(window, sessionId).locator('.xterm-rows').getByText(text, { exact: true }).first().waitFor();
}

/** The text after `<label>=` on the first line that starts with it. */
async function printed(window, label, sessionId) {
	const pattern = new RegExp(`^${label}=(.*)$`, 'u');
	const line = terminal(window, sessionId).locator('.xterm-rows > div').filter({ hasText: pattern }).first();
	await line.waitFor();
	return pattern.exec((await line.innerText()).trim())[1];
}

/**
 * Has PowerShell print `<label>-<expression>`, and reads the number back. The
 * number is matched anywhere in a row: ConPTY repaints the screen on a resize,
 * and can leave the tail of an older row beside it.
 */
async function answer(window, label, expression) {
	await type(window, `Write-Output "${label}-${expression}"`);
	const pattern = new RegExp(`(?:^|\\s)${label}-(\\d+)`, 'u');
	const line = terminal(window).locator('.xterm-rows > div').filter({ hasText: pattern }).first();
	await line.waitFor();
	return Number(pattern.exec(await line.innerText())[1]);
}

/** Runs an application command the way its menu item does. */
async function appCommand(window, command) {
	await window.evaluate(async (next) => {
		const host = globalThis.terminayHost;
		const context = await host.getContext();
		await host.requestAction({
			bridgeVersion: context.hostBridgeVersion,
			profileId: context.profileId,
			schemaVersion: context.schemaVersion,
			serverId: context.serverId,
			sourceId: context.sourceId,
			userGesture: true,
			windowId: context.windowId,
			action: { command: next, type: 'menu.invoke' },
		});
	}, command);
}

/** How many of the window's terminals the application sees running a program. */
async function runningTerminals(app, window) {
	const native = await app.browserWindow(window);
	const id = await native.evaluate((browserWindow) => browserWindow.webContents.id);
	return app.evaluate(
		async (_electron, webContentsId) =>
			(await globalThis.__terminayTestRunningTerminalCountForWindow?.(webContentsId)) ?? -1,
		id,
	);
}

/** One folder of the project's Folders tree, by its exact name. */
function folder(window, name) {
	return window
		.locator('.project-workspace--active [data-terminay-folders-column="true"] .folders-tree__folder')
		.filter({ has: window.locator(`.folders-tree__row--folder .folders-tree__name:text-is(${JSON.stringify(name)})`) });
}

// Run from a terminal: connects to the MCP control pipe named in the
// terminal's environment and asks for its capabilities.
const MCP_CLIENT = `
import { connect } from 'node:net';
const path = process.env.TERMINAY_CONTROL_SOCKET ?? '';
console.log('mcp-socket=' + path.replaceAll('\\\\', '/'));
if (!path) { console.log('mcp-result=no-socket'); process.exit(0); }
const socket = connect(path);
let buffer = '';
socket.on('connect', () => {
	socket.write(JSON.stringify({ id: 'probe-1', token: process.env.TERMINAY_CONTROL_TOKEN, version: 1, op: 'get_mcp_capabilities', params: {} }) + '\\n');
});
socket.on('data', (chunk) => {
	buffer += chunk;
	const end = buffer.indexOf('\\n');
	if (end < 0) return;
	const response = JSON.parse(buffer.slice(0, end));
	console.log('mcp-result=' + (response.ok ? 'ok' : response.error?.code));
	socket.end();
});
socket.on('error', (error) => console.log('mcp-result=' + error.code));
`;

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
		// The shell's own width, so the answer is what the PTY reports.
		const before = await answer(session.window, 'cols-before', '$([Console]::WindowWidth)');
		await session.app.evaluate(({ BrowserWindow }) => {
			const [window] = BrowserWindow.getAllWindows();
			const [width, height] = window.getSize();
			window.setSize(Math.max(800, width - 240), height);
		});
		// Let the resize reach the PTY before asking again.
		await new Promise((resolve) => setTimeout(resolve, 1000));
		let after = before;
		for (let attempt = 0; attempt < 20 && after === before; attempt += 1)
			after = await answer(session.window, `cols-after-${attempt}`, '$([Console]::WindowWidth)');
		assert.ok(after < before, `the shell saw ${before} columns before the resize and ${after} after`);
		return { before, after };
	});

	await check('a split starts in the directory of the terminal it splits', async () => {
		const { window } = session;
		const [first] = await visibleSessions(window);
		await type(window, 'Set-Location C:\\Windows', first);
		await type(window, 'Write-Output "here=$((Get-Location).Path)"', first);
		await output(window, 'here=C:\\Windows', first);
		await appCommand(window, 'split-vertical');
		let second;
		await until(async () => {
			second = (await visibleSessions(window)).find((id) => id && id !== first);
			return second !== undefined;
		}, 'the split never showed a second terminal');
		await type(window, 'Write-Output "split=$((Get-Location).Path)"', second);
		const directory = await printed(window, 'split', second);
		await type(window, 'exit', second);
		await terminal(window, second).locator('.xterm-rows').getByText(/\[process exited with /u).first().waitFor();
		await window.getByLabel('Close terminal').last().click();
		await until(async () => (await window.locator('.terminal-tab-content').count()) === 1, 'the split terminal did not close');
		assert.equal(directory, 'C:\\Windows');
		return { directory };
	});

	await check('a foreground node is reported busy', async () => {
		const { app, window } = session;
		await until(async () => (await runningTerminals(app, window)) === 0, 'an idle PowerShell was reported busy');
		await type(window, 'node -e "setTimeout(() => {}, 120000)"');
		await until(async () => (await runningTerminals(app, window)) >= 1, 'a running node was never reported busy');
		await terminal(window).locator('.xterm-helper-textarea').focus();
		await window.keyboard.press('Control+C');
		await until(async () => (await runningTerminals(app, window)) === 0, 'the terminal stayed busy after node ended');
	});

	await check('the MCP pipe answers from inside a terminal', async () => {
		const { window } = session;
		const client = join(dataDir, 'probe-mcp-client.mjs');
		await writeFile(client, MCP_CLIENT);
		await type(window, `node "${client}"`);
		const socket = await printed(window, 'mcp-socket');
		const result = await printed(window, 'mcp-result');
		assert.match(socket, /^\/\/\.\/pipe\//u, 'the control endpoint must be a named pipe');
		assert.equal(result, 'ok');
		return { socket };
	});

	await check('git worktree add moves its terminal into the new folder', async () => {
		const { window } = session;
		const repository = join(dataDir, 'probe-repository');
		await mkdir(repository, { recursive: true });
		const git = (...args) => execFileSync('git', args, { cwd: repository, stdio: 'pipe' });
		git('init', '-b', 'main');
		git('config', 'user.name', 'Terminay probe');
		git('config', 'user.email', 'probe@terminay.invalid');
		git('commit', '--allow-empty', '-m', 'initial');

		await window.locator('.project-tab--active').evaluate((element) => {
			element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
		});
		const editor = window.getByRole('dialog').filter({ has: window.getByRole('heading', { name: 'Edit Project Tab' }) });
		await editor.waitFor();
		await editor.getByPlaceholder('Enter folder path').fill(repository);
		await editor.getByRole('button', { name: 'Save' }).click();
		await editor.waitFor({ state: 'detached' });
		await folder(window, 'General').locator('.folders-tree__branch').getByText('main', { exact: true }).waitFor();

		await type(window, `Set-Location "${repository}"`);
		await type(window, 'git worktree add ..\\probe-worktree -b probe-worktree');
		// The project's one terminal is the one that ran Git.
		await folder(window, 'probe-worktree').locator('.folders-tree__row--terminal').waitFor();
		await until(
			async () => (await folder(window, 'General').locator('.folders-tree__row--terminal').count()) === 0,
			'the terminal that ran git worktree add stayed in General',
		);
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
		// An ended terminal stays open, read-only, until its tab is closed.
		await type(window, 'exit');
		await terminal(window).locator('.xterm-rows').getByText(/\[process exited with /u).first().waitFor();
		await window.locator('.dv-tab.dv-active-tab:visible').getByLabel('Close terminal').click();
		await window.waitForFunction(() => document.querySelectorAll('.terminal-tab-content').length === 1);
	});

	await step('server restart keeps the held terminal', async () => {
		const pid = await answer(session.window, 'pid-before', '$PID');
		await quit(session.app, 'keep');
		session = await launch();
		assert.equal(await answer(session.window, 'pid-after', '$PID'), pid, 'the same PowerShell must answer after the restart');
		await output(session.window, `${marker}-42`);
		await type(session.window, 'Write-Output "back-$(2+3)"');
		await output(session.window, 'back-5');
	});

	await step('quit', async () => {
		await quit(session.app, 'end');
		session = undefined;
	});
	const failedCheck = steps.find((entry) => !entry.ok);
	if (failedCheck) throw new Error(`parity check failed: ${failedCheck.name}`);
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
