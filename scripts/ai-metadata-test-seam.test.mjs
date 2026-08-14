import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [preload, main, journey] = await Promise.all([
	readFile(new URL('../electron/serverUiPreload.ts', import.meta.url), 'utf8'),
	readFile(new URL('../electron/main.ts', import.meta.url), 'utf8'),
	readFile(new URL('../e2e/ai-tab-metadata.spec.ts', import.meta.url), 'utf8'),
]);

test('AI metadata fixtures use one production-inert server-bound seam', () => {
	assert.match(preload, /process\.env\.TERMINAY_TEST === '1'/u);
	assert.match(preload, /'terminayAiMetadataTest'/u);
	assert.match(preload, /'test:set-ai-tab-metadata-mock'/u);
	assert.match(
		main,
		/'test:set-ai-tab-metadata-mock',[\s\S]*?assertBoundServerUiEvent\(event\)/u,
	);
	assert.match(journey, /window\.terminayAiMetadataTest\.setMock/u);
	assert.doesNotMatch(journey, /terminayTest\.setAiTabMetadataMock/u);
});
