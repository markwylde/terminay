import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	AUTOMATION_SPACE_PROJECT_ID,
	CanonicalProjectPathResolver,
	createInitialWorkspace,
	createOperationDispatcher,
	createWorkspaceOperationRegistry,
	FILE_CATALOG_OPERATIONS,
	FileCatalog,
	FileContentStreamService,
	GitService,
	ServerFileCatalogAdapter,
	TerminalLaunchResolver,
	TerminalService,
	WorkspaceRepository,
	WorkspaceStore,
} from '@terminay/server-core';
import {
	createFolderFileScope,
	createStandaloneFolders,
} from '../dist/folders.js';
import {
	createServerTerminalControlAdapter,
	createTerminalControlAdapter,
	ProjectHandleCodec,
} from '../dist/index.js';

const PROJECT = 'project-a';
const HANDLE_KEY = new Uint8Array(32).fill(7);

function git(cwd, ...args) {
	return execFileSync('git', args, {
		cwd,
		stdio: 'pipe',
		env: {
			...process.env,
			GIT_CONFIG_GLOBAL: '/dev/null',
			GIT_CONFIG_NOSYSTEM: '1',
			GIT_AUTHOR_NAME: 'Test',
			GIT_AUTHOR_EMAIL: 'test@example.invalid',
			GIT_COMMITTER_NAME: 'Test',
			GIT_COMMITTER_EMAIL: 'test@example.invalid',
		},
	}).toString();
}

/** A real repository with one commit, removed when the test ends. */
async function temporaryRepository(t) {
	const base = await realpath(
		await mkdtemp(join(tmpdir(), 'terminay-folders-')),
	);
	t.after(() => rm(base, { recursive: true, force: true }));
	const repo = join(base, 'repo');
	await mkdir(repo);
	git(repo, 'init', '-q', '-b', 'main');
	await writeFile(join(repo, 'README.md'), 'project\n');
	git(repo, 'add', '.');
	git(repo, 'commit', '-q', '-m', 'initial');
	return { base, repo };
}

function addWorktree(repo, path, branch) {
	git(repo, 'worktree', 'add', '-q', '-b', branch, path);
}

/** Resolves when the workspace reaches a state the predicate accepts. The
 * timeout only bounds the test; nothing under test polls. */
function workspaceReaches(workspace, predicate, what) {
	return new Promise((resolve, reject) => {
		const found = () => {
			const value = predicate(workspace.state);
			if (value === undefined || value === false) return false;
			clearTimeout(timer);
			unsubscribe();
			resolve(value);
			return true;
		};
		const timer = setTimeout(() => {
			unsubscribe();
			reject(new Error(`timed out waiting for ${what}`));
		}, 20_000);
		const unsubscribe = workspace.subscribe(() => void found());
		found();
	});
}

const linkedFolder = (state, path) =>
	Object.values(state.folders).find(
		(folder) => folder.projectId === PROJECT && folder.worktree?.path === path,
	);

/** The workspace, Git service, and folder wiring the standalone server composes. */
async function fixture(t, repo, workspace = new WorkspaceStore(createInitialWorkspace('server-a'))) {
	const registry = createWorkspaceOperationRegistry(workspace);
	const gitService = new GitService();
	t.after(() => gitService.close());
	const errors = [];
	const folders = createStandaloneFolders({
		workspace,
		git: gitService,
		applyHostCommand: registry.applyHostCommand,
		onError: (_projectId, error) => errors.push(error),
	});
	t.after(() => folders.close());
	let serial = 0;
	const host = (command) => {
		const applied = registry.applyHostCommand(`test:${++serial}`, command);
		assert.equal(applied.ok, true, applied.ok ? '' : applied.conflict.message);
		return applied;
	};
	host({
		type: 'project.create',
		projectId: PROJECT,
		viewId: workspace.state.viewOrder[0],
		root: repo,
		name: 'Project',
	});
	await gitService.bindProject(PROJECT, repo);
	return { workspace, registry, gitService, folders, host, errors };
}

const toStat = (value) => ({
	isDirectory: value.isDirectory(),
	isFile: value.isFile(),
	isSymbolicLink: value.isSymbolicLink(),
	size: value.size,
	mtimeMs: value.mtimeMs,
	mode: value.mode,
});
/** The real filesystem, as the server's own storage object reads it. */
const storage = {
	realpath: (path) => realpath(path),
	stat: async (path) => toStat(await stat(path)),
	lstat: async (path) => toStat(await lstat(path)),
	readDirectory: async (path) =>
		(await readdir(path, { withFileTypes: true })).map((entry) => ({
			name: entry.name,
			isDirectory: entry.isDirectory(),
			isFile: entry.isFile(),
			isSymbolicLink: entry.isSymbolicLink(),
		})),
	readRange: async () => new Uint8Array(),
	atomicWrite: async () => {
		throw new Error('read-only test storage');
	},
};
const observationHost = () => ({
	watch() {},
	async calculateFolderSize() {
		return { bytes: 0, files: 0, directories: 0 };
	},
});

test('a folder-scoped listing reads the linked worktree, leaves the project root alone, and fails closed', async (t) => {
	const { base, repo } = await temporaryRepository(t);
	const worktree = join(base, 'feature');
	addWorktree(repo, worktree, 'feature');
	await writeFile(join(worktree, 'feature.ts'), 'export {};\n');
	const { workspace, folders, gitService } = await fixture(t, repo);
	await folders.reconciler.reconcile(PROJECT);
	const linked = linkedFolder(workspace.state, worktree);
	assert.notEqual(linked, undefined, 'the worktree has a linked folder');
	const general = workspace.state.projects[PROJECT].folderIds[0];

	const resolver = new CanonicalProjectPathResolver(repo, storage);
	const project = {
		projectId: PROJECT,
		resolver,
		storage,
		content: new FileContentStreamService(resolver, storage),
		catalog: new FileCatalog(resolver, storage),
		host: observationHost(),
	};
	const scope = createFolderFileScope({
		roots: folders.roots,
		workspace,
		storage,
		projectContext: (projectId) =>
			projectId === PROJECT ? project : undefined,
		observationHost,
	});
	const dispatcher = createOperationDispatcher(
		new ServerFileCatalogAdapter({
			serverId: 'server-a',
			projects: { [PROJECT]: project },
			folderScope: scope.resolve,
		}).operations(),
	);
	let serial = 0;
	const list = async (folderId) => {
		const answer = await dispatcher.query({
			body: new Uint8Array(),
			context: {
				authScope: 'read',
				clientId: 'client-a',
				connectionId: 'connection-a',
				signal: new AbortController().signal,
				claims: { projectId: PROJECT },
			},
			envelope: {
				type: 'query',
				queryId: `q${++serial}`,
				operation: FILE_CATALOG_OPERATIONS.list,
				payload: {
					projectId: PROJECT,
					path: '.',
					...(folderId === undefined ? {} : { folderId }),
				},
			},
		});
		return answer.envelope.ok
			? answer.envelope.result.entries.map((entry) => entry.relativePath).sort()
			: `refused:${JSON.stringify(answer.envelope.error)}`;
	};

	assert.deepEqual(await list(linked.id), ['README.md', 'feature.ts']);
	assert.equal(scope.size, 1);
	// The project root is what it was: no folder, and General, both list it.
	assert.equal((await list()).includes('feature.ts'), false);
	assert.equal((await list(general)).includes('feature.ts'), false);
	assert.equal(workspace.state.projects[PROJECT].root, repo);
	assert.equal(scope.size, 1, 'General reuses the project context');

	// The worktree goes while its folder still exists: the folder must not
	// fall back to the project root.
	const resume = folders.reconciler.suspend(PROJECT);
	git(repo, 'worktree', 'remove', '--force', worktree);
	assert.notEqual(workspace.state.folders[linked.id], undefined);
	const removed = await list(linked.id);
	assert.match(removed, /^refused:.*"code":"not_found"/u);
	assert.equal((await list()).includes('README.md'), true);

	// Once the folder itself is gone its services are dropped with it.
	resume();
	await gitService.worktrees({ projectId: PROJECT, fresh: true });
	await folders.reconciler.reconcile(PROJECT);
	assert.equal(workspace.state.folders[linked.id], undefined);
	assert.equal(scope.size, 0);
	assert.match(await list(linked.id), /^refused:/u);

	// A project release drops whatever its folders still hold.
	addWorktree(repo, worktree, 'feature-two');
	await gitService.worktrees({ projectId: PROJECT, fresh: true });
	await folders.reconciler.reconcile(PROJECT);
	const again = linkedFolder(workspace.state, worktree);
	await list(again.id);
	assert.equal(scope.size, 1);
	scope.releaseProject(PROJECT);
	assert.equal(scope.size, 0);
});

test('Git service events alone create a linked folder for a new worktree and, on the next one after it goes, empty it into General', async (t) => {
	const { base, repo } = await temporaryRepository(t);
	const { workspace, folders, host, errors } = await fixture(t, repo);
	folders.projectBound(PROJECT);
	const worktree = join(base, 'feature');

	// From here on the test never calls the reconciler.
	const appeared = workspaceReaches(
		workspace,
		(state) => linkedFolder(state, worktree),
		'a linked folder for the new worktree',
	);
	addWorktree(repo, worktree, 'feature');
	const linked = await appeared;
	assert.equal(linked.kind, 'linked');
	const general = workspace.state.projects[PROJECT].folderIds[0];
	assert.deepEqual(workspace.state.projects[PROJECT].folderIds, [
		general,
		linked.id,
	]);

	host({
		type: 'terminal.createPanel',
		sessionId: 'session-1',
		projectId: PROJECT,
		folderId: linked.id,
		panelId: 'panel-1',
		title: 'In the worktree',
	});
	assert.deepEqual(workspace.state.folders[linked.id].panelIds, ['panel-1']);

	const gone = workspaceReaches(
		workspace,
		(state) => state.folders[linked.id] === undefined,
		'the linked folder to be removed',
	);
	git(repo, 'worktree', 'remove', '--force', worktree);
	// The Git service publishes a change per listed worktree whose status
	// changed. A worktree that only vanished changes none, so the removal is
	// reconciled on the project's next status change; this makes one.
	await writeFile(join(repo, 'untracked.txt'), 'changed\n');
	await gone;
	assert.equal(workspace.state.panels['panel-1'].folderId, general);
	assert.deepEqual(workspace.state.folders[general].panelIds, ['panel-1']);
	assert.notEqual(workspace.state.terminalSessions['session-1'], undefined);
	assert.deepEqual(workspace.state.projects[PROJECT].folderIds, [general]);
	assert.deepEqual(errors, []);

	// A released project is no longer reconciled.
	folders.releaseProject(PROJECT);
});

/** A Git service that holds a listing and emits what the real one emits. */
function fakeGit(repositoryId, paths) {
	const listeners = new Set();
	const listing = { paths };
	return {
		listing,
		listeners,
		worktrees: async () => ({
			state: 'ready',
			worktrees: listing.paths.map((path) => ({
				repositoryId,
				path,
				isBare: false,
				isPrunable: false,
			})),
		}),
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		changed() {
			for (const listener of listeners)
				listener({ type: 'git.status.changed', projectId: PROJECT });
		},
	};
}

async function fakeFixture(t) {
	const base = await realpath(
		await mkdtemp(join(tmpdir(), 'terminay-folders-')),
	);
	t.after(() => rm(base, { recursive: true, force: true }));
	const root = join(base, 'repo');
	await mkdir(root);
	const workspace = new WorkspaceStore(createInitialWorkspace('server-a'));
	const registry = createWorkspaceOperationRegistry(workspace);
	registry.applyHostCommand('project', {
		type: 'project.create',
		projectId: PROJECT,
		viewId: workspace.state.viewOrder[0],
		root,
		name: 'Project',
	});
	return { base, root, workspace, registry };
}

test('a worktree moved through Terminay keeps its folder and its panels', async (t) => {
	const { base, root, workspace, registry } = await fakeFixture(t);
	const from = join(base, 'feature');
	const to = join(base, 'renamed');
	const gitService = fakeGit('repo-1', [root, from]);
	const folders = createStandaloneFolders({
		workspace,
		git: gitService,
		applyHostCommand: registry.applyHostCommand,
	});
	await folders.reconciler.reconcile(PROJECT);
	const linked = linkedFolder(workspace.state, from);
	registry.applyHostCommand('panel', {
		type: 'terminal.createPanel',
		sessionId: 'session-1',
		projectId: PROJECT,
		folderId: linked.id,
		panelId: 'panel-1',
	});

	// What ServerGitAdapter.move does around the Git operation.
	const moved = folders.onWorktreeMove({
		projectId: PROJECT,
		repositoryId: 'repo-1',
		fromPath: from,
	});
	// The registry watch fires mid-move, with the old path already gone.
	gitService.listing.paths = [root];
	gitService.changed();
	await new Promise((resolve) => setImmediate(resolve));
	assert.notEqual(workspace.state.folders[linked.id], undefined);
	gitService.listing.paths = [root, to];
	moved(to);
	await folders.reconciler.reconcile(PROJECT);

	assert.deepEqual(workspace.state.folders[linked.id].worktree, {
		repositoryId: 'repo-1',
		path: to,
	});
	assert.deepEqual(workspace.state.folders[linked.id].panelIds, ['panel-1']);
	assert.equal(
		workspace.state.projects[PROJECT].folderIds.length,
		2,
		'no second folder appeared for the new path',
	);

	// A move that did not happen changes nothing and still resumes.
	folders.onWorktreeMove({
		projectId: PROJECT,
		repositoryId: 'repo-1',
		fromPath: to,
	})(null);
	await folders.reconciler.reconcile(PROJECT);
	assert.equal(workspace.state.folders[linked.id].worktree.path, to);
});

test('the folder wiring starts no timer, interval, or watcher of its own', async (t) => {
	const source = await readFile(
		new URL('../src/folders.ts', import.meta.url),
		'utf8',
	);
	assert.doesNotMatch(
		source,
		/setTimeout|setInterval|setImmediate|\bwatch(File)?\(|chokidar/u,
	);

	const { base, root, workspace, registry } = await fakeFixture(t);
	const gitService = fakeGit('repo-1', [root]);
	const real = {
		setTimeout: globalThis.setTimeout,
		setInterval: globalThis.setInterval,
	};
	let timers = 0;
	globalThis.setTimeout = (...args) => {
		timers += 1;
		return real.setTimeout(...args);
	};
	globalThis.setInterval = (...args) => {
		timers += 1;
		return real.setInterval(...args);
	};
	try {
		const folders = createStandaloneFolders({
			workspace,
			git: gitService,
			applyHostCommand: registry.applyHostCommand,
		});
		assert.equal(gitService.listeners.size, 1, 'one Git event subscription');
		folders.projectBound(PROJECT);
		gitService.listing.paths = [root, join(base, 'feature')];
		gitService.changed();
		await folders.reconciler.reconcile(PROJECT);
		assert.notEqual(
			linkedFolder(workspace.state, join(base, 'feature')),
			undefined,
		);
		folders.releaseProject(PROJECT);
		folders.close();
		assert.equal(gitService.listeners.size, 0);
	} finally {
		globalThis.setTimeout = real.setTimeout;
		globalThis.setInterval = real.setInterval;
	}
	assert.equal(timers, 0);
});

function ptyFactory() {
	const processes = [];
	return {
		processes,
		spawn(options) {
			const process = {
				pid: 9000 + processes.length,
				options,
				write() {},
				resize() {},
				kill() {},
				onData: () => () => {},
				onExit: () => () => {},
			};
			processes.push(process);
			return process;
		},
	};
}

test('MCP open_terminal follows the calling terminal into its folder and worktree; automation callers land in General', async (t) => {
	const { base, repo } = await temporaryRepository(t);
	const worktree = join(base, 'feature');
	addWorktree(repo, worktree, 'feature');
	let persisted;
	const repository = new WorkspaceRepository(
		{
			load: async () => persisted,
			commit: async (state) => {
				persisted = state;
			},
		},
		'server-a',
	);
	await repository.load();
	const { workspace, folders, host } = await fixture(
		t,
		repo,
		repository.workspace,
	);
	workspace.ensureAutomationSpace({ root: base });
	await folders.reconciler.reconcile(PROJECT);
	const linked = linkedFolder(workspace.state, worktree);
	const general = workspace.state.projects[PROJECT].folderIds[0];

	const pty = ptyFactory();
	const ids = ['in-linked', 'in-general', 'automation'];
	let opened = 0;
	const terminal = new TerminalService({
		serverId: 'server-a',
		ptyFactory: pty,
		generateSessionId: () => ids.shift() ?? `opened-${++opened}`,
	});
	for (const [projectId, folderId] of [
		[PROJECT, linked.id],
		[PROJECT, general],
		[AUTOMATION_SPACE_PROJECT_ID, undefined],
	]) {
		const session = await terminal.createSession({
			projectId,
			cols: 80,
			rows: 24,
		});
		host({
			type: 'terminal.createPanel',
			sessionId: session.sessionId,
			projectId,
			...(folderId === undefined ? {} : { folderId }),
			panelId: `panel-${session.sessionId}`,
		});
	}
	const profile = {
		id: 'system',
		name: 'System default',
		target: { kind: 'executable', executable: '/bin/test-shell' },
		args: [],
		startupMode: 'default',
		environment: {},
		kind: 'system',
		readOnly: true,
		source: 'system',
		availability: { available: true },
	};
	const launchResolver = new TerminalLaunchResolver({
		serverId: 'server-a',
		profiles: {
			catalogue: async () => ({
				settingsRevision: 1,
				defaultProfileId: 'system',
				cwdPolicy: 'project',
				entries: [],
				projectReferences: {},
			}),
			resolveProfile: async (_id, catalogue) => ({
				profile,
				definition: profile,
				settingsRevision: catalogue.settingsRevision,
				target: profile.target,
			}),
		},
		workspaceSnapshot: () => repository.state,
		// As the shared composition wires `folderRoots`.
		folderWorktreeRoot: async (projectId, folderId) => {
			const resolved = await folders.roots.resolve(projectId, folderId);
			return resolved.worktree ? resolved.root : null;
		},
		pathAuthority: {
			canonicalDirectory: async (value) => value,
			homeDirectory: async () => base,
			isRoot: (value) => value === '/',
		},
	});
	const dispatch = createTerminalControlAdapter({
		adapter: createServerTerminalControlAdapter({
			terminal,
			workspace: repository,
			launchResolver,
			projectHandleKey: HANDLE_KEY,
		}),
	});
	let serial = 0;
	const call = (context, op, params = {}) => {
		const id = `${op}-${++serial}`;
		return dispatch(
			{ id, version: 1, op, params },
			{
				scope: 'write',
				connectionId: 'local',
				signal: new AbortController().signal,
				...context,
				requestId: id,
			},
		);
	};
	const fromLinked = { terminalSessionId: 'in-linked', projectId: PROJECT };
	const fromGeneral = { terminalSessionId: 'in-general', projectId: PROJECT };
	const automation = {
		terminalSessionId: 'automation',
		projectId: AUTOMATION_SPACE_PROJECT_ID,
		reach: 'workspace',
	};
	const panelOf = (sessionId) => repository.state.panels[`p:${sessionId}`];

	// From a terminal in the linked folder: that folder, at its worktree.
	const first = await call(fromLinked, 'open_terminal', { name: 'Worker' });
	assert.equal(first.status, 'running');
	assert.equal(panelOf(first.terminal).folderId, linked.id);
	assert.equal(pty.processes.at(-1).options.cwd, worktree);
	assert.equal(panelOf(first.terminal).cwd, worktree);

	// An explicit cwd is honoured; the folder still follows the caller.
	const explicit = await call(fromLinked, 'open_terminal', { cwd: repo });
	assert.equal(panelOf(explicit.terminal).folderId, linked.id);
	assert.equal(pty.processes.at(-1).options.cwd, repo);

	// From General: General, at the project root. A folder is not an input.
	const second = await call(fromGeneral, 'open_terminal', {
		folderId: linked.id,
		folder: linked.id,
	});
	assert.equal(panelOf(second.terminal).folderId, general);
	assert.equal(pty.processes.at(-1).options.cwd, repo);

	// An automation terminal names a project, never a folder: General.
	const handle = new ProjectHandleCodec('server-a', HANDLE_KEY).handleFor(
		PROJECT,
	);
	const third = await call(automation, 'open_terminal', { project: handle });
	assert.equal(third.project, handle);
	assert.equal(panelOf(third.terminal).projectId, PROJECT);
	assert.equal(panelOf(third.terminal).folderId, general);
	assert.equal(pty.processes.at(-1).options.cwd, repo);

	// Splitting stays in the folder of the terminal that is split.
	await call(fromGeneral, 'split_terminal', {
		terminal: first.terminal,
		direction: 'right',
	});
	assert.equal(panelOf(first.terminal).folderId, linked.id);

	// Project reach lists the terminals of every folder of its project.
	const listed = await call(fromGeneral, 'list_terminals');
	assert.deepEqual(
		listed.terminals.map((row) => row.terminal).sort(),
		[
			'in-general',
			'in-linked',
			first.terminal,
			explicit.terminal,
			second.terminal,
			third.terminal,
		].sort(),
	);
	// Workspace reach lists them too, plus its own.
	const all = await call(automation, 'list_terminals');
	assert.equal(all.terminals.length, 7);
});

/**
 * The standalone CLI runs on import, so that it passes the wiring above to its
 * services is checked at the source, as the project-release contract is.
 */
test('the standalone server composes the folder wiring into its services', async () => {
	const source = await readFile(
		new URL('../src/cli.ts', import.meta.url),
		'utf8',
	);
	assert.match(
		source,
		/git: gitService,\n\t\tapplyHostCommand: \(commandId, command\) =>\n\t\t\tcomposition\.workspaceOperations\?\.applyHostCommand\(commandId, command\)/u,
	);
	assert.match(source, /\n\t\tfolderRoots: folders\.roots,\n/u);
	assert.match(source, /\n\t\tonWorktreeMove: folders\.onWorktreeMove,\n/u);
	assert.match(
		source,
		/bindProject\('default', options\.projectRoot\);\n\t\t\t\tfolders\.projectBound\('default'\);/u,
	);
	assert.match(
		source,
		/prepared\.commit\(\);[\s\S]{0,200}?folders\.projectBound\(projectId\);/u,
	);
	assert.match(
		source,
		/releaseProject: \(projectId\) => \{[\s\S]{0,200}?folders\.releaseProject\(projectId\);/u,
	);
	assert.match(
		source,
		/mdxRuntimeProjects\.delete\(projectId\);\n\t\t\tfolderScope\.releaseProject\(projectId\);/u,
	);
	// Exactly the four file adapters follow a folder.
	assert.equal(source.match(/folderScope: folderScope\.resolve,/gu)?.length, 4);
	for (const adapter of [
		'ServerFileAdapter',
		'ServerFileContentAdapter',
		'ServerFileCatalogAdapter',
		'ServerFileObservationAdapter',
	])
		assert.match(
			source,
			new RegExp(
				`new ${adapter}\\(\\{[^}]*folderScope: folderScope\\.resolve,`,
				'u',
			),
			adapter,
		);
	for (const adapter of [
		'ServerDocumentationCatalogAdapter',
		'ServerMdxRuntimeAdapter',
	])
		assert.doesNotMatch(
			source,
			new RegExp(`new ${adapter}\\(\\{[^}]*folderScope`, 'u'),
			adapter,
		);
});
