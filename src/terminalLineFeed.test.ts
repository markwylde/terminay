import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import {
	buildTerminalOptions,
	defaultTerminalSettings,
	normalizeTerminalSettings,
	terminalSettingsSections,
} from './terminalSettings.ts';

const require = createRequire(import.meta.url);
const { Terminal } =
	require('@xterm/headless') as typeof import('@xterm/headless');

const COLS = 40;
const ROWS = 8;

/** Write `data` into a headless xterm built from Terminay's options for
 * `settings`, and return the visible screen rows with trailing blanks trimmed. */
async function render(
	data: string,
	settings = defaultTerminalSettings,
): Promise<string[]> {
	const { convertEol } = buildTerminalOptions(settings);
	const terminal = new Terminal({
		cols: COLS,
		rows: ROWS,
		allowProposedApi: true,
		convertEol,
	});
	await new Promise<void>((resolve) => terminal.write(data, resolve));
	const buffer = terminal.buffer.active;
	const rows: string[] = [];
	for (let row = 0; row < ROWS; row += 1) {
		rows.push(
			buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? '',
		);
	}
	terminal.dispose();
	return rows;
}

const optedIn = normalizeTerminalSettings({
	...defaultTerminalSettings,
	convertEol: true,
});

// The shape of the Antigravity CLI's raw-mode header: half-block logo rows
// placed with CHA after a bare LF, and info text that relies on a bare LF
// keeping its column.
const RAW_MODE_HEADER = [
	'\x1b[H\x1b[2J',
	'\x1b[6G▄▀▀▄',
	'\n\x1b[5G▀▀▀▀▀▀',
	'\x1b[1;14HTitle 1.0',
	'\n\x1b[9Dsubtitle',
].join('');

test('Convert LF to CRLF is off by default', () => {
	assert.equal(defaultTerminalSettings.convertEol, false);
	assert.equal(normalizeTerminalSettings({}).convertEol, false);
	assert.equal(buildTerminalOptions(defaultTerminalSettings).convertEol, false);
	const field = terminalSettingsSections
		.flatMap((section) => section.fields)
		.find((candidate) => candidate.key === 'convertEol');
	assert.ok(field, 'the setting has no control');
	assert.equal(field.input, 'boolean');
});

test('a bare LF keeps the column by default', async () => {
	const screen = await render('abc\ndef');
	assert.equal(screen[0], 'abc');
	assert.equal(screen[1], '   def');
});

test('a raw-mode header renders in place by default', async () => {
	const screen = await render(RAW_MODE_HEADER);
	assert.equal(screen[0], '     ▄▀▀▄    Title 1.0');
	assert.equal(screen[1], '    ▀▀▀▀▀▀   subtitle');
});

test('a bare LF on the bottom row scrolls and keeps the column', async () => {
	const screen = await render(`\x1b[${ROWS};1Hbottom\nnext`);
	assert.equal(screen[ROWS - 2], 'bottom');
	assert.equal(screen[ROWS - 1], '      next');
});

test('cooked-mode CR LF output starts every line at column 0', async () => {
	const screen = await render('one\r\ntwo\r\n');
	assert.deepEqual(screen.slice(0, 2), ['one', 'two']);
});

test('an explicit opt-in returns to column 0 on every bare LF', async () => {
	assert.deepEqual((await render('abc\ndef', optedIn)).slice(0, 2), [
		'abc',
		'def',
	]);
	const screen = await render(RAW_MODE_HEADER, optedIn);
	assert.notEqual(screen[1], '    ▀▀▀▀▀▀   subtitle');
});
