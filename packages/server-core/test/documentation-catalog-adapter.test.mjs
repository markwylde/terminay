import assert from 'node:assert/strict';
import test from 'node:test';
import {
	CanonicalProjectPathResolver,
	DOCUMENTATION_OPERATIONS,
	DocumentationCatalog,
	FileServiceError,
	ServerDocumentationCatalogAdapter,
} from '../dist/index.js';

function project(id = 'project-a') {
	const storage = {
		realpath(path) {
			return path;
		},
		stat(path) {
			return path === '/project' ? { isDirectory: true } : { isFile: true, size: 7 };
		},
		lstat() {
			return { isSymbolicLink: false };
		},
		readDirectory() {
			return [{ name: 'README.md', isFile: true }];
		},
		readRange() {
			return new TextEncoder().encode('# Hello');
		},
	};
	const resolver = new CanonicalProjectPathResolver('/project', storage);
	return {
		context: { projectId: id, catalog: new DocumentationCatalog(resolver, storage) },
	};
}

function request(projectId, claimsProjectId = projectId, extra = {}) {
	return {
		envelope: {
			type: 'query',
			queryId: 'query-docs',
			operation: DOCUMENTATION_OPERATIONS.catalog,
			payload: { projectId, ...extra },
		},
		body: new Uint8Array(),
		context: {
			connectionId: 'connection-a',
			clientId: 'client-a',
			authScope: 'read',
			claims: { projectId: claimsProjectId },
			signal: new AbortController().signal,
		},
	};
}

test('docs.catalog is registered with authenticated project authorization', async () => {
	const adapter = new ServerDocumentationCatalogAdapter({
		serverId: 'server-a',
		projects: new Map([['project-a', project().context]]),
	});
	const operations = adapter.operations();
	assert.equal(typeof operations.queries[DOCUMENTATION_OPERATIONS.catalog], 'function');
	const response = await operations.queries[DOCUMENTATION_OPERATIONS.catalog](request('project-a'));
	assert.equal(response.result.partial, false);
	assert.equal(typeof response.result.revision, 'string');
	assert.equal(typeof response.result.observationCapability, 'string');
	const body = JSON.parse(new TextDecoder().decode(response.body));
	assert.equal(body.documents[0].relativePath, 'README.md');
});

test('docs.catalog rejects a cross-project request and returns no records', async () => {
	const adapter = new ServerDocumentationCatalogAdapter({
		serverId: 'server-a',
		projects: new Map([
			['project-a', project('project-a').context],
			['project-b', project('project-b').context],
		]),
	});
	const operations = adapter.operations();
	await assert.rejects(
		() => operations.queries[DOCUMENTATION_OPERATIONS.catalog](request('project-b', 'project-a')),
		(error) => error instanceof FileServiceError && error.code === 'path_escape',
	);
});

test('local and extension-backed adapters share the docs.catalog operation name', () => {
	const local = new ServerDocumentationCatalogAdapter({
		serverId: 'local',
		projects: new Map([['project-a', project().context]]),
	});
	const remote = new ServerDocumentationCatalogAdapter({
		serverId: 'remote-runtime',
		projects: new Map([['project-a', project().context]]),
	});
	assert.deepEqual(Object.keys(local.operations().queries), Object.keys(remote.operations().queries));
	assert.deepEqual(Object.keys(local.operations().queries), [DOCUMENTATION_OPERATIONS.catalog]);
});
