import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const acceptance = await readFile(
	new URL('../e2e/task20-desktop-stream-responsiveness.spec.ts', import.meta.url),
	'utf8',
);
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('Desktop stream responsiveness targets the canonical production app surface', () => {
	assert.match(app, /data-terminay-app-component=/u);
	assert.match(acceptance, /\[data-terminay-app-component\]/u);
	assert.doesNotMatch(acceptance, /responsive-workspace/u);
});
