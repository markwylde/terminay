import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	FileViewerClient,
	TerminayClient,
	TerminayClientFacade,
	TerminayGitClient,
	WebSocketByteTransport,
} from '@terminay/client-core';
import { WebSocket } from 'ws';

// A restored project's files stay reachable after the server restarts: the
// standalone server binds every restored project's root before the restore,
// as creating the project did (server-owned-workspace-state, "Restoring a
// non-empty repository"). Each test restarts the server on one data root;
// whether a session holder is used is the CLI's own choice, and nothing here
// depends on it.

async function startServer(root) {
	const child = spawn(
		process.execPath,
		[
			'dist/cli.js',
			'start',
			'--server-id',
			'restored-files-test',
			'--data-root',
			join(root, 'data'),
			'--project-root',
			join(root, 'default'),
			'--http-host',
			'127.0.0.1',
			'--http-port',
			'0',
			'--remote-origin',
			'http://127.0.0.1:9123',
			'--expose',
			'off',
			'--vault-unlock-fd',
			'3',
		],
		{
			cwd: new URL('../', import.meta.url),
			env: { ...process.env, HOME: root, TERMINAY_SERVER_VERSION: 'test' },
			stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
		},
	);
	// The child may close its end once it has read the passphrase.
	child.stdio[3].on('error', () => undefined);
	child.stdio[3].end('test-vault-passphrase\n');
	let stderr = '';
	child.stderr.on('data', (bytes) => (stderr += bytes));
	try {
		const ready = await new Promise((resolve, reject) => {
			let output = '';
			child.stdout.on('data', (bytes) => {
				output += bytes;
				const end = output.indexOf('\n');
				if (end >= 0) {
					try {
						resolve(JSON.parse(output.slice(0, end)));
					} catch (error) {
						reject(error);
					}
				}
			});
			child.once('error', reject);
			child.once('exit', () =>
				reject(new Error(`CLI exited before readiness: ${stderr}`)),
			);
		});
		assert.equal(ready.ready, true);
		const token = new URLSearchParams(
			new URL(ready.pairing.pairingUrl).hash.slice(1),
		).get('pairingToken');
		assert.ok(token);
		const client = new TerminayClient({
			transport: new WebSocketByteTransport({
				origin: ready.protocolEndpoint,
				authToken: token,
				WebSocket,
			}),
			clientId: 'restored-files-test',
			// A project created without a root then awaits its start choice.
			capabilities: ['project-start-choice.v1'],
			reconnect: false,
		});
		await client.connect();
		const facade = new TerminayClientFacade(client);
		return {
			child,
			client,
			facade,
			files: new FileViewerClient(facade),
			git: new TerminayGitClient(facade),
		};
	} catch (error) {
		if (child.exitCode === null) {
			child.kill('SIGTERM');
			await once(child, 'exit');
		}
		throw error;
	}
}

async function stopServer(server) {
	if (server === undefined) return;
	await server.client.close().catch(() => undefined);
	if (server.child.exitCode === null) {
		server.child.kill('SIGTERM');
		await once(server.child, 'exit');
	}
}

async function restart(server, root) {
	await stopServer(server);
	return startServer(root);
}

/** Without a root the server holds the project awaiting its start choice. */
async function createProject(facade, projectId, root) {
	const snapshot = await facade.query('workspace.snapshot');
	const viewId = snapshot.viewOrder[0];
	assert.ok(viewId, 'the workspace has a view');
	await facade.command('workspace.command', {
		command: {
			type: 'project.create',
			projectId,
			viewId,
			...(root === undefined ? {} : { root }),
			name: projectId,
		},
	});
}

function terminalPanelsIn(snapshot, projectId) {
	return Object.values(snapshot.panels ?? {}).filter(
		(panel) => panel.type === 'terminal' && panel.projectId === projectId,
	).length;
}

function names(page) {
	return page.entries.map((entry) => entry.name);
}

test('a restored project keeps its file and Git access after a standalone restart', {
	timeout: 90000,
}, async () => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-restored-files-'));
	let server;
	try {
		await mkdir(join(root, 'default'));
		const projectRoot = join(root, 'kept');
		await mkdir(projectRoot);
		await writeFile(join(projectRoot, 'marker.txt'), 'kept\n');

		server = await startServer(root);
		await createProject(server.facade, 'project-kept', projectRoot);
		assert.ok(
			names(await server.files.listFolder('.', 'project-kept')).includes(
				'marker.txt',
			),
		);

		server = await restart(server, root);
		const snapshot = await server.facade.query('workspace.snapshot');
		assert.ok(snapshot.projects['project-kept'], 'the project is restored');
		assert.ok(
			names(await server.files.listFolder('.', 'project-kept')).includes(
				'marker.txt',
			),
			'the restored project lists its folder',
		);
		const content = await server.files.readContentText(
			'marker.txt',
			0,
			64,
			'project-kept',
		);
		assert.equal(content.text, 'kept\n');
		await server.git.list({ projectId: 'project-kept' });
	} finally {
		await stopServer(server);
		await rm(root, { recursive: true, force: true });
	}
});

test('a restored project whose root is gone stays refused until repaired, without stopping the restart', {
	timeout: 90000,
}, async () => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-restored-missing-'));
	let server;
	try {
		await mkdir(join(root, 'default'));
		const keptRoot = join(root, 'kept');
		const goneRoot = join(root, 'gone');
		const repairedRoot = join(root, 'repaired');
		await mkdir(keptRoot);
		await mkdir(goneRoot);

		server = await startServer(root);
		await createProject(server.facade, 'project-kept', keptRoot);
		await createProject(server.facade, 'project-gone', goneRoot);
		await rm(goneRoot, { recursive: true, force: true });

		server = await restart(server, root);
		const snapshot = await server.facade.query('workspace.snapshot');
		assert.ok(
			snapshot.projects['project-gone'],
			'the project stays represented',
		);
		assert.equal(
			terminalPanelsIn(snapshot, 'project-gone'),
			0,
			'a project with a missing root gets no replacement terminal',
		);
		await assert.rejects(
			server.files.listFolder('.', 'project-gone'),
			'a project with a missing root holds no file authority',
		);
		await server.files.listFolder('.', 'project-kept');

		await mkdir(repairedRoot);
		await writeFile(join(repairedRoot, 'fixed.txt'), 'fixed\n');
		await server.facade.command('project.root.update', {
			projectId: 'project-gone',
			root: repairedRoot,
		});
		assert.ok(
			names(await server.files.listFolder('.', 'project-gone')).includes(
				'fixed.txt',
			),
			'repairing the root restores access',
		);
	} finally {
		await stopServer(server);
		await rm(root, { recursive: true, force: true });
	}
});

test('a restored project awaiting its start choice survives a standalone restart', {
	timeout: 90000,
}, async () => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-restored-start-'));
	let server;
	try {
		await mkdir(join(root, 'default'));
		server = await startServer(root);
		await createProject(server.facade, 'project-waiting');
		assert.equal(
			(await server.facade.query('workspace.snapshot')).projects[
				'project-waiting'
			]?.start,
			'awaiting-choice',
		);

		server = await restart(server, root);
		const project = (await server.facade.query('workspace.snapshot')).projects[
			'project-waiting'
		];
		assert.ok(project, 'the project is restored');
		assert.equal(project.start, 'awaiting-choice');
		assert.equal(project.rootOrigin, 'none');
	} finally {
		await stopServer(server);
		await rm(root, { recursive: true, force: true });
	}
});
