import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A shell in a real PTY, in a disposable working directory. A conformance test
 * owns one of these for its whole run and must always end up in `close()`:
 * leaking it would leave a real agent CLI running on the machine, spending the
 * developer's tokens.
 *
 * @typedef {object} ConformancePty
 * @property {string} cwd
 * @property {number} shellPid
 * @property {() => string} output Everything the PTY has produced so far.
 * @property {() => string} plainOutput The same with escape sequences removed.
 * @property {(pattern: RegExp, timeoutMs?: number) => Promise<void>} waitForOutput Resolves once the plain output matches.
 * @property {(text: string) => void} write
 * @property {(line: string) => void} send Types a line and submits it.
 * @property {() => Array<{ pid: number; name: string }>} descendants Live processes below the shell.
 * @property {() => Promise<void>} close
 */

/** Loaded lazily so a machine without a built node-pty can still skip cleanly. */
async function loadPty() {
	return import('node-pty');
}

/**
 * Every live process below `root`, from the platform process table, with its
 * executable name.
 * @returns {Array<{ pid: number; name: string }>}
 */
export function processTreeBelow(root) {
	const listed = spawnSync('ps', ['-axo', 'pid=,ppid=,comm='], {
		encoding: 'utf8',
	});
	if (listed.status !== 0) return [];
	const children = new Map();
	const names = new Map();
	for (const line of listed.stdout.split('\n')) {
		const [pidText, parentText, ...command] = line.trim().split(/\s+/u);
		const pid = Number(pidText);
		const parent = Number(parentText);
		if (!Number.isInteger(pid) || !Number.isInteger(parent)) continue;
		children.set(parent, [...(children.get(parent) ?? []), pid]);
		const path = command.join(' ');
		names.set(pid, path.slice(path.lastIndexOf('/') + 1));
	}
	const found = [];
	const pending = [...(children.get(root) ?? [])];
	while (pending.length > 0) {
		const pid = pending.shift();
		if (found.some((entry) => entry.pid === pid)) continue;
		found.push({ pid, name: names.get(pid) ?? '' });
		pending.push(...(children.get(pid) ?? []));
	}
	return found;
}

/**
 * Terminal output with escape sequences removed, so a test can match the words
 * a user sees. A cursor-column move becomes a space because full-screen CLIs
 * position each word rather than emitting the spaces between them.
 */
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const OSC_SEQUENCE = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, 'gu');
const CURSOR_COLUMN = new RegExp(`${ESC}\\[[0-9;?]*G`, 'gu');
const CSI_SEQUENCE = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z@\`]`, 'gu');
const CHARSET_SEQUENCE = new RegExp(`${ESC}[()][A-Za-z0-9]`, 'gu');
const SINGLE_ESCAPE = new RegExp(`${ESC}[=>78]`, 'gu');
export function stripTerminalEscapes(text) {
	return text
		.replace(OSC_SEQUENCE, '')
		.replace(CURSOR_COLUMN, ' ')
		.replace(CSI_SEQUENCE, '')
		.replace(CHARSET_SEQUENCE, '')
		.replace(SINGLE_ESCAPE, '')
		.replace(/\r/gu, '');
}

function signalAll(pids, signal) {
	for (const pid of pids) {
		try {
			process.kill(pid, signal);
		} catch {
			// Already gone.
		}
	}
}

function alive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

const sleep = (ms) =>
	new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		timer.unref?.();
	});

/**
 * The environment a user's terminal would have. A conformance run started from
 * inside an agent session inherits that agent's own markers, and a CLI that
 * sees them changes behaviour: Claude Code, for one, stops writing its
 * transcript when it believes it is a child session.
 */
export function userTerminalEnvironment(environment) {
	return Object.fromEntries(
		Object.entries(environment).filter(
			([name]) => !/^(?:CLAUDECODE|CLAUDE_CODE_)/u.test(name),
		),
	);
}

/**
 * @param {{ environment?: Record<string, string>; shell?: string }} [options]
 * @returns {Promise<ConformancePty>}
 */
export async function openConformancePty(options = {}) {
	const pty = await loadPty();
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'terminay-conformance-')));
	let buffer = '';
	const listeners = new Set();
	const child = pty.spawn(options.shell ?? '/bin/bash', ['--norc', '--noprofile'], {
		name: 'xterm-256color',
		cols: 120,
		rows: 40,
		cwd,
		env: {
			...userTerminalEnvironment(process.env),
			...options.environment,
			TERM: 'xterm-256color',
		},
	});
	child.onData((data) => {
		buffer += data;
		for (const listener of [...listeners]) listener();
	});

	let closed = false;
	return {
		cwd,
		shellPid: child.pid,
		output: () => buffer,
		plainOutput: () => stripTerminalEscapes(buffer),
		write: (text) => child.write(text),
		// A full-screen CLI treats text and Enter arriving in one chunk as a
		// paste, and the Enter is folded into the pasted text instead of
		// submitting it. Type the line, let the CLI settle, then submit.
		send: (line) => {
			child.write(line);
			setTimeout(() => {
				if (!closed) child.write('\r');
			}, 400);
		},
		descendants: () => processTreeBelow(child.pid),
		waitForOutput(pattern, timeoutMs = 60_000) {
			if (pattern.test(stripTerminalEscapes(buffer))) return Promise.resolve();
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					listeners.delete(check);
					reject(
						new Error(
							`timed out waiting for ${pattern}. Last output:\n${stripTerminalEscapes(buffer).slice(-2_000)}`,
						),
					);
				}, timeoutMs);
				function check() {
					if (!pattern.test(stripTerminalEscapes(buffer))) return;
					clearTimeout(timer);
					listeners.delete(check);
					resolve();
				}
				listeners.add(check);
			});
		},
		async close() {
			if (closed) return;
			closed = true;
			listeners.clear();
			// The CLI and anything it spawned are children of the shell, and
			// killing the shell alone would orphan them. Terminate the whole tree,
			// politely first so a CLI can flush its journal, then by force.
			const tree = [
				child.pid,
				...processTreeBelow(child.pid).map((entry) => entry.pid),
			];
			signalAll(tree, 'SIGTERM');
			for (let waited = 0; waited < 3_000 && tree.some(alive); waited += 100)
				await sleep(100);
			signalAll(tree.filter(alive), 'SIGKILL');
			for (let waited = 0; waited < 3_000 && tree.some(alive); waited += 100)
				await sleep(100);
			try {
				child.kill();
			} catch {
				// Already gone; nothing further to terminate.
			}
			rmSync(cwd, { recursive: true, force: true });
		},
	};
}
