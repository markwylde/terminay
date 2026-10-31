#!/usr/bin/env node
// The Windows Desktop probe's update step (native-windows-desktop, task 6.3),
// run by scripts/probe-windows-desktop.ps1 against build N installed where the
// per-user installer puts it, with build N+1's installer and `beta.yml` in a
// feed directory:
//
//   1. serve the feed directory on loopback and launch build N against it;
//   2. leave a PowerShell terminal running, wait for the update to download,
//      and choose Restart to update;
//   3. wait for build N+1's installer to replace build N and relaunch it,
//      watching that no UAC consent prompt appears;
//   4. launch the installed build and find it is N+1, with the same PowerShell
//      still answering;
//   5. end that terminal, start again, and find build N's holder runtime copy
//      removed now that nothing runs it.
//
//   node scripts/probe-windows-update.mjs --executable <Terminay.exe> --data-dir <dir> --feed <dir> --version <N+1> --record <file>
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readdir, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, dirname, join, win32 } from 'node:path';
import { _electron as electron } from '@playwright/test';

function argument(name) {
	const index = process.argv.indexOf(name);
	const value = index === -1 ? undefined : process.argv[index + 1];
	if (!value)
		throw new Error(
			`usage: probe-windows-update.mjs --executable <exe> --data-dir <dir> --feed <dir> --version <version> --record <file> (missing ${name})`,
		);
	return value;
}

const executablePath = argument('--executable');
const dataDir = argument('--data-dir');
const feedDir = argument('--feed');
const nextVersion = argument('--version');
const recordPath = argument('--record');
const installDir = win32.dirname(executablePath);
const steps = [];
const STEP_TIMEOUT_MS = 300_000;
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

async function until(probe, message, timeout = ACTION_TIMEOUT_MS) {
	const deadline = Date.now() + timeout;
	while (!(await probe())) {
		if (Date.now() > deadline) throw new Error(message);
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
}

/** The feed: every file directly in the feed directory, and nothing else. */
async function serveFeed() {
	const files = new Set((await readdir(feedDir)).filter((name) => !name.includes('/')));
	const requests = [];
	const server = createServer((request, response) => {
		const name = decodeURIComponent(new URL(request.url ?? '/', 'http://feed').pathname.slice(1));
		requests.push(`${request.method} ${name}`);
		if (!files.has(name)) {
			response.writeHead(404).end();
			return;
		}
		stat(join(feedDir, name)).then(
			(info) => {
				response.writeHead(200, { 'Content-Length': info.size });
				if (request.method === 'HEAD') response.end();
				else createReadStream(join(feedDir, name)).pipe(response);
			},
			() => response.writeHead(404).end(),
		);
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	return { server, requests, url: `http://127.0.0.1:${server.address().port}/` };
}

async function launch(feedUrl) {
	const app = await electron.launch({
		timeout: ACTION_TIMEOUT_MS,
		executablePath,
		env: {
			...process.env,
			CI: '1',
			TERMINAY_TEST: '1',
			TERMINAY_SESSION_HOLDER: '1',
			TERMINAY_USER_DATA_DIR: dataDir,
			VITE_DEV_SERVER_URL: '',
			...(feedUrl === undefined ? {} : { TERMINAY_TEST_UPDATE_FEED_URL: feedUrl }),
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

async function type(window, line) {
	await window.locator('.terminal-panel:visible').first().locator('.xterm-helper-textarea').focus();
	// Escape clears whatever is on the line.
	await window.keyboard.press('Escape');
	await window.keyboard.type(line);
	await window.keyboard.press('Enter');
}

async function output(window, text) {
	await window.locator('.terminal-panel:visible').first().locator('.xterm-rows').getByText(text, { exact: true }).first().waitFor();
}

/** Has PowerShell print `<label>-<expression>`, and reads the number back. */
async function answer(window, label, expression) {
	await type(window, `Write-Output "${label}-${expression}"`);
	const pattern = new RegExp(`(?:^|\\s)${label}-(\\d+)`, 'u');
	const line = window.locator('.terminal-panel:visible').first().locator('.xterm-rows > div').filter({ hasText: pattern }).first();
	await line.waitFor();
	return Number(pattern.exec(await line.textContent())[1]);
}

/** Asks the desktop host to do something, the way the Settings page does. */
async function hostAction(window, action) {
	return window.evaluate(async (next) => {
		const host = globalThis.terminayHost;
		const context = await host.getContext();
		return host.requestAction({
			bridgeVersion: context.hostBridgeVersion,
			profileId: context.profileId,
			schemaVersion: context.schemaVersion,
			serverId: context.serverId,
			sourceId: context.sourceId,
			userGesture: true,
			windowId: context.windowId,
			action: next,
		});
	}, action);
}

/** Terminay processes running from the install directory. */
function installedProcesses() {
	const script = `Get-CimInstance Win32_Process -Filter "Name = 'Terminay.exe'" | Where-Object { $_.ExecutablePath -and ([IO.Path]::GetDirectoryName($_.ExecutablePath)) -ieq '${installDir.replaceAll("'", "''")}' } | ForEach-Object { $_.ProcessId }`;
	return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' })
		.split(/\s+/u)
		.filter(Boolean)
		.map(Number);
}

/** The per-build holder runtime copies in the data directory. */
async function holderRuntimes() {
	return (await readdir(join(dataDir, 'holder-runtime')).catch(() => [])).filter((name) => !name.startsWith('.'));
}

/** Processes whose executable is under a directory. */
function processesUnder(directory) {
	const script = `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${directory.replaceAll("'", "''")}\\', [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { $_.ProcessId }`;
	return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' })
		.split(/\s+/u)
		.filter(Boolean)
		.map(Number);
}

function installedVersion() {
	const script = `(Get-Item -LiteralPath '${executablePath.replaceAll("'", "''")}').VersionInfo.ProductVersion`;
	return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim();
}

/** Watches for the UAC consent prompt for as long as it runs. */
function watchForConsent() {
	const seen = [];
	const timer = setInterval(() => {
		try {
			const out = execFileSync('tasklist.exe', ['/FI', 'IMAGENAME eq consent.exe', '/NH'], { encoding: 'utf8' });
			if (/consent\.exe/iu.test(out)) seen.push(new Date().toISOString());
		} catch {}
	}, 500);
	return { seen, stop: () => clearInterval(timer) };
}

/** Quits, ending the terminals. */
async function quitEnding(running) {
	await running.app.evaluate(({ dialog }) => {
		dialog.showMessageBox = async () => ({ checkboxChecked: false, response: 1 });
	});
	const child = running.app.process();
	const exited = new Promise((resolve) => child.once('exit', resolve));
	await running.app.evaluate(({ app }) => setImmediate(() => app.quit())).catch(() => undefined);
	await exited;
}

let session;
let feed;
let failure;
try {
	await step('launch build N against a local feed', async () => {
		feed = await serveFeed();
		session = await launch(feed.url);
		const current = await session.app.evaluate(({ app }) => app.getVersion());
		assert.notEqual(current, nextVersion, 'build N must not already be the update');
		// 0.0.0 is a development build, which never checks for updates.
		assert.notEqual(current, '0.0.0', 'build N must carry a release version');
		return { current, feed: [...(await readdir(feedDir))] };
	});

	let pid;
	let oldRuntimes;
	await step('a running terminal and a downloaded update', async () => {
		pid = await answer(session.window, 'pid-before', '$PID');
		oldRuntimes = await holderRuntimes();
		assert.equal(oldRuntimes.length, 1, `build N must run its holder from one copy, found ${oldRuntimes.join(', ')}`);
		let status;
		await until(async () => {
			const response = await hostAction(session.window, { type: 'updater.check' });
			status = response?.result;
			if (status?.state === 'error') throw new Error(`the update check failed: ${status.errorMessage}`);
			return status?.state === 'ready';
		}, 'the update never finished downloading', 240_000);
		assert.equal(status.canInstallInPlace, true, 'build N must install updates in place');
		assert.equal(status.latestVersion, nextVersion);
		return { pid, status: { state: status.state, latestVersion: status.latestVersion }, requests: feed.requests };
	});

	await step('restart to update installs build N+1 without elevation', async () => {
		const consent = watchForConsent();
		try {
			const child = session.app.process();
			const exited = new Promise((resolve) => {
				if (child.exitCode !== null || child.signalCode !== null) resolve();
				else child.once('exit', resolve);
			});
			// Restart to update keeps the terminals; a confirmation, if any, keeps them too.
			await session.app.evaluate(({ dialog }) => {
				dialog.showMessageBox = async () => ({ checkboxChecked: false, response: 0 });
			});
			await hostAction(session.window, { type: 'updater.install' }).catch(() => undefined);
			await exited;
			session = undefined;
			await until(() => installedProcesses().length === 0, 'build N did not stop for its update', 60_000);
			// The installer replaces the files, then relaunches the app it installed.
			await until(() => installedProcesses().length > 0, 'the installer never relaunched Terminay', 240_000);
			assert.deepEqual(consent.seen, [], 'the update must not ask for elevation');
		} finally {
			consent.stop();
		}
		// The relaunched app is not this probe's to drive: stop it so the probe can
		// launch the installed build itself. The terminal's holder is a separate
		// executable and is not stopped.
		for (const id of installedProcesses()) {
			try {
				process.kill(id);
			} catch {}
		}
		await until(() => installedProcesses().length === 0, 'the relaunched Terminay did not stop', 60_000);
		return { productVersion: installedVersion() };
	});

	await step('build N+1 runs with the same terminal', async () => {
		session = await launch(undefined);
		assert.equal(await session.app.evaluate(({ app }) => app.getVersion()), nextVersion);
		await output(session.window, `pid-before-${pid}`);
		assert.equal(await answer(session.window, 'pid-after', '$PID'), pid, 'the same PowerShell must answer after the update');
	});

	await step('ending the terminal lets a later start remove build N\'s holder copy', async () => {
		await quitEnding(session);
		// The old copy goes only once nothing runs it, and only when a holder starts.
		await until(() => processesUnder(join(dataDir, 'holder-runtime', oldRuntimes[0])).length === 0, 'build N\'s holder kept running', 60_000);
		session = await launch(undefined);
		await answer(session.window, 'fresh', '$(1+1)');
		let runtimes;
		await until(async () => {
			runtimes = await holderRuntimes();
			return !runtimes.some((name) => oldRuntimes.includes(name));
		}, 'build N\'s holder copy was never removed', 60_000);
		return { oldRuntimes, runtimes };
	});

	await step('quit', async () => {
		await quitEnding(session);
		session = undefined;
	});
} catch (error) {
	failure = error;
} finally {
	if (session) {
		await session.window
			.screenshot({ path: join(dirname(recordPath), 'windows-probe-update-failure.png'), timeout: 10_000 })
			.catch(() => {});
		session.app.process().kill();
	}
	feed?.server.close();
	const failed = steps.find((entry) => !entry.ok);
	await writeFile(
		recordPath,
		`${JSON.stringify({ ok: failure === undefined, failedStep: failed?.name ?? null, steps, feedRequests: feed?.requests ?? [] }, null, 2)}\n`,
	);
}

if (failure) {
	console.error(`Windows update probe failed at: ${steps.find((entry) => !entry.ok)?.name}`);
	console.error(failure);
	process.exit(1);
}
console.log(`Windows update probe passed: ${basename(executablePath)} updated to ${nextVersion}`);
process.exit(0);
