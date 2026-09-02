import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Documentation pane defaults, settings fields, and stored-order append are explicit', async () => {
	const source = await readFile(new URL('./terminalSettings.ts', import.meta.url), 'utf8');
	assert.match(source, /defaultDocumentationState: 'collapsed'/);
	assert.match(source, /defaultDocumentationPaneHeight: 240/);
	assert.match(source, /key: 'sidebar.defaultDocumentationState'/);
	assert.match(source, /key: 'sidebar.defaultDocumentationPaneHeight'/);
	assert.match(
		source,
		/return \[\s*\.\.\.ordered,\s*\.\.\.SIDEBAR_PANEL_IDS.filter\(\(id\) => !ordered.includes\(id\)\),\s*\]/s,
	);
	const model = await readFile(new URL('./workspace/projectTabModel.ts', import.meta.url), 'utf8');
	assert.match(
		model,
		/isDocumentationPaneCollapsed: sidebarDefaults.defaultDocumentationState === 'collapsed'/,
	);
	assert.match(model, /expandedDocumentationFolderIds: \[\]/);
});
