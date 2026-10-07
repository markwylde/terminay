import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [embedded, standalone] = await Promise.all([
	readFile(
		new URL('../electron/serverTerminalAuthority.ts', import.meta.url),
		'utf8',
	),
	readFile(
		new URL('../apps/terminay-server/src/cli.ts', import.meta.url),
		'utf8',
	),
]);

test('embedded and standalone servers apply AI metadata through one authority', () => {
	for (const [name, source] of [
		['embedded', embedded],
		['standalone', standalone],
	]) {
		assert.match(
			source,
			/createWorkspaceAiTargetAuthority\(\{/u,
			`${name} server uses the shared authority`,
		);
		// A host-local target resolver is how the two servers drifted apart:
		// neither may report a fixed revision or an always-empty note again.
		assert.doesNotMatch(source, /metadataRevision:\s*0/u, name);
		assert.doesNotMatch(source, /note:\s*''/u, name);
	}
	assert.doesNotMatch(embedded, /generateAiMetadata\(\s*request: CommandRequest/u);
	assert.doesNotMatch(standalone, /function standaloneAiTarget/u);
});
