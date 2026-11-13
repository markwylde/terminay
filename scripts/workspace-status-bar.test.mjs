import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('the Desktop View menu offers Show Status Bar as a checkbox bound to the setting', async () => {
	const main = await read('electron/main.ts');
	const item = main.slice(main.indexOf("label: 'Show Status Bar'"));
	assert.notEqual(main.indexOf("label: 'Show Status Bar'"), -1);
	const block = item.slice(0, item.indexOf('}'));
	assert.match(block, /type: 'checkbox'/u);
	assert.match(block, /checked: settings\.showStatusBar/u);
	assert.match(block, /sendCommandToFocusedWindow\('toggle-status-bar'\)/u);
});

test('the browser View menu offers a checked Show Status Bar item', async () => {
	const workspace = await read('src/web/ConnectedWebRendererWorkspace.tsx');
	const view = workspace.slice(workspace.indexOf('view: ['));
	assert.match(
		view,
		/id: 'toggle-status-bar',\s*label: 'Show Status Bar',\s*checked: statusBarVisible,\s*onSelect: \(\) => dispatchCommand\('toggle-status-bar'\)/u,
	);
});

test('the header connections control names the server without exposure icon or count pill', async () => {
	const menu = await read('src/workspace/RemoteAccessConnectionMenu.tsx');
	assert.doesNotMatch(menu, /remote-access-button__exposure/u);
	assert.doesNotMatch(menu, /remote-access-button__connections/u);
	assert.match(menu, /Open connection menu, \$\{isExposed \? 'Exposed' : 'Offline'\}/u);
});

test('the status bar sits below the workspace and never polls the working directory', async () => {
	const app = await read('src/App.tsx');
	const stackEnd = app.lastIndexOf('</McpApprovalsContext.Provider>');
	assert.ok(app.indexOf('<WorkspaceStatusBar', stackEnd) > stackEnd);
	const statusBar = await read('src/workspace/WorkspaceStatusBar.tsx');
	assert.doesNotMatch(statusBar, /setInterval/u);
});

test('host stats sit before Pixel and are watched only while shown and visible', async () => {
	const bar = await read('src/workspace/WorkspaceStatusBar.tsx');
	const render = bar.slice(bar.indexOf('<footer className="workspace-status-bar"'));
	const host = render.indexOf('<HostStatsStrip');
	assert.ok(host > render.indexOf('workspace-status-bar__focused'));
	assert.ok(host < render.indexOf('workspace-status-bar__pixel'));

	const hook = await read('src/workspace/useHostStats.ts');
	assert.match(hook, /options\.shown && visible && facade !== undefined/u);
	assert.match(hook, /visibilitychange/u);
	assert.match(hook, /HOST_STATS_OPERATIONS\.unwatch/u);
	// The client never samples on a timer of its own: the server pushes.
	assert.doesNotMatch(hook, /setInterval|setTimeout/u);

	const app = await read('src/App.tsx');
	assert.match(app, /shown: settings\.hostStats\.enabled && isStatusBarVisible/u);
});

test('the server sampler cites its owner approval (ADR-0028)', async () => {
	const service = await read('packages/server-core/src/hostStats/service.ts');
	assert.match(service, /owner-approved poll \(ADR-0028\)/u);
	assert.match(service, /host-stats-in-status-bar/u);
});

test('the Settings window can change the nested host stats setting', async () => {
	const source = await read('src/components/SettingsWindow.tsx');
	const start = source.indexOf('const allowedRoots');
	const roots = source.slice(start, source.indexOf(']);', start));
	assert.match(roots, /'hostStats'/u);
});
