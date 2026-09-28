import assert from 'node:assert/strict';
import test from 'node:test';
import {
	commandSubmissionInput,
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
