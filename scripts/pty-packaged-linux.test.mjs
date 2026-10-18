import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
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
import { join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { _electron as electron } from '@playwright/test';

const execFileAsync = promisify(execFile);

test(
	'packaged GNU/Linux x64 Desktop resolves and exercises its PTY payload',
	{
		skip:
			(process.platform !== 'linux' || process.arch !== 'x64') &&
			'This packaged Desktop proof covers GNU/Linux x64 only.',
	},
	async (t) => {
		const packaged = await resolvePackagedExecutable();
		t.after(async () => {
			if (packaged.extractionPath) {
				await rm(packaged.extractionPath, { force: true, recursive: true });
			}
		});
		const payload = await inspectPackagedPayload(packaged.executablePath);
		if (packaged.extractionPath) {
			assert.ok(
				payload.resourcesPath.startsWith(
					`${join(packaged.extractionPath, 'squashfs-root')}/`,
				),
				`Packaged resources escaped the extracted AppImage: ${payload.resourcesPath}`,
			);
		}
		t.diagnostic(JSON.stringify(payload));

		const profilePath = await mkdtemp(
			join(tmpdir(), 'terminay-packaged-linux-profile-'),
		);
		const tempPath = await mkdtemp(
			join(tmpdir(), 'terminay-packaged-linux-temp-'),
		);
		const canonicalTempPath = await realpath(tempPath);
		await createHostResolutionPoison(tempPath);
		let electronApp;
		try {
			electronApp = await electron.launch({
				// Every wait is for a state the application reaches, not a budget.
				timeout: 0,
				args:
					typeof process.getuid === 'function' && process.getuid() === 0
						? ['--no-sandbox']
						: [],
				cwd: canonicalTempPath,
				executablePath: packaged.executablePath,
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
			electronApp.context().setDefaultTimeout(0);
			const mainPid = electronApp.process().pid;
			assert.ok(mainPid > 0);
			assert.deepEqual(
				await electronApp.evaluate(() => ({
					arch: process.arch,
					cwd: process.cwd(),
					electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE === '1',
					loaderOverridesPresent: [
						'LD_LIBRARY_PATH',
						'LD_PRELOAD',
						'NODE_OPTIONS',
						'NODE_PATH',
						'VITE_DEV_SERVER_URL',
					].filter((name) => process.env[name] !== undefined),
					processType: process.type,
					resourcesPath: process.resourcesPath,
				})),
				{
					arch: 'x64',
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
				async () =>
					(await window.terminayTest.createServerTerminal({ cwd: '/tmp' })).id,
			);
			const interactiveHost = await hostOfReadyShell(mainWindow, interactiveId, mainPid, initialHostPids);
			assert.ok(
				interactiveHost.command.startsWith(
					`${packaged.executablePath} ${payload.expectedHostEntry}`,
				),
				`Unexpected packaged PTY host command: ${interactiveHost.command}`,
			);

			const inactivity = await mainWindow.evaluate(async (sessionId) => {
				let output = '';
				let sawEnd;
				const ended = new Promise((resolveEnd) => {
					sawEnd = resolveEnd;
				});
				const dispose = window.terminay.onTerminalData((message) => {
					if (message.id !== sessionId) return;
					output += message.data;
					if (/(?:^|\n)PACKAGED_QUIET:end(?:\n|$)/.test(output.replaceAll('\r', '')))
						sawEnd();
				});
				window.terminayTest.writeServerTerminal(
					sessionId,
					"printf 'PACKAGED_QUIET:start\\n'; printf 'PACKAGED_QUIET:end\\n'\r",
				);
				// The packaged wait is asked once the output has finished, so it is
				// answered by the terminal going quiet, not by how quickly this machine
				// printed. Its window is the server's to keep (terminal-inactivity-hold).
				await ended;
				await window.terminay.waitForTerminalInactivity(sessionId, 180);
				dispose();
				return { output };
			}, interactiveId);
			assert.match(
				inactivity.output.replaceAll('\r', ''),
				/(?:^|\n)PACKAGED_QUIET:end(?:\n|$)/,
			);

			const interactive = await mainWindow.evaluate(
				async (sessionId) =>
					new Promise((resolveProof) => {
						let output = '';
						const activities = [];
						// The foreground process waits for a line the test types once it has
						// been seen working, so seeing it never depends on how long it ran.
						let released = false;
						const disposeData = window.terminay.onTerminalData((message) => {
							if (message.id === sessionId) {
								output += message.data;
							}
						});
						const disposeActivity = window.terminay.onTerminalActivity(
							(message) => {
								if (message.id === sessionId) {
									activities.push(message.activity);
									if (
										!released &&
										message.activity.status === 'working' &&
										message.activity.source === 'generic:foreground'
									) {
										released = true;
										window.terminayTest.writeServerTerminal(sessionId, 'go\r');
									}
								}
							},
						);
						const disposeExit = window.terminay.onTerminalExit((message) => {
							if (message.id !== sessionId) {
								return;
							}
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
								"head -n 1 >/dev/null; printf 'PACKAGED_FOREGROUND:DONE\\n'; exit 17\r",
						);
					}),
				interactiveId,
			);
			const normalizedOutput = interactive.output.replaceAll('\r', '');
			assert.match(normalizedOutput, /(?:^|\n)PACKAGED_CWD:\/tmp(?:\n|$)/);
			assert.match(normalizedOutput, /(?:^|\n)PACKAGED_UTF8:✓-雪(?:\n|$)/);
			assert.match(normalizedOutput, /(?:^|\n)PACKAGED_SIZE:33 99(?:\n|$)/);
			assert.match(
				normalizedOutput,
				/(?:^|\n)PACKAGED_FOREGROUND:DONE(?:\n|$)/,
			);
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
				async () =>
					(await window.terminayTest.createServerTerminal({ cwd: '/tmp' })).id,
			);
			const signalHost = await hostOfReadyShell(mainWindow, signalId, mainPid, beforeSignalPids);
			const signalExit = await mainWindow.evaluate(
				async (sessionId) =>
					new Promise((resolveExit) => {
						const dispose = window.terminay.onTerminalExit((message) => {
							if (message.id !== sessionId) {
								return;
							}
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
				async () =>
					(await window.terminayTest.createServerTerminal({ cwd: '/tmp' })).id,
			);
			const cleanupHost = await hostOfReadyShell(mainWindow, cleanupId, mainPid, beforeCleanupPids);
			const descendantPid = await mainWindow.evaluate(
				async (sessionId) =>
					new Promise((resolvePid) => {
						let output = '';
						const dispose = window.terminay.onTerminalData((message) => {
							if (message.id !== sessionId) {
								return;
							}
							output += message.data.replaceAll('\r', '');
							const match = output.match(
								/(?:^|\n)PACKAGED_TREE:(\d+)(?:\n|$)/,
							);
							if (!match) {
								return;
							}
							dispose();
							resolvePid(Number.parseInt(match[1], 10));
						});
						window.terminayTest.writeServerTerminal(
							sessionId,
							'tail -f /dev/null & child=$!; printf "PACKAGED_TREE:%s\\n" "$child"; wait\r',
						);
					}),
				cleanupId,
			);
			// The descendant never exits by itself; a run that fails before cleanup
			// kills it here rather than leaving it behind.
			t.after(() => {
				try {
					process.kill(descendantPid, 'SIGKILL');
				} catch {}
			});
			await mainWindow.evaluate(
				(sessionId) => window.terminay.killTerminal(sessionId),
				cleanupId,
			);
			await waitForPidsToDisappear([cleanupHost.pid, descendantPid]);

			t.diagnostic(
				JSON.stringify({
					cleanup: true,
					foreground: 'generic:foreground',
					mainPid,
					resize: { cols: 99, rows: 33 },
					signal: signalExit.signal,
					utf8: true,
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
	},
);

async function resolvePackagedExecutable() {
	const appImagePath = process.env.TERMINAY_PACKAGED_APPIMAGE;
	if (!appImagePath) {
		return {
			executablePath: resolve(
				process.env.TERMINAY_PACKAGED_APP ||
					'release/0.0.0/linux-unpacked/terminay',
			),
			extractionPath: null,
		};
	}

	const extractionPath = await mkdtemp(
		join(tmpdir(), 'terminay-packaged-linux-appimage-'),
	);
	const resolvedAppImage = resolve(appImagePath);
	await access(resolvedAppImage, fsConstants.R_OK | fsConstants.X_OK);
	await execFileAsync(resolvedAppImage, ['--appimage-extract'], {
		cwd: extractionPath,
		env: createSanitizedPackagedEnv({
			APPIMAGE_EXTRACT_AND_RUN: '1',
		}),
	});
	return {
		executablePath: join(extractionPath, 'squashfs-root', 'terminay'),
		extractionPath,
	};
}

async function inspectPackagedPayload(executablePath) {
	const resourcesPath = join(resolve(executablePath, '..'), 'resources');
	const asarPath = join(resourcesPath, 'app.asar');
	const unpackedPath = join(resourcesPath, 'app.asar.unpacked');
	const ptyHostPath = join(unpackedPath, 'dist-electron', 'ptyHost.js');
	const expectedHostEntry = join(
		resourcesPath,
		'app.asar',
		'dist-electron',
		'ptyHost.js',
	);
	const nativePath = join(
		unpackedPath,
		'node_modules',
		'node-pty',
		'build',
		'Release',
		'pty.node',
	);
	await Promise.all([
		access(executablePath, fsConstants.R_OK | fsConstants.X_OK),
		access(asarPath, fsConstants.R_OK),
		access(ptyHostPath, fsConstants.R_OK),
		access(nativePath, fsConstants.R_OK),
	]);
	const nativeStat = await stat(nativePath);
	assert.equal(nativeStat.isFile(), true);
	await assertX64Elf(nativePath, 'node-pty addon');
	return {
		architecture: 'x64',
		asarPath,
		expectedHostEntry,
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

async function assertX64Elf(path, label) {
	const bytes = await readFile(path);
	assert.ok(bytes.length >= 20, `${label} is too short.`);
	assert.equal(bytes.readUInt32LE(0), 0x464c457f, `${label} is not ELF.`);
	assert.equal(bytes[4], 2, `${label} is not ELF64.`);
	assert.equal(bytes.readUInt16LE(18), 62, `${label} is not x86-64.`);
}

async function waitForPackagedShell(page, sessionId) {
	await page.evaluate(
		async (nextSessionId) =>
			new Promise((resolveReady) => {
				let output = '';
				const dispose = window.terminay.onTerminalData((message) => {
					if (message.id !== nextSessionId) {
						return;
					}
					output += message.data.replaceAll('\r', '');
					if (!output.match(/(?:^|\n)PACKAGED_READY(?:\n|$)/)) {
						return;
					}
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

/** The PTY host of a terminal whose shell has answered: once it has, its
 * host is running, so it is there to find. */
async function hostOfReadyShell(page, sessionId, mainPid, previousPids) {
	await waitForPackagedShell(page, sessionId);
	const host = (await findPtyHostProcesses(mainPid)).find(
		(process) => !previousPids.has(process.pid),
	);
	assert.ok(host, 'a packaged PTY host child runs the ready shell');
	return host;
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

/** Resolves once every process has exited. They are not this test's
 * children, so the operating system's own exit notification is waited on
 * (a pidfd, via util-linux `waitpid`), which returns at once for a process already gone. */
async function waitForPidsToDisappear(pids) {
	await Promise.all(
		pids.map(
			(pid) =>
				new Promise((resolveExit, rejectExit) => {
					const waiter = spawn('waitpid', [String(pid)], { stdio: 'ignore' });
					waiter.once('error', rejectExit);
					waiter.once('exit', () => resolveExit());
				}),
		),
	);
}
