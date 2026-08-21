import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentationClient } from '../dist/index.js';

test('DocumentationClient validates and decodes a bounded binary document catalog', async () => {
	const calls = [];
	const client = new DocumentationClient({ async queryWithBody(operation, payload) { calls.push({ operation, payload }); return { result: { revision: 'r1', scannedEntries: 2, scannedFiles: 1, partial: false }, body: new TextEncoder().encode(JSON.stringify({ folders: [{ kind: 'folder', relativePath: 'docs', title: 'docs' }], documents: [{ kind: 'document', relativePath: 'docs/guide.mdx', extension: 'mdx', title: 'Guide', titleSource: 'frontmatter' }] })) }; } });
	const catalog = await client.catalog('project-a');
	assert.equal(catalog.documents[0].title, 'Guide');
	assert.deepEqual(calls, [{ operation: 'docs.catalog', payload: { projectId: 'project-a' } }]);
});
