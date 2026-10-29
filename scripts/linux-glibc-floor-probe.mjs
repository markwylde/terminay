// Runs inside the clean floor host (Dockerfile.linux-floor-runtime) under an
// artifact's own runtime: Electron in Node mode for the AppImage, `bin/node`
// for a server archive. It proves the two things a user's first terminal
// needs: the packaged session holder starts and reports ready, exactly as the
// server launches it, and the packaged node-pty runs a shell in a PTY.
//
//   <runtime> linux-glibc-floor-probe.mjs <sessionHolderEntry.js>
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// SESSION_HOLDER_ENV in packages/server-core/src/sessionHolder/process.ts.
const HOLDER_ENV = {
	dataRoot: 'TERMINAY_SESSION_HOLDER_DATA_ROOT',
	generation: 'TERMINAY_SESSION_HOLDER_GENERATION',
	buildId: 'TERMINAY_SESSION_HOLDER_BUILD_ID',
	limitMs: 'TERMINAY_SESSION_HOLDER_LIMIT_MS',
	readyFd: 'TERMINAY_SESSION_HOLDER_READY_FD',
};
const LIMIT_MS = 20_000;

function within(promise, what) {
	let timer;
	return Promise.race([
		promise,
		new Promise((_, reject) => {
			timer = setTimeout(
				() => reject(new Error(`${what} did not finish within ${LIMIT_MS} ms`)),
				LIMIT_MS,
			);
		}),
	]).finally(() => clearTimeout(timer));
}

async function shellThroughNodePty(entry) {
	// Resolved from the holder entry, so it is the copy the holder loads.
	const nodePty = createRequire(entry)('node-pty');
	const terminal = nodePty.spawn(
		'/bin/sh',
		['-c', 'printf "terminay-floor-%s\\n" ok; exit 7'],
		{
			name: 'xterm-256color',
			cols: 80,
			rows: 24,
			cwd: tmpdir(),
			env: { PATH: '/usr/bin:/bin', HOME: tmpdir() },
		},
	);
	let output = '';
	terminal.onData((data) => {
		output += data;
	});
	const exit = await within(
		new Promise((resolve) => terminal.onExit(resolve)),
		'the PTY shell',
	);
	if (!output.includes('terminay-floor-ok') || exit.exitCode !== 7)
		throw new Error(
			`the PTY shell produced ${JSON.stringify(output)} and exit ${JSON.stringify(exit)}`,
		);
	process.stdout.write('node-pty ran a shell in a PTY\n');
}

async function holderReady(entry) {
	const dataRoot = mkdtempSync(join(tmpdir(), 'terminay-floor-holder-'));
	const generation = randomBytes(8).toString('hex');
	const holder = spawn(process.execPath, [entry], {
		stdio: ['ignore', 'ignore', 'pipe', 'pipe'],
		env: {
			...process.env,
			ELECTRON_RUN_AS_NODE: '1',
			[HOLDER_ENV.dataRoot]: dataRoot,
			[HOLDER_ENV.generation]: generation,
			[HOLDER_ENV.buildId]: 'glibc-floor-probe',
			[HOLDER_ENV.limitMs]: String(LIMIT_MS),
			[HOLDER_ENV.readyFd]: '3',
		},
	});
	let stderr = '';
	let reason = '';
	holder.stderr.on('data', (data) => {
		stderr += data;
	});
	holder.stdio[3].on('data', (data) => {
		reason += data;
	});
	const exited = new Promise((resolve) =>
		holder.once('exit', (code, signal) => resolve({ code, signal })),
	);
	// The holder closes the descriptor once its record is in place; a holder
	// that dies closes it too.
	await within(
		new Promise((resolve) => holder.stdio[3].once('close', resolve)),
		'the session holder',
	);
	const record = join(dataRoot, 'session-holder', `${generation}.json`);
	if (!existsSync(record)) {
		const exit = await within(exited, 'the failed session holder');
		throw new Error(
			`the session holder exited before it was ready (${JSON.stringify(exit)}): ${reason.trim() || stderr.trim() || 'no reason given'}`,
		);
	}
	holder.kill('SIGTERM');
	const exit = await within(exited, 'the session holder shutdown');
	process.stdout.write(
		`session holder became ready and closed on SIGTERM (${JSON.stringify(exit)})\n`,
	);
}

const entry = process.argv[2];
if (!entry) {
	process.stderr.write('Usage: <runtime> linux-glibc-floor-probe.mjs <sessionHolderEntry.js>\n');
	process.exit(64);
}
try {
	// The holder first: when node-pty cannot load, its report names the
	// loader's real error rather than the last place node-pty searched.
	await holderReady(entry);
	await shellThroughNodePty(entry);
} catch (error) {
	process.stderr.write(`glibc floor probe failed: ${error instanceof Error ? error.message : error}\n`);
	process.exit(1);
}
