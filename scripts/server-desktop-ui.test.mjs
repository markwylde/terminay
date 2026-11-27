import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const testDirectory = await mkdtemp(join(process.cwd(), '.server-desktop-ui-test-'));

async function bundleComponent(entryPoint, outputName) {
	const outputPath = join(testDirectory, outputName);
	await build({
		entryPoints: [entryPoint],
		outfile: outputPath,
		bundle: true,
		format: 'cjs',
		platform: 'node',
		external: ['react', 'react-dom'],
		loader: { '.css': 'empty' },
		logLevel: 'silent',
	});
	return require(outputPath);
}

const { ServerDesktopBar, ServerDesktopButton, ServerDesktopStateView } = await bundleComponent(
	'src/workspace/serverDesktop/ServerDesktopViews.tsx',
	'server-desktop-views.cjs',
);

test.after(() => rm(testDirectory, { force: true, recursive: true }));

const noop = () => {};
const actions = { onSetup: noop, onCheckAgain: noop, onTurnOn: noop, onCopyCommand: noop };
const COMMAND = 'sudo terminay daemon desktop install';

/** Every element a hookless component renders that matches. */
function find(element, matches, found = []) {
	if (Array.isArray(element)) {
		for (const child of element) find(child, matches, found);
		return found;
	}
	if (element === null || typeof element !== 'object') return found;
	if (typeof element.type === 'function') return find(element.type(element.props ?? {}), matches, found);
	const props = element.props ?? {};
	if (matches(props, element)) found.push(element);
	return find(props.children, matches, found);
}
const action = (tree, name) => find(tree, (props) => props['data-server-desktop-action'] === name);

const stateView = (status, extra = {}) =>
	React.createElement(ServerDesktopStateView, { status, busy: false, copied: false, actions, ...extra });
const html = (element) => renderToStaticMarkup(element);

test('the header control names the server and says whether its window is open', () => {
	const closed = html(React.createElement(ServerDesktopButton, { serverLabel: 'VPS', isOpen: false, onActivate: noop }));
	assert.match(closed, /data-server-desktop-button="true"/);
	assert.match(closed, /aria-label="Show desktop of VPS"/);
	assert.match(closed, /aria-pressed="false"/);
	assert.match(closed, /title="Show desktop"/);
	const open = html(React.createElement(ServerDesktopButton, { serverLabel: 'VPS', isOpen: true, onActivate: noop }));
	assert.match(open, /aria-pressed="true"/);
	let activated = 0;
	const tree = ServerDesktopButton({ serverLabel: 'VPS', isOpen: false, onActivate: () => activated++ });
	find(tree, (props) => props['data-server-desktop-button'] === 'true')[0].props.onClick();
	assert.equal(activated, 1);
});

test('the control is rendered only for a server whose connection has a desktop client, which only the capability gives', async () => {
	const app = await readFile('src/App.tsx', 'utf8');
	assert.match(app, /\{serverDesktopClient === undefined \? null : \(\s*<ServerDesktopButton/);
	assert.match(app, /isServerDesktopOpen && serverDesktopClient !== undefined \? \(\s*<ServerDesktopWindow/);
	// Activating it only ever sets the one window open: there is no second.
	assert.match(app, /setIsServerDesktopOpen\(true\);/);
	assert.equal(app.match(/<ServerDesktopWindow/g).length, 1);
	const wiring = await readFile('src/shared/rendererServerClient.ts', 'utf8');
	assert.match(wiring, /serverOffersDesktop\(server\.capabilities\)\s*\? new ServerDesktopClient\(/);
	assert.match(wiring, /serverDesktopClient === undefined \? \{\} : \{ serverDesktopClient \}/);
});

test('needs-setup offers setup where the server can run it, and the command where it cannot', () => {
	const byServer = stateView({ state: 'needs-setup', setup: 'server', command: COMMAND });
	const serverHtml = html(byServer);
	assert.match(serverHtml, /data-server-desktop-state="needs-setup"/);
	assert.match(serverHtml, /Set up desktop/);
	assert.doesNotMatch(serverHtml, /data-server-desktop-command/);
	assert.match(serverHtml, /Nothing listens on the\s+network/);
	let setups = 0;
	const tree = ServerDesktopStateView({ status: { state: 'needs-setup', setup: 'server', command: COMMAND }, busy: false, copied: false, actions: { ...actions, onSetup: () => setups++ } });
	action(tree, 'setup')[0].props.onClick();
	assert.equal(setups, 1);

	let checks = 0;
	let copiedCommand;
	const manual = ServerDesktopStateView({
		status: { state: 'needs-setup', setup: 'command', command: COMMAND },
		busy: false,
		copied: false,
		actions: { ...actions, onCheckAgain: () => checks++, onCopyCommand: (command) => (copiedCommand = command) },
	});
	const manualHtml = html(stateView({ state: 'needs-setup', setup: 'command', command: COMMAND }));
	assert.match(manualHtml, /<code data-server-desktop-command="true">sudo terminay daemon desktop install<\/code>/);
	assert.match(manualHtml, /Check again/);
	assert.equal(action(manual, 'setup').length, 0);
	action(manual, 'check')[0].props.onClick();
	find(manual, (props) => props['data-server-desktop-copy'] === 'true')[0].props.onClick();
	assert.equal(checks, 1);
	assert.equal(copiedCommand, COMMAND);
	assert.match(html(stateView({ state: 'needs-setup', setup: 'command', command: COMMAND }, { copied: true })), />Copied</);
});

test('setting-up shows the step list and a progress bar, and nothing to press', () => {
	const view = stateView({ state: 'setting-up', step: 'downloading', fraction: 0.42 });
	const markup = html(view);
	assert.match(markup, /role="progressbar"[^>]*aria-valuenow="42"/);
	assert.match(markup, /style="width:42%"/);
	assert.match(markup, /data-server-desktop-step="preparing" data-step-state="done"/);
	assert.match(markup, /data-server-desktop-step="downloading" data-step-state="current" aria-current="step"/);
	assert.match(markup, /data-server-desktop-step="starting" data-step-state="pending"/);
	assert.match(markup, /Setup carries on if you close this window/);
	assert.doesNotMatch(markup, /data-server-desktop-action/);
});

test('unsupported explains why and offers no action', () => {
	const markup = html(stateView({ state: 'unsupported', reason: 'not-debian', message: 'The desktop is offered on Debian Linux only.' }));
	assert.match(markup, /data-server-desktop-state="unsupported"/);
	assert.match(markup, /data-server-desktop-reason="not-debian"/);
	assert.match(markup, /The desktop is offered on Debian Linux only\./);
	assert.doesNotMatch(markup, /<button/);
});

test('off offers turning it on', () => {
	let turnedOn = 0;
	const tree = ServerDesktopStateView({ status: { state: 'off' }, busy: false, copied: false, actions: { ...actions, onTurnOn: () => turnedOn++ } });
	action(tree, 'turn-on')[0].props.onClick();
	assert.equal(turnedOn, 1);
	const markup = html(stateView({ state: 'off' }));
	assert.match(markup, /The desktop is turned off/);
	assert.match(markup, /Turn on/);
	// While a request is on its way the button cannot be pressed twice.
	assert.match(html(stateView({ state: 'off' }, { busy: true })), /disabled=""[^>]*data-server-desktop-action="turn-on"/);
});

test('a failed setup names its step and reason and retries the way this host sets up', () => {
	const failed = { state: 'failed', step: 'downloading', reason: 'E: Failed to fetch', setup: 'server', command: COMMAND };
	const markup = html(stateView(failed));
	assert.match(markup, /Setup did not finish/);
	assert.match(markup, /data-server-desktop-step="downloading" data-step-state="failed"/);
	assert.match(markup, /role="alert">E: Failed to fetch</);
	assert.match(markup, /data-server-desktop-action="setup"[^>]*>Try again</);
	assert.doesNotMatch(markup, /data-server-desktop-command/);

	const manual = html(stateView({ ...failed, setup: 'command' }));
	assert.match(manual, /data-server-desktop-command/);
	assert.match(manual, /Check again/);
	assert.doesNotMatch(manual, /data-server-desktop-action="setup"/);

	// The desktop's own start failed: no step list, and asking again starts it.
	const start = html(stateView({ state: 'failed', reason: 'The display server exited.', setup: 'server', command: COMMAND }));
	assert.match(start, /The desktop could not start/);
	assert.doesNotMatch(start, /data-server-desktop-step/);
	assert.match(start, /data-server-desktop-action="check"/);
	assert.doesNotMatch(start, /data-server-desktop-action="setup"/);
});

test('a refused request is shown with the state it left', () => {
	assert.match(html(stateView({ state: 'off' }, { error: 'The server refused the request.' })), /role="alert">The server refused the request\.</);
});

const bar = (props = {}) => ({
	mode: 'control',
	controller: { clientId: 'me', deviceName: 'Phone' },
	display: 765,
	state: 'open',
	busy: false,
	onTakeControl: noop,
	onReleaseControl: noop,
	onReconnect: noop,
	onTurnOff: noop,
	onConfirmTurnOff: noop,
	onCancelTurnOff: noop,
	...props,
});

test('the bar of a controlling window: give up control, the display number, the shared notice', () => {
	const calls = [];
	const tree = ServerDesktopBar(bar({ onReleaseControl: () => calls.push('release'), onReconnect: () => calls.push('reconnect'), onTurnOff: () => calls.push('off') }));
	const markup = html(React.createElement(ServerDesktopBar, bar()));
	assert.match(markup, /data-server-desktop-mode="control"/);
	assert.match(markup, /You control this desktop\./);
	assert.match(markup, /data-server-desktop-display="765"[^>]*>DISPLAY=:765</);
	assert.match(markup, /data-server-desktop-shared-notice="true"/);
	assert.match(markup, /every project and every paired\s+device sees the same windows/);
	assert.equal(action(tree, 'take-control').length, 0);
	action(tree, 'release-control')[0].props.onClick();
	action(tree, 'reconnect')[0].props.onClick();
	action(tree, 'turn-off')[0].props.onClick();
	assert.deepEqual(calls, ['release', 'reconnect', 'off']);
	assert.doesNotMatch(markup, /data-server-desktop-notice/);
	assert.doesNotMatch(markup, /data-server-desktop-confirm/);
});

test('the bar of a viewer: who controls, take control, and the taken-over notice', () => {
	let taken = 0;
	const viewer = bar({ mode: 'view-only', controller: { clientId: 'laptop', deviceName: 'Laptop' }, notice: 'Taken over by Laptop.', onTakeControl: () => taken++ });
	const markup = html(React.createElement(ServerDesktopBar, viewer));
	assert.match(markup, /data-server-desktop-mode="view-only"/);
	assert.match(markup, /Viewing\. Laptop controls this desktop\./);
	assert.match(markup, /role="status" data-server-desktop-notice="true">Taken over by Laptop\.</);
	const tree = ServerDesktopBar(viewer);
	assert.equal(action(tree, 'release-control').length, 0);
	action(tree, 'take-control')[0].props.onClick();
	assert.equal(taken, 1);
	// Until the server has said which mode the stream is in, nothing is taken.
	assert.match(html(React.createElement(ServerDesktopBar, bar({ mode: undefined, controller: null }))), /disabled=""[^>]*data-server-desktop-action="take-control"/);
	assert.match(html(React.createElement(ServerDesktopBar, bar({ state: 'closed' }))), /Disconnected\./);
});

test('turning off asks first when program windows are open, and can be cancelled', () => {
	const calls = [];
	const confirming = bar({ confirmingTurnOff: { windows: 3 }, onConfirmTurnOff: () => calls.push('confirm'), onCancelTurnOff: () => calls.push('cancel') });
	const markup = html(React.createElement(ServerDesktopBar, confirming));
	assert.match(markup, /role="alertdialog"[^>]*data-server-desktop-confirm="turn-off"/);
	assert.match(markup, /3 program windows are open on the desktop and will close\. Turn it off\?/);
	const tree = ServerDesktopBar(confirming);
	action(tree, 'confirm-turn-off')[0].props.onClick();
	find(tree, (props, element) => element.type === 'button' && props.children === 'Cancel')[0].props.onClick();
	assert.deepEqual(calls, ['confirm', 'cancel']);
});

test('the desktop window is the shared in-page frame, remembered by its own id, with the shared viewer', async () => {
	const source = await readFile('src/workspace/serverDesktop/ServerDesktopWindow.tsx', 'utf8');
	assert.match(source, /<InPageWindow/);
	assert.match(source, /kind=\{\{ resizable: true, id: 'server-desktop'/);
	assert.match(source, /from '@terminay\/remote-desktop\/ui'/);
	assert.match(source, /<RemoteDesktopCanvas/);
	// The controller's window sizes the desktop; the server decides the mode.
	assert.match(source, /\n\t{5}resize\n/);
	assert.match(source, /clipboard=\{desktopClipboardHost\}/);
	assert.match(source, /<RemoteDesktopCanvas[^>]*?\n\t{5}mode="view-only"/);
	const ids = await readFile('src/shared/inPageWindow/geometryStore.ts', 'utf8');
	assert.match(ids, /'server-desktop',/);
	// One clipboard host for every desktop: the bot's and the server's.
	const bots = await readFile('src/workspace/bots/BotDesktopView.tsx', 'utf8');
	assert.match(bots, /desktopClipboardHost/);
});
