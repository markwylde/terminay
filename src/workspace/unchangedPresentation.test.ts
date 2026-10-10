import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	changedTerminalAppearance,
	keepIfUnchanged,
	keepListIfUnchanged,
} from './unchangedPresentation.ts';

test('a project tab that says the same thing is the tab already presented', () => {
	const existing = {
		id: 'project-a',
		title: 'A',
		rootFolder: '/a',
		expandedAgentEntryIds: ['one'],
	};
	// Built again from an unchanged projection: equal, and a different object.
	const rebuilt = { ...existing, expandedAgentEntryIds: ['one'] };
	assert.equal(keepIfUnchanged(existing, rebuilt), existing);
	const renamed = { ...rebuilt, title: 'B' };
	assert.equal(keepIfUnchanged(existing, renamed), renamed);
	const reordered = { ...rebuilt, expandedAgentEntryIds: ['one', 'two'] };
	assert.equal(keepIfUnchanged(existing, reordered), reordered);
	assert.equal(keepIfUnchanged(undefined, rebuilt), rebuilt);
});

test('a project list whose members are the same objects is the list already presented', () => {
	const a = { id: 'a' };
	const b = { id: 'b' };
	const current = [a, b];
	assert.equal(keepListIfUnchanged(current, [a, b]), current);
	const changed = [a, { id: 'b' }];
	assert.equal(keepListIfUnchanged(current, changed), changed);
	const reordered = [b, a];
	assert.equal(keepListIfUnchanged(current, reordered), reordered);
	const shorter = [a];
	assert.equal(keepListIfUnchanged(current, shorter), shorter);
	const none: unknown[] = [];
	assert.equal(keepListIfUnchanged(none, []), none);
});

test('a terminal that already looks as the workspace says is handed nothing', () => {
	const held = {
		emoji: '🧪',
		color: '#fff',
		inheritsProjectColor: false,
		activityIndicatorsEnabled: true,
		sessionId: 'session-a',
	};
	assert.deepEqual(changedTerminalAppearance(held, { ...held }), {});
	// What the workspace does not define is not written, and nor is anything
	// that is not appearance.
	assert.deepEqual(changedTerminalAppearance(held, { emoji: '🧪' }), {});
	assert.deepEqual(
		changedTerminalAppearance(held, { sessionId: 'other' } as never),
		{},
	);
});

test('a terminal is handed only the appearance that differs', () => {
	const held = { emoji: '🧪', color: '#fff', inheritsProjectColor: false };
	assert.deepEqual(
		changedTerminalAppearance(held, {
			emoji: '🧪',
			color: '#000',
			inheritsProjectColor: false,
			activityIndicatorsEnabled: false,
		}),
		{ color: '#000', activityIndicatorsEnabled: false },
	);
	assert.deepEqual(changedTerminalAppearance(undefined, { emoji: 'x' }), {
		emoji: 'x',
	});
});

test('the workspace uses these, and a title is no longer a reason to render or to ask for a directory', async () => {
	const app = await readFile('src/App.tsx', 'utf8');
	const collection = await readFile(
		'src/workspace/useProjectCollection.ts',
		'utf8',
	);
	const statusBar = await readFile(
		'src/workspace/WorkspaceStatusBar.tsx',
		'utf8',
	);
	assert.match(app, /changedTerminalAppearance\(panel\.params, canonical\)/u);
	assert.match(collection, /keepIfUnchanged\(existing, presented\)/u);
	assert.match(collection, /keepListIfUnchanged\(current, ordered\)/u);
	// A title bump used to render the whole project workspace and send a
	// working-directory query. Neither state nor dependency exists now.
	for (const source of [app, statusBar])
		assert.doesNotMatch(source, /titleRevision|TitleRevision/u);
	// The project workspace is memoised and reads its own part of the
	// projection, so another project's change does not render it.
	assert.match(app, /const ProjectWorkspace = memo\(forwardRef</u);
	assert.match(app, /useWorkspaceProjectSlice\(/u);
	assert.doesNotMatch(app, /collapsedFolderIds=\{new Set\(/u);
});
