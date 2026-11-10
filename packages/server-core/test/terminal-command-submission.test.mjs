import assert from 'node:assert/strict';
import test from 'node:test';
import {
	commandPasteInput,
	commandSubmissionInput,
	SUBMIT_INPUT,
	TERMINAL_KEYS,
	terminalInputKey,
	writeSeparatedInput,
	TerminalPresentationCheckpointAuthority,
	TerminalService,
} from '../dist/index.js';

function createPtyFactory() {
	const processes = [];
	return {
		processes,
		spawn(options) {
			const dataListeners = new Set();
			const process = {
				pid: 7000 + processes.length,
				options,
				write() {},
				resize() {},
				kill() {},
				onData(listener) {
					dataListeners.add(listener);
					return () => dataListeners.delete(listener);
				},
				onExit() {
					return () => {};
				},
				emitData(value) {
					const bytes = new TextEncoder().encode(value);
					for (const listener of dataListeners) listener(bytes);
				},
			};
			processes.push(process);
			return process;
		},
	};
}

test('command submission adds bracketed-paste markers only when enabled', () => {
	assert.equal(
		commandSubmissionInput('X=1 env', true),
		'\u001b[200~X=1 env\u001b[201~\r',
	);
	assert.equal(commandSubmissionInput('X=1 env', false), 'X=1 env\r');
	assert.equal(
		commandSubmissionInput('one\ntwo\r\nthree', false),
		'one\rtwo\rthree\r',
	);
	assert.equal(
		commandSubmissionInput('one\ntwo', true),
		'\u001b[200~one\ntwo\u001b[201~\r',
	);
});

test("terminal service reports the program's bracketed paste mode", async () => {
	const pty = createPtyFactory();
	const service = new TerminalService({
		serverId: 'server-paste',
		ptyFactory: pty,
		presentationCheckpoints: new TerminalPresentationCheckpointAuthority(),
	});
	await service.createSession({
		projectId: 'project-paste',
		sessionId: 'session-paste',
		cols: 80,
		rows: 24,
	});
	const [process] = pty.processes;

	assert.equal(await service.bracketedPasteMode('session-paste'), false);
	process.emitData('\u001b[?2004h$ ');
	assert.equal(await service.bracketedPasteMode('session-paste'), true);
	process.emitData('\u001b[?2004l');
	assert.equal(await service.bracketedPasteMode('session-paste'), false);
	await service.stop?.();
});

test('terminal service reports bracketed paste off without a presentation emulator', async () => {
	const pty = createPtyFactory();
	const service = new TerminalService({
		serverId: 'server-plain',
		ptyFactory: pty,
	});
	await service.createSession({
		projectId: 'project-plain',
		sessionId: 'session-plain',
		cols: 80,
		rows: 24,
	});
	pty.processes[0].emitData('\u001b[?2004h');
	assert.equal(await service.bracketedPasteMode('session-plain'), false);
	await service.stop?.();
});

test('a paste and the keys after it are separate writes, with a pause before each key', async () => {
	assert.equal(commandPasteInput('a\nb', false), 'a\rb');
	assert.equal(commandPasteInput('a\nb', true), '\u001b[200~a\nb\u001b[201~');
	const writes = [];
	const pauses = [];
	const bytes = await writeSeparatedInput(
		{ body: 'hello', keys: [TERMINAL_KEYS.Backspace, SUBMIT_INPUT] },
		async (data) => {
			writes.push(data);
		},
		{
			sleep: async (ms) => {
				pauses.push([ms, writes.length]);
			},
		},
	);
	assert.deepEqual(writes, ['hello', '\u007f', '\r']);
	assert.equal(bytes, 7);
	// Each key waits for its own pause after what came before it.
	assert.equal(pauses.length, 2);
	assert.deepEqual(
		pauses.map(([, written]) => written),
		[1, 2],
	);
	assert.ok(pauses.every(([ms]) => ms > 0));
});

test('with no text, Enter is written at once', async () => {
	const writes = [];
	let paused = false;
	await writeSeparatedInput(
		{ body: '', keys: [SUBMIT_INPUT] },
		async (data) => {
			writes.push(data);
		},
		{
			sleep: async () => {
				paused = true;
			},
		},
	);
	assert.deepEqual(writes, ['\r']);
	assert.equal(paused, false);
});

test('two submissions to one terminal do not interleave', async () => {
	const writes = [];
	const key = terminalInputKey('server-a', 'session-1');
	const write = async (data) => {
		writes.push(data);
	};
	const sleep = () => new Promise((resolve) => setImmediate(resolve));
	await Promise.all([
		writeSeparatedInput({ body: 'A', keys: [SUBMIT_INPUT] }, write, { terminal: key, sleep }),
		writeSeparatedInput({ body: 'B', keys: [SUBMIT_INPUT] }, write, { terminal: key, sleep }),
	]);
	assert.deepEqual(writes, ['A', '\r', 'B', '\r']);
});

test('a cancelled submission writes nothing after the pause', async () => {
	const writes = [];
	const controller = new AbortController();
	await assert.rejects(
		writeSeparatedInput(
			{ body: 'text', keys: [SUBMIT_INPUT] },
			async (data) => {
				writes.push(data);
			},
			{
				signal: controller.signal,
				sleep: async () => {
					controller.abort();
				},
			},
		),
		{ name: 'AbortError' },
	);
	assert.deepEqual(writes, ['text']);
});

test('a failed write stops the submission and releases the terminal', async () => {
	const key = terminalInputKey('server-a', 'session-2');
	const writes = [];
	const sleep = async () => {};
	await assert.rejects(
		writeSeparatedInput(
			{ body: 'text', keys: [TERMINAL_KEYS.Backspace, SUBMIT_INPUT] },
			async (data) => {
				if (data === TERMINAL_KEYS.Backspace) throw new Error('terminal exited');
				writes.push(data);
			},
			{ terminal: key, sleep },
		),
		/terminal exited/,
	);
	assert.deepEqual(writes, ['text']);
	// The next submission is not blocked by the failed one.
	await writeSeparatedInput(
		{ body: 'next', keys: [] },
		async (data) => {
			writes.push(data);
		},
		{ terminal: key, sleep },
	);
	assert.deepEqual(writes, ['text', 'next']);
});
