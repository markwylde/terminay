import assert from 'node:assert/strict';
import test from 'node:test';
import {
	CanonicalProjectPathResolver,
	createOperationDispatcher,
	FileServiceError,
	MDX_RUNTIME_OPERATIONS,
	MdxRuntime,
	ServerMdxRuntimeAdapter,
} from '../dist/index.js';

const encoder = new TextEncoder();

function projectStorage(files, options = {}) {
	const source = new Map(files);
	const directories = new Set(['/project', '/project/docs', '/project/node_modules', '/project/node_modules/react', '/project/node_modules/react-dom']);
	const missing = (path) => Object.assign(new Error(`ENOENT ${path}`), { code: 'ENOENT' });
	const reads = [];
	const storage = {
		realpath(path) {
			if (!source.has(path) && !directories.has(path)) throw missing(path);
			return path;
		},
		stat(path) {
			if (source.has(path)) {
				const value = source.get(path);
				return { isFile: true, size: typeof value === 'string' ? encoder.encode(value).byteLength : value.byteLength };
			}
			if (directories.has(path)) return { isDirectory: true, size: 0 };
			throw missing(path);
		},
		lstat(path) {
			if (!source.has(path) && !directories.has(path)) throw missing(path);
			return { isSymbolicLink: false };
		},
		readDirectory() { return []; },
		readRange(path, offset, length) {
			reads.push(path);
			if (options.forbidden) throw new Error('local filesystem fallback');
			const value = source.get(path);
			if (value === undefined) throw missing(path);
			return (typeof value === 'string' ? encoder.encode(value) : value).slice(offset, offset + length);
		},
	};
	return { storage, reads, resolver: new CanonicalProjectPathResolver('/project', storage) };
}

const reactFiles = {
	'/project/docs/page.mdx': '# Hello',
	'/project/node_modules/react/package.json': '{"main":"index.js"}',
	'/project/node_modules/react/index.js': 'export default { createElement(type, props) { return { type, props } } }',
	'/project/node_modules/react/jsx-runtime.js': 'export const Fragment = Symbol.for("fragment"); export const jsx = (type, props) => ({ type, props }); export const jsxs = jsx;',
	'/project/node_modules/react-dom/client.js': 'export function createRoot() { return { render() {} } }',
};

function runtimeProject(projectId = 'project-a', files = reactFiles, options = {}) {
	const fixture = projectStorage(Object.entries(files), options);
	return {
		context: { projectId, runtime: new MdxRuntime({ projectId, resolver: fixture.resolver, storage: fixture.storage }) },
		reads: fixture.reads,
	};
}

function request(operation, payload, { clientId = 'client-a', claimsProjectId = 'project-a', authScope = 'read' } = {}) {
	return {
		envelope: {
			type: operation === MDX_RUNTIME_OPERATIONS.dispose ? 'command' : 'query',
			queryId: 'query-1',
			commandId: 'command-1',
			operation,
			payload,
		},
		body: new Uint8Array(),
		context: {
			connectionId: 'connection-a',
			clientId,
			authScope,
			claims: claimsProjectId === null ? {} : { projectId: claimsProjectId },
			signal: new AbortController().signal,
		},
	};
}

test('2.1 adapter exposes compile resource and dispose with typed authorization failures', async () => {
	const project = runtimeProject();
	const adapter = new ServerMdxRuntimeAdapter({
		serverId: 'server-a',
		projects: new Map([['project-a', project.context]]),
	});
	const operations = adapter.operations();
	const compiled = await operations.queries[MDX_RUNTIME_OPERATIONS.compile](
		request(MDX_RUNTIME_OPERATIONS.compile, { projectId: 'project-a', path: 'docs/page.mdx' }),
	);
	assert.equal(compiled.result.entryResourceId, 'entry');
	assert.ok(compiled.body.byteLength > 10);
	const resource = await operations.queries[MDX_RUNTIME_OPERATIONS.resource](
		request(MDX_RUNTIME_OPERATIONS.resource, {
			projectId: 'project-a',
			runtimeId: compiled.result.runtimeId,
			resourceId: 'entry',
			offset: 0,
			length: 4,
		}),
	);
	assert.equal(resource.body.byteLength, 4);
	assert.equal(
		operations.commands[MDX_RUNTIME_OPERATIONS.dispose](
			request(MDX_RUNTIME_OPERATIONS.dispose, { projectId: 'project-a', runtimeId: compiled.result.runtimeId }),
		),
		null,
	);
});

test('2.2 payload projectId alone grants nothing', async () => {
	const project = runtimeProject();
	const adapter = new ServerMdxRuntimeAdapter({
		serverId: 'server-a',
		projects: new Map([['project-a', project.context]]),
	});
	await assert.rejects(
		() => adapter.operations().queries[MDX_RUNTIME_OPERATIONS.compile](
			request(MDX_RUNTIME_OPERATIONS.compile, { projectId: 'project-a', path: 'docs/page.mdx' }, { claimsProjectId: null }),
		),
		(error) => error instanceof FileServiceError && error.code === 'path_escape',
	);
	await assert.rejects(
		() => adapter.operations().queries[MDX_RUNTIME_OPERATIONS.compile](
			request(MDX_RUNTIME_OPERATIONS.compile, { projectId: 'project-a', path: 'docs/page.mdx' }, { claimsProjectId: 'project-b' }),
		),
		(error) => error instanceof FileServiceError && error.code === 'path_escape',
	);
});

test('2.3 remote adapter uses supplied storage and never the host filesystem', async () => {
	const remote = runtimeProject('project-a', reactFiles);
	const local = runtimeProject('project-a', reactFiles, { forbidden: true });
	const remoteAdapter = new ServerMdxRuntimeAdapter({
		serverId: 'remote-runtime',
		projects: new Map([['project-a', remote.context]]),
	});
	const compiled = await remoteAdapter.operations().queries[MDX_RUNTIME_OPERATIONS.compile](
		request(MDX_RUNTIME_OPERATIONS.compile, { projectId: 'project-a', path: 'docs/page.mdx' }),
	);
	assert.ok(remote.reads.some((path) => path.endsWith('page.mdx')));
	assert.equal(local.reads.length, 0);
	assert.ok(compiled.body.byteLength > 10);
});

test('2.6 dispose client project replacement explicit close and shutdown', async () => {
	const project = runtimeProject();
	const adapter = new ServerMdxRuntimeAdapter({
		serverId: 'server-a',
		projects: new Map([['project-a', project.context]]),
	});
	const operations = adapter.operations();
	const compiled = await operations.queries[MDX_RUNTIME_OPERATIONS.compile](
		request(MDX_RUNTIME_OPERATIONS.compile, { projectId: 'project-a', path: 'docs/page.mdx' }),
	);
	adapter.closeClient('client-a');
	await assert.rejects(
		() => operations.queries[MDX_RUNTIME_OPERATIONS.resource](
			request(MDX_RUNTIME_OPERATIONS.resource, {
				projectId: 'project-a',
				runtimeId: compiled.result.runtimeId,
				resourceId: 'entry',
				offset: 0,
				length: 1,
			}),
		),
		(error) => error instanceof FileServiceError,
	);
	const again = await operations.queries[MDX_RUNTIME_OPERATIONS.compile](
		request(MDX_RUNTIME_OPERATIONS.compile, { projectId: 'project-a', path: 'docs/page.mdx' }),
	);
	adapter.disposeProject('project-a');
	await assert.rejects(
		() => operations.queries[MDX_RUNTIME_OPERATIONS.resource](
			request(MDX_RUNTIME_OPERATIONS.resource, {
				projectId: 'project-a',
				runtimeId: again.result.runtimeId,
				resourceId: 'entry',
				offset: 0,
				length: 1,
			}),
		),
		(error) => error instanceof FileServiceError,
	);
	const third = await operations.queries[MDX_RUNTIME_OPERATIONS.compile](
		request(MDX_RUNTIME_OPERATIONS.compile, { projectId: 'project-a', path: 'docs/page.mdx' }),
	);
	operations.commands[MDX_RUNTIME_OPERATIONS.dispose](
		request(MDX_RUNTIME_OPERATIONS.dispose, { projectId: 'project-a', runtimeId: third.result.runtimeId }),
	);
	adapter.disposeAll();
});

test('2.7 dispatcher compiles streams a resource and rejects mismatched identity', async () => {
	const project = runtimeProject();
	const adapter = new ServerMdxRuntimeAdapter({
		serverId: 'server-a',
		projects: new Map([['project-a', project.context]]),
	});
	const dispatcher = createOperationDispatcher(adapter.operations());
	const compiled = await dispatcher.query(request(MDX_RUNTIME_OPERATIONS.compile, { projectId: 'project-a', path: 'docs/page.mdx' }));
	assert.equal(compiled.envelope.ok, true);
	assert.ok(compiled.body.byteLength > 10);
	const resource = await dispatcher.query(request(MDX_RUNTIME_OPERATIONS.resource, {
		projectId: 'project-a',
		runtimeId: compiled.envelope.result.runtimeId,
		resourceId: 'entry',
		offset: 0,
		length: compiled.body.byteLength,
	}));
	assert.equal(resource.envelope.ok, true);
	assert.deepEqual([...resource.body], [...compiled.body]);
	const mismatchedClient = await dispatcher.query({
		...request(MDX_RUNTIME_OPERATIONS.resource, {
			projectId: 'project-a',
			runtimeId: compiled.envelope.result.runtimeId,
			resourceId: 'entry',
			offset: 0,
			length: 1,
		}, { clientId: 'other-client' }),
	});
	assert.equal(mismatchedClient.envelope.ok, false);
	const pathResource = await dispatcher.query(request(MDX_RUNTIME_OPERATIONS.resource, {
		projectId: 'project-a',
		runtimeId: compiled.envelope.result.runtimeId,
		resourceId: '../secret.txt',
		offset: 0,
		length: 1,
	}));
	assert.equal(pathResource.envelope.ok, false);
	const mismatchedProject = await dispatcher.query(request(MDX_RUNTIME_OPERATIONS.compile, {
		projectId: 'project-a',
		path: 'docs/page.mdx',
	}, { claimsProjectId: 'project-b' }));
	assert.equal(mismatchedProject.envelope.ok, false);
});
