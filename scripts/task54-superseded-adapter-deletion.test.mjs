import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';

const supersededPaths = [
	'src/services/settings/legacySettingsClient.ts',
	'src/shared/legacyServerConnectionLifecycleCapability.ts',
	'scripts/task19-ai-metadata-compatibility-authority.test.mjs',
	'scripts/task19-file-viewer-capability.test.mjs',
	'scripts/task19-hidden-compatibility-imports.test.mjs',
	'scripts/task19-preload-compatibility-boundary.test.mjs',
	'scripts/task19-renderer-capability-one-shot.test.mjs',
	'scripts/task19-server-connection-lifecycle-capability.test.mjs',
	'scripts/task19-server-frame-capability.test.mjs',
	'scripts/task19-settings-capability-snapshot.test.mjs',
	'scripts/task19-settings-subscription-authority.test.mjs',
];

test('Task 54 physically removes superseded compatibility adapters and preservation tests', async () => {
	for (const file of supersededPaths) {
		await assert.rejects(
			access(file),
			(error) => error?.code === 'ENOENT',
			`${file} must be deleted instead of retained outside the canonical runtime graph`,
		);
	}
});
