import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('2.5 renderer server client constructs MdxRuntimeClient for Desktop and web', async () => {
	const source = await readFile(new URL('./rendererServerClient.ts', import.meta.url), 'utf8');
	assert.match(source, /const mdxRuntimeClient = new MdxRuntimeClient\(featureTransport\)/u);
	assert.match(source, /mdxRuntimeClient,/u);
	assert.match(source, /await mdxRuntimeClient\.disposeAll\(\)/u);
	assert.doesNotMatch(source, /window\.terminay\..*mdx/u);
});
