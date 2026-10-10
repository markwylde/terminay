import assert from 'node:assert/strict';
import test from 'node:test';
import {
	activePanelIdFromInventory,
	buildProjectFolderTree,
	folderNameFromStatus,
	folderTreeWorktrees,
	worktreeUnmerged,
	panelFactsFromInventory,
} from '../src/workspace/folderTreeSources.ts';

const entry = (panelId, extra = {}) => ({
	color: '#fff',
	emoji: '',
	isAgentStatus: false,
	kind: 'terminal',
	panelId,
	projectEmoji: '',
	projectId: 'project-a',
	projectTitle: 'Project',
	sessionId: `s-${panelId}`,
	status: 'idle',
	title: panelId,
	...extra,
});

const worktree = (path, branch, properties) => ({
	path,
	name: path.split('/').at(-1),
	branch,
	head: 'abc',
	aheadOfMainCount: 0,
	lineAdditions: 0,
	lineDeletions: 0,
	lastChangedAt: null,
	isDirtyBranch: false,
	hasUnpushedCommits: false,
	unpushedLineAdditions: 0,
	unpushedLineDeletions: 0,
	isCurrent: false,
	isMain: false,
	isBare: false,
	isDetached: false,
	isLocked: false,
	isPrunable: false,
	entries: [],
	...(properties === undefined ? {} : { properties }),
});

const gitStatus = (worktrees) => ({
	gitAvailable: true,
	repoRoot: '/repo',
	defaultBranch: 'main',
	worktrees,
});

test('a panel takes its status and title from the inventory the dashboard reads', () => {
	const facts = panelFactsFromInventory([
		entry('dev', { title: 'npm run dev', status: 'recent' }),
		entry('agent', { isAgentStatus: true, status: 'waiting' }),
		entry('quiet'),
	]);
	assert.deepEqual(facts('dev'), { status: 'working', title: 'npm run dev' });
	assert.deepEqual(facts('agent'), { status: 'waiting', title: 'agent' });
	assert.equal(facts('quiet').status, 'idle');
	// A panel in a folder with no mounted workspace is in no inventory.
	assert.equal(facts('elsewhere'), undefined);
});

test('the panel in front is the one the inventory marks', () => {
	assert.equal(
		activePanelIdFromInventory([entry('a'), entry('b', { isActivePanel: true })]),
		'b',
	);
	assert.equal(activePanelIdFromInventory([entry('a')]), undefined);
});

test('worktrees carry their branch, change, pull request, and checks', () => {
	const worktrees = folderTreeWorktrees(
		gitStatus([
			worktree('/repo', 'main'),
			worktree('/repo/.worktrees/one', 'feat/one', {
				pullRequest: { number: 350, title: 'One', url: 'https://example.test/350', state: 'open' },
				checks: { passed: 26, failed: 0, pending: 1, skipped: 2 },
			}),
		]),
	);
	assert.deepEqual(worktrees[0], {
		path: '/repo',
		branch: 'main',
		isDetached: false,
		head: 'abc',
		change: { kind: 'clean' },
	});
	assert.deepEqual(worktrees[1], {
		path: '/repo/.worktrees/one',
		branch: 'feat/one',
		isDetached: false,
		head: 'abc',
		change: { kind: 'clean' },
		pullRequest: { number: 350, state: 'open', title: 'One', url: 'https://example.test/350' },
		checks: { failed: 0, pending: 1, passed: 26, skipped: 2 },
	});
});

test('a folder is named from the listing: a linked one by its branch, or its directory when detached or unlisted', () => {
	const linkedFolder = (path) => ({ kind: 'linked', name: 'a name nobody sees', worktree: { repositoryId: 'repo', path } });
	const status = gitStatus([
		worktree('/repo', 'main'),
		worktree('/repo/.worktrees/one', 'feat/one'),
		{ ...worktree('/repo/.worktrees/bisect', '(detached)'), isDetached: true },
	]);
	assert.equal(folderNameFromStatus(linkedFolder('/repo/.worktrees/one'), status), 'feat/one');
	assert.equal(folderNameFromStatus(linkedFolder('/repo/.worktrees/bisect'), status), 'bisect');
	assert.equal(folderNameFromStatus(linkedFolder('/repo/.worktrees/one'), null), 'one');
	assert.equal(folderNameFromStatus({ kind: 'plain', name: 'Servers' }, status), 'Servers');
	assert.equal(folderNameFromStatus({ kind: 'general', name: 'General' }, status), 'General');
});

test('a pushed branch the default branch lacks is unmerged and not changed; unpushed work is changed', () => {
	const pushed = {
		...worktree('/repo/.worktrees/one', 'feat/one'),
		isDirtyBranch: true,
		aheadOfMainCount: 4,
		// The whole branch against the default branch is not what is unpushed.
		lineAdditions: 247,
		lineDeletions: 13,
	};
	const [shown] = folderTreeWorktrees(gitStatus([pushed]));
	assert.deepEqual(shown.change, { kind: 'clean' });
	assert.deepEqual(shown.unmerged, { commits: 4 });

	const [local] = folderTreeWorktrees(
		gitStatus([
			{
				...pushed,
				aheadOfMainCount: 5,
				hasUnpushedCommits: true,
				unpushedLineAdditions: 12,
				unpushedLineDeletions: 3,
			},
		]),
	);
	assert.deepEqual(local.change, { kind: 'delta', additions: 12, deletions: 3 });
	assert.deepEqual(local.unmerged, { commits: 5 });

	// Unmerged with no count, and nothing unmerged at all.
	assert.deepEqual(
		worktreeUnmerged({ isPrunable: false, isDirtyBranch: true, aheadOfMainCount: null }),
		{ commits: null },
	);
	assert.equal(
		worktreeUnmerged({ isPrunable: false, isDirtyBranch: false, aheadOfMainCount: 2 }),
		undefined,
	);
	assert.equal(
		worktreeUnmerged({ isPrunable: true, isDirtyBranch: true, aheadOfMainCount: 2 }),
		undefined,
	);
});

test('no repository, no Git, or no listing yet means no worktrees at all', () => {
	assert.equal(folderTreeWorktrees(null), undefined);
	assert.equal(folderTreeWorktrees(undefined), undefined);
	assert.equal(folderTreeWorktrees(gitStatus([])), undefined);
	assert.equal(
		folderTreeWorktrees({ ...gitStatus([worktree('/repo', 'main')]), gitAvailable: false }),
		undefined,
	);
});

const folder = (id, name, kind, panelIds, extra = {}) => ({
	id,
	projectId: 'project-a',
	name,
	kind,
	panelIds,
	...extra,
});
const terminal = (id, folderId, title) => ({
	id,
	projectId: 'project-a',
	folderId,
	type: 'terminal',
	sessionId: `s-${id}`,
	title,
});
const projection = {
	project: { id: 'project-a', root: '/repo', folderIds: ['general', 'one'] },
	folders: {
		general: folder('general', 'General', 'general', ['dev']),
		one: folder('one', 'one', 'linked', ['agent'], {
			worktree: { repositoryId: 'repo', path: '/repo/.worktrees/one' },
		}),
	},
	panels: {
		dev: terminal('dev', 'general', 'server title'),
		agent: terminal('agent', 'one', 'agent title'),
	},
};

test('the tree joins the projection, the inventory, and the worktree listing', () => {
	const rows = buildProjectFolderTree({
		...projection,
		selectedFolderId: 'one',
		inventory: [
			// General has no mounted workspace here, so only the linked folder's
			// terminal is in the inventory.
			entry('agent', { title: 'renamed here', status: 'waiting', isAgentStatus: true, isActivePanel: true }),
		],
		worktreeStatus: gitStatus([
			worktree('/repo', 'main'),
			worktree('/repo/.worktrees/one', 'feat/one', {
				pullRequest: { number: 350, title: 'One', url: 'https://example.test/350', state: 'open' },
			}),
		]),
	});
	const [general, one] = rows;
	assert.equal(general.branch, 'main');
	assert.equal(general.isSelected, false);
	// Falls back to the projection's title, idle.
	assert.deepEqual(
		general.panels.map((row) => [row.title, row.status, row.isActive]),
		[['server title', 'idle', false]],
	);
	assert.equal(one.isSelected, true);
	assert.equal(one.branch, 'feat/one');
	assert.equal(one.pullRequest.number, 350);
	assert.deepEqual(
		one.panels.map((row) => [row.title, row.status, row.isActive]),
		[['renamed here', 'waiting', true]],
	);
});

test('a project without a repository shows no branch on any row', () => {
	const rows = buildProjectFolderTree({
		...projection,
		selectedFolderId: undefined,
		inventory: [],
		worktreeStatus: { gitAvailable: true, repoRoot: null, defaultBranch: null, worktrees: [] },
	});
	assert.deepEqual(
		rows.map((row) => row.branch),
		[undefined, undefined],
	);
	// Nothing remembered selects General.
	assert.deepEqual(
		rows.map((row) => row.isSelected),
		[true, false],
	);
});

test('a project no projection describes has no tree yet', () => {
	assert.deepEqual(
		buildProjectFolderTree({
			project: undefined,
			folders: {},
			panels: {},
			selectedFolderId: undefined,
			inventory: [],
			worktreeStatus: null,
		}),
		[],
	);
});

test('the file and folder tabs open on this device are rows of their folder, where their tabs are', () => {
	const viewer = (panelId, kind, folderId, extra = {}) => {
		const { sessionId: _none, ...rest } = entry(panelId, { kind, folderId, ...extra });
		return rest;
	};
	const rows = buildProjectFolderTree({
		...projection,
		folders: {
			...projection.folders,
			general: { ...projection.folders.general, panelIds: ['dev', 'logs'] },
		},
		panels: { ...projection.panels, logs: terminal('logs', 'general', 'logs') },
		selectedFolderId: 'general',
		inventory: [
			// The tab strip: a file first, then the two terminals with a folder
			// tab between them. The projection holds only the terminals.
			viewer('readme', 'file', 'general', { title: 'README.md', isActivePanel: true }),
			entry('dev', { folderId: 'general', title: 'dev' }),
			viewer('src', 'folder', 'general', { title: 'src' }),
			entry('logs', { folderId: 'general', title: 'logs' }),
			// A tab in no folder this window knows is not placed anywhere.
			viewer('stray', 'file', undefined),
		],
	});
	const [general, one] = rows;
	assert.deepEqual(
		general.panels.map((row) => [row.panelId, row.kind, row.title, row.isActive]),
		[
			['readme', 'file', 'README.md', true],
			['dev', 'terminal', 'dev', false],
			['src', 'folder', 'src', false],
			['logs', 'terminal', 'logs', false],
		],
	);
	assert.equal(general.isEmpty, false);
	// A folder whose tabs are not drawn here still lists what the server holds.
	assert.deepEqual(one.panels.map((row) => row.panelId), ['agent']);
});

test('a folder whose only tab is a file is not empty', () => {
	const { sessionId: _none, ...file } = entry('notes', { kind: 'file', folderId: 'one', title: 'notes.txt' });
	const [, one] = buildProjectFolderTree({
		...projection,
		folders: { ...projection.folders, one: { ...projection.folders.one, panelIds: [] } },
		selectedFolderId: 'one',
		inventory: [file],
	});
	assert.deepEqual(one.panels.map((row) => [row.kind, row.title]), [['file', 'notes.txt']]);
	assert.equal(one.isEmpty, false);
});
