import assert from 'node:assert/strict';
import test from 'node:test';
import {
	findContainingWorktree,
	firstChangedSegmentIndex,
	inferHomeDirectory,
	remoteDeviceKind,
	remoteIndicatorState,
	splitStatusBarPath,
	statusBarBranch,
	statusBarBreadcrumb,
	statusBarLayoutCells,
} from './workspaceStatusBarModel.ts';

const HOME = '/Users/mark';

test('paths under home start with ~', () => {
	assert.deepEqual(splitStatusBarPath('/Users/mark/Projects/terminay', HOME), ['~', 'Projects', 'terminay']);
	assert.deepEqual(splitStatusBarPath('/Users/mark', HOME), ['~']);
	assert.deepEqual(splitStatusBarPath('/Users/mark/', HOME), ['~']);
});

test('a sibling of home is not collapsed to ~', () => {
	assert.deepEqual(splitStatusBarPath('/Users/markus/src', HOME), ['/', 'Users', 'markus', 'src']);
});

test('paths outside home keep their root', () => {
	assert.deepEqual(splitStatusBarPath('/var/log', HOME), ['/', 'var', 'log']);
	assert.deepEqual(splitStatusBarPath('/', HOME), ['/']);
	assert.deepEqual(splitStatusBarPath('C:\\Users\\mark\\src', 'C:\\Users\\mark'), ['~', 'src']);
	assert.deepEqual(splitStatusBarPath('D:\\work\\api', 'C:\\Users\\mark'), ['D:', 'work', 'api']);
});

test('home is inferred from conventional layouts', () => {
	assert.equal(inferHomeDirectory('/Users/mark/src'), '/Users/mark');
	assert.equal(inferHomeDirectory('/Users/mark'), '/Users/mark');
	assert.equal(inferHomeDirectory('/home/dev/app'), '/home/dev');
	assert.equal(inferHomeDirectory('/root/x'), '/root');
	assert.equal(inferHomeDirectory('/rootfs/x'), '');
	assert.equal(inferHomeDirectory('C:\\Users\\mark\\src'), 'C:\\Users\\mark');
	assert.equal(inferHomeDirectory('/var/log'), '');
});

test('an unknown home leaves the path as is', () => {
	assert.deepEqual(splitStatusBarPath('/Users/mark/src', ''), ['/', 'Users', 'mark', 'src']);
});

test('short breadcrumbs show every segment with its absolute path', () => {
	const crumbs = statusBarBreadcrumb('/Users/mark/Projects/terminay', HOME);
	assert.deepEqual(
		crumbs.map((crumb) => [crumb.label, crumb.path]),
		[
			['~', '/Users/mark'],
			['Projects', '/Users/mark/Projects'],
			['terminay', '/Users/mark/Projects/terminay'],
		],
	);
});

test('long breadcrumbs collapse the middle and keep the last three', () => {
	const crumbs = statusBarBreadcrumb('/Users/mark/Documents/Projects/terminay/terminay/apps/web', HOME);
	assert.deepEqual(crumbs.map((crumb) => crumb.label), ['~', '…', 'terminay', 'apps', 'web']);
	assert.equal(crumbs[1].path, null);
	assert.equal(crumbs[4].index, 6);
	assert.equal(crumbs[4].path, '/Users/mark/Documents/Projects/terminay/terminay/apps/web');
});

test('only the segments after the shared prefix change', () => {
	assert.equal(firstChangedSegmentIndex(['~', 'a', 'b'], ['~', 'a', 'b', 'c', 'd']), 3);
	assert.equal(firstChangedSegmentIndex(['~', 'a', 'b'], ['~', 'x']), 1);
	assert.equal(firstChangedSegmentIndex(['~', 'a'], ['~', 'a']), 2);
	assert.equal(firstChangedSegmentIndex(['~', 'a', 'b'], ['~', 'a']), 2);
	assert.equal(firstChangedSegmentIndex(null, ['~', 'a']), 2);
});

test('the containing worktree is the longest matching prefix', () => {
	const worktrees = [
		{ path: '/p/terminay', branch: 'main', aheadOfMainCount: 0, entries: [] },
		{ path: '/p/terminay/.claude/worktrees/x', branch: 'feat/x', aheadOfMainCount: 2, entries: [1, 2, 3] },
		{ path: '/p/terminay-auto', branch: 'auto', aheadOfMainCount: 1, entries: [] },
	];
	assert.equal(findContainingWorktree('/p/terminay/src', worktrees)?.branch, 'main');
	assert.equal(findContainingWorktree('/p/terminay/.claude/worktrees/x/src', worktrees)?.branch, 'feat/x');
	assert.equal(findContainingWorktree('/p/terminay-auto', worktrees)?.branch, 'auto');
	assert.equal(findContainingWorktree('/p/other', worktrees), null);
});

test('branch chip counts', () => {
	assert.deepEqual(
		statusBarBranch({ path: '/p', branch: 'feat/x', aheadOfMainCount: 2, entries: [1, 2, 3] }),
		{ name: 'feat/x', uncommittedCount: 3, aheadCount: 2 },
	);
	assert.deepEqual(
		statusBarBranch({ path: '/p', branch: 'main', aheadOfMainCount: null, entries: [] }),
		{ name: 'main', uncommittedCount: 0, aheadCount: 0 },
	);
	assert.equal(statusBarBranch({ path: '/p', branch: null, aheadOfMainCount: 0, entries: [] }), null);
	assert.equal(statusBarBranch(null), null);
});

test('layout cells are normalised to the union of groups', () => {
	const cells = statusBarLayoutCells([
		{ left: 100, top: 50, width: 200, height: 400, isFocused: false },
		{ left: 300, top: 50, width: 200, height: 400, isFocused: true },
		{ left: 0, top: 0, width: 0, height: 0, isFocused: false },
	]);
	assert.deepEqual(cells, [
		{ x: 0, y: 0, width: 0.5, height: 1, isFocused: false },
		{ x: 0.5, y: 0, width: 0.5, height: 1, isFocused: true },
	]);
	assert.deepEqual(statusBarLayoutCells([]), []);
});

test('device kinds from device names', () => {
	assert.equal(remoteDeviceKind("Mark's iPhone"), 'phone');
	assert.equal(remoteDeviceKind('Pixel 9'), 'phone');
	assert.equal(remoteDeviceKind('iPad Pro'), 'tablet');
	assert.equal(remoteDeviceKind('MacBook Pro'), 'computer');
});

test('Desktop Local not exposed is red with no devices', () => {
	const state = remoteIndicatorState({ isDesktopLocal: true, isExposed: false, connections: [] });
	assert.equal(state.tone, 'offline');
	assert.deepEqual(state.devices, []);
	assert.match(state.accessibleLabel, /not exposed/u);
});

test('exposed with no connections is grey', () => {
	const state = remoteIndicatorState({ isDesktopLocal: true, isExposed: true, connections: [] });
	assert.equal(state.tone, 'idle');
	assert.deepEqual(state.devices, []);
});

test('a remote server is never red', () => {
	const state = remoteIndicatorState({ isDesktopLocal: false, isExposed: false, connections: [] });
	assert.equal(state.tone, 'idle');
});

test('connected devices are blue with icons and a count', () => {
	const state = remoteIndicatorState({
		isDesktopLocal: true,
		isExposed: true,
		connections: [{ deviceName: 'iPhone' }, { deviceName: 'iPad' }],
	});
	assert.equal(state.tone, 'connected');
	assert.equal(state.label, '2 devices');
	assert.deepEqual(state.devices, ['phone', 'tablet']);
	assert.equal(state.accessibleLabel, 'Remote access, exposed, 2 devices connected');
});

test('device icons are capped', () => {
	const state = remoteIndicatorState({
		isDesktopLocal: true,
		isExposed: true,
		connections: Array.from({ length: 5 }, () => ({ deviceName: 'iPhone' })),
	});
	assert.equal(state.devices.length, 3);
	assert.equal(state.label, '5 devices');
});
