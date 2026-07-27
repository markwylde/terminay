import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const HOST_PATH = resolve('dist-electron/ptyHost.js');
const WAIT_TIMEOUT_MS = 5_000;
const INACTIVITY_MS = 180;

test('the built PTY host runs under plain Node and Electron Node mode on macOS', {
	skip:
		process.platform !== 'darwin' &&
		'This development probe currently covers macOS only.',
}, async (t) => {
	await access(HOST_PATH);

	const electronPath = (await import('electron')).default;
	const runtimes = [
		{
			label: 'plain Node',
			execPath: process.execPath,
			env: process.env,
		},
		{
			label: 'Electron Node mode',
			execPath: electronPath,
			env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
		},
	];

	for (const runtime of runtimes) {
		await t.test(runtime.label, async (runtimeTest) => {
			await exerciseInteractiveSession(runtime);
			await exerciseBoundedKill(runtime);
			const signalEvidence = await inspectSignalPropagation(runtime);
			runtimeTest.diagnostic(signalEvidence);
		});
	}
});

async function exerciseInteractiveSession(runtime) {
	const host = startHost(runtime);

	try {
		const startIndex = host.messages.length;
		host.send({
			type: 'create',
			shellPath: '/bin/sh',
			args: [],
			cwd: '/tmp',
			env: {
				...process.env,
				PS1: '',
				PROMPT_COMMAND: '',
			},
		});

		const ready = await host.waitForMessage(
			({ message }) => message.type === 'ready',
			startIndex,
			'PTY ready',
		);
		assert.equal(Number.isInteger(ready.message.pid), true);
		assert.equal(ready.message.pid > 0, true);

		let outputIndex = host.messages.length;
		host.send({ type: 'write', data: 'printf \'CWD:%s\\n\' "$PWD"\r' });
		await host.waitForOutputLine('CWD:/tmp', outputIndex);

		outputIndex = host.messages.length;
		host.send({ type: 'write', data: "printf 'UTF8:✓-雪\\n'\r" });
		await host.waitForOutputLine('UTF8:✓-雪', outputIndex);

		outputIndex = host.messages.length;
		host.send({ type: 'resize', cols: 101, rows: 37 });
		host.send({ type: 'write', data: "stty size | sed 's/^/SIZE:/'\r" });
		await host.waitForOutputLine('SIZE:37 101', outputIndex);

		const foregroundIndex = host.messages.length;
		host.send({
			type: 'write',
			data: "sleep 2; printf 'FOREGROUND:DONE\\n'\r",
		});
		await host.waitForMessage(
			({ message }) =>
				message.type === 'activity' &&
				message.activity?.status === 'working' &&
				message.activity?.source === 'generic:foreground',
			foregroundIndex,
			'foreground process activity',
		);
		await host.waitForOutputLine('FOREGROUND:DONE', foregroundIndex);

		const inactivityIndex = host.messages.length;
		const requestId = `${runtime.label}-inactivity`;
		host.send({
			type: 'waitForInactivity',
			requestId,
			durationMs: INACTIVITY_MS,
		});
		host.send({
			type: 'write',
			data: "printf 'INACTIVITY:start\\n'; sleep 0.12; printf 'INACTIVITY:end\\n'\r",
		});

		const endOutput = await host.waitForOutputLine(
			'INACTIVITY:end',
			inactivityIndex,
		);
		const inactive = await host.waitForMessage(
			({ message }) =>
				message.type === 'inactive' && message.requestId === requestId,
			inactivityIndex,
			'PTY inactivity response',
		);
		assert.ok(
			inactive.receivedAt - endOutput.receivedAt >= INACTIVITY_MS - 40,
			`Inactivity fired before output had been quiet for the requested duration.\n${host.diagnostics()}`,
		);

		const exitIndex = host.messages.length;
		host.send({ type: 'write', data: 'exit 7\r' });
		const terminalExit = await host.waitForMessage(
			({ message }) => message.type === 'exit',
			exitIndex,
			'terminal exit',
		);
		assert.equal(terminalExit.message.exitCode, 7);
		assert.equal(terminalExit.message.signal, null);

		const hostExit = await withTimeout(
			host.exited,
			WAIT_TIMEOUT_MS,
			'PTY host process exit',
		);
		assert.deepEqual(hostExit, { code: 0, signal: null });
		await waitForPidToDisappear(ready.message.pid);
	} finally {
		await host.stop();
	}
}

async function exerciseBoundedKill(runtime) {
	const host = startHost(runtime);

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
			'long-running PTY ready',
		);
		const treeOutput = await host.waitForOutputMatch(
			/(?:^|\n)TREE:(\d+)(?:\n|$)/,
			0,
			'background child PID',
		);
		const childPid = Number.parseInt(treeOutput.match[1], 10);
		const killStartedAt = Date.now();
		host.send({ type: 'kill' });

		const hostExit = await withTimeout(
			host.exited,
			3_000,
			'killed PTY host process exit',
		);
		assert.deepEqual(hostExit, { code: 0, signal: null });
		assert.ok(Date.now() - killStartedAt < 3_000);
		await waitForPidToDisappear(ready.message.pid);
		await waitForPidToDisappear(childPid);
	} finally {
		await host.stop();
	}
}

async function inspectSignalPropagation(runtime) {
	const host = startHost(runtime);
	try {
		host.send({
			type: 'create',
			shellPath: '/bin/sh',
			args: ['-c', 'kill -TERM $$'],
			cwd: '/tmp',
			env: process.env,
		});
		const terminalExit = await host.waitForMessage(
			({ message }) => message.type === 'exit',
			0,
			'signal-terminated PTY exit',
		);
		await withTimeout(host.exited, WAIT_TIMEOUT_MS, 'signal probe host exit');
		assert.equal(terminalExit.message.exitCode, 0);
		assert.equal(terminalExit.message.signal, 15);
		return `SIGTERM propagated as signal ${terminalExit.message.signal} while exitCode remained ${terminalExit.message.exitCode}.`;
	} finally {
		await host.stop();
	}
}

function startHost(runtime) {
	const child = fork(HOST_PATH, {
		execArgv: [],
		execPath: runtime.execPath,
		env: runtime.env,
		stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
	});
	const messages = [];
	let stderr = '';
	let stdout = '';
	let exitResult = null;

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
				await withTimeout(exited, 1_000, 'PTY host cleanup');
			} catch {
				child.kill('SIGKILL');
				await exited;
			}
		},
		async waitForMessage(predicate, afterIndex, description) {
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
		async waitForOutputLine(expected, afterIndex) {
			return this.waitForOutputMatch(
				new RegExp(`(?:^|\\n)${escapeRegExp(expected)}(?:\\n|$)`),
				afterIndex,
				`output line ${JSON.stringify(expected)}`,
			);
		},
		async waitForOutputMatch(pattern, afterIndex, description) {
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

async function waitForPidToDisappear(pid) {
	await waitFor(
		() => !isPidAlive(pid),
		2_000,
		`PTY process ${pid} to exit`,
		() => `Process ${pid} still exists.`,
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

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
