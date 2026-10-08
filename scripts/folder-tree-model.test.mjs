import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildFolderTree,
	folderIdOfPanel,
	isChangeDirty,
	resolveSelectedFolderId,
} from '../src/workspace/folderTreeModel.ts';

const terminal = (id, folderId, extra = {}) => ({ id, projectId: 'project-a', folderId, type: 'terminal', sessionId: `s-${id}`, ...extra });

/** General with a dev server and an agent; a linked folder with one terminal
 * and a file panel; an empty linked folder; a plain folder. */
function workspace(overrides = {}) {
	const panels = {
		dev: terminal('dev', 'general', { title: 'npm run dev' }),
		agent: terminal('agent', 'general', { title: 'one project, one window' }),
		release: terminal('release', 'releases', { title: 'release notes' }),
		readme: { id: 'readme', projectId: 'project-a', folderId: 'releases', type: 'file', path: 'README.md' },
		ssh: terminal('ssh', 'servers'),
	};
	const folder = (id, name, kind, panelIds, extra = {}) => ({ id, projectId: 'project-a', name, kind, panelIds, ...extra });
	const folders = {
		general: folder('general', 'General', 'general', ['dev', 'agent']),
		releases: folder('releases', 'Releases', 'linked', ['release', 'readme'], { worktree: { repositoryId: 'repo', path: '/repo/.worktrees/release-notes' } }),
		window: folder('window', 'one-project-one-window', 'linked', [], { worktree: { repositoryId: 'repo', path: '/repo/.worktrees/one-project-one-window' } }),
		servers: folder('servers', 'Servers', 'plain', ['ssh']),
		...overrides.folders,
	};
	return {
		project: { id: 'project-a', root: '/repo', folderIds: ['general', 'releases', 'window', 'servers'] },
		folders,
		panels,
		worktrees: [
			{ path: '/repo', branch: 'main' },
			{ path: '/repo/.worktrees/release-notes', branch: 'fix/release-notes', pullRequest: { number: 351, state: 'open', title: 'Release notes' }, checks: { failed: 0, pending: 0, passed: 26, skipped: 0 } },
			{ path: '/repo/.worktrees/one-project-one-window', branch: 'feat/one-project-one-window' },
		],
		...overrides.input,
	};
}
const byId = (rows) => Object.fromEntries(rows.map((row) => [row.id, row]));

test('folders are listed in order with their terminals, and only terminals', () => {
	const rows = buildFolderTree(workspace());
	assert.deepEqual(rows.map((row) => row.name), ['General', 'Releases', 'one-project-one-window', 'Servers']);
	const tree = byId(rows);
	assert.deepEqual(tree.general.terminals.map((row) => row.title), ['npm run dev', 'one project, one window']);
	// The file panel is in the folder but is not a terminal row.
	assert.deepEqual(tree.releases.terminals.map((row) => row.panelId), ['release']);
	assert.equal(tree.releases.isEmpty, false);
	assert.deepEqual(tree.window.terminals, []);
	assert.equal(tree.window.isEmpty, true);
	// A terminal with no title of its own still has a label.
	assert.equal(tree.servers.terminals[0].title, 'Terminal');
});

test('a linked folder shows its branch, pull request and checks; General shows the root checkout branch; a plain folder shows none', () => {
	const tree = byId(buildFolderTree(workspace()));
	assert.equal(tree.general.branch, 'main');
	assert.equal(tree.general.pullRequest, undefined);
	assert.equal(tree.general.worktreePath, undefined);
	assert.equal(tree.releases.branch, 'fix/release-notes');
	assert.equal(tree.releases.pullRequest.number, 351);
	assert.equal(tree.releases.checks.passed, 26);
	assert.equal(tree.releases.worktreePath, '/repo/.worktrees/release-notes');
	assert.equal(tree.window.branch, 'feat/one-project-one-window');
	assert.equal(tree.window.pullRequest, undefined);
	assert.equal(tree.servers.branch, undefined);
});

test('a project that is not a repository shows no branch on any folder', () => {
	const input = workspace({ input: { worktrees: undefined } });
	input.project = { ...input.project, folderIds: ['general', 'servers'] };
	const rows = buildFolderTree(input);
	assert.deepEqual(rows.map((row) => [row.name, row.branch]), [['General', undefined], ['Servers', undefined]]);
});

test('General stands for the deepest checkout containing the project root', () => {
	const input = workspace();
	input.project = { ...input.project, root: '/repo/.worktrees/release-notes/' };
	assert.equal(byId(buildFolderTree(input)).general.branch, 'fix/release-notes');
	input.project = { ...input.project, root: '/repo/packages/app' };
	assert.equal(byId(buildFolderTree(input)).general.branch, 'main');
	input.project = { ...input.project, root: '/repository-elsewhere' };
	assert.equal(byId(buildFolderTree(input)).general.branch, undefined);
});

test('status and titles come from what is known about each panel, and default quietly', () => {
	const facts = { agent: { status: 'waiting', title: 'Reviewing the plan' }, dev: { status: 'working' } };
	const tree = byId(buildFolderTree(workspace({ input: { panelFacts: (panelId) => facts[panelId] } })));
	assert.deepEqual(tree.general.terminals.map((row) => [row.title, row.status]), [['npm run dev', 'working'], ['Reviewing the plan', 'waiting']]);
	assert.equal(tree.releases.terminals[0].status, 'idle');
});

test('the selected folder and active terminal are marked, and only in the selected folder', () => {
	const tree = byId(buildFolderTree(workspace({ input: { selectedFolderId: 'releases', activePanelId: 'release' } })));
	assert.equal(tree.releases.isSelected, true);
	assert.equal(tree.general.isSelected, false);
	assert.equal(tree.releases.terminals[0].isActive, true);
	// The project's active panel is not marked when another folder is selected.
	const other = byId(buildFolderTree(workspace({ input: { selectedFolderId: 'general', activePanelId: 'release' } })));
	assert.equal(other.releases.terminals[0].isActive, false);
	assert.equal(other.general.isSelected, true);
});

test('a device with no remembered folder, or a folder that is gone, shows General', () => {
	const { project, folders } = workspace();
	assert.equal(resolveSelectedFolderId(project, folders, undefined), 'general');
	assert.equal(resolveSelectedFolderId(project, folders, 'servers'), 'servers');
	assert.equal(resolveSelectedFolderId(project, folders, 'folder-deleted'), 'general');
	// A folder of another project is never selected here.
	assert.equal(resolveSelectedFolderId(project, { ...folders, foreign: { id: 'foreign' } }, 'foreign'), 'general');
	assert.equal(byId(buildFolderTree(workspace({ input: { selectedFolderId: 'folder-deleted' } }))).general.isSelected, true);
});

test('a terminal that created a worktree is tagged until it is in that folder, and an offer names it', () => {
	const offered = workspace({
		folders: {
			window: { id: 'window', projectId: 'project-a', name: 'one-project-one-window', kind: 'linked', panelIds: [], worktree: { repositoryId: 'repo', path: '/repo/.worktrees/one-project-one-window' }, createdByPanelId: 'agent', captureOffer: { panelId: 'agent' } },
		},
	});
	const tree = byId(buildFolderTree(offered));
	assert.equal(tree.general.terminals[1].createdWorktree, 'one-project-one-window');
	assert.equal(tree.general.terminals[0].createdWorktree, undefined);
	assert.deepEqual(tree.window.offer, { panelId: 'agent', title: 'one project, one window' });

	// Once it has moved in, the tag goes.
	const moved = structuredClone(offered);
	moved.folders.general.panelIds = ['dev'];
	moved.folders.window.panelIds = ['agent'];
	delete moved.folders.window.captureOffer;
	moved.panels.agent.folderId = 'window';
	const after = byId(buildFolderTree(moved));
	assert.equal(after.window.terminals[0].createdWorktree, undefined);
	assert.equal(after.window.offer, undefined);
});

test('the folder of a panel is read from the projection', () => {
	const { panels } = workspace();
	assert.equal(folderIdOfPanel(panels, 'release'), 'releases');
	assert.equal(folderIdOfPanel(panels, 'missing'), undefined);
});

test('General carries the change of the root checkout, and never a pull request or checks', () => {
	const input = workspace();
	input.worktrees[0] = {
		...input.worktrees[0],
		change: { kind: 'delta', additions: 12, deletions: 3 },
		pullRequest: { number: 9, state: 'open', title: 'Root' },
		checks: { failed: 0, pending: 1, passed: 0, skipped: 0 },
	};
	const tree = byId(buildFolderTree(input));
	assert.deepEqual(tree.general.change, { kind: 'delta', additions: 12, deletions: 3 });
	assert.equal(tree.general.isDirty, true);
	assert.equal(tree.general.pullRequest, undefined);
	assert.equal(tree.general.checks, undefined);
	// A plain folder has no checkout to measure.
	assert.equal(tree.servers.change, undefined);
	assert.equal(tree.servers.isDirty, false);
});

test('a checkout is dirty with a measured or unmeasured change, and not when clean, missing, or unknown', () => {
	assert.equal(isChangeDirty({ kind: 'delta', additions: 1, deletions: 0 }), true);
	assert.equal(isChangeDirty({ kind: 'changed' }), true);
	assert.equal(isChangeDirty({ kind: 'clean' }), false);
	assert.equal(isChangeDirty({ kind: 'missing' }), false);
	assert.equal(isChangeDirty(undefined), false);
	const withChange = (change) => {
		const input = workspace();
		input.worktrees[1] = { ...input.worktrees[1], change };
		return byId(buildFolderTree(input)).releases.isDirty;
	};
	assert.equal(withChange({ kind: 'changed' }), true);
	assert.equal(withChange({ kind: 'clean' }), false);
	assert.equal(withChange({ kind: 'missing' }), false);
	assert.equal(withChange(undefined), false);
});
