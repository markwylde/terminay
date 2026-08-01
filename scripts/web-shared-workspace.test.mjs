import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const [
	webEntry,
	webMount,
	sharedMount,
	app,
	splitLayout,
	splitStyle,
	sidebarStack,
	sidebarSplit,
	sidebarStyle,
] = await Promise.all([
	readFile('src/web/main.tsx', 'utf8'),
	readFile('src/web/ConnectedWebRendererWorkspace.tsx', 'utf8'),
	readFile('src/shared/ConnectedRendererWorkspace.tsx', 'utf8'),
	readFile('src/App.tsx', 'utf8'),
	readFile('src/shared/WorkspaceSplitLayout.tsx', 'utf8'),
	readFile('src/shared/WorkspaceSplitLayout.css', 'utf8'),
	readFile('src/components/sidebar/SidebarPanelStack.tsx', 'utf8'),
	readFile('src/components/sidebar/SidebarSplit.tsx', 'utf8'),
	readFile('src/components/sidebar/sidebar.css', 'utf8'),
]);

test('web production mounts the canonical connected renderer and App tree', () => {
	assert.match(webEntry, /<ConnectedWebRendererWorkspace/u);
	assert.match(webMount, /<ConnectedRendererWorkspace/u);
	assert.match(sharedMount, /import App from ['"]\.\.\/App['"]/u);
	assert.match(
		sharedMount,
		/<App[\s\S]*terminalClientContext=\{terminalClientContext\}/u,
	);
	assert.match(
		app,
		/data-terminay-app-component=\{TERMINAY_APP_COMPONENT_ID\}/u,
	);
	for (const source of [webEntry, webMount, sharedMount]) {
		assert.doesNotMatch(
			source,
			/ServerWorkspaceSurface|ResponsiveWorkspaceShell|SharedProductionRoutes(?!\.css)/u,
		);
	}
});

test('connected web host injects browser adapters and preserves the disconnected manager', () => {
	assert.match(webMount, /createBrowserTerminalSettingsClient/u);
	assert.match(webMount, /createBrowserMacroSettingsCapability/u);
	assert.match(webMount, /SharedConnectionsRouteBody/u);
	assert.match(webMount, /onOpenConnectionManager/u);
	assert.doesNotMatch(webMount, /window\.terminay|new Terminal\(/u);
});

test('browser and Desktop share the host-neutral production workspace split layout', () => {
	assert.match(app, /import\s+\{\s*WorkspaceSplitLayout\s*\}/u);
	assert.match(app, /<WorkspaceSplitLayout/u);
	assert.match(app, /navigationWidth=\{project\.fileExplorerWidth\}/u);
	assert.match(app, /onNavigationWidthChange=\{\(width\)\s*=>/u);
	assert.doesNotMatch(app, /maximumNavigationWidth=\{Math\.max/u);
	assert.doesNotMatch(
		app,
		/className="file-explorer-sidebar"[\s\S]{0,120}style=\{\{\s*width:/u,
	);
	assert.match(splitLayout, /workspace-split-layout/u);
	assert.match(splitLayout, /controlledNavigationWidth/u);
	assert.match(splitLayout, /maximumNavigationWidthRatio\s*=\s*0\.8/u);
	assert.match(splitLayout, /rootWidth/u);
	assert.match(splitLayout, /previewNavigationResize/u);
	assert.match(splitLayout, /dragStateRef/u);
	assert.doesNotMatch(splitLayout, /setDragNavigationWidth/u);
	assert.match(splitStyle, /\.workspace-split-layout/u);
	assert.match(
		splitStyle,
		/grid-template-columns:\s*var\(--workspace-navigation-width/u,
	);
	assert.match(
		splitStyle,
		/grid-template-columns:\s*var\(--workspace-navigation-width,\s*22rem\)\s*minmax\(0,\s*1fr\)/u,
	);
	assert.match(splitStyle, /position:\s*absolute/u);
	assert.match(
		splitStyle,
		/left:\s*var\(--workspace-navigation-width,\s*22rem\)/u,
	);
	assert.match(splitLayout, /onPointerDown=\{handleSeparatorPointerDown\}/u);
	assert.match(splitLayout, /onPointerMove=\{handleSeparatorPointerMove\}/u);
	assert.match(splitLayout, /onPointerUp=\{handleSeparatorPointerEnd\}/u);
	assert.match(splitLayout, /onNavigationWidthCommit\?\.\(finalWidth\)/u);
	assert.doesNotMatch(
		splitStyle,
		/grid-template-columns:\s*clamp\([^;]*--workspace-navigation-width/u,
	);
	assert.doesNotMatch(splitStyle, /file-explorer-sidebar__resizer/u);
	assert.match(
		splitStyle,
		/\.workspace-split-layout__navigation\s*\{[\s\S]*overflow:\s*hidden/u,
	);
	assert.match(
		splitStyle,
		/\.workspace-split-layout__separator\s*\{[\s\S]*width:\s*6px;[\s\S]*margin:\s*0;[\s\S]*padding:\s*0;/u,
	);
	assert.doesNotMatch(
		splitStyle,
		/grid-template-columns:[^;]*(?:0\.75rem|12px)/u,
	);
});

test('nested sidebar resize observers keep a stable element ref', () => {
	assert.match(sidebarSplit, /const setRoot = useCallback/u);
	assert.match(sidebarSplit, /ref=\{setRoot\}/u);
	assert.match(sidebarSplit, /containerHeight - SIDEBAR_SPLITTER_HEIGHT - bottomMinHeight/u);
	assert.match(sidebarSplit, /minHeight:\s*`\$\{bottomMinHeight\}px`/u);
	assert.match(sidebarSplit, /bottomMinHeight = SIDEBAR_HEADER_MIN_HEIGHT/u);
	assert.doesNotMatch(
		sidebarSplit,
		/ref=\{\(element\) => \{[\s\S]*setRootElement/u,
	);
});

test('nested sidebar panes share height without clipping lower headers', () => {
	assert.match(sidebarStyle, /\.sidebar-panel-stack\s*\{[\s\S]*height:\s*100%/u);
	assert.match(sidebarStyle, /\.sidebar-panel-stack\s*\{[\s\S]*min-height:\s*0/u);
	assert.match(sidebarStyle, /\.sidebar-split__pane\s*\{[\s\S]*overflow:\s*hidden/u);
	assert.match(sidebarSplit, /SIDEBAR_HEADER_MIN_HEIGHT/u);
	assert.match(sidebarSplit, /bottomMinHeight\s*=\s*SIDEBAR_HEADER_MIN_HEIGHT/u);
	assert.match(sidebarStack, /bottomMinHeight=\{SIDEBAR_HEADER_MIN_HEIGHT \* bottom\.length\}/u);
	assert.match(sidebarSplit, /containerHeight - SIDEBAR_SPLITTER_HEIGHT - bottomMinHeight/u);
	assert.match(sidebarSplit, /onTopHeightCommit\?\.\(state\.latestHeight\)/u);
});

test('command launcher scroll stays bounded and non-animated', () => {
	assert.match(app, /macroLauncherListRef/u);
	assert.match(app, /list\.scrollTop\s*=/u);
	assert.match(app, /activeItem\.getBoundingClientRect\(\)/u);
	assert.doesNotMatch(app, /activeItem\.scrollIntoView/u);
	assert.doesNotMatch(app, /behavior:\s*['"]smooth['"]/u);
	assert.doesNotMatch(app, /matchMedia\(['"]\\(prefers-reduced-motion: reduce\\)['"]\)/u);
	assert.doesNotMatch(app, /backdrop-filter:\s*blur/u);
});

test('retired production duplicate surface is deleted', async () => {
	await assert.rejects(
		access('src/shared/ServerWorkspaceSurface.tsx'),
		(error) => error?.code === 'ENOENT',
	);
});
