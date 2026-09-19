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

test('Documentation indexing is latched per project, not gated on pane collapse', async () => {
	const source = await readFile(new URL('../../App.tsx', import.meta.url), 'utf8');
	assert.match(source, /enabled: isDocumentationIndexingStarted/);
	assert.doesNotMatch(source, /enabled: !project\.isDocumentationPaneCollapsed/);
	assert.match(
		source,
		/isDocumentationGroupVisible =\s*\n?\s*project\.isFileExplorerOpen && activeSidebarGroup === 'documentation'/,
	);
	assert.match(source, /shouldAutoExpandDocumentationPane\(/);
	assert.match(source, /isDocumentationPaneCollapsed: false/);
});

test('the Documentation header trades refresh for a spinner and a stop button while indexing', async () => {
	const source = await readFile(new URL('../../App.tsx', import.meta.url), 'utf8');
	assert.match(source, /actions: documentation\.loading \? \(/);
	assert.match(source, /className="sidebar-pane__action-spinner"/);
	assert.match(source, /aria-label="Indexing documentation"/);
	assert.match(source, /aria-label="Stop indexing documentation"/);
	assert.match(source, /onClick=\{documentation\.stop\}/);
});

test('the spinner box matches the action button so the header does not reflow', async () => {
	const stylesheet = await readFile(
		new URL('./sidebar.css', import.meta.url),
		'utf8',
	);
	assert.match(stylesheet, /\.sidebar-pane__action-spinner \{/);
	assert.match(stylesheet, /@keyframes sidebar-pane-spin/);
	const spinner = stylesheet.slice(
		stylesheet.indexOf('.sidebar-pane__action-spinner {'),
	);
	assert.match(spinner.slice(0, spinner.indexOf('}')), /width: 22px/);
	assert.match(spinner.slice(0, spinner.indexOf('}')), /height: 22px/);
});
