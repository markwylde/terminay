import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fork, execFile } from 'node:child_process';
import { access, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
	getPtyRuntimePlatform,
	PTY_RUNTIME_NODE_VERSION,
} from './pty-runtime-platforms.mjs';

const execFileAsync = promisify(execFile);
const WAIT_TIMEOUT_MS = 7_000;
const args = parseArgs(process.argv.slice(2));
const archivePath = resolve(requireArg(args, 'archive'));
const target = requireArg(args, 'target');
const platform = getPtyRuntimePlatform(target);

if (process.platform !== 'linux' || process.arch !== platform.architecture) {
	throw new Error(
		`The ${target} artifact probe requires native linux-${platform.architecture}; this process is ${process.platform}-${process.arch}.`,
	);
}

const tempDirectory = await mkdtemp(
	join(tmpdir(), 'terminay-pty-runtime-probe-'),
);
try {
	const { stdout: archiveListing } = await execFileAsync('tar', [
		'-tzf',
		archivePath,
		'--quoting-style=escape',
	]);
	const { stdout: verboseArchiveListing } = await execFileAsync('tar', [
		'-tvzf',
		archivePath,
		'--quoting-style=escape',
	]);
	const archiveEntries = archiveListing
		.split('\n')
		.map((entry) => entry.trim())
		.filter(Boolean);
	assert.ok(archiveEntries.length > 0, 'The archive is empty.');
	for (const entry of archiveEntries) {
		assert.equal(
			entry.startsWith('/'),
			false,
			`Unsafe absolute path: ${entry}`,
		);
		assert.equal(
			entry.split('/').includes('..'),
			false,
			`Unsafe parent path: ${entry}`,
		);
	}
	for (const entry of verboseArchiveListing.split('\n').filter(Boolean)) {
		assert.ok(
			entry.startsWith('-') || entry.startsWith('d'),
			`Archive links and special entries are forbidden: ${entry}`,
		);
	}
	await execFileAsync('tar', [
		'-xzf',
		archivePath,
		'--no-same-owner',
		'-C',
		tempDirectory,
	]);
	const roots = await readdir(tempDirectory);
	assert.deepEqual(
		roots.length,
		1,
		'The archive must contain exactly one root.',
	);
	const artifactRoot = join(tempDirectory, roots[0]);
	const manifest = JSON.parse(
		await readFile(join(artifactRoot, 'manifest.json'), 'utf8'),
	);
	assert.equal(manifest.schemaVersion, 1);
	assert.equal(manifest.target, target);
	assert.equal(manifest.node.version, PTY_RUNTIME_NODE_VERSION);
	assert.deepEqual(manifest.nodePty.spawnHelper, {
		path: null,
		required: false,
		reason:
			'node-pty uses forkpty on Linux; binding.gyp builds spawn-helper only for macOS.',
	});
	await verifyManifestFiles(artifactRoot, manifest.files);

	const nodePath = join(artifactRoot, 'bin', 'node');
	const hostPath = join(artifactRoot, manifest.hostEntry);
	await access(nodePath);
	await access(hostPath);
	const { stdout: nodeVersion } = await execFileAsync(nodePath, ['--version']);
	assert.equal(nodeVersion.trim(), `v${PTY_RUNTIME_NODE_VERSION}`);

	const interactive = await exerciseInteractiveHost(nodePath, hostPath);
	const cleanup = await exerciseProcessTreeCleanup(nodePath, hostPath);
	const signal = await inspectSignalPropagation(nodePath, hostPath);

	process.stdout.write(
		`${JSON.stringify(
			{
				archive: archivePath,
				cleanup,
				interactive,
				signal,
				target,
			},
			null,
			2,
		)}\n`,
	);
} finally {
	await rm(tempDirectory, { force: true, recursive: true });
}

async function exerciseInteractiveHost(nodePath, hostPath) {
	const host = startHost(nodePath, hostPath);
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

		let outputIndex = host.messages.length;
		host.send({ type: 'write', data: 'printf \'CWD:%s\\n\' "$PWD"\r' });
		await host.waitForOutputLine('CWD:/tmp', outputIndex);

		outputIndex = host.messages.length;
		host.send({ type: 'write', data: "printf 'UTF8:✓-雪\\n'\r" });
		await host.waitForOutputLine('UTF8:✓-雪', outputIndex);

		outputIndex = host.messages.length;
		host.send({ type: 'resize', cols: 103, rows: 41 });
		host.send({ type: 'write', data: "stty size | sed 's/^/SIZE:/'\r" });
		await host.waitForOutputLine('SIZE:41 103', outputIndex);

		const foregroundIndex = host.messages.length;
		host.send({
			type: 'write',
			data: "sleep 2; printf 'FOREGROUND:DONE\\n'\r",
		});
		const foreground = await host.waitForMessage(
			({ message }) =>
				message.type === 'activity' &&
				message.activity?.status === 'working' &&
				message.activity?.source === 'generic:foreground',
			foregroundIndex,
			'foreground process activity',
		);
		await host.waitForOutputLine('FOREGROUND:DONE', foregroundIndex);

		const inactivityIndex = host.messages.length;
		const requestId = 'artifact-inactivity';
		host.send({
			type: 'waitForInactivity',
			requestId,
			durationMs: 180,
		});
		host.send({
			type: 'write',
			data: "printf 'QUIET:start\\n'; sleep 0.12; printf 'QUIET:end\\n'\r",
		});
		const lastOutput = await host.waitForOutputLine(
			'QUIET:end',
			inactivityIndex,
		);
		const inactive = await host.waitForMessage(
			({ message }) =>
				message.type === 'inactive' && message.requestId === requestId,
			inactivityIndex,
			'inactivity response',
		);
		assert.ok(inactive.receivedAt - lastOutput.receivedAt >= 140);

		const exitIndex = host.messages.length;
		host.send({ type: 'write', data: 'exit 9\r' });
		const terminalExit = await host.waitForMessage(
			({ message }) => message.type === 'exit',
			exitIndex,
			'terminal exit',
		);
		assert.equal(terminalExit.message.exitCode, 9);
		assert.equal(terminalExit.message.signal, null);
		assert.deepEqual(
			await withTimeout(host.exited, WAIT_TIMEOUT_MS, 'host exit'),
			{ code: 0, signal: null },
		);
		await waitForPidsToDisappear([ready.message.pid]);

		return {
			cwd: '/tmp',
			exitCode: terminalExit.message.exitCode,
			foregroundSource: foreground.message.activity.source,
			resize: { cols: 103, rows: 41 },
			utf8: true,
		};
	} finally {
		await host.stop();
	}
}

async function exerciseProcessTreeCleanup(nodePath, hostPath) {
	const host = startHost(nodePath, hostPath);
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
			'process-tree PTY ready',
		);
		const treeOutput = await host.waitForOutputMatch(
			/(?:^|\n)TREE:(\d+)(?:\n|$)/,
			0,
			'background child PID',
		);
		const childPid = Number.parseInt(treeOutput.match[1], 10);
		const startedAt = Date.now();
		host.send({ type: 'kill' });
		assert.deepEqual(
			await withTimeout(host.exited, 3_000, 'bounded host shutdown'),
			{ code: 0, signal: null },
		);
		await waitForPidsToDisappear([ready.message.pid, childPid]);
		return {
			childPidRemoved: true,
			rootPidRemoved: true,
			shutdownMs: Date.now() - startedAt,
		};
	} finally {
		await host.stop();
	}
}

async function inspectSignalPropagation(nodePath, hostPath) {
	const host = startHost(nodePath, hostPath);
	try {
		host.send({
			type: 'create',
			shellPath: '/bin/sh',
			args: ['-c', 'kill -TERM $$'],
			cwd: '/tmp',
			env: process.env,
		});
		const exit = await host.waitForMessage(
			({ message }) => message.type === 'exit',
			0,
			'signal-terminated PTY exit',
		);
		await withTimeout(host.exited, WAIT_TIMEOUT_MS, 'signal probe host exit');
		assert.equal(exit.message.exitCode, 0);
		assert.equal(exit.message.signal, 15);
		return {
			exitCode: exit.message.exitCode,
			signal: exit.message.signal,
			supported: true,
		};
	} finally {
		await host.stop();
	}
}

function startHost(nodePath, hostPath) {
	const child = fork(hostPath, {
		execArgv: [],
		execPath: nodePath,
		env: process.env,
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
				await withTimeout(exited, 1_000, 'probe cleanup');
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
							`Host exited before ${description}.\n${this.diagnostics()}`,
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
			let output = '';
			return waitFor(
				() => {
					const entries = messages
						.slice(afterIndex)
						.filter(({ message }) => message.type === 'data');
					output = entries
						.map(({ message }) => message.data)
						.join('')
						.replaceAll('\r', '');
					const match = output.match(pattern);
					if (match) {
						const finalEntry = entries.at(-1);
						return { ...finalEntry, match };
					}
					if (exitResult !== null) {
						throw new Error(
							`Host exited before ${description}.\n${this.diagnostics()}`,
						);
					}
					return null;
				},
				WAIT_TIMEOUT_MS,
				description,
				() => `${this.diagnostics()}\nOutput:\n${output}`,
			);
		},
	};
}

async function verifyManifestFiles(root, files) {
	const expectedPaths = new Set([
		'manifest.json',
		...files.map((file) => file.path),
	]);
	const actualPaths = new Set(await listFilePaths(root));
	assert.deepEqual(
		[...actualPaths].sort(),
		[...expectedPaths].sort(),
		'The archive contains files outside the manifest.',
	);

	for (const file of files) {
		const path = join(root, ...file.path.split('/'));
		const details = await stat(path);
		assert.equal(details.isFile(), true, `${file.path} is not a regular file.`);
		assert.equal(details.size, file.size, `${file.path} size does not match.`);
		assert.equal(
			(details.mode & 0o777).toString(8).padStart(3, '0'),
			file.mode,
			`${file.path} mode does not match.`,
		);
		assert.equal(
			await sha256File(path),
			file.sha256,
			`${file.path} SHA-256 does not match.`,
		);
	}
}

async function listFilePaths(root, directory = root) {
	const paths = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			paths.push(...(await listFilePaths(root, path)));
		} else if (entry.isFile()) {
			paths.push(
				path
					.slice(root.length + 1)
					.split('/')
					.join('/'),
			);
		}
	}
	return paths;
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

async function sha256File(path) {
	const hash = createHash('sha256');
	hash.update(await readFile(path));
	return hash.digest('hex');
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseArgs(values) {
	const parsed = {};
	for (let index = 0; index < values.length; index += 2) {
		const key = values[index];
		const value = values[index + 1];
		if (!key?.startsWith('--') || value === undefined) {
			throw new Error(
				`Expected --name value arguments, received ${values.join(' ')}.`,
			);
		}
		parsed[key.slice(2)] = value;
	}
	return parsed;
}

function requireArg(parsed, name) {
	const value = parsed[name];
	if (!value) {
		throw new Error(`Missing required --${name} argument.`);
	}
	return value;
}
