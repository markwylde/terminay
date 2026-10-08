import assert from 'node:assert/strict';
import test from 'node:test';
import {
	FOLDER_TERMINAL_CAPTURED_EVENT,
	FRONT_PANEL_GRACE_MS,
	parseFolderTerminalCapture,
	recordFrontPanel,
	wasLookingAt,
} from '../src/workspace/folderCapture.ts';

const capture = {
	projectId: 'project-a',
	folderId: 'folder-wt',
	panelId: 'p:1',
	fromFolderId: 'folder-general',
};

test('the event is the one the server appends', () => {
	assert.equal(FOLDER_TERMINAL_CAPTURED_EVENT, 'folder.terminal-captured');
});

test('a capture is read from exactly the four ids the server sends', () => {
	assert.deepEqual(parseFolderTerminalCapture(capture), capture);
	// Anything else the payload carries is not read.
	assert.deepEqual(
		parseFolderTerminalCapture({ ...capture, path: '/etc', revision: 9 }),
		capture,
	);
});

test('anything that is not a capture is ignored', () => {
	for (const payload of [
		null,
		undefined,
		'folder',
		[capture],
		{},
		{ ...capture, panelId: undefined },
		{ ...capture, folderId: '' },
		{ ...capture, projectId: 7 },
		{ ...capture, fromFolderId: 'x'.repeat(129) },
		// A move to the folder it was already in is no move.
		{ ...capture, fromFolderId: capture.folderId },
	])
		assert.equal(parseFolderTerminalCapture(payload), undefined);
});

test('the device with the terminal in front was looking at it', () => {
	const history = recordFrontPanel({}, { projectId: 'project-a', panelId: 'p:1' }, 100);
	assert.equal(wasLookingAt(history, capture, 200), true);
});

test('a device with another terminal, another project, or Home in front was not', () => {
	const another = recordFrontPanel({}, { projectId: 'project-a', panelId: 'p:2' }, 100);
	assert.equal(wasLookingAt(another, capture, 200), false);
	const elsewhere = recordFrontPanel({}, { projectId: 'project-b', panelId: 'p:1' }, 100);
	assert.equal(wasLookingAt(elsewhere, capture, 200), false);
	assert.equal(wasLookingAt(recordFrontPanel({}, undefined, 100), capture, 200), false);
});

test('a terminal that has just left the front, because it was moved, still counts', () => {
	let history = recordFrontPanel({}, { projectId: 'project-a', panelId: 'p:1' }, 100);
	// The move is on screen before the event that explains it: the folder now
	// shows another panel, or none.
	history = recordFrontPanel(history, { projectId: 'project-a', panelId: 'p:2' }, 1_000);
	assert.equal(wasLookingAt(history, capture, 1_000 + FRONT_PANEL_GRACE_MS), true);
	assert.equal(wasLookingAt(history, capture, 1_001 + FRONT_PANEL_GRACE_MS), false);
	let emptied = recordFrontPanel({}, { projectId: 'project-a', panelId: 'p:1' }, 100);
	emptied = recordFrontPanel(emptied, undefined, 1_000);
	assert.equal(wasLookingAt(emptied, capture, 1_500), true);
});

test('the same panel reported again does not restart the clock', () => {
	let history = recordFrontPanel({}, { projectId: 'project-a', panelId: 'p:1' }, 100);
	history = recordFrontPanel(history, { projectId: 'project-a', panelId: 'p:2' }, 1_000);
	const unchanged = recordFrontPanel(history, { projectId: 'project-a', panelId: 'p:2' }, 9_000);
	assert.equal(unchanged, history);
});
