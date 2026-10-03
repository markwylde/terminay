import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	endedTerminalNotice,
	replayEndedTerminal,
} from './endedTerminalReplay.ts';

const bytesOf = (value: string) => new TextEncoder().encode(value);
const textOf = (value: Uint8Array | string) =>
	typeof value === 'string' ? value : new TextDecoder().decode(value);

function attachmentOf(events: readonly Record<string, unknown>[]) {
	let detached = 0;
	return {
		detachCount: () => detached,
		attachment: {
			initialEvents: events as never,
			detach: async () => {
				detached += 1;
			},
		},
	};
}

test('saved output is written in order and the exit is reported', async () => {
	const written: string[] = [];
	const { attachment, detachCount } = attachmentOf([
		{ type: 'output', bytes: bytesOf('first\r\n') },
		{ type: 'output', bytes: bytesOf('last\r\n') },
		{ type: 'exit', exitCode: 2, signal: null },
	]);
	const result = await replayEndedTerminal({
		attach: async () => attachment,
		write: (bytes) => written.push(textOf(bytes)),
		isCurrent: () => true,
	});
	assert.deepEqual(written, ['first\r\n', 'last\r\n']);
	assert.deepEqual(result, { available: true, exitCode: 2, signal: null });
	// The replay is everything the panel reads; it does not stay attached.
	assert.equal(detachCount(), 1);
});

test('output that is no longer kept is said so before what remains', async () => {
	const written: string[] = [];
	const { attachment } = attachmentOf([
		{ type: 'skip' },
		{ type: 'output', bytes: bytesOf('tail') },
	]);
	await replayEndedTerminal({
		attach: async () => attachment,
		write: (bytes) => written.push(textOf(bytes)),
		isCurrent: () => true,
	});
	assert.match(written[0], /Earlier output is no longer kept/);
	assert.equal(written[1], 'tail');
});

test('a session with nothing saved writes nothing and still gets its notice', async () => {
	const written: string[] = [];
	const result = await replayEndedTerminal({
		attach: async () => {
			throw new Error('terminal session has exited');
		},
		write: (bytes) => written.push(textOf(bytes)),
		isCurrent: () => true,
	});
	assert.deepEqual(written, []);
	assert.deepEqual(result, { available: false });
	assert.equal(
		endedTerminalNotice('interrupted', result),
		"This session has ended and can't be resumed.",
	);
});

test('a panel that has gone away is not written to', async () => {
	const written: string[] = [];
	const { attachment, detachCount } = attachmentOf([
		{ type: 'output', bytes: bytesOf('late') },
	]);
	const result = await replayEndedTerminal({
		attach: async () => attachment,
		write: (bytes) => written.push(textOf(bytes)),
		isCurrent: () => false,
	});
	assert.deepEqual(written, []);
	assert.equal(result.available, false);
	assert.equal(detachCount(), 1);
});

test('the notice says the session cannot be resumed and gives the exit when one is known', () => {
	const base = "This session has ended and can't be resumed.";
	assert.equal(endedTerminalNotice('exited'), base);
	assert.equal(
		endedTerminalNotice('exited', { exitCode: 0, signal: null }),
		`${base} It exited with code 0.`,
	);
	assert.equal(
		endedTerminalNotice('exited', { exitCode: 143, signal: 15 }),
		`${base} It was stopped by signal 15.`,
	);
	// An interrupted session never chose an exit code, so none is shown.
	assert.equal(
		endedTerminalNotice('interrupted', { exitCode: 130, signal: null }),
		base,
	);
});

test('the terminal panel shows the notice as an alert, replays read-only, and takes no input', async () => {
	const panel = await readFile(
		new URL('./TerminalPanel.tsx', import.meta.url),
		'utf8',
	);
	const branch = panel.slice(
		panel.indexOf('if (terminalSessionUnavailable) {'),
		panel.indexOf('} else if (useServerTerminal) {'),
	);
	assert.match(branch, /setServerTerminalError\(endedTerminalNotice\(endedStatus\)\)/);
	assert.match(branch, /terminal\.options\.disableStdin = true/);
	assert.match(branch, /readOnly: true/);
	assert.match(branch, /setTerminalSessionEnded\(true\)/);
	// The notice renders in the panel's error banner.
	assert.match(
		panel,
		/className="terminal-panel-connection-error" role="alert">\s*<p>\{serverTerminalError\}<\/p>/,
	);
});
