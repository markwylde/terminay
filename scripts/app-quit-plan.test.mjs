import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	appQuitChoice,
	createAppQuitConfirmationDialog,
	describeBackgroundLimit,
	planAppQuit,
} from '../electron/appQuitPlan.ts';

const FIVE_MINUTES = 5 * 60_000;

test('with held terminals an idle quit keeps them without asking', () => {
	assert.equal(
		planAppQuit({ keepsTerminals: true, restartToUpdate: false, runningTerminalCount: 0 }),
		'quit-keeping-terminals',
	);
});

test('with held terminals a quit over running work asks whether to keep or end', () => {
	assert.equal(
		planAppQuit({ keepsTerminals: true, restartToUpdate: false, runningTerminalCount: 2 }),
		'ask-keep-or-end',
	);
});

test('Restart to update never asks, however much is running', () => {
	for (const runningTerminalCount of [0, 1, 12])
		assert.equal(
			planAppQuit({ keepsTerminals: true, restartToUpdate: true, runningTerminalCount }),
			'quit-keeping-terminals',
		);
});

test('without held terminals quitting still warns before it ends running work', () => {
	assert.equal(
		planAppQuit({ keepsTerminals: false, restartToUpdate: false, runningTerminalCount: 0 }),
		'quit',
	);
	assert.equal(
		planAppQuit({ keepsTerminals: false, restartToUpdate: false, runningTerminalCount: 1 }),
		'ask-before-ending',
	);
	// An update restart that would end terminals is not exempt.
	assert.equal(
		planAppQuit({ keepsTerminals: false, restartToUpdate: true, runningTerminalCount: 1 }),
		'ask-before-ending',
	);
});

test('the dialog offers keep, end, and cancel, with keep as the default', () => {
	const options = createAppQuitConfirmationDialog(3, FIVE_MINUTES, 'darwin');
	assert.deepEqual(options.buttons, [
		'Quit and Keep Terminals',
		'Quit and End Terminals',
		'Cancel',
	]);
	assert.equal(options.buttons[options.defaultId], 'Quit and Keep Terminals');
	assert.equal(options.buttons[options.cancelId], 'Cancel');
	assert.equal(options.message, '3 terminals have a process running');
	assert.match(options.detail, /for up to 5 minutes/);
	assert.equal(
		createAppQuitConfirmationDialog(1, FIVE_MINUTES, 'darwin').message,
		'1 terminal has a process running',
	);
});

test('each button maps to its choice and a dismissed dialog is Cancel', () => {
	const options = createAppQuitConfirmationDialog(1, FIVE_MINUTES);
	assert.equal(appQuitChoice(options.buttons.indexOf('Quit and Keep Terminals')), 'keep');
	assert.equal(appQuitChoice(options.buttons.indexOf('Quit and End Terminals')), 'end');
	assert.equal(appQuitChoice(options.buttons.indexOf('Cancel')), 'cancel');
	// Electron reports cancelId when a dialog is dismissed.
	assert.equal(appQuitChoice(options.cancelId), 'cancel');
	assert.equal(appQuitChoice(-1), 'cancel');
	assert.equal(appQuitChoice(99), 'cancel');
});

test('the dialog names the configured limit', () => {
	assert.equal(describeBackgroundLimit(60_000), 'for up to 1 minute');
	assert.equal(describeBackgroundLimit(FIVE_MINUTES), 'for up to 5 minutes');
	assert.equal(describeBackgroundLimit(30 * 60_000), 'for up to 30 minutes');
	assert.equal(describeBackgroundLimit(2 * 60 * 60_000), 'for up to 2 hours');
	assert.equal(describeBackgroundLimit(null, 'darwin'), 'until this Mac restarts');
	assert.equal(describeBackgroundLimit(null, 'linux'), 'until this computer restarts');
	assert.match(
		createAppQuitConfirmationDialog(1, null, 'linux').detail,
		/until this computer restarts/,
	);
});

/**
 * `before-quit` cannot be driven without Electron, so the wiring is pinned
 * here: the plan decides, End runs before shutdown, and a kept quit never
 * signals a terminal.
 */
test('before-quit follows the plan and only End ends terminals', async () => {
	const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
	const handler = main.slice(main.indexOf("app.on('before-quit'"));
	assert.match(handler, /planAppQuit\(\{/);
	assert.match(handler, /restartToUpdate: appUpdater\?\.isRestartToUpdateRequested\(\) === true/);
	assert.match(handler, /endTerminalsOnQuit = choice === 'end'/);
	assert.match(handler, /if \(choice === 'cancel'\) \{\s*appUpdater\?\.cancelRestartToUpdate\(\);\s*return;/);

	const shutdown = main.slice(main.indexOf('const handleBeforeQuit = createGracefulQuitHandler'));
	const end = shutdown.indexOf('if (endTerminalsOnQuit)');
	const stop = shutdown.indexOf('serverTerminalAuthority?.shutdown()');
	assert.ok(end > 0 && end < stop, 'terminals must be ended before the server shuts down');
	assert.match(
		shutdown.slice(end, stop),
		/await serverTerminalAuthority\?\.endAllTerminalSessions\(\)/,
	);
});
