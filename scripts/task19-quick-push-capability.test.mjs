import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

test('Task 19 Quick Push removes the renderer-global compatibility hand-off', async () => {
	const [modal, entry, runtime] = await Promise.all([
		readFile('src/components/QuickPushModal.tsx', 'utf8'),
		readFile('src/rendererApp.tsx', 'utf8'),
		readFile('src/rendererRuntime.tsx', 'utf8'),
	]);
	assert.doesNotMatch(modal, /window\.terminay(?:\b|\s*\?)/u);
	assert.match(modal, /client\s*\.\s*generateQuickPushPlan/u);
	assert.match(modal, /client\s*\.\s*applyQuickPush/u);
	assert.doesNotMatch(entry, /QuickPush/u);
	assert.match(runtime, /quickPushClient:\s*window\.terminayQuickPushHost/u);
});

test('Task 19 Quick Push retains only its named two-operation preload host', async () => {
	const [preload, declarations] = await Promise.all([
		readFile('electron/preload.ts', 'utf8'),
		readFile('src/vite-env.d.ts', 'utf8'),
	]);
	assert.match(preload, /exposeInMainWorld\(\s*'terminayQuickPushHost'/u);
	assert.match(declarations, /terminayQuickPushHost:/u);
	assert.doesNotMatch(preload, /terminayQuickPushCompatibilityHost/u);
	assert.doesNotMatch(declarations, /terminayQuickPushCompatibilityHost/u);
	await assert.rejects(
		access('src/services/quickPush/legacyQuickPushCapability.ts'),
		(error) => error?.code === 'ENOENT',
	);
});
