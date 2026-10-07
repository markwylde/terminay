import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { MessageChannel } from 'node:worker_threads';
import {
	TerminayClient,
	TerminayClientFacade,
	WorkspaceClient,
} from '@terminay/client-core';
import { build } from 'esbuild';

/**
 * The embedded server's folder wiring, driven the way a renderer drives it:
 * over a framed port, against a real repository with real worktrees.
 */

const {
	ServerPortTransport,
	ServerScopedMessagePort,
	ServerTerminalAuthority,
	TerminalService,
} = await importAuthority();

const run = promisify(execFile);

async function git(cwd, ...args) {
	await run(
		'git',
		[
			'-c',
			'user.name=Terminay Test',
			'-c',
			'user.email=test@terminay.invalid',
			'-c',
			'commit.gpgsign=false',
			...args,
		],
		{ cwd },
	);
}

/** A repository with one commit, and a sibling directory for its worktrees. */
async function repository(t) {
	const base = await realpath(
		await mkdtemp(join(tmpdir(), 'terminay-desktop-folders-')),
	);
	t.after(() => rm(base, { recursive: true, force: true }));
	const root = join(base, 'main');
	await mkdir(root);
	await git(root, 'init', '-b', 'main');
	await writeFile(join(root, 'README.md'), '# Main checkout\n');
	await git(root, 'add', '.');
	await git(root, 'commit', '-m', 'initial');
	return {
		base,
		root,
		async addWorktree(name) {
			const path = join(base, name);
			await git(root, 'worktree', 'add', '-b', name, path);
			return path;
		},
	};
}

function createPtyFactory() {
	const processes = [];
	return {
		processes,
		spawn(options) {
			const process = {
				pid: 7_000 + processes.length,
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

function systemShellProfiles() {
	const definition = {
		id: 'system',
		name: 'System default',
		target: { kind: 'system' },
		args: [],
		startupMode: 'login',
		environment: {},
	};
	const profile = {
		...definition,
		kind: 'system',
		readOnly: true,
		source: 'system',
		availability: { available: true },
		projectReferences: [],
		environmentEntryCount: 0,
		hasEnvironmentOverlay: false,
	};
	return {
		async catalogue() {
			return {
				settingsRevision: 1,
				defaultProfileId: 'system',
				cwdPolicy: 'current',
				entries: [profile],
			};
		},
		async resolveProfile(_id, catalogue) {
			return {
				profile,
				definition,
				settingsRevision: catalogue.settingsRevision,
				target: { kind: 'executable', executable: '/bin/zsh' },
			};
		},
	};
}

/** An embedded server with one connected renderer. */
async function embeddedServer(t, serverId, options = {}) {
	const pty = createPtyFactory();
	const authority = new ServerTerminalAuthority({
		serverId,
		terminalService: new TerminalService({ serverId, ptyFactory: pty }),
		...options,
	});
	const channel = new MessageChannel();
	let serverMessage;
	let serverMessageError;
	channel.port1.on('message', (data) => serverMessage?.({ data }));
	channel.port1.on('messageerror', () => serverMessageError?.());
	authority.acceptRendererPort({
		get onmessage() {
			return serverMessage;
		},
		set onmessage(listener) {
			serverMessage = listener;
		},
		get onmessageerror() {
			return serverMessageError;
		},
		set onmessageerror(listener) {
			serverMessageError = listener;
		},
		postMessage: (data) => channel.port1.postMessage(data),
		start: () => channel.port1.start(),
		close: () => channel.port1.close(),
	});
	const protocol = new TerminayClient({
		clientId: `embedded-renderer-${serverId}`,
		clientVersion: 'test',
		capabilities: ['terminal', 'files', 'workspace', 'git'],
		transport: new ServerPortTransport(
			new ServerScopedMessagePort(channel.port2, serverId),
		),
	});
	t.after(async () => {
		await protocol.close().catch(() => undefined);
		channel.port1.close();
		channel.port2.close();
		await authority.shutdown();
	});
	await authority.initializeWorkspace();
	await protocol.connect();
	const facade = new TerminayClientFacade(protocol);
	const workspace = new WorkspaceClient(protocol);
	const viewId = (await workspace.snapshot()).viewOrder[0];
	return {
		authority,
		pty,
		facade,
		workspace,
		createProject: (projectId, root) =>
			workspace.createProject({ projectId, viewId, root }),
	};
}

const linkedFolders = (authority, projectId) =>
	(authority.workspace.state.projects[projectId]?.folderIds ?? [])
		.map((folderId) => authority.workspace.state.folders[folderId])
		.filter((folder) => folder.kind === 'linked');

/** Wait for something the server does on its own, after an event. */
async function eventually(read, description, timeoutMs = 15_000) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = await read();
		if (value !== undefined && value !== false && value !== null) return value;
		if (Date.now() > deadline)
			assert.fail(`timed out waiting for ${description}`);
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

const folderFor = (authority, projectId, path) =>
	eventually(
		() =>
			linkedFolders(authority, projectId).find(
				(folder) => folder.worktree.path === path,
			),
		`a folder linked to ${path}`,
	);

const listedNames = async (facade, payload) =>
	(await facade.query('files.list', { path: '.', ...payload })).entries
		.map((entry) => entry.name)
		.sort();

test('a bound project gets one linked folder per worktree, and loses it when the worktree goes', async (t) => {
	const repo = await repository(t);
	const existing = await repo.addWorktree('existing');
	const { authority, createProject } = await embeddedServer(
		t,
		'folders-reconcile',
	);
	await createProject('repo', repo.root);

	// Binding the project reconciles it: the worktree that was already there.
	const first = await folderFor(authority, 'repo', existing);
	assert.equal(first.projectId, 'repo');
	assert.equal(first.name, 'existing');
	assert.equal(linkedFolders(authority, 'repo').length, 1);

	// A worktree added behind Terminay's back arrives through the Git
	// service's own registry watch.
	const later = await repo.addWorktree('later');
	await folderFor(authority, 'repo', later);
	assert.equal(linkedFolders(authority, 'repo').length, 2);

	// Let the passes asked for so far finish, so that only the Git service
	// reporting the removal can be what removes the folder.
	await authority.folders.reconciler.reconcile('repo');
	await new Promise((resolve) => setTimeout(resolve, 500));
	await git(repo.root, 'worktree', 'remove', '--force', later);
	await eventually(
		() => linkedFolders(authority, 'repo').length === 1,
		'the removed worktree to lose its folder',
	);
	assert.deepEqual(
		linkedFolders(authority, 'repo').map((folder) => folder.worktree.path),
		[existing],
	);
});

test('a project outside any repository keeps only its General folder', async (t) => {
	const root = await realpath(
		await mkdtemp(join(tmpdir(), 'terminay-desktop-folders-plain-')),
	);
	t.after(() => rm(root, { recursive: true, force: true }));
	const { authority, createProject } = await embeddedServer(
		t,
		'folders-no-repository',
	);
	await createProject('plain', root);
	await authority.folders.reconciler.reconcile('plain');
	assert.equal(authority.workspace.state.projects.plain.folderIds.length, 1);
});

test('a folder is revealed by id: General and a plain folder outside a repository, and a linked folder at its worktree', async (t) => {
	const plainRoot = await realpath(
		await mkdtemp(join(tmpdir(), 'terminay-desktop-folders-reveal-')),
	);
	t.after(() => rm(plainRoot, { recursive: true, force: true }));
	const repo = await repository(t);
	const feature = await repo.addWorktree('feature');
	const revealed = [];
	const { authority, facade, workspace, createProject } = await embeddedServer(
		t,
		'folders-reveal',
		{ revealPathOnHost: (path) => void revealed.push(path) },
	);
	await createProject('notes', plainRoot);
	await createProject('repo', repo.root);
	const general = (projectId) =>
		authority.workspace.state.projects[projectId].folderIds[0];

	// The listing tells a client at the host that it may ask, repository or not.
	assert.equal(
		(await facade.query('git.worktrees.list', { projectId: 'notes' }))
			.folderRevealAvailable,
		true,
	);

	await workspace.createFolder({ projectId: 'notes', name: 'Servers' });
	const plain = authority.workspace.state.projects.notes.folderIds
		.map((folderId) => authority.workspace.state.folders[folderId])
		.find((folder) => folder.kind === 'plain');
	const linked = await folderFor(authority, 'repo', feature);
	const reveal = (projectId, folderId, extra = {}) =>
		facade.command('git.folder.reveal', { projectId, folderId, ...extra });

	assert.deepEqual(await reveal('notes', general('notes')), { revealed: true });
	assert.deepEqual(await reveal('notes', plain.id), { revealed: true });
	assert.deepEqual(await reveal('repo', general('repo')), { revealed: true });
	// A path sent with the request decides nothing.
	assert.deepEqual(await reveal('repo', linked.id, { path: '/etc' }), {
		revealed: true,
	});
	assert.deepEqual(revealed, [plainRoot, plainRoot, repo.root, feature]);

	// A folder of another project is refused before anything is shown.
	await assert.rejects(reveal('notes', linked.id));
	await assert.rejects(reveal('repo', 'no-such-folder'));
	assert.equal(revealed.length, 4);
});

test('file operations naming a folder run in that folder’s worktree', async (t) => {
	const repo = await repository(t);
	const worktree = await repo.addWorktree('feature');
	await writeFile(join(worktree, 'feature.ts'), 'export const feature = 1;\n');
	const { authority, facade, createProject } = await embeddedServer(
		t,
		'folders-files',
	);
	await createProject('repo', repo.root);
	const folder = await folderFor(authority, 'repo', worktree);
	const general = authority.workspace.state.projects.repo.folderIds[0];
	const inFolder = { projectId: 'repo', folderId: folder.id };

	// Catalog.
	assert.deepEqual(await listedNames(facade, inFolder), [
		'README.md',
		'feature.ts',
	]);
	assert.deepEqual(await listedNames(facade, { projectId: 'repo' }), [
		'README.md',
	]);
	// General is the project's own context, not a second set of services.
	assert.deepEqual(
		await listedNames(facade, { projectId: 'repo', folderId: general }),
		['README.md'],
	);
	assert.equal(authority.folders.catalog.size, 1);
	assert.equal(
		await authority.folders.catalog.resolve('repo', general),
		authority.fileCatalogProjects.get('repo'),
	);

	// Content.
	const range = { path: 'feature.ts', offset: 0, length: 1024 };
	const text = await facade.query('files.content-text', {
		...inFolder,
		...range,
	});
	assert.equal(text.text, 'export const feature = 1;\n');
	await assert.rejects(
		facade.query('files.content-text', { projectId: 'repo', ...range }),
	);

	// Editing sessions.
	const opened = await facade.query('files.open', {
		...inFolder,
		path: 'feature.ts',
	});
	assert.equal(opened.folderId, folder.id);
	await assert.rejects(
		facade.query('files.open', { projectId: 'repo', path: 'feature.ts' }),
	);

	// Observation: a watch on the folder sees a change in the worktree.
	const watch = await facade.command('files.watch.start', {
		...inFolder,
		resource: '',
	});
	assert.equal(watch.folderId, folder.id);
	await writeFile(join(worktree, 'watched.ts'), 'export {};\n');
	const events = await eventually(async () => {
		const read = await facade.query('files.watch.read', {
			subscriptionId: watch.subscriptionId,
		});
		return read.events.length > 0 ? read.events : undefined;
	}, 'a watch event from the worktree');
	assert.equal(events[0].folderId, folder.id);
	await facade.command('files.watch.stop', {
		subscriptionId: watch.subscriptionId,
	});

	// A folder of another project, or one that does not exist, is refused.
	await assert.rejects(
		listedNames(facade, { projectId: 'repo', folderId: 'folder:missing' }),
	);
});

test('a diff and a revision check naming a folder read that folder’s worktree', async (t) => {
	const repo = await repository(t);
	const worktree = await repo.addWorktree('feature');
	// The same tracked file, changed only in the worktree.
	await writeFile(join(worktree, 'README.md'), '# Changed in the worktree\n');
	const { authority, facade, createProject } = await embeddedServer(
		t,
		'folders-diff',
	);
	await createProject('repo', repo.root);
	const folder = await folderFor(authority, 'repo', worktree);
	const inFolder = { projectId: 'repo', folderId: folder.id };
	/** The diff answer is JSON carried in the response body. */
	const diffOf = async (payload) => {
		const answer = await facade.queryWithBody('file.get-git-diff', payload);
		const body = answer?.body ?? answer?.bytes;
		return body === undefined
			? answer
			: JSON.parse(new TextDecoder().decode(body));
	};

	const inWorktree = await diffOf({ ...inFolder, path: 'README.md' });
	assert.equal(inWorktree.hasDiff, true);
	assert.equal(inWorktree.repoRoot, worktree);
	assert.equal(inWorktree.path, join(worktree, 'README.md'));
	// Without the folder the same relative path is the main checkout's file,
	// which has not changed.
	const inProject = await diffOf({ projectId: 'repo', path: 'README.md' });
	assert.equal(inProject.hasDiff, false);
	assert.equal(inProject.repoRoot, repo.root);

	const folderRevision = await facade.query('file.mutation-revision', {
		...inFolder,
		path: 'README.md',
	});
	const projectRevision = await facade.query('file.mutation-revision', {
		projectId: 'repo',
		path: 'README.md',
	});
	assert.notEqual(folderRevision.ino, projectRevision.ino);
	assert.equal(folderRevision.size, '# Changed in the worktree\n'.length);

	// A path outside the folder's worktree, and an unknown folder, are refused.
	await assert.rejects(
		diffOf({ ...inFolder, path: join(repo.root, 'README.md') }),
	);
	await assert.rejects(
		facade.query('file.mutation-revision', {
			projectId: 'repo',
			folderId: 'folder:missing',
			path: 'README.md',
		}),
	);
});

test('folder services are dropped when the folder goes and when the project is closed', async (t) => {
	const repo = await repository(t);
	const kept = await repo.addWorktree('kept');
	const dropped = await repo.addWorktree('dropped');
	const { authority, facade, workspace, createProject } = await embeddedServer(
		t,
		'folders-release',
	);
	await createProject('repo', repo.root);
	const keptFolder = await folderFor(authority, 'repo', kept);
	const droppedFolder = await folderFor(authority, 'repo', dropped);
	for (const folder of [keptFolder, droppedFolder])
		await listedNames(facade, { projectId: 'repo', folderId: folder.id });
	assert.equal(authority.folders.catalog.size, 2);

	await git(repo.root, 'worktree', 'remove', '--force', dropped);
	await eventually(
		() => authority.workspace.state.folders[droppedFolder.id] === undefined,
		'the removed worktree to lose its folder',
	);
	// The workspace change that deleted the folder pruned its services.
	assert.equal(authority.folders.catalog.size, 1);
	await assert.rejects(
		listedNames(facade, { projectId: 'repo', folderId: droppedFolder.id }),
	);

	await workspace.closeProject('repo');
	for (const cache of ['catalog', 'content', 'session', 'observation'])
		assert.equal(
			authority.folders[cache].size,
			0,
			`${cache} still holds a folder`,
		);
});

test('a worktree renamed through Terminay keeps its folder', async (t) => {
	const repo = await repository(t);
	const before = await repo.addWorktree('before');
	const server = await embeddedServer(t, 'folders-move');
	const { authority, createProject } = server;
	await createProject('repo', repo.root);
	const folder = await folderFor(authority, 'repo', before);

	const listing = await authority.git.worktrees('repo');
	const worktree = listing.worktrees.find(
		(candidate) => candidate.path === before,
	);
	const moved = await server.facade.command('git.worktree.move', {
		projectId: 'repo',
		repositoryId: worktree.repositoryId,
		worktreeId: worktree.id,
		name: 'after',
	});
	assert.equal(moved.applied, true);
	const after = join(repo.base, 'after');

	// The same folder, pointing at the new path, both right away and once the
	// passes the move held back have run.
	assert.equal(
		authority.workspace.state.folders[folder.id]?.worktree.path,
		after,
	);
	await authority.folders.reconciler.reconcile('repo');
	assert.deepEqual(
		linkedFolders(authority, 'repo').map((candidate) => [
			candidate.id,
			candidate.worktree.path,
		]),
		[[folder.id, after]],
	);
});

test('a terminal created in a folder starts in its worktree and its panel joins the folder', async (t) => {
	const repo = await repository(t);
	const worktree = await repo.addWorktree('agent');
	const { authority, pty, createProject } = await embeddedServer(
		t,
		'folders-terminal',
		{ shellProfiles: systemShellProfiles() },
	);
	await createProject('repo', repo.root);
	const folder = await folderFor(authority, 'repo', worktree);
	const panelOf = (session) =>
		Object.values(authority.workspace.state.panels).find(
			(panel) => panel.sessionId === session.id,
		);

	const inFolder = await authority.create({
		projectId: 'repo',
		folderId: folder.id,
		cols: 80,
		rows: 24,
	});
	assert.equal(pty.processes.at(-1).options.cwd, worktree);
	assert.equal(panelOf(inFolder).folderId, folder.id);

	// What an MCP open or split passes: the calling terminal's panel and the
	// folder that panel is in.
	const beside = await authority.create({
		projectId: 'repo',
		activePanelId: panelOf(inFolder).id,
		folderId: panelOf(inFolder).folderId,
		cols: 80,
		rows: 24,
	});
	assert.equal(pty.processes.at(-1).options.cwd, worktree);
	assert.equal(panelOf(beside).folderId, folder.id);

	// Without a folder a terminal is created in General, at the project root.
	const general = await authority.create({
		projectId: 'repo',
		cols: 80,
		rows: 24,
	});
	assert.equal(pty.processes.at(-1).options.cwd, repo.root);
	assert.equal(
		panelOf(general).folderId,
		authority.workspace.state.projects.repo.folderIds[0],
	);

	await assert.rejects(
		authority.create({
			projectId: 'repo',
			folderId: 'folder:missing',
			cols: 80,
			rows: 24,
		}),
	);
});

test('MCP open and split create the terminal in the folder of the terminal they act for', async () => {
	const main = await readFile(
		new URL('../electron/main.ts', import.meta.url),
		'utf8',
	);
	assert.match(
		main,
		/openTerminal: async[\s\S]*?const callerPanel =\s*projectId === context\.projectId\s*\? mcpPanelFor\(context\.terminalSessionId, context\.projectId\)\s*: undefined;[\s\S]*?createServerOwnedTerminalSession\(\s*projectId,\s*params\.cwd,\s*undefined,\s*callerPanel\?\.id,\s*callerPanel\?\.folderId,\s*\)/u,
	);
	assert.match(
		main,
		/splitTerminal: async[\s\S]*?const targetPanel = mcpPanelFor\(target\.id, target\.projectId\);[\s\S]*?createServerOwnedTerminalSession\(\s*target\.projectId,\s*undefined,\s*undefined,\s*targetPanel\?\.id,\s*targetPanel\?\.folderId,\s*\)/u,
	);
	assert.match(
		main,
		/async function createServerOwnedTerminalSession\([\s\S]*?folderId\?: string,[\s\S]*?\.\.\.\(folderId === undefined \? \{\} : \{ folderId \}\),/u,
	);
});

test('the folder wiring adds no timer and no filesystem watcher of its own', async () => {
	const source = await readFile(
		new URL('../electron/serverFolders.ts', import.meta.url),
		'utf8',
	);
	assert.doesNotMatch(source, /setInterval|setTimeout|\bwatch\w*\(/u);
});

async function importAuthority() {
	const cacheRoot = join(process.cwd(), 'node_modules', '.cache');
	await mkdir(cacheRoot, { recursive: true });
	const directory = await mkdtemp(
		join(cacheRoot, 'terminay-server-terminal-authority-folders-'),
	);
	const outputPath = join(directory, 'authority.mjs');
	try {
		await build({
			absWorkingDir: process.cwd(),
			bundle: true,
			// Keep package dependencies external: several are CommonJS and must be
			// loaded through Node's ESM-to-CommonJS bridge rather than esbuild's
			// generated dynamic-require shim. Local TypeScript stays bundled.
			format: 'esm',
			packages: 'external',
			outfile: outputPath,
			platform: 'node',
			stdin: {
				contents: [
					`export { ServerTerminalAuthority } from ${JSON.stringify(new URL('../electron/serverTerminalAuthority.ts', import.meta.url).pathname)}`,
					`export { TerminalService } from ${JSON.stringify(new URL('../packages/server-core/src/terminalService/service.ts', import.meta.url).pathname)}`,
					`export { ServerPortTransport, ServerScopedMessagePort } from ${JSON.stringify(new URL('../src/shared/serverPortTransport.ts', import.meta.url).pathname)}`,
				].join('\n'),
				loader: 'ts',
				resolveDir: process.cwd(),
			},
			target: 'node24',
		});
		return await import(outputPath);
	} finally {
		// The module remains loaded after import; the generated file is no longer
		// needed and must not become a worktree artifact.
		await rm(directory, { recursive: true, force: true });
	}
}
