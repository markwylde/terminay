import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeFilePanelParams } from './filePanelParams.ts';

const base = { filePath: 'docs/guide.md', projectRoot: '/project' };

test('a panel saved in the Documentation presentation restores on Document', () => {
	const params = normalizeFilePanelParams({ ...base, presentation: 'documentation' });
	assert.equal(params.initialMode, 'document');
	assert.equal('presentation' in params, false);
});

test('a requested view wins over the retired presentation', () => {
	const params = normalizeFilePanelParams({
		...base,
		initialMode: 'diff',
		presentation: 'documentation',
	});
	assert.equal(params.initialMode, 'diff');
});

test('a panel saved in the file viewer presentation keeps its default view', () => {
	const params = normalizeFilePanelParams({ ...base, presentation: 'file-viewer' });
	assert.equal(params.initialMode, undefined);
	assert.equal('presentation' in params, false);
});

test('current params pass through unchanged', () => {
	const current = { ...base, initialMode: 'text' as const };
	assert.equal(normalizeFilePanelParams(current), current);
});
