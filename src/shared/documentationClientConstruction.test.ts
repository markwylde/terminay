import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('2.2 renderer server client constructs DocumentationClient beside the file viewer', async () => {
	const source = await readFile(new URL('./rendererServerClient.ts', import.meta.url), 'utf8');
	assert.match(source, /const fileViewerClient = new FileViewerClient\(featureTransport\)/);
	assert.match(
		source,
		/const documentationClient = new DocumentationClient\(featureTransport\)/,
	);
	assert.match(source, /documentationClient,/);
	assert.doesNotMatch(source, /window\.terminay\..*docs/);
});
