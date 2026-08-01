import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { extractFile } from '@electron/asar';
import { _electron as electron } from '@playwright/test';

const execFileAsync = promisify(execFile);
const APP_PATH = resolve(
	process.env.TERMINAY_PACKAGED_APP || 'release/0.0.0/mac-arm64/Terminay.app',
);
const WAIT_TIMEOUT_MS = 10_000;

test('packaged macOS Desktop resolves and exercises its PTY payload', {
		skip:
			(process.platform !== 'darwin' || process.arch !== 'arm64') &&
			'This packaged Desktop proof currently covers macOS arm64 only.',
	timeout: 40_000,
}, async (t) => {
	const payload = await inspectPackagedPayload(APP_PATH);
	t.diagnostic(JSON.stringify(payload));

	const profilePath = await mkdtemp(
		join(tmpdir(), 'terminay-packaged-pty-profile-'),
	);
	const tempPath = await mkdtemp(join(tmpdir(), 'terminay-packaged-pty-temp-'));
	const canonicalTempPath = await realpath(tempPath);
	await createHostResolutionPoison(tempPath);
	const executablePath = join(
		APP_PATH,
		'Contents',
		'MacOS',
		basename(APP_PATH, '.app'),
	);
	let electronApp;
	try {
		electronApp = await electron.launch({
			cwd: canonicalTempPath,
			executablePath,
			env: createSanitizedPackagedEnv({
				CI: '1',
				TEMP: tempPath,
				TERMINAY_E2E_TEMP_DIR: tempPath,
				TERMINAY_TEST: '1',
				TERMINAY_USER_DATA_DIR: profilePath,
				TMP: tempPath,
				TMPDIR: tempPath,
			}),
		});
		const mainPid = electronApp.process().pid;
		assert.ok(mainPid > 0);
		assert.deepEqual(
			await electronApp.evaluate(() => ({
				arch: process.arch,
				cwd: process.cwd(),
				electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE === '1',
				loaderOverridesPresent: [
					'DYLD_INSERT_LIBRARIES',
					'DYLD_LIBRARY_PATH',
					'NODE_OPTIONS',
					'NODE_PATH',
					'VITE_DEV_SERVER_URL',
				].filter((name) => process.env[name] !== undefined),
				processType: process.type,
				resourcesPath: process.resourcesPath,
			})),
			{
				arch: 'arm64',
				cwd: canonicalTempPath,
				electronRunAsNode: false,
				loaderOverridesPresent: [],
				processType: 'browser',
				resourcesPath: payload.resourcesPath,
			},
		);

		const mainWindow = await electronApp.firstWindow();
		await mainWindow.waitForFunction(() => Boolean(window.terminay));

		const initialHostPids = new Set(await findPtyHostPids(mainPid));
		const interactiveId = await mainWindow.evaluate(
			async () => (await window.terminayTest.createServerTerminal({ cwd: '/tmp' })).id,
		);
		const interactiveHost = await waitForNewHost(mainPid, initialHostPids);
		assert.ok(
			interactiveHost.command.includes(payload.expectedHostEntry),
			`Unexpected packaged PTY host command: ${interactiveHost.command}`,
		);
		await waitForPackagedShell(mainWindow, interactiveId);
		const inactivity = await mainWindow.evaluate(async (sessionId) => {
			let output = '';
			let lastDataAt = 0;
			const dispose = window.terminay.onTerminalData((message) => {
				if (message.id === sessionId) {
					output += message.data;
					lastDataAt = Date.now();
				}
			});
			const waiting = window.terminay.waitForTerminalInactivity(sessionId, 180);
			window.terminayTest.writeServerTerminal(
				sessionId,
				"printf 'PACKAGED_QUIET:start\\n'; sleep 0.12; printf 'PACKAGED_QUIET:end\\n'\r",
			);
			await waiting;
			dispose();
			return {
				output,
				quietMs: Date.now() - lastDataAt,
			};
		}, interactiveId);
		assert.match(
			inactivity.output.replaceAll('\r', ''),
			/(?:^|\n)PACKAGED_QUIET:end(?:\n|$)/,
		);
		assert.ok(inactivity.quietMs >= 140);
		const interactive = await mainWindow.evaluate(
			async (sessionId) =>
				new Promise((resolveProof, rejectProof) => {
					let output = '';
					const activities = [];
					const timeout = setTimeout(() => {
						disposeData();
						disposeActivity();
						disposeExit();
						rejectProof(
							new Error(
								`Timed out waiting for packaged PTY exit. Output: ${output}`,
							),
						);
					}, 8_000);
					const disposeData = window.terminay.onTerminalData((message) => {
						if (message.id === sessionId) {
							output += message.data;
						}
					});
					const disposeActivity = window.terminay.onTerminalActivity(
						(message) => {
							if (message.id === sessionId) {
								activities.push(message.activity);
							}
						},
					);
					const disposeExit = window.terminay.onTerminalExit((message) => {
						if (message.id !== sessionId) {
							return;
						}
						clearTimeout(timeout);
						disposeData();
						disposeActivity();
						disposeExit();
						resolveProof({ activities, exit: message, output });
					});
					window.terminay.resizeTerminal(sessionId, 99, 33);
					window.terminayTest.writeServerTerminal(
						sessionId,
						'printf \'PACKAGED_CWD:%s\\n\' "$PWD"; ' +
							"printf 'PACKAGED_UTF8:✓-雪\\n'; " +
							"stty size | sed 's/^/PACKAGED_SIZE:/'; " +
							"sleep 2; printf 'PACKAGED_FOREGROUND:DONE\\n'; exit 17\r",
					);
				}),
			interactiveId,
		);
		const normalizedOutput = interactive.output.replaceAll('\r', '');
		assert.match(normalizedOutput, /(?:^|\n)PACKAGED_CWD:\/tmp(?:\n|$)/);
		assert.match(normalizedOutput, /(?:^|\n)PACKAGED_UTF8:✓-雪(?:\n|$)/);
		assert.match(normalizedOutput, /(?:^|\n)PACKAGED_SIZE:33 99(?:\n|$)/);
		assert.match(normalizedOutput, /(?:^|\n)PACKAGED_FOREGROUND:DONE(?:\n|$)/);
		assert.ok(
			interactive.activities.some(
				(activity) =>
					activity.status === 'working' &&
					activity.source === 'generic:foreground',
			),
		);
		assert.deepEqual(
			{
				exitCode: interactive.exit.exitCode,
				signal: interactive.exit.signal,
			},
			{ exitCode: 17, signal: null },
		);
		await waitForPidsToDisappear([interactiveHost.pid]);

		const beforeSignalPids = new Set(await findPtyHostPids(mainPid));
		const signalId = await mainWindow.evaluate(
			async () => (await window.terminayTest.createServerTerminal({ cwd: '/tmp' })).id,
		);
		const signalHost = await waitForNewHost(mainPid, beforeSignalPids);
		await waitForPackagedShell(mainWindow, signalId);
		const signalExit = await mainWindow.evaluate(
			async (sessionId) =>
				new Promise((resolveExit, rejectExit) => {
					const timeout = setTimeout(() => {
						dispose();
						rejectExit(new Error('Timed out waiting for packaged SIGTERM.'));
					}, 8_000);
					const dispose = window.terminay.onTerminalExit((message) => {
						if (message.id !== sessionId) {
							return;
						}
						clearTimeout(timeout);
						dispose();
						resolveExit(message);
					});
					window.terminayTest.writeServerTerminal(
						sessionId,
						"exec /bin/sh -c 'kill -TERM $$'\r",
					);
				}),
			signalId,
		);
		assert.deepEqual(
			{ exitCode: signalExit.exitCode, signal: signalExit.signal },
			{ exitCode: 0, signal: 15 },
		);
		await waitForPidsToDisappear([signalHost.pid]);

		const beforeCleanupPids = new Set(await findPtyHostPids(mainPid));
		const cleanupId = await mainWindow.evaluate(
			async () => (await window.terminayTest.createServerTerminal({ cwd: '/tmp' })).id,
		);
		const cleanupHost = await waitForNewHost(mainPid, beforeCleanupPids);
		await waitForPackagedShell(mainWindow, cleanupId);
		const descendantPid = await mainWindow.evaluate(
			async (sessionId) =>
				new Promise((resolvePid, rejectPid) => {
					let output = '';
					const timeout = setTimeout(() => {
						dispose();
						rejectPid(
							new Error(
								`Timed out waiting for packaged descendant PID. Output: ${output}`,
							),
						);
					}, 8_000);
					const dispose = window.terminay.onTerminalData((message) => {
						if (message.id !== sessionId) {
							return;
						}
						output += message.data.replaceAll('\r', '');
						const match = output.match(/(?:^|\n)PACKAGED_TREE:(\d+)(?:\n|$)/);
						if (!match) {
							return;
						}
						clearTimeout(timeout);
						dispose();
						resolvePid(Number.parseInt(match[1], 10));
					});
					window.terminayTest.writeServerTerminal(
						sessionId,
						'sleep 30 & child=$!; printf "PACKAGED_TREE:%s\\n" "$child"; wait\r',
					);
				}),
			cleanupId,
		);
		assert.ok(descendantPid > 0);
		const cleanupStartedAt = Date.now();
		await mainWindow.evaluate(
			(sessionId) => window.terminay.killTerminal(sessionId),
			cleanupId,
		);
		await waitForPidsToDisappear([cleanupHost.pid, descendantPid]);
		const cleanupMs = Date.now() - cleanupStartedAt;
		assert.ok(cleanupMs < 3_000);

		t.diagnostic(
			JSON.stringify({
				cleanup: {
					descendantPidRemoved: true,
					hostPidRemoved: true,
					shutdownMs: cleanupMs,
				},
				interactive: {
					cwd: '/tmp',
					exitCode: interactive.exit.exitCode,
					foregroundSource: 'generic:foreground',
					hostPidRemoved: true,
					inactivityQuietMs: inactivity.quietMs,
					resize: { cols: 99, rows: 33 },
					signal: interactive.exit.signal,
					utf8: true,
				},
				mainPid,
				ptyHostCommand: interactiveHost.command,
				signal: {
					exitCode: signalExit.exitCode,
					hostPidRemoved: true,
					signal: signalExit.signal,
				},
			}),
		);
	} finally {
		if (electronApp) {
			await electronApp.close().catch(() => {
				if (electronApp.process().exitCode === null) {
					electronApp.process().kill('SIGKILL');
				}
			});
		}
		await Promise.all([
			rm(profilePath, { force: true, recursive: true }),
			rm(tempPath, { force: true, recursive: true }),
		]);
	}
});

async function inspectPackagedPayload(appPath) {
	const resourcesPath = join(appPath, 'Contents', 'Resources');
	const asarPath = join(resourcesPath, 'app.asar');
	const unpackedPath = join(resourcesPath, 'app.asar.unpacked');
	const ptyHostPath = join(unpackedPath, 'dist-electron', 'ptyHost.js');
	const expectedHostEntry = join(
		resourcesPath,
		'app.asar',
		'dist-electron',
		'ptyHost.js',
	);
	const nativeDirectory = join(
		unpackedPath,
		'node_modules',
		'node-pty',
		'build',
		'Release',
	);
	const nativePath = join(nativeDirectory, 'pty.node');
	const helperPath = join(nativeDirectory, 'spawn-helper');
	await Promise.all([
		access(asarPath, fsConstants.R_OK),
		access(ptyHostPath, fsConstants.R_OK),
		access(nativePath, fsConstants.R_OK),
		access(helperPath, fsConstants.R_OK | fsConstants.X_OK),
	]);
	const [nativeStat, helperStat] = await Promise.all([
		stat(nativePath),
		stat(helperPath),
	]);
	assert.equal(nativeStat.isFile(), true);
	assert.equal(helperStat.isFile(), true);
	assert.notEqual(nativeStat.mode & 0o111, 0);
	assert.notEqual(helperStat.mode & 0o111, 0);
	await Promise.all([
		assertArm64MachO(nativePath, 'node-pty addon'),
		assertArm64MachO(helperPath, 'node-pty spawn-helper'),
	]);

	const unixTerminal = extractFile(
		asarPath,
		'node_modules/node-pty/lib/unixTerminal.js',
	).toString('utf8');
	assert.match(
		unixTerminal,
		/helperPath = helperPath\.replace\('app\.asar', 'app\.asar\.unpacked'\)/,
	);
	assert.match(unixTerminal, /pty\.fork\(.+helperPath, onexit\)/s);

	return {
		architecture: 'arm64',
		asarPath,
		expectedHostEntry,
		helper: {
			mode: (helperStat.mode & 0o777).toString(8),
			path: helperPath,
		},
		nativeAddon: {
			mode: (nativeStat.mode & 0o777).toString(8),
			path: nativePath,
		},
		ptyHostPath,
		resourcesPath,
	};
}

async function createHostResolutionPoison(cwd) {
	const poisonRoot = join(cwd, 'node_modules', 'node-pty');
	await mkdir(poisonRoot, { recursive: true });
	await writeFile(
		join(poisonRoot, 'package.json'),
		`${JSON.stringify({
			name: 'node-pty',
			version: '0.0.0-host-poison',
			main: 'index.js',
		})}\n`,
	);
	await writeFile(
		join(poisonRoot, 'index.js'),
		"throw new Error('host cwd node-pty poison was loaded');\n",
	);
}

function createSanitizedPackagedEnv(overrides) {
	const env = { ...process.env };
	for (const name of [
		'APP_ROOT',
		'ELECTRON_FORCE_IS_PACKAGED',
		'ELECTRON_NO_ASAR',
		'ELECTRON_OVERRIDE_DIST_PATH',
		'ELECTRON_RUN_AS_NODE',
		'DYLD_FALLBACK_FRAMEWORK_PATH',
		'DYLD_FALLBACK_LIBRARY_PATH',
		'DYLD_FRAMEWORK_PATH',
		'DYLD_INSERT_LIBRARIES',
		'DYLD_LIBRARY_PATH',
		'LD_LIBRARY_PATH',
		'LD_PRELOAD',
		'NODE_CHANNEL_FD',
		'NODE_CHANNEL_SERIALIZATION_MODE',
		'NODE_ENV',
		'NODE_OPTIONS',
		'NODE_PATH',
		'NODE_REPL_EXTERNAL_MODULE',
		'TS_NODE_COMPILER_OPTIONS',
		'TS_NODE_PROJECT',
		'TS_NODE_TRANSPILE_ONLY',
		'VITE_DEV_SERVER_URL',
		'VITE_PUBLIC',
		'WEBPACK_DEV_SERVER_URL',
	]) {
		delete env[name];
	}
	return { ...env, ...overrides };
}

async function waitForPackagedShell(page, sessionId) {
	await page.evaluate(
		async (nextSessionId) =>
			new Promise((resolveReady, rejectReady) => {
				let output = '';
				const timeout = setTimeout(() => {
					dispose();
					rejectReady(
						new Error(
							`Timed out waiting for packaged shell readiness. Output: ${output}`,
						),
					);
				}, 8_000);
				const dispose = window.terminay.onTerminalData((message) => {
					if (message.id !== nextSessionId) {
						return;
					}
					output += message.data.replaceAll('\r', '');
					if (!output.match(/(?:^|\n)PACKAGED_READY(?:\n|$)/)) {
						return;
					}
					clearTimeout(timeout);
					dispose();
					resolveReady();
				});
				window.terminayTest.writeServerTerminal(
					nextSessionId,
					"printf 'PACKAGED_READY\\n'\r",
				);
			}),
		sessionId,
	);
}

async function assertArm64MachO(path, label) {
	const bytes = await readFile(path);
	assert.ok(bytes.length >= 12, `${label} is too short.`);
	assert.equal(bytes.readUInt32LE(0), 0xfeedfacf, `${label} is not Mach-O 64.`);
	assert.equal(bytes.readUInt32LE(4), 0x0100000c, `${label} is not arm64.`);
}

async function waitForNewHost(mainPid, previousPids) {
	return waitFor(
		async () => {
			const processes = await findPtyHostProcesses(mainPid);
			return (
				processes.find((process) => !previousPids.has(process.pid)) || null
			);
		},
		WAIT_TIMEOUT_MS,
		'packaged PTY host child',
	);
}

async function findPtyHostPids(mainPid) {
	return (await findPtyHostProcesses(mainPid)).map((process) => process.pid);
}

async function findPtyHostProcesses(mainPid) {
	const { stdout } = await execFileAsync('/bin/ps', [
		'-axo',
		'pid=,ppid=,command=',
	]);
	const results = [];
	for (const line of stdout.split('\n')) {
		const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
		if (!match) {
			continue;
		}
		const pid = Number.parseInt(match[1], 10);
		const parentPid = Number.parseInt(match[2], 10);
		const command = match[3];
		if (parentPid === mainPid && command.includes('ptyHost.js')) {
			results.push({ command, pid });
		}
	}
	return results;
}

async function waitForPidsToDisappear(pids) {
	await waitFor(
		async () => pids.every((pid) => !isPidAlive(pid)),
		3_000,
		`processes ${pids.join(', ')} to exit`,
	);
}

function isPidAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if (error?.code === 'ESRCH') {
			return false;
		}
		if (error?.code === 'EPERM') {
			return true;
		}
		throw error;
	}
}

async function waitFor(check, timeoutMs, description) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const result = await check();
		if (result) {
			return result;
		}
		await new Promise((resolveWait) => setTimeout(resolveWait, 25));
	}
	throw new Error(`Timed out waiting for ${description}.`);
}
