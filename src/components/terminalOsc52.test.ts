import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createTerminalOsc52Handler,
	parseTerminalOsc52,
	TERMINAL_OSC52_MAX_TEXT_BYTES,
} from './terminalOsc52.ts';

const encode = (text: string) => Buffer.from(text, 'utf8').toString('base64');

test('a clipboard write decodes UTF-8 text', () => {
	assert.deepEqual(parseTerminalOsc52(`c;${encode('hello wörld ✓')}`), {
		kind: 'write',
		text: 'hello wörld ✓',
	});
});

test('every target writes the one system clipboard, including an empty list', () => {
	for (const targets of ['', 'c', 'p', 's', 'pc', '0', 'cs7']) {
		assert.deepEqual(parseTerminalOsc52(`${targets};${encode('x')}`), {
			kind: 'write',
			text: 'x',
		});
	}
});

test('unpadded base64 is accepted', () => {
	const padded = encode('ab');
	assert.equal(padded.endsWith('='), true);
	assert.deepEqual(parseTerminalOsc52(`c;${padded.replace(/=+$/, '')}`), {
		kind: 'write',
		text: 'ab',
	});
});

test('tabs and line breaks survive', () => {
	const text = 'line one\n\tline two\r\n';
	assert.deepEqual(parseTerminalOsc52(`c;${encode(text)}`), {
		kind: 'write',
		text,
	});
});

test('a clipboard query is never answered', () => {
	assert.deepEqual(parseTerminalOsc52('c;?'), {
		kind: 'ignore',
		reason: 'query',
	});
});

test('an empty payload does not clear the clipboard', () => {
	assert.deepEqual(parseTerminalOsc52('c;'), {
		kind: 'ignore',
		reason: 'empty',
	});
});

test('malformed sequences are ignored', () => {
	for (const data of [
		'no-separator',
		'x;aGk=',
		'c;not base64!',
		'c;aGk=aGk=',
		'c;a',
		`c;${Buffer.from([0xff, 0xfe]).toString('base64')}`,
	]) {
		assert.equal(parseTerminalOsc52(data).kind, 'ignore', data);
	}
});

test('text carrying terminal control sequences is refused', () => {
	assert.deepEqual(parseTerminalOsc52(`c;${encode('rm -rf ~\x1b[201~\r')}`), {
		kind: 'ignore',
		reason: 'unsafe',
	});
	assert.deepEqual(parseTerminalOsc52(`c;${encode('a\x7f')}`), {
		kind: 'ignore',
		reason: 'unsafe',
	});
});

test('text over the clipboard bound is refused', () => {
	const atLimit = 'a'.repeat(TERMINAL_OSC52_MAX_TEXT_BYTES);
	assert.equal(parseTerminalOsc52(`c;${encode(atLimit)}`).kind, 'write');
	assert.deepEqual(parseTerminalOsc52(`c;${encode(`${atLimit}a`)}`), {
		kind: 'ignore',
		reason: 'too-large',
	});
});

function harness(options: { enabled?: boolean; live?: boolean } = {}) {
	const writes: string[] = [];
	const handler = createTerminalOsc52Handler({
		isEnabled: () => options.enabled ?? true,
		isLiveOutput: () => options.live ?? true,
		writeClipboardText: (text) => {
			writes.push(text);
		},
	});
	return { handler, writes };
}

test('live output writes the clipboard and the sequence is consumed', () => {
	const { handler, writes } = harness();
	assert.equal(handler(`c;${encode('copied')}`), true);
	assert.deepEqual(writes, ['copied']);
});

test('replayed output never writes the clipboard', () => {
	const { handler, writes } = harness({ live: false });
	assert.equal(handler(`c;${encode('old copy')}`), true);
	assert.deepEqual(writes, []);
});

test('the setting turns clipboard writes off', () => {
	const { handler, writes } = harness({ enabled: false });
	assert.equal(handler(`c;${encode('copied')}`), true);
	assert.deepEqual(writes, []);
});

test('a query or malformed sequence is consumed without a write', () => {
	const { handler, writes } = harness();
	assert.equal(handler('c;?'), true);
	assert.equal(handler('c;!!'), true);
	assert.deepEqual(writes, []);
});

test('a refused clipboard write does not throw into the terminal parser', async () => {
	const rejecting = createTerminalOsc52Handler({
		isEnabled: () => true,
		isLiveOutput: () => true,
		writeClipboardText: () => Promise.reject(new Error('denied')),
	});
	assert.equal(rejecting(`c;${encode('x')}`), true);
	const throwing = createTerminalOsc52Handler({
		isEnabled: () => true,
		isLiveOutput: () => true,
		writeClipboardText: () => {
			throw new Error('denied');
		},
	});
	assert.equal(throwing(`c;${encode('x')}`), true);
	await new Promise((resolve) => setImmediate(resolve));
});
