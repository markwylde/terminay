import test from 'node:test';
import assert from 'node:assert/strict';
import headless from '@xterm/headless';
const { Terminal } = headless;
import { TerminalPresentationCheckpointAuthority } from '../dist/terminalService/presentationCheckpoint.js';
import {
	encodePresentationRecovery,
	decodePresentationRecovery,
	MAX_PRESENTATION_RECOVERY_BYTES,
} from '../dist/terminalService/presentationRecovery.js';
const identity = {
	serverId: 'server',
	projectId: 'project',
	sessionId: 'terminal',
};
const scope = { ...identity, clientId: 'client', attachmentId: 'attachment' };
const bytes = (text) => new TextEncoder().encode(text);
async function take(authority) {
	const pin = await authority.pin(scope);
	return authority.fetch({ ...scope, checkpointId: pin.checkpointId });
}
async function replay(snapshot) {
	const terminal = new Terminal({
		...snapshot.checkpointDimensions,
		allowProposedApi: true,
	});
	const decoder = new TextDecoder();
	const write = (data) =>
		new Promise((resolve) => terminal.write(data, resolve));
	await write(decoder.decode(snapshot.state));
	for (const event of snapshot.tail) {
		if (event.type === 'resize')
			terminal.resize(event.dimensions.cols, event.dimensions.rows);
		else await write(decoder.decode(event.bytes, { stream: true }));
	}
	return terminal;
}

test('a recovery seed preserves modes and a fragmented UTF-8/CSI tail with ordered resizes', async () => {
	const original = new TerminalPresentationCheckpointAuthority();
	const restored = new TerminalPresentationCheckpointAuthority();
	try {
		original.createSession(identity, { cols: 80, rows: 24 });
		let offset = 0;
		const output = async (text) => {
			const value = typeof text === 'string' ? bytes(text) : text;
			await original.ingestOutput(identity, offset, value);
			offset += value.byteLength;
		};
		await output(
			'\x1b[?1049h\x1b[?1003h\x1b[?1006h\x1b[?2004h\x1b[?1004hcurrent',
		);
		await take(original);
		await output(bytes('🙂').subarray(0, 2));
		await original.ingestResize(identity, { cols: 60, rows: 20 });
		const snapshot = await take(original);
		assert.ok(snapshot.position < snapshot.headPosition);
		const recovery = decodePresentationRecovery(
			encodePresentationRecovery(snapshot),
			identity.sessionId,
		);
		restored.restoreSession(identity, recovery);
		await restored.ingestOutput(identity, offset, bytes('🙂').subarray(2));
		offset += 2;
		await original.ingestOutput(identity, offset - 2, bytes('🙂').subarray(2));
		const result = await take(restored);
		const expected = await take(original);
		assert.equal(result.headPosition, offset);
		const view = await replay(result),
			control = await replay(expected);
		try {
			assert.equal(view.buffer.active.type, 'alternate');
			assert.equal(view.modes.mouseTrackingMode, 'any');
			assert.equal(view.modes.bracketedPasteMode, true);
			assert.equal(view.cols, 60);
			assert.equal(view.rows, 20);
			assert.equal(
				view.buffer.active.getLine(0).translateToString(true),
				control.buffer.active.getLine(0).translateToString(true),
			);
			assert.match(
				view.buffer.active.getLine(0).translateToString(true),
				/current🙂/u,
			);
		} finally {
			view.dispose();
			control.dispose();
		}
		await restored.ingestOutput(
			identity,
			offset,
			bytes('\x1b[?1003l\x1b[?1006l'),
		);
		const disabled = await replay(await take(restored));
		assert.equal(disabled.modes.mouseTrackingMode, 'none');
		disabled.dispose();
	} finally {
		original.close();
		restored.close();
	}
});

test('recovery refuses another session, malformed positions, lengths, formats, and oversized transfers', () => {
	const value = {
		sessionId: 'terminal',
		formatVersion: 1,
		position: 100,
		headPosition: 103,
		checkpointDimensions: { cols: 80, rows: 24 },
		dimensions: { cols: 80, rows: 24 },
		state: bytes('state'),
		tail: [
			{ type: 'output', position: 100, nextPosition: 103, bytes: bytes('abc') },
		],
	};
	const encoded = encodePresentationRecovery(value);
	assert.deepEqual(decodePresentationRecovery(encoded, 'terminal'), value);
	assert.throws(() => decodePresentationRecovery(encoded, 'another'));
	for (const length of [0, 3, encoded.length - 1])
		assert.throws(() =>
			decodePresentationRecovery(encoded.subarray(0, length), 'terminal'),
		);
	assert.throws(() =>
		decodePresentationRecovery(
			new Uint8Array(MAX_PRESENTATION_RECOVERY_BYTES + 1),
			'terminal',
		),
	);
	for (const change of [
		{ headPosition: 104 },
		{ formatVersion: 2 },
		{ dimensions: { cols: 0, rows: 24 } },
		{
			tail: [
				{
					type: 'output',
					position: 99,
					nextPosition: 102,
					bytes: bytes('abc'),
				},
			],
		},
	])
		assert.throws(() => encodePresentationRecovery({ ...value, ...change }));
	const trailing = new Uint8Array(encoded.length + 1);
	trailing.set(encoded);
	assert.throws(() => decodePresentationRecovery(trailing, 'terminal'));
});

test('recovery continues an unfinished mode reset instead of losing or rendering the CSI', async () => {
	const source = new TerminalPresentationCheckpointAuthority(),
		target = new TerminalPresentationCheckpointAuthority();
	try {
		source.createSession(identity, { cols: 80, rows: 24 });
		const enabled = bytes('\x1b[?1003h\x1b[?1006h');
		await source.ingestOutput(identity, 0, enabled);
		await take(source);
		const unfinished = bytes('\x1b[?100');
		await source.ingestOutput(identity, enabled.length, unfinished);
		const snapshot = await take(source);
		target.restoreSession(
			identity,
			decodePresentationRecovery(
				encodePresentationRecovery(snapshot),
				'terminal',
			),
		);
		const ending = bytes('3l');
		await target.ingestOutput(
			identity,
			enabled.length + unfinished.length,
			ending,
		);
		const view = await replay(await take(target));
		try {
			assert.equal(view.modes.mouseTrackingMode, 'none');
			assert.equal(view.buffer.active.getLine(0).translateToString(true), '');
		} finally {
			view.dispose();
		}
	} finally {
		source.close();
		target.close();
	}
});
