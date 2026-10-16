import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The start chooser of a project awaiting its start choice, the server folder
// browser, and the "No root folder" state of the sidebar panes (ADR-0066).

const require = createRequire(import.meta.url);
const testDirectory = await mkdtemp(join(process.cwd(), '.project-start-ui-test-'));

async function bundleComponent(entryPoint, outputName) {
	const outputPath = join(testDirectory, outputName);
	await build({
		entryPoints: [entryPoint],
		outfile: outputPath,
		bundle: true,
		format: 'cjs',
		platform: 'node',
		external: ['react', 'react-dom'],
		jsx: 'automatic',
		loader: { '.css': 'empty' },
		logLevel: 'silent',
	});
	return require(outputPath);
}

const { ProjectStartChooserView } = await bundleComponent(
	'src/workspace/ProjectStartChooser.tsx',
	'project-start-chooser.cjs',
);
const { RootFolderBrowserView } = await bundleComponent(
	'src/workspace/RootFolderBrowser.tsx',
	'root-folder-browser.cjs',
);
const { NoRootFolderState } = await bundleComponent(
	'src/workspace/NoRootFolderState.tsx',
	'no-root-folder-state.cjs',
);
const [app, css] = await Promise.all([
	readFile('src/App.tsx', 'utf8'),
	readFile('src/workspace/projectStart.css', 'utf8'),
]);

test.after(() => rm(testDirectory, { force: true, recursive: true }));

const noop = () => {};

const chooser = (overrides = {}) =>
	renderToStaticMarkup(
		React.createElement(ProjectStartChooserView, {
			projectId: 'project-2',
			projectTitle: 'Project 2',
			projectColor: '#7c5cff',
			isActive: true,
			isCompact: false,
			recent: [
				{ path: '/srv/projects/terminay', name: 'terminay', available: true },
				{ path: '/srv/projects/gone', name: 'gone', available: false },
			],
			recentError: null,
			error: null,
			busy: false,
			onOpenFolder: noop,
			onHome: noop,
			onOpenRecent: noop,
			onForgetRecent: noop,
			...overrides,
		}),
	);

/** Every control the arrow keys and Tab walk, in document order. */
function chooserItems(markup) {
	return [...markup.matchAll(/<button[^>]*data-start-chooser-item=""[^>]*>/gu)].map(
		([tag]) => tag,
	);
}

test('the chooser offers Open a folder, Home directory, and the server recent folders', () => {
	const markup = chooser();
	assert.match(markup, /data-terminay-start-chooser="true"/u);
	assert.match(markup, /data-terminay-project-id="project-2"/u);
	assert.match(markup, /project-workspace--active/u);
	assert.match(markup, /Start Project 2/u);
	assert.match(markup, /data-terminay-start-action="folder"[\s\S]*Open a folder/u);
	assert.match(markup, /data-terminay-start-action="home"[\s\S]*Home directory/u);
	assert.match(markup, /Recent projects/u);
	// Each entry shows its name and full path, and offers Forget.
	assert.match(markup, /data-terminay-recent-folder="\/srv\/projects\/terminay"/u);
	assert.match(markup, />terminay<\/span>/u);
	assert.match(markup, />\/srv\/projects\/terminay<\/span>/u);
	assert.match(markup, /aria-label="Forget terminay"/u);
	// No terminal, panel layout, or sidebar is drawn with it.
	assert.doesNotMatch(markup, /dockview|terminal-panel|file-explorer-sidebar/u);
});

test('an unavailable recent folder is shown, reachable, not openable, and still forgettable', () => {
	const markup = chooser();
	const row = markup.match(
		/<li[^>]*data-terminay-recent-folder="\/srv\/projects\/gone"[\s\S]*?<\/li>/u,
	)?.[0];
	assert.ok(row);
	assert.match(row, /data-available="false"/u);
	assert.match(row, /Unavailable/u);
	assert.match(row, /data-terminay-recent-open="true"/u);
	assert.match(row, /aria-disabled="true"/u);
	assert.doesNotMatch(
		row.match(/<button[^>]*data-terminay-recent-open[^>]*>/u)[0],
		/ disabled=""/u,
		'kept in the focus order',
	);
	const forget = row.match(/<button[^>]*data-terminay-recent-forget[^>]*>/u)[0];
	assert.doesNotMatch(forget, /disabled/u);
});

test('every start and every recent entry with its Forget is in the keyboard order', () => {
	const items = chooserItems(chooser());
	assert.equal(items.length, 6);
	assert.match(items[0], /data-terminay-start-action="folder"/u, 'the first action leads');
	assert.match(items[1], /data-terminay-start-action="home"/u);
	assert.match(items[2], /data-terminay-recent-open/u);
	assert.match(items[3], /data-terminay-recent-forget/u);
	assert.match(items[4], /data-terminay-recent-open/u);
	assert.match(items[5], /data-terminay-recent-forget/u);
	for (const item of items) assert.match(item, /type="button"/u);
});

test('the chooser names its server only when more than one connection is attached', () => {
	assert.doesNotMatch(chooser(), /data-terminay-start-chooser-server/u);
	assert.match(
		chooser({ serverLabel: 'build-box' }),
		/data-terminay-start-chooser-server="true"[^>]*>On build-box</u,
	);
	assert.match(app, /connections\.length > 1\s*\?\s*\{ serverLabel: currentServerLabel \}/u);
});

test('a refused choice is shown inline, and the starts wait while one is being made', () => {
	const refused = chooser({ error: 'That folder does not exist on the server.' });
	assert.match(
		refused,
		/role="alert" data-terminay-start-chooser-error="true">That folder does not exist on the server\./u,
	);
	const busy = chooser({ busy: true });
	assert.match(busy, /aria-busy="true"/u);
	assert.match(busy, /data-terminay-start-action="folder"/u);
	assert.equal(chooserItems(busy).filter((item) => / disabled=""/u.test(item)).length, 4);
});

test('the chooser says when the server has no recent folders, or is still reading them', () => {
	assert.match(chooser({ recent: [] }), /No recent projects yet\./u);
	assert.match(chooser({ recent: null }), /role="status">Loading recent projects/u);
});

test('the compact chooser is one column scrolled vertically alone', () => {
	const markup = chooser({ isCompact: true });
	assert.match(markup, /project-start--compact/u);
	const rule = (selector) =>
		css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\s*\\{([^}]*)\\}`, 'u'))?.[1] ?? '';
	assert.match(rule('.project-start'), /overflow-x:\s*hidden/u);
	assert.match(rule('.project-start'), /overflow-y:\s*auto/u);
	assert.match(rule('.project-start--compact .project-start__actions'), /grid-template-columns:\s*minmax\(0, 1fr\)/u);
	assert.match(rule('.project-start--compact .project-start__recent-path'), /overflow-wrap:\s*anywhere/u);
	// Nothing in the chooser holds a fixed width wider than a phone.
	assert.doesNotMatch(css.slice(0, css.indexOf('.root-folder-browser {')), /(?:^|[^-])width:\s*[4-9]\d\dpx|min-width:\s*[1-9]\d{2,}px/mu);
	assert.match(rule('.project-start__panel'), /min-width:\s*0/u);
	assert.match(rule('.root-folder-browser__list'), /overflow-x:\s*hidden/u);
	assert.match(rule('.root-folder-browser__current'), /text-overflow:\s*ellipsis/u);
});

const browserView = (listing, overrides = {}) =>
	renderToStaticMarkup(
		React.createElement(RootFolderBrowserView, {
			listing,
			typedPath: listing.state === 'ready' ? listing.folder.path : '',
			onTypedPathChange: noop,
			onOpen: noop,
			onChoose: noop,
			onCancel: noop,
			...overrides,
		}),
	);

test('the folder browser lists directories, a parent, a path field, and its two actions', () => {
	const markup = browserView({
		state: 'ready',
		folder: {
			path: '/home/mark',
			parent: '/home',
			entries: [{ name: 'code' }, { name: 'notes' }],
			truncated: false,
		},
	});
	assert.match(markup, /data-terminay-root-folder-browser="true"/u);
	assert.match(markup, /data-terminay-root-folder-current="true"[^>]*>\/home\/mark</u);
	assert.match(markup, /data-terminay-root-folder-entry="code"/u);
	assert.match(markup, /data-terminay-root-folder-entry="notes"/u);
	assert.match(markup, /data-terminay-root-folder-path="true" value="\/home\/mark"/u);
	assert.doesNotMatch(
		markup.match(/<button[^>]*data-terminay-root-folder-parent[^>]*>/u)[0],
		/disabled/u,
	);
	assert.match(markup, />Cancel</u);
	assert.doesNotMatch(
		markup.match(/<button[^>]*data-terminay-root-folder-choose[^>]*>/u)[0],
		/disabled/u,
	);
	assert.match(markup, /Open this folder/u);
	assert.doesNotMatch(markup, /data-terminay-root-folder-truncated/u);
});

test('the folder browser suggests folders for a typed path as a listbox', () => {
	const ready = {
		state: 'ready',
		folder: { path: '/Users/mark', parent: '/Users', entries: [{ name: 'Documents' }], truncated: false },
	};
	const markup = browserView(ready, {
		typedPath: '/Users/mark/Doc',
		suggestions: [
			{ name: 'Documents', path: '/Users/mark/Documents' },
			{ name: 'docs', path: '/Users/mark/docs' },
		],
		highlighted: 1,
	});
	assert.match(markup, /role="combobox"[^>]*aria-expanded="true"/u);
	assert.match(markup, /role="listbox"[^>]*data-terminay-root-folder-suggestions="true"/u);
	assert.match(markup, /aria-selected="false"[^>]*title="\/Users\/mark\/Documents"[^>]*data-terminay-root-folder-suggestion="Documents"/u);
	assert.match(markup, /aria-selected="true"[^>]*data-terminay-root-folder-suggestion="docs"/u);
	assert.doesNotMatch(browserView(ready), /data-terminay-root-folder-suggestions/u);
});

test('the folder browser holds one height and scrolls its listing inside it', () => {
	const markup = browserView({ state: 'loading' });
	assert.match(markup, /data-terminay-root-folder-body="true"/u);
	assert.match(css, /\.root-folder-browser__body \{[^}]*\bheight: min\(50vh, 360px\);/u);
	assert.match(css, /\.root-folder-browser__list \{[^}]*flex: 1;[^}]*overflow-y: auto;/u);
	assert.match(css, /\.root-folder-browser__suggestions \{[^}]*position: absolute;/u);
});

test('the folder browser marks a truncated listing', () => {
	const markup = browserView({
		state: 'ready',
		folder: {
			path: '/big',
			parent: '/',
			entries: [{ name: 'a' }, { name: 'b' }],
			truncated: true,
		},
	});
	assert.match(markup, /data-terminay-root-folder-truncated="true"[^>]*>Showing the first 2 folders/u);
});

test('the folder browser shows an error in place of a listing and cannot choose it', () => {
	const markup = browserView({
		state: 'error',
		message: 'The server cannot read that folder.',
		previous: { path: '/home/mark', parent: '/home', entries: [{ name: 'code' }], truncated: false },
	});
	assert.match(markup, /role="alert" data-terminay-root-folder-error="true">The server cannot read that folder\./u);
	assert.doesNotMatch(markup, /data-terminay-root-folder-entry/u);
	assert.match(markup.match(/<button[^>]*data-terminay-root-folder-choose[^>]*>/u)[0], /disabled/u);
	// Going up from where it was still works.
	assert.doesNotMatch(markup.match(/<button[^>]*data-terminay-root-folder-parent[^>]*>/u)[0], /disabled/u);
});

test('the folder browser at a filesystem root has no parent, and says when it is still loading', () => {
	const root = browserView({ state: 'ready', folder: { path: '/', entries: [], truncated: false } });
	assert.match(root.match(/<button[^>]*data-terminay-root-folder-parent[^>]*>/u)[0], /disabled/u);
	assert.match(root, /This folder holds no folders\./u);
	assert.match(browserView({ state: 'loading' }), /role="status">Loading folders/u);
});

test('the browser is drawn in the one in-page window frame', async () => {
	const source = await readFile('src/workspace/RootFolderBrowser.tsx', 'utf8');
	assert.match(source, /<InPageWindow[\s\S]*name="root-folder-browser"/u);
	assert.match(source, /void navigator\.open\(\);/u, 'opens at the server home');
});

test('each no-root pane says so and offers to open a folder', () => {
	for (const pane of ['explorer', 'git', 'documentation']) {
		const markup = renderToStaticMarkup(
			React.createElement(NoRootFolderState, { pane, onOpenFolder: noop }),
		);
		assert.match(markup, new RegExp(`data-terminay-no-root-folder="${pane}"`, 'u'));
		assert.match(markup, /No root folder/u);
		assert.match(markup, /data-terminay-no-root-open-folder="true"[^>]*>[\s\S]*Open a folder/u);
		assert.doesNotMatch(markup, /Not a git repository/u);
	}
});

test('a no-root project wires no filesystem client to its Explorer, Git, watches, or Documentation', () => {
	assert.match(app, /const rootScopedAuthority = rootScopedFeatureAuthority\(featureAvailability\)/u);
	assert.match(app, /const projectFileViewerClient = rootScopedAuthority\?\.fileViewerClient/u);
	assert.match(app, /rootScopedAuthority\?\.fileObservationClient\?\.forFolder\(linkedFolderId\)/u);
	assert.match(app, /gitClient: rootScopedAuthority\?\.gitClient/u);
	assert.match(app, /enabled: isDocumentationIndexingStarted && !isNoRootProject/u);
	assert.match(app, /client: rootScopedAuthority\?\.documentationClient/u);
	for (const pane of ['explorer', 'git', 'documentation'])
		assert.match(app, new RegExp(`<NoRootFolderState\\s+pane="${pane}"`, 'u'));
	assert.match(app, /await store\.setProjectRoot\(\{ projectId: project\.id, root \}\)/u);
});

test('a project awaiting its choice renders its chooser instead of its workspace and sidebar', () => {
	assert.match(app, /projectAwaitsStartChoice\(workspaceSnapshot, project\.id\)[\s\S]{0,200}<ProjectStartChooser/u);
	assert.match(app, /onStarted=\{launchStartedProjectTerminal\}/u);
	assert.match(app, /createInitialTerminalForProjectRef\.current\(projectId\);\s*window\.requestAnimationFrame\(\(\) =>\s*scheduleCreatedTerminalFocus\(sessionId\)/u);
});

test('the chooser focuses its first start, Open a folder, when it is shown', async () => {
	const source = await readFile('src/workspace/ProjectStartChooser.tsx', 'utf8');
	assert.match(source, /if \(isActive\) firstActionRef\.current\?\.focus\(/u);
	assert.match(
		source,
		/ref=\{firstActionRef\}[\s\S]{0,200}data-terminay-start-action="folder"/u,
	);
	// A creation that ends awaiting a choice does not send focus to a terminal.
	assert.match(app, /if \(sessionId !== null\)\s*window\.requestAnimationFrame/u);
});
