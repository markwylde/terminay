import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Task 39 correction keeps sanitizer evidence distinct from executable browser migration', async () => {
	const [correction, task18, task19Audit, task39] = await Promise.all([
		read('specs/decisions/evidence/task39-browser-manager-drift-correction.md'),
		read('specs/tasks_completed/18-connection-menu-and-web-host.md'),
		read('specs/decisions/evidence/task19-20-release-migration-audit.md'),
		read('specs/tasks/39-browser-connection-manager-drift-recovery.md'),
	]);

	assert.match(task18, /Define migration\/redirect/u);
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
		/\.\.\/\.\.\/tasks\/39-browser-connection-manager-drift-recovery\.md/u,
	);
	assert.match(task39, /Preserve the old task files as history/u);
});

test('Task 39 retains explicit executable migration and public evidence gates', async () => {
	const task39 = await read(
		'specs/tasks/39-browser-connection-manager-drift-recovery.md',
	);

	for (const required of [
		'Implement an actual bounded legacy page',
		'consume the handoff once',
		'cleanup only after acknowledgement',
		'Add a migration E2E',
		'Run the public verifier only after deployment',
	])
		assert.match(task39, new RegExp(required, 'u'), required);
});
