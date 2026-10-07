import assert from 'node:assert/strict';
import test from 'node:test';
import {
	chooseWindowView,
	isOwnWindowView,
	workspaceWindowTitle,
} from '../electron/windowWorkspaceView.ts';

test('the first window on a server presents its default view', () => {
	assert.deepEqual(chooseWindowView({ othersOnServer: [] }), { ownView: false });
});

test('a further window on a server presents a view of its own', () => {
	assert.deepEqual(chooseWindowView({ othersOnServer: ['default'] }), {
		viewId: 'view-window-2',
		ownView: true,
	});
	// A third window does not share the second's.
	assert.deepEqual(
		chooseWindowView({ othersOnServer: ['default', 'view-window-2'] }),
		{ viewId: 'view-window-3', ownView: true },
	);
	// The lowest free view is reused, so a closed window's projects come back.
	assert.deepEqual(
		chooseWindowView({ othersOnServer: ['default', 'view-window-3'] }),
		{ viewId: 'view-window-2', ownView: true },
	);
});

test('the default view is taken again once no window is presenting it', () => {
	assert.deepEqual(chooseWindowView({ othersOnServer: ['view-window-2'] }), {
		ownView: false,
	});
	// A torn-off window is presenting its own view, not the default one.
	assert.deepEqual(chooseWindowView({ othersOnServer: ['view-abc'] }), {
		ownView: false,
	});
});

test('a torn-off window presents the view it was created for', () => {
	assert.deepEqual(
		chooseWindowView({ tornOffViewId: 'view-abc', othersOnServer: ['default'] }),
		{ viewId: 'view-abc', ownView: false },
	);
});

test('own views are recognisable', () => {
	assert.equal(isOwnWindowView('view-window-2'), true);
	assert.equal(isOwnWindowView('view-window-0'), false);
	assert.equal(isOwnWindowView('view-3b1f'), false);
});

test('a window is titled by its server, then what it holds', () => {
	assert.equal(workspaceWindowTitle('Local', 'Terminay, ddd'), 'Local - Terminay, ddd');
	assert.equal(workspaceWindowTitle('Remote 1', ''), 'Remote 1');
	assert.equal(workspaceWindowTitle('Remote 1', '   '), 'Remote 1');
	// The page's own file name is not a description of the window.
	assert.equal(workspaceWindowTitle('Local', 'server.html'), 'Local');
	assert.equal(workspaceWindowTitle('Local', 'Home'), 'Local - Home');
	// The page cannot put anything before the server's name, break the title
	// across lines, or make it unbounded.
	assert.equal(workspaceWindowTitle('Local', 'a\nb\u0000c\t d'), 'Local - a b c d');
	const long = workspaceWindowTitle('Local', 'x'.repeat(500));
	assert.equal(long.length, 'Local - '.length + 160);
	assert.ok(long.startsWith('Local - '));
});
