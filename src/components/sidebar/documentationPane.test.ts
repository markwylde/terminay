import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { sidebarGroupForPanel } from './sidebarGroups.ts';

test('Documentation pane is registered in the sidebar group map', () => {
	assert.equal(sidebarGroupForPanel('documentation'), 'documentation');
});

test('workspace sidebar chrome exposes Documentation refresh and count', async () => {
	const source = await readFile(new URL('../../App.tsx', import.meta.url), 'utf8');
	assert.match(source, /id: 'documentation'/);
	assert.match(source, /title: 'Documentation'/);
	assert.match(source, /aria-label="Reload documentation"/);
	assert.match(source, /count: documentation\.catalog\?\.documents\.length/);
	assert.match(source, /expandedDocumentationFolderIds/);
});
