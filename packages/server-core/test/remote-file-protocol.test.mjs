import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createInitialProjectEnvironmentState,
	createInitialWorkspace,
	ExtensionProjectEnvironmentRuntime,
	ProjectEnvironmentRegistry,
	ProjectEnvironmentRouter,
	routeProjectOperationRegistries,
} from '../dist/index.js';

function harness() {
	const files = new Map([
		['/home/dev/readme.md', Buffer.from('# Demo\n- [ ] remote task\n')],
		['/home/dev/binary.bin', Buffer.from([0, 255, 7, 9])],
	]);
	const directories = new Set(['/home/dev']);
	const calls = [];
	let unknownWrite = false;
	const metadata = (path) => ({
		path,
		size: files.get(path)?.byteLength ?? 0,
		mode: directories.has(path) ? 0o40700 : 0o100600,
		mtimeMs: 1000,
		atimeMs: 1000,
		type: directories.has(path) ? 'directory' : 'file',
	});
	const service = async (operation, input) => {
		calls.push({ operation, input });
		if (operation === 'resolveRoot') return { root: '/home/dev' };
		if (operation === 'realpath') {
			const path =
				input.path === '.'
					? '/home/dev'
					: input.path.startsWith('/')
						? input.path
						: `/home/dev/${input.path}`;
			if (!files.has(path) && !directories.has(path)) {
				const error = new Error('missing');
				error.code = 'ENOENT';
				throw error;
			}
			return { path };
		}
		if (operation === 'stat') {
			if (!files.has(input.path) && !directories.has(input.path)) {
				const error = new Error('missing');
				error.code = 'ENOENT';
				throw error;
			}
			return metadata(input.path);
		}
		if (operation === 'list')
			return {
				path: input.path,
				entries: [...files.keys()]
					.filter(
						(path) =>
							path.startsWith(`${input.path}/`) &&
							!path.slice(input.path.length + 1).includes('/'),
					)
					.map((path) => ({
						name: path.slice(input.path.length + 1),
						...metadata(path),
					})),
			};
		if (operation === 'read') {
			const value = files.get(input.path);
			if (!value) throw new Error('missing');
			const data = value.subarray(
				input.offset ?? 0,
				(input.offset ?? 0) + (input.length ?? value.length),
			);
			return {
				path: input.path,
				data: data.toString('base64'),
				encoding: 'base64',
				metadata: metadata(input.path),
			};
		}
		if (operation === 'write') {
			if (unknownWrite) {
				const error = new Error('outcome unknown');
				error.code = 'outcome-unknown';
				throw error;
			}
			files.set(input.path, Buffer.from(input.data, 'base64'));
			return {
				outcome: 'written',
				metadata: metadata(input.path),
				atomic: true,
			};
		}
		if (operation === 'createDirectory') {
			directories.add(input.path);
			return { outcome: 'created', path: input.path };
		}
		if (operation === 'rename') {
			const value = files.get(input.path);
			if (value) {
				files.delete(input.path);
				files.set(input.destination, value);
			}
			return { outcome: 'renamed', from: input.path, to: input.destination };
		}
		if (operation === 'remove') {
			files.delete(input.path);
			directories.delete(input.path);
			return { outcome: 'removed', path: input.path };
		}
		throw new Error(`unexpected ${operation}`);
	};
	const environment = {
		id: 'ssh-env',
		providerId: 'com.terminay.ssh/connection',
		pinnedRevision: 4,
		name: 'SSH',
		endpointSummary: 'dev@example',
		declaredCapabilities: ['filesystem'],
		availableCapabilities: ['filesystem'],
		status: 'ready',
		operationReferences: [],
		projectReferenceCount: 1,
		archived: false,
		builtIn: false,
		providerState: {},
	};
	const environmentState = createInitialProjectEnvironmentState('server-a');
	environmentState.environments[environment.id] = environment;
	const workspace = createInitialWorkspace('server-a');
	workspace.projects.default = {
		...workspace.projects.default,
		projectEnvironmentId: environment.id,
		environmentRevision: 4,
	};
	const host = {
		invokeProvider: ({ request }) => service(request.operation, request.input),
	};
	const runtime = new ExtensionProjectEnvironmentRuntime(
		environment.providerId,
		['filesystem'],
		host,
		() => environmentState,
	);
	const registry = new ProjectEnvironmentRegistry();
	registry.register(runtime);
	const router = new ProjectEnvironmentRouter({
		serverId: 'server-a',
		workspaceSnapshot: () => workspace,
		environmentSnapshot: () => environmentState,
		registry,
	});
	let localCalls = 0;
	const operations = [
		'files.list',
		'files.content-range',
		'files.tasks',
		'files.open',
		'files.metadata',
		'files.read-range',
		'files.read-text',
		'files.create',
		'files.create-directory',
		'files.rename',
		'files.delete',
		'files.edit',
		'files.save',
		'files.reload',
		'files.keep-local',
		'files.close',
	];
	const local = async () => {
		localCalls += 1;
		throw new Error('local filesystem fallback');
	};
	const routed = routeProjectOperationRegistries(
		{
			queries: Object.fromEntries(operations.map((name) => [name, local])),
			commands: Object.fromEntries(operations.map((name) => [name, local])),
		},
		router,
	);
	const request = (operation, payload, body = new Uint8Array()) => ({
		envelope: {
			id: 'request',
			operation,
			payload: { projectId: 'default', ...payload },
		},
		body,
		context: {
			connectionId: 'connection',
			clientId: 'client',
			authScope: 'admin',
			signal: new AbortController().signal,
		},
	});
	const query = (operation, payload) =>
		routed.queries.get(operation)(request(operation, payload));
	const command = (operation, payload, body) =>
		routed.commands.get(operation)(request(operation, payload, body));
	return {
		files,
		calls,
		query,
		command,
		localCalls: () => localCalls,
		setUnknownWrite: () => {
			unknownWrite = true;
		},
	};
}

test('fixed file registries map catalog, binary content, folder tasks, and uploads onto SFTP', async () => {
	const app = harness();
	const listing = await app.query('files.list', { path: '.' });
	assert.deepEqual(
		listing.entries.map(({ relativePath }) => relativePath).sort(),
		['binary.bin', 'readme.md'],
	);
	const binary = await app.query('files.content-range', {
		path: 'binary.bin',
		offset: 0,
		length: 4,
	});
	assert.deepEqual([...binary.body], [0, 255, 7, 9]);
	assert.equal(binary.result.bodyLength, 4);
	const tasks = await app.query('files.tasks', { path: '.' });
	assert.match(new TextDecoder().decode(tasks.body), /remote task/u);
	await app.command(
		'files.create',
		{ path: 'upload.bin' },
		Uint8Array.from([8, 0, 9]),
	);
	assert.deepEqual([...app.files.get('/home/dev/upload.bin')], [8, 0, 9]);
	await app.command('files.rename', {
		path: 'upload.bin',
		destination: 'renamed.bin',
	});
	assert.equal(app.files.has('/home/dev/upload.bin'), false);
	assert.deepEqual([...app.files.get('/home/dev/renamed.bin')], [8, 0, 9]);
	const refreshed = await app.query('files.list', { path: '.' });
	assert.ok(
		refreshed.entries.some(
			({ relativePath }) => relativePath === 'renamed.bin',
		),
	);
	await app.command('files.delete', { path: 'renamed.bin' });
	assert.equal(app.files.has('/home/dev/renamed.bin'), false);
	assert.ok(
		app.calls.filter(({ operation }) => operation === 'list').length >= 2,
		'manual refresh performs a fresh SFTP listing',
	);
	assert.equal(app.localCalls(), 0);
});

test('remote sessions retain server-owned drafts and save without host filesystem fallback', async () => {
	const app = harness();
	const opened = await app.query('files.open', { path: 'readme.md' });
	const edited = await app.command(
		'files.edit',
		{
			sessionId: opened.sessionId,
			expectedDraftRevision: opened.metadata.draftRevision,
		},
		new TextEncoder().encode('changed remotely'),
	);
	assert.equal(edited.ok, true);
	assert.match(
		new TextDecoder().decode(app.files.get('/home/dev/readme.md')),
		/remote task/u,
	);
	const saved = await app.command('files.save', {
		sessionId: opened.sessionId,
		expectedDiskRevision: opened.metadata.diskRevision,
		expectedDraftRevision: edited.value.draftRevision,
	});
	assert.equal(saved.ok, true);
	assert.equal(
		new TextDecoder().decode(app.files.get('/home/dev/readme.md')),
		'changed remotely',
	);
	assert.equal(app.localCalls(), 0);
});

test('outcome-unknown remote mutations fail closed and are never retried locally', async () => {
	const app = harness();
	app.setUnknownWrite();
	await assert.rejects(
		() =>
			app.command(
				'files.create',
				{ path: 'maybe.bin' },
				Uint8Array.from([1, 2, 3]),
			),
		(error) =>
			error.code === 'provider-operation-failed' &&
			error.cause?.code === 'outcome-unknown',
	);
	assert.equal(app.localCalls(), 0);
	assert.equal(
		app.calls.filter(({ operation }) => operation === 'write').length,
		1,
	);
});
