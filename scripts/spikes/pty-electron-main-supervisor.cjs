const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { resolve } = require('node:path');
const { app } = require('electron');

const HOST_PATH = resolve(
	process.env.TERMINAY_PTY_HOST_PATH || 'dist-electron/ptyHost.js',
);
const WAIT_TIMEOUT_MS = 7_000;
const RESULT_PREFIX = 'TERMINAY_ELECTRON_PTY_PROOF=';

app.whenReady().then(async () => {
	try {
		assert.equal(
			process.env.ELECTRON_RUN_AS_NODE,
			undefined,
			'The supervisor must be an Electron main process, not Electron Node mode.',
		);
		assert.equal(process.type, 'browser');

		const interactive = await exerciseInteractiveSession();
		const cleanup = await exerciseCleanup();
		const result = {
			appReady: app.isReady(),
			cleanup,
			electronRunAsNode: false,
			electronVersion: process.versions.electron,
			interactive,
			processType: process.type,
			supervisorExecPath: process.execPath,
			supervisorPid: process.pid,
		};

		process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(result)}\n`, () => {
			app.exit(0);
		});
	} catch (error) {
		process.stderr.write(
			`${error instanceof Error ? error.stack : String(error)}\n`,
			() => {
				app.exit(1);
			},
		);
	}
});

async function exerciseInteractiveSession() {
	const host = startHost();
	try {
		host.send({
			type: 'create',
			shellPath: '/bin/sh',
			args: [],
			cwd: '/tmp',
			env: { ...process.env, PS1: '', PROMPT_COMMAND: '' },
		});
		const ready = await host.waitForMessage(
			({ message }) => message.type === 'ready',
			0,
			'PTY ready',
		);
		const outputIndex = host.messages.length;
		host.send({ type: 'resize', cols: 97, rows: 31 });
		host.send({
			type: 'write',
			data:
				'printf \'ELECTRON_MAIN_CWD:%s\\n\' "$PWD"; ' +
				"printf 'ELECTRON_MAIN_UTF8:✓-雪\\n'; " +
				"stty size | sed 's/^/ELECTRON_MAIN_SIZE:/'; exit 13\r",
		});
		await host.waitForOutputLine('ELECTRON_MAIN_CWD:/tmp', outputIndex);
		await host.waitForOutputLine('ELECTRON_MAIN_UTF8:✓-雪', outputIndex);
		await host.waitForOutputLine('ELECTRON_MAIN_SIZE:31 97', outputIndex);
		const terminalExit = await host.waitForMessage(
			({ message }) => message.type === 'exit',
			outputIndex,
			'PTY exit',
		);
		assert.deepEqual(
			{
				exitCode: terminalExit.message.exitCode,
				signal: terminalExit.message.signal,
			},
			{ exitCode: 13, signal: null },
		);
		assert.deepEqual(
			await withTimeout(host.exited, WAIT_TIMEOUT_MS, 'PTY host exit'),
			{ code: 0, signal: null },
		);
		await waitForPidsToDisappear([ready.message.pid]);

		return {
			childExecPath: host.child.spawnfile,
			cwd: '/tmp',
			exitCode: terminalExit.message.exitCode,
			hostPid: host.child.pid,
			resize: { cols: 97, rows: 31 },
			rootPidRemoved: true,
			signal: terminalExit.message.signal,
			utf8: true,
		};
	} finally {
		await host.stop();
	}
}

async function exerciseCleanup() {
	const host = startHost();
	try {
		host.send({
			type: 'create',
			shellPath: '/bin/sh',
			args: ['-c', 'sleep 30 & child=$!; printf "TREE:%s\\n" "$child"; wait'],
			cwd: '/tmp',
			env: process.env,
		});
		const ready = await host.waitForMessage(
			({ message }) => message.type === 'ready',
			0,
			'cleanup PTY ready',
		);
		const tree = await host.waitForOutputMatch(
			/(?:^|\n)TREE:(\d+)(?:\n|$)/,
			0,
			'cleanup descendant PID',
		);
		const childPid = Number.parseInt(tree.match[1], 10);
		const startedAt = Date.now();
		host.send({ type: 'kill' });
		assert.deepEqual(
			await withTimeout(host.exited, 3_000, 'bounded PTY host cleanup'),
			{ code: 0, signal: null },
		);
		await waitForPidsToDisappear([ready.message.pid, childPid]);
		const shutdownMs = Date.now() - startedAt;
		assert.ok(shutdownMs < 3_000);
		return {
			childPidRemoved: true,
			rootPidRemoved: true,
			shutdownMs,
		};
	} finally {
		await host.stop();
	}
}

function startHost() {
	const child = fork(HOST_PATH, {
		execArgv: [],
		env: {
			...process.env,
			ELECTRON_RUN_AS_NODE: '1',
			TERMINAY_PTY_HOST: '1',
		},
		stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
	});
	const messages = [];
	let exitResult = null;
	let stderr = '';
	let stdout = '';
	child.stderr.on('data', (chunk) => {
		stderr += chunk.toString();
	});
	child.stdout.on('data', (chunk) => {
		stdout += chunk.toString();
	});
	child.on('message', (message) => {
		messages.push({ message, receivedAt: Date.now() });
	});
	const exited = new Promise((resolveExit) => {
		child.once('exit', (code, signal) => {
			exitResult = { code, signal };
			resolveExit(exitResult);
		});
	});

	return {
		child,
		exited,
		messages,
		diagnostics() {
			return JSON.stringify({ exitResult, messages, stderr, stdout }, null, 2);
		},
		send(message) {
			assert.equal(
				child.connected,
				true,
				`PTY host IPC disconnected.\n${this.diagnostics()}`,
			);
			child.send(message);
		},
		async stop() {
			if (exitResult !== null) {
				return;
			}
			if (child.connected) {
				child.send({ type: 'kill' });
			}
			try {
				await withTimeout(exited, 1_000, 'PTY host fixture cleanup');
			} catch {
				child.kill('SIGKILL');
				await exited;
			}
		},
		waitForMessage(predicate, afterIndex, description) {
			return waitFor(
				() => {
					const match = messages.slice(afterIndex).find(predicate);
					if (match) {
						return match;
					}
					if (exitResult !== null) {
						throw new Error(
							`PTY host exited before ${description}.\n${this.diagnostics()}`,
						);
					}
					return null;
				},
				WAIT_TIMEOUT_MS,
				description,
				() => this.diagnostics(),
			);
		},
		waitForOutputLine(expected, afterIndex) {
			return this.waitForOutputMatch(
				new RegExp(`(?:^|\\n)${escapeRegExp(expected)}(?:\\n|$)`),
				afterIndex,
				`output line ${JSON.stringify(expected)}`,
			);
		},
		waitForOutputMatch(pattern, afterIndex, description) {
			let combinedOutput = '';
			return waitFor(
				() => {
					const outputMessages = messages
						.slice(afterIndex)
						.filter(({ message }) => message.type === 'data');
					combinedOutput = outputMessages
						.map(({ message }) => message.data)
						.join('')
						.replaceAll('\r', '');
					const match = combinedOutput.match(pattern);
					if (match) {
						return { ...outputMessages.at(-1), match };
					}
					if (exitResult !== null) {
						throw new Error(
							`PTY host exited before ${description}.\n${this.diagnostics()}`,
						);
					}
					return null;
				},
				WAIT_TIMEOUT_MS,
				description,
				() => `${this.diagnostics()}\nCombined output:\n${combinedOutput}`,
			);
		},
	};
}

async function waitForPidsToDisappear(pids) {
	await waitFor(
		() => pids.every((pid) => !isPidAlive(pid)),
		2_000,
		`processes ${pids.join(', ')} to exit`,
		() =>
			`Still alive: ${pids.filter((pid) => isPidAlive(pid)).join(', ') || 'none'}`,
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

async function waitFor(check, timeoutMs, description, diagnostics) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const result = check();
		if (result) {
			return result;
		}
		await new Promise((resolveWait) => setTimeout(resolveWait, 10));
	}
	throw new Error(`Timed out waiting for ${description}.\n${diagnostics()}`);
}

async function withTimeout(promise, timeoutMs, description) {
	let timeout;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timeout = setTimeout(
					() => reject(new Error(`Timed out waiting for ${description}.`)),
					timeoutMs,
				);
			}),
		]);
	} finally {
		clearTimeout(timeout);
	}
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
