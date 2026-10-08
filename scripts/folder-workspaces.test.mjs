import assert from 'node:assert/strict';
import test from 'node:test';
import {
	activeSessionMemoryKey,
	commandFolderId,
	FolderWorkspaceRegistry,
	folderIdOfInventoryPanel,
	folderOfSession,
	foldersToMount,
	folderWorkspaceKey,
	mergeFolderInventories,
	mergeProjectInventories,
	UNPROJECTED_FOLDER_ID,
	withFolderInventory,
} from '../src/workspace/folderWorkspaces.ts';

const folder = (id, kind, panelIds = []) => ({
	id,
	projectId: 'project-a',
	name: id,
	kind,
	panelIds,
});

/** General with one terminal, a linked folder with one, and two linked folders
 * with none: a repository with more worktrees than anyone is looking at. */
const project = { folderIds: ['general', 'busy', 'quiet', 'idle'] };
const folders = {
	general: folder('general', 'general', ['p-dev']),
	busy: folder('busy', 'linked', ['p-agent']),
	quiet: folder('quiet', 'linked'),
	idle: folder('idle', 'linked'),
};
const mount = (overrides = {}) =>
	foldersToMount({
		projectId: 'project-a',
		project,
		folders,
		rememberedFolderId: undefined,
		mounted: new Set(),
		...overrides,
	}).map((entry) => entry.id);

test('a key names one project and folder and no other pair', () => {
	assert.equal(folderWorkspaceKey('a', 'b'), 'a/b');
	assert.notEqual(folderWorkspaceKey('a:b', 'c'), folderWorkspaceKey('a', 'b:c'));
});

test('folders with panels and the selected folder are mounted, in folder order', () => {
	// Nothing remembered selects General.
	assert.deepEqual(mount(), ['general', 'busy']);
	assert.deepEqual(mount({ rememberedFolderId: 'idle' }), [
		'general',
		'busy',
		'idle',
	]);
});

test('an empty folder nobody is looking at is not mounted', () => {
	assert.equal(mount().includes('quiet'), false);
	// Having been mounted is not a reason to stay: it holds nothing.
	assert.deepEqual(
		mount({ mounted: new Set(['quiet']), holdsLocalPanels: () => false }),
		['general', 'busy'],
	);
});

test('a deselected folder stays mounted while it shows a panel of its own', () => {
	assert.deepEqual(
		mount({
			mounted: new Set(['quiet']),
			holdsLocalPanels: (folderId) => folderId === 'quiet',
		}),
		['general', 'busy', 'quiet'],
	);
	// A folder that was never mounted cannot be holding anything.
	assert.deepEqual(mount({ holdsLocalPanels: () => true }), ['general', 'busy']);
});

test('a remembered folder that is gone falls back to General', () => {
	assert.deepEqual(mount({ rememberedFolderId: 'deleted' }), ['general', 'busy']);
	assert.equal(commandFolderId(project, folders, 'deleted'), 'general');
	assert.equal(commandFolderId(project, folders, 'busy'), 'busy');
});

test('a folder the projection no longer holds is not mounted', () => {
	const { busy: _gone, ...remaining } = folders;
	assert.deepEqual(mount({ folders: remaining, mounted: new Set(['busy']) }), [
		'general',
	]);
});

test('a project no projection describes yet gets one stand-in General folder', () => {
	const [only, ...rest] = foldersToMount({
		projectId: 'project-new',
		project: undefined,
		folders: {},
		rememberedFolderId: 'busy',
		mounted: new Set(),
	});
	assert.equal(rest.length, 0);
	assert.deepEqual(
		[only.id, only.kind, only.projectId, only.panelIds],
		[UNPROJECTED_FOLDER_ID, 'general', 'project-new', []],
	);
	assert.equal(commandFolderId(undefined, {}, 'busy'), UNPROJECTED_FOLDER_ID);
});

test('a session is found through the folder the projection places it in', () => {
	const panels = {
		'p-dev': { id: 'p-dev', projectId: 'project-a', folderId: 'general', type: 'terminal', sessionId: 's-dev' },
		'p-file': { id: 'p-file', projectId: 'project-a', folderId: 'busy', type: 'file', path: 'a.md' },
		'p-agent': { id: 'p-agent', projectId: 'project-a', folderId: 'busy', type: 'terminal', sessionId: 's-agent' },
	};
	assert.equal(folderOfSession(panels, 's-agent')?.folderId, 'busy');
	assert.equal(folderOfSession(panels, 's-agent')?.id, 'p-agent');
	assert.equal(folderOfSession(panels, 's-unknown'), undefined);
});

test('General remembers its tab under the project, every other folder apart', () => {
	assert.equal(activeSessionMemoryKey('project-a', folders.general), 'project-a');
	assert.equal(
		activeSessionMemoryKey('project-a', folders.busy),
		'project-a/busy',
	);
	assert.notEqual(
		activeSessionMemoryKey('project-a', folders.busy),
		activeSessionMemoryKey('project-a', folders.quiet),
	);
});

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

test('a project inventory is its folders in folder order, each entry naming its folder', () => {
	const byFolder = {
		busy: [entry('agent', { status: 'working' })],
		general: [entry('dev'), entry('notes', { kind: 'file' })],
	};
	const merged = mergeFolderInventories(
		['general', 'busy', 'quiet'],
		(folderId) => byFolder[folderId],
		'general',
	);
	assert.deepEqual(
		merged.map((item) => [item.panelId, item.folderId]),
		[
			['dev', 'general'],
			['notes', 'general'],
			['agent', 'busy'],
		],
	);
	assert.equal(merged[2].status, 'working');
	assert.equal(folderIdOfInventoryPanel(merged, 'notes'), 'general');
	assert.equal(folderIdOfInventoryPanel(merged, 'missing'), undefined);
	assert.equal(folderIdOfInventoryPanel(undefined, 'notes'), undefined);
});

test('only the selected folder keeps the panel in front of the project', () => {
	const byFolder = {
		general: [entry('dev', { isActivePanel: true })],
		busy: [entry('agent', { isActivePanel: true }), entry('logs')],
	};
	const front = (selected) =>
		mergeFolderInventories(
			['general', 'busy'],
			(folderId) => byFolder[folderId],
			selected,
		)
			.filter((item) => item.isActivePanel === true)
			.map((item) => item.panelId);
	assert.deepEqual(front('general'), ['dev']);
	assert.deepEqual(front('busy'), ['agent']);
	// The source inventories are not rewritten.
	assert.equal(byFolder.busy[0].isActivePanel, true);
	assert.equal('folderId' in byFolder.busy[0], false);
});

test('an inventory for a folder the project no longer lists is left out', () => {
	const merged = mergeFolderInventories(
		['general'],
		(folderId) => ({ general: [entry('dev')], gone: [entry('stale')] })[folderId],
		'general',
	);
	assert.deepEqual(
		merged.map((item) => item.panelId),
		['dev'],
	);
});

test('a folder publishing nothing leaves no entry, and no change is no new object', () => {
	const dev = [entry('dev')];
	const one = withFolderInventory({}, 'project-a', 'general', dev);
	assert.deepEqual(one, { 'project-a': { general: dev } });
	const two = withFolderInventory(one, 'project-a', 'busy', [entry('agent')]);
	assert.deepEqual(Object.keys(two['project-a']), ['general', 'busy']);
	// The earlier state is not rewritten.
	assert.deepEqual(Object.keys(one['project-a']), ['general']);

	const unmounted = withFolderInventory(two, 'project-a', 'busy', []);
	assert.deepEqual(unmounted, { 'project-a': { general: dev } });
	assert.deepEqual(withFolderInventory(unmounted, 'project-a', 'general', []), {});
	// Clearing what was never published changes nothing.
	assert.equal(withFolderInventory(two, 'project-a', 'quiet', []), two);
	assert.equal(withFolderInventory(two, 'project-z', 'general', []), two);
});

test('every project is merged in its own folder order with its own selected folder', () => {
	const inventories = {
		'project-a': {
			busy: [entry('agent', { isActivePanel: true })],
			general: [entry('dev', { isActivePanel: true })],
		},
		// No projection describes this one yet.
		'project-new': { general: [entry('first', { isActivePanel: true })] },
	};
	const order = { 'project-a': ['general', 'busy'] };
	const merge = (remembered) =>
		mergeProjectInventories(
			inventories,
			(projectId) => order[projectId],
			(projectId) => remembered[projectId],
		);
	const merged = merge({ 'project-a': 'busy' });
	assert.deepEqual(
		merged['project-a'].map((item) => [item.panelId, item.isActivePanel === true]),
		[
			['dev', false],
			['agent', true],
		],
	);
	assert.deepEqual(
		merged['project-new'].map((item) => [item.panelId, item.folderId, item.isActivePanel]),
		[['first', 'general', true]],
	);
	// Nothing remembered, or a folder that is gone, means the first folder
	// where General is not named.
	for (const remembered of [{}, { 'project-a': 'deleted' }])
		assert.deepEqual(
			merge(remembered)['project-a']
				.filter((item) => item.isActivePanel === true)
				.map((item) => item.panelId),
			['dev'],
		);
	// Where General is named it is the default, wherever it is in the order.
	const generalLast = (remembered) =>
		mergeProjectInventories(
			inventories,
			(projectId) => (projectId === 'project-a' ? ['busy', 'general'] : undefined),
			(projectId) => remembered[projectId],
			(projectId) => (projectId === 'project-a' ? 'general' : undefined),
		);
	for (const remembered of [{}, { 'project-a': 'deleted' }])
		assert.deepEqual(
			generalLast(remembered)['project-a'].map((item) => [item.panelId, item.isActivePanel === true]),
			[
				['agent', false],
				['dev', true],
			],
		);
	assert.deepEqual(
		generalLast({ 'project-a': 'busy' })['project-a']
			.filter((item) => item.isActivePanel === true)
			.map((item) => item.panelId),
		['agent'],
	);
});

test('the registry finds a workspace by project and folder, and forgets it on unmount', () => {
	const registry = new FolderWorkspaceRegistry();
	registry.set('project-a', 'general', 'a-general');
	registry.set('project-a', 'busy', 'a-busy');
	registry.set('project-b', 'general', 'b-general');
	assert.equal(registry.get('project-a', 'busy'), 'a-busy');
	assert.equal(registry.get('project-b', 'busy'), undefined);
	assert.equal(registry.get('project-a', undefined), undefined);
	assert.deepEqual(registry.ofProject('project-a'), ['a-general', 'a-busy']);
	assert.deepEqual(registry.all(), ['a-general', 'a-busy', 'b-general']);

	registry.set('project-a', 'busy', null);
	assert.equal(registry.has('project-a', 'busy'), false);
	assert.deepEqual(registry.ofProject('project-a'), ['a-general']);
	registry.set('project-a', 'general', null);
	assert.deepEqual(registry.ofProject('project-a'), []);
	// Forgetting something never recorded is not an error.
	registry.set('project-c', 'general', null);
	assert.deepEqual(registry.all(), ['b-general']);
});
