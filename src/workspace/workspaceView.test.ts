import assert from 'node:assert/strict';
import test from 'node:test';
import {
	arrangementShape,
	pathInsideRoot,
	viewTreeFromSerialized,
} from './workspaceView.ts';

const facts = (id: string) =>
	id.startsWith('p:')
		? { tab: id, sessionId: id.slice(2), kind: 'terminal' as const, title: `T ${id}` }
		: id === 'gone'
			? undefined
			: { tab: id, kind: 'file' as const, title: id };

const leaf = (id: string, views: string[], activeView = views[0], size?: number) => ({
	type: 'leaf' as const,
	data: { id, views, activeView },
	...(size === undefined ? {} : { size }),
});

const grid = (root: unknown, orientation: 'HORIZONTAL' | 'VERTICAL') =>
	({ grid: { root, orientation, width: 1000, height: 800 } }) as never;

test('a single pane of tabs is one pane, with its active tab', () => {
	const tree = viewTreeFromSerialized(
		grid({ type: 'branch', data: [leaf('1', ['p:a', 'readme'], 'readme', 1000)] }, 'HORIZONTAL'),
		facts,
	);
	assert.deepEqual(tree, {
		pane: '1',
		tabs: [
			{ tab: 'p:a', sessionId: 'a', kind: 'terminal', title: 'T p:a', active: false },
			{ tab: 'readme', kind: 'file', title: 'readme', active: true },
		],
	});
});

test('a 2x2 grid is a row of two columns, each two panes, with sizes as shares', () => {
	const tree = viewTreeFromSerialized(
		grid(
			{
				type: 'branch',
				data: [
					{ type: 'branch', size: 500, data: [leaf('1', ['p:a'], 'p:a', 400), leaf('3', ['p:c'], 'p:c', 400)] },
					{ type: 'branch', size: 500, data: [leaf('2', ['p:b'], 'p:b', 400), leaf('4', ['p:d'], 'p:d', 400)] },
				],
			},
			'HORIZONTAL',
		),
		facts,
	);
	assert.equal(tree && 'split' in tree ? tree.split : undefined, 'row');
	const columns = tree && 'split' in tree ? tree.children : [];
	assert.equal(columns.length, 2);
	for (const column of columns) {
		assert.equal(column.size, 0.5);
		assert.ok('split' in column && column.split === 'column');
		assert.deepEqual(
			'split' in column ? column.children.map((child) => child.size) : [],
			[0.5, 0.5],
		);
	}
	const panes = columns.flatMap((column) => ('split' in column ? column.children : []));
	assert.deepEqual(
		panes.map((pane) => ('tabs' in pane ? pane.tabs.map((tab) => tab.sessionId) : [])),
		[['a'], ['c'], ['b'], ['d']],
	);
});

test('a vertical root stacks its children as a column', () => {
	const tree = viewTreeFromSerialized(
		grid({ type: 'branch', data: [leaf('1', ['p:a'], 'p:a', 300), leaf('2', ['p:b'], 'p:b', 100)] }, 'VERTICAL'),
		facts,
	);
	assert.ok(tree && 'split' in tree);
	assert.equal(tree.split, 'column');
	assert.deepEqual(tree.children.map((child) => child.size), [0.75, 0.25]);
});

test('a tab the device no longer knows is left out', () => {
	const tree = viewTreeFromSerialized(
		grid({ type: 'branch', data: [leaf('1', ['p:a', 'gone'], 'p:a', 1)] }, 'HORIZONTAL'),
		facts,
	);
	assert.ok(tree && 'tabs' in tree);
	assert.deepEqual(tree.tabs.map((tab) => tab.tab), ['p:a']);
});

test('arrangement shapes', () => {
	assert.deepEqual(arrangementShape('grid', 4), { columns: 2, rows: 2 });
	assert.deepEqual(arrangementShape('grid', 3), { columns: 2, rows: 2 });
	assert.deepEqual(arrangementShape('grid', 5), { columns: 3, rows: 2 });
	assert.deepEqual(arrangementShape('grid', 9), { columns: 3, rows: 3 });
	assert.deepEqual(arrangementShape('columns', 3), { columns: 3, rows: 1 });
	assert.deepEqual(arrangementShape('rows', 3), { columns: 1, rows: 3 });
	assert.deepEqual(arrangementShape('tabs', 3), { columns: 1, rows: 1 });
});

test('paths are resolved inside the folder root and never outside it', () => {
	assert.equal(pathInsideRoot('/home/me/proj', 'src/app.ts'), '/home/me/proj/src/app.ts');
	assert.equal(pathInsideRoot('/home/me/proj', './a/../b.md'), '/home/me/proj/b.md');
	assert.equal(pathInsideRoot('/home/me/proj', '/home/me/proj/README.md'), '/home/me/proj/README.md');
	assert.equal(pathInsideRoot('/home/me/proj', '../secret'), undefined);
	assert.equal(pathInsideRoot('/home/me/proj', '/etc/passwd'), undefined);
	assert.equal(pathInsideRoot('/home/me/proj', '/home/me/project-other/x'), undefined);
	assert.equal(pathInsideRoot('/home/me/proj', '.'), undefined);
	assert.equal(pathInsideRoot('C:\\work\\proj', 'src\\a.ts'), 'C:\\work\\proj\\src\\a.ts');
});
