import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Task 39 correction keeps sanitizer evidence distinct from executable browser migration', async () => {
	const [correction, task18, task19Audit, task39] = await Promise.all([
		read('openspec/adr/evidence/task39-browser-manager-drift-correction.md'),
		read('openspec/changes/archive/2026-08-01-connection-menu-and-web-host/tasks.md'),
		read('openspec/adr/evidence/task19-20-release-migration-audit.md'),
		read('openspec/changes/archive/2026-08-09-browser-connection-manager-drift-recovery/tasks.md'),
	]);

	assert.match(task18, /Define migration and redirect/u);
	assert.match(task19Audit, /sanitized manager metadata/u);
	assert.match(correction, /data-contract\/design milestone/u);
	assert.match(correction, /no evidence for:/u);
	assert.match(correction, /acknowledgement-gated cleanup/u);
	assert.match(
		correction,
		/must not be described as an executed browser-origin\s+migration/u,
	);
	assert.match(
		correction,
		/\.\.\/\.\.\/changes\/archive\/2026-08-09-browser-connection-manager-drift-recovery\//u,
	);
	assert.match(task39, /preserving the old task files as history/u);
});

test('Task 39 retains explicit executable migration and public evidence gates', async () => {
	const task39 = await read(
		'openspec/changes/archive/2026-08-09-browser-connection-manager-drift-recovery/tasks.md',
	);

	for (const required of [
		'Implement a bounded legacy page',
		'Consume the handoff once',
		'cleanup only after acknowledgement',
		'Add a migration end-to-end test',
		'Extend the verifier to identify the expected release revision or image',
	])
		assert.match(task39, new RegExp(required, 'u'), required);
});
