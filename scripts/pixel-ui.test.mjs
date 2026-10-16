import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const directory = await mkdtemp(join(process.cwd(), '.pixel-ui-test-'));
const bundle = async (entry, name) => {
	const outfile = join(directory, `${name}.cjs`);
	await build({
		entryPoints: [entry],
		outfile,
		bundle: true,
		format: 'cjs',
		platform: 'node',
		external: ['react', 'react-dom', '@terminay/client-core'],
		loader: { '.css': 'empty' },
		logLevel: 'silent',
	});
	return require(outfile);
};
const { PixelCompanion } = await bundle('src/pixel/Pixel.tsx', 'pixel');
const { WorkspaceStatusBar } = await bundle(
	'src/workspace/WorkspaceStatusBar.tsx',
	'status-bar',
);
test.after(async () => {
	await rm(directory, { recursive: true, force: true });
});

const server = (overrides = {}) => ({
	state: { enabled: true, provider: 'com.terminay.builtin-agents/claude-code' },
	chat: undefined,
	providers: [],
	problem: undefined,
	send() {},
	stop() {},
	clear() {},
	decide() {},
	chooseProvider() {},
	...overrides,
});

const render = (props) =>
	renderToStaticMarkup(
		React.createElement(PixelCompanion, {
			serverId: 's1',
			statusBarDock: null,
			...props,
		}),
	);

test('the status bar keeps a Pixel slot just before the remote indicator', () => {
	const markup = renderToStaticMarkup(
		React.createElement(WorkspaceStatusBar, {
			onToggleConnectionMenu() {},
			remote: {
				tone: 'grey',
				devices: [],
				label: '',
				accessibleLabel: 'No devices',
			},
			slotRef: () => {},
			pixelSlotRef: () => {},
		}),
	);
	assert.match(
		markup,
		/workspace-status-bar__focused"><\/div><div class="workspace-status-bar__pixel"><\/div><button[^>]*workspace-status-bar__remote/,
	);
});

test('with the status bar hidden, Pixel docks in the corner as a labelled button with Pixel drawn in it', () => {
	const markup = render({ server: server() });
	assert.match(
		markup,
		/<button[^>]*aria-label="Open Pixel"[^>]*class="pixel-dock pixel-dock--corner"/,
	);
	assert.match(markup, /data-state="idle"/);
	assert.match(markup, /<svg/);
	assert.doesNotMatch(markup, /pixel-dock__badge/);
});

test('the dock says when Pixel is working and when it needs an answer', () => {
	const working = render({
		server: server({
			chat: { status: 'streaming', pendingApprovals: 0, entries: [] },
		}),
	});
	assert.match(working, /data-state="working"/);
	assert.match(working, /aria-label="Pixel is working\. Open Pixel\."/);
	assert.match(working, /pixel-dock__badge/);
	const asking = render({
		server: server({
			chat: { status: 'thinking', pendingApprovals: 1, entries: [] },
		}),
	});
	assert.match(asking, /data-state="attention"/);
	assert.match(asking, /Pixel needs your answer/);
});

test('the Settings window lets Pixel’s nested settings be changed', async () => {
	const { readFile } = await import('node:fs/promises');
	const source = await readFile('src/components/SettingsWindow.tsx', 'utf8');
	const roots = source.slice(source.indexOf('const allowedRoots'), source.indexOf(']);', source.indexOf('const allowedRoots')));
	assert.match(roots, /'pixel'/);
});
