import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentationClient } from '../dist/index.js';

function validBody() {
	return new TextEncoder().encode(
		JSON.stringify({
			folders: [{ kind: 'folder', relativePath: 'docs', title: 'Docs' }],
			documents: [
				{
					kind: 'document',
					relativePath: 'docs/guide.mdx',
					extension: 'mdx',
					title: 'Guide',
					titleSource: 'frontmatter',
				},
			],
		}),
	);
}

function validMetadata(extra = {}) {
	return {
		revision: 'r1',
		scannedEntries: 2,
		scannedFiles: 1,
		partial: false,
		observationCapability: 'watching',
		...extra,
	};
}

test('DocumentationClient validates and decodes a bounded binary document catalog', async () => {
	const calls = [];
	const client = new DocumentationClient({
		async query() {
			throw new Error('json query is not used');
		},
		async command() {
			throw new Error('command is not used');
		},
		async queryWithBody(operation, payload, options) {
			calls.push({ operation, payload, options });
			return { result: validMetadata(), body: validBody() };
		},
	});
	const catalog = await client.catalog('project-a');
	assert.equal(catalog.documents[0].title, 'Guide');
	assert.equal(catalog.observationCapability, 'watching');
	assert.deepEqual(calls[0].operation, 'docs.catalog');
	assert.deepEqual(calls[0].payload, { projectId: 'project-a' });
});

test('DocumentationClient forwards cancellation and pagination', async () => {
	const abort = new AbortController();
	const client = new DocumentationClient({
		async query() {},
		async command() {},
		async queryWithBody(_operation, payload, options) {
			assert.equal(payload.cursor, 'docs/guide.mdx');
			assert.equal(payload.knownRevision, 'r1');
			assert.equal(options.signal, abort.signal);
			return {
				result: validMetadata({ partial: true, partialReason: 'file_limit', nextCursor: 'docs/next.md' }),
				body: validBody(),
			};
		},
	});
	const catalog = await client.catalog(
		'project-a',
		{ knownRevision: 'r1', cursor: 'docs/guide.mdx' },
		{ signal: abort.signal },
	);
	assert.equal(catalog.nextCursor, 'docs/next.md');
	assert.equal(catalog.partial, true);
	abort.abort();
	await assert.rejects(() => client.catalog('project-a', {}, { signal: abort.signal }), /aborted/i);
});

test('DocumentationClient rejects invalid metadata and body', async () => {
	const client = new DocumentationClient({
		async query() {},
		async command() {},
		async queryWithBody() {
			return { result: validMetadata({ observationCapability: 'nope' }), body: validBody() };
		},
	});
	await assert.rejects(() => client.catalog('project-a'), /observation capability/);
	const truncated = new DocumentationClient({
		async query() {},
		async command() {},
		async queryWithBody() {
			return { result: validMetadata(), body: new TextEncoder().encode('{') };
		},
	});
	await assert.rejects(() => truncated.catalog('project-a'), /body is invalid/);
});
