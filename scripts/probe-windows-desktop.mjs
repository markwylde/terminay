#!/usr/bin/env node
// The Windows Desktop probe's journey (native-windows-desktop, task 6.1), run
// by scripts/probe-windows-desktop.ps1 against an installed Terminay.exe:
//
//   1. launch with an isolated data directory and wait for the workspace; a
//      second launch only brings the window forward, and a second listener
//      cannot take the holder's pipe;
//   2. PowerShell: input and output, then a window resize the shell sees;
//   3. parity: a split starts in the directory of the terminal it splits, a
//      foreground `node` is reported busy, the MCP pipe answers from inside a
//      terminal, every built-in extension is on (or declared unavailable on Windows), and `git worktree add`
//      moves its terminal into the new folder;
//   4. Command Prompt, opened from the shell profile chooser: input, output,
//      a foreground `node` reported busy, and `exit` ending it, then closing
//      its tab;
//   5. quit with the PowerShell terminal held, relaunch, and find the same
//      PowerShell, with its earlier output, still answering.
//
//   node scripts/probe-windows-desktop.mjs --executable <Terminay.exe> --data-dir <dir> --record <file>
//
// Every step is bounded and logged as it starts and ends. The record names each
// step and its outcome. A failed parity check is recorded and the run goes on,
// so one run reports every one; any other failure ends the run, with a
// screenshot of the window beside the record.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
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

/**
 * A parity check: recorded like a step, but a failure lets the run go on. A
 * failure keeps a screenshot and the text of the terminal on screen.
 */
async function check(name, run) {
	try {
		await step(name, run);
	} catch {
		const entry = steps.at(-1);
		const slug = name.replace(/[^a-z0-9]+/giu, '-').replace(/^-|-$/gu, '').toLowerCase();
		await session?.window
			.screenshot({ path: join(dirname(recordPath), `windows-probe-${slug}.png`), timeout: 10_000 })
			.catch(() => {});
		entry.screen = await session?.window
			.locator('.terminal-panel:visible .xterm-rows')
			.allInnerTexts()
			.then((texts) => texts.join('\n---\n').slice(-4000))
			.catch(() => undefined);
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
	// Escape clears whatever is on the line in PowerShell and Command Prompt.
	await window.keyboard.press('Escape');
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

/** Opens the command bar, and waits for it before anything is typed into it. */
async function commandBar(window) {
	await window.keyboard.press('Control+L');
	await window.getByRole('dialog', { name: 'Command bar' }).waitFor({ state: 'visible' });
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

/** Every failure an extension registry in the data directory records. */
async function registryFailures() {
	const found = [];
	const walk = async (directory, depth) => {
		if (depth > 5) return;
		for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
			const path = join(directory, entry.name);
			if (entry.isDirectory() && entry.name !== 'node_modules') await walk(path, depth + 1);
			else if (entry.isFile() && entry.name.endsWith('.json')) {
				const text = await readFile(path, 'utf8').catch(() => '');
				for (const match of text.matchAll(/"extensionId":"([^"]+)"[^{}]*?"failureClass":"([^"]+)"/gu))
					found.push(`${match[1]}: ${match[2]}`);
				for (const match of text.matchAll(/"failureClass":\s*"([^"]+)"/gu)) found.push(`${entry.name}: ${match[1]}`);
			}
		}
	};
	await walk(dataDir, 0);
	return [...new Set(found)].join('; ') || 'no failure recorded';
}

/** The application's log lines that match, newest last, bounded. */
async function logLines(pattern) {
	try {
		const directory = join(dataDir, 'logs');
		const files = (await readdir(directory)).filter((name) => name.endsWith('.jsonl')).sort();
		const lines = (await Promise.all(files.map((name) => readFile(join(directory, name), 'utf8'))))
			.join('\n')
			.split('\n')
			.filter((line) => pattern.test(line) && !line.includes('port-diagnostic'));
		return lines.slice(-40).join('\n').slice(-6000);
	} catch (error) {
		return `no log (${error})`;
	}
}

/** Terminay processes from this executable that are not Chromium helpers (`--type=`). */
function mainProcesses() {
	const script = `Get-CimInstance Win32_Process -Filter "Name = 'Terminay.exe'" | Where-Object { $_.ExecutablePath -ieq '${executablePath.replaceAll("'", "''")}' -and $_.CommandLine -notmatch '--type=' } | ForEach-Object { $_.ProcessId }`;
	return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' })
		.split(/\s+/u)
		.filter(Boolean)
		.map(Number);
}

/** The pipe the running holder listens on, from its record. */
async function holderPipe() {
	const directory = join(dataDir, 'session-holder');
	for (const name of await readdir(directory).catch(() => [])) {
		if (!name.endsWith('.json')) continue;
		const record = JSON.parse(await readFile(join(directory, name), 'utf8').catch(() => '{}'));
		if (typeof record.socketPath === 'string') return record.socketPath;
	}
	return undefined;
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

	await check('a second launch brings the running window forward instead of starting', async () => {
		// Terminay's own node-mode children also run without `--type=`, so the
		// set is compared, not counted.
		const before = mainProcesses().sort();
		assert.ok(before.length > 0, 'no Terminay process runs from the installation');
		await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
		await until(() => session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()), 'the window never minimized');
		const second = spawn(executablePath, [], {
			env: { ...process.env, CI: '1', TERMINAY_TEST: '1', TERMINAY_SESSION_HOLDER: '1', TERMINAY_USER_DATA_DIR: dataDir },
			stdio: 'ignore',
		});
		const code = await new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('the second launch kept running')), 60_000);
			second.once('exit', (exitCode) => {
				clearTimeout(timer);
				resolve(exitCode);
			});
		});
		await until(
			() => session.app.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows()[0].isMinimized()),
			'the running window was not brought forward',
		);
		const after = mainProcesses().sort();
		assert.ok(!after.includes(second.pid), 'the second launch is still running');
		assert.deepEqual(after.filter((id) => !before.includes(id)), [], 'a second launch left a process running');
		return { secondLaunchExit: code, processes: before.length };
	});

	await check('a second listener cannot take the holder pipe', async () => {
		let pipe;
		await until(async () => {
			pipe = await holderPipe();
			return pipe !== undefined;
		}, 'no holder record names a pipe');
		assert.match(pipe, /^\\\\\.\\pipe\\terminay-holder-[0-9a-f]{24}-[0-9a-f]+$/u);
		const error = await new Promise((resolve) => {
			const server = createServer();
			server.once('error', resolve);
			server.listen(pipe, () => server.close(() => resolve(undefined)));
		});
		assert.ok(error, 'a second server listened on the holder pipe');
		assert.match(error.code, /^(EADDRINUSE|EACCES)$/u);
		return { pipe, refused: error.code };
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
		// PSReadLine drops what is typed while it redraws the prompt after an
		// interrupt, so the shell is asked again until it answers.
		for (let attempt = 0; ; attempt += 1) {
			await type(window, `Write-Output "after-busy-${attempt}-$(1+1)"`);
			try {
				await terminal(window).locator('.xterm-rows').getByText(`after-busy-${attempt}-2`, { exact: true }).first().waitFor({ timeout: 10_000 });
				break;
			} catch (error) {
				if (attempt === 2) throw error;
			}
		}
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

	await check('every built-in extension is on, or not available on Windows', async () => {
		const { app, window } = session;
		// Settings › Extensions, from the command bar; it opens in its own window.
		const opened = app.waitForEvent('window', { timeout: 30_000 }).catch(() => undefined);
		await commandBar(window);
		await window.keyboard.type('Extensions');
		await window
			.getByRole('dialog', { name: 'Command bar' })
			.locator('.macro-launcher-item-title', { hasText: /^Extensions$/u })
			.first()
			.click();
		const settings = (await opened) ?? window;
		// The built-in list reads "<name> <state>" per extension, between its
		// BUILT-IN and CUSTOM headings.
		const builtIns = async () => {
			const text = await settings.locator('body').innerText();
			const start = text.indexOf('BUILT-IN');
			const end = text.indexOf('CUSTOM', start);
			return start < 0 || end < 0 ? undefined : text.slice(start + 'BUILT-IN'.length, end).trim();
		};
		let listed;
		await until(async () => {
			listed = await builtIns();
			return listed !== undefined && !/\b(Starting|Pending|Installing)\b/u.test(listed);
		}, 'the built-in extensions never settled');
		if (settings !== window) await settings.close();
		const lines = listed.split('\n').map((line) => line.trim()).filter(Boolean);
		// A built-in that declares only other platforms reads "Not available on
		// Windows"; anything else that is not on is a fault.
		if (lines.some((line) => ['Failed', 'Incompatible', 'Quarantined'].includes(line)))
			throw new Error(`a built-in extension failed (${lines.join(' | ')}): ${await registryFailures()}`);
		assert.ok(lines.includes('On'), `no built-in extension is on: ${lines.join(' | ')}`);
		return { builtIns: lines };
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
		await type(window, 'Write-Output "trace2=$env:GIT_TRACE2_EVENT"');
		const trace2 = await printed(window, 'trace2');
		await type(window, `Write-Output "tracedir=$(Test-Path '${join(dataDir, 'run', 'git-trace')}')"`);
		const traceDirectory = await printed(window, 'tracedir');
		await type(window, 'git worktree add ..\\probe-worktree -b probe-worktree');
		const folders = () =>
			window.locator('.project-workspace--active .folders-tree__row--folder .folders-tree__name').allInnerTexts();
		try {
			await folder(window, 'probe-worktree').waitFor();
		} catch (error) {
			throw new Error(`no probe-worktree folder (folders: ${(await folders()).join(', ')}; trace2: ${trace2})`, { cause: error });
		}
		// The project's one terminal is the one that ran Git.
		try {
			await folder(window, 'probe-worktree').locator('.folders-tree__row--terminal').waitFor();
		} catch (error) {
			// Is Git reporting at all, or did the first terminal start before
			// the stream was listening? A terminal opened now says.
			await appCommand(window, 'new-terminal');
			let fresh;
			await until(async () => {
				fresh = (await visibleSessions(window)).find((id) => id && id !== 'default');
				return fresh !== undefined;
			}, 'no new terminal');
			await type(window, 'Write-Output "trace2=$env:GIT_TRACE2_EVENT"', fresh);
			const freshTrace2 = await printed(window, 'trace2', fresh).catch(() => '?');
			throw new Error(
				`the folder appeared but its terminal was not moved (trace2: "${trace2}", in a new terminal: "${freshTrace2}", trace directory exists: ${traceDirectory}; log: ${await logLines(/worktree-capture|capture\.|stream\.listening|git-command|trace-directory/iu)})`,
				{ cause: error },
			);
		}
		await until(
			async () => (await folder(window, 'General').locator('.folders-tree__row--terminal').count()) === 0,
			'the terminal that ran git worktree add stayed in General',
		);
	});

	await step('command prompt input and output', async () => {
		const { window } = session;
		await commandBar(window);
		await window.keyboard.type('New Terminal with Profile');
		await window.keyboard.press('Enter');
		const chooser = window.locator('.shell-profile-chooser');
		await chooser.waitFor({ state: 'visible' });
		await chooser.getByRole('button', { name: /Command Prompt/u }).first().click();
		await window.locator('.terminal-tab-content').nth(1).waitFor({ state: 'visible' });
		await type(window, 'echo probe-cmd-%OS%');
		await output(window, 'probe-cmd-Windows_NT');
	});

	await check('a foreground node under Command Prompt is reported busy', async () => {
		const { app, window } = session;
		await until(async () => (await runningTerminals(app, window)) === 0, 'an idle Command Prompt was reported busy');
		await type(window, 'node -e "setTimeout(() => {}, 120000)"');
		await until(async () => (await runningTerminals(app, window)) >= 1, 'a running node was never reported busy');
		await terminal(window).locator('.xterm-helper-textarea').focus();
		await window.keyboard.press('Control+C');
		await until(async () => (await runningTerminals(app, window)) === 0, 'the terminal stayed busy after node ended');
	});

	await step('command prompt exit', async () => {
		const { window } = session;
		// An ended terminal stays open, read-only, until its tab is closed.
		await type(window, 'exit');
		await terminal(window).locator('.xterm-rows').getByText(/\[process exited with /u).first().waitFor();
		await window.locator('.dv-tab.dv-active-tab:visible').getByLabel('Close terminal').click();
		await window.waitForFunction(() => document.querySelectorAll('.terminal-tab-content').length === 1);
	});

	await step('server restart keeps the held terminal', async () => {
		// Printed last before the quit, so it is on screen after the relaunch.
		const pid = await answer(session.window, 'pid-before', '$PID');
		await quit(session.app, 'keep');
		session = await launch();
		await output(session.window, `pid-before-${pid}`);
		assert.equal(await answer(session.window, 'pid-after', '$PID'), pid, 'the same PowerShell must answer after the restart');
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
