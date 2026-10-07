import assert from 'node:assert/strict';
import test from 'node:test';
import {
	activePanelIdFromInventory,
	buildProjectFolderTree,
	folderTreeWorktrees,
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
		change: { kind: 'clean' },
	});
	assert.deepEqual(worktrees[1], {
		path: '/repo/.worktrees/one',
		branch: 'feat/one',
		change: { kind: 'clean' },
		pullRequest: { number: 350, state: 'open', title: 'One', url: 'https://example.test/350' },
		checks: { failed: 0, pending: 1, passed: 26, skipped: 2 },
	});
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
		general.terminals.map((row) => [row.title, row.status, row.isActive]),
		[['server title', 'idle', false]],
	);
	assert.equal(one.isSelected, true);
	assert.equal(one.branch, 'feat/one');
	assert.equal(one.pullRequest.number, 350);
	assert.deepEqual(
		one.terminals.map((row) => [row.title, row.status, row.isActive]),
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
