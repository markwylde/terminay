import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const testDirectory = await mkdtemp(join(process.cwd(), '.server-upgrade-ui-test-'));

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

const { ServerUpgradeMenuRows } = await bundleComponent(
	'src/workspace/ServerUpgradeMenuRows.tsx',
	'server-upgrade-menu-rows.cjs',
);
const { ServerUpgradeConfirmation } = await bundleComponent(
	'src/workspace/ServerUpgradeDialog.tsx',
	'server-upgrade-dialog.cjs',
);
const { ServerUpgradeNotices } = await bundleComponent(
	'src/workspace/ServerUpgradeNotices.tsx',
	'server-upgrade-notices.cjs',
);
const { RemoteAccessConnectionMenu } = await bundleComponent(
	'src/workspace/RemoteAccessConnectionMenu.tsx',
	'remote-access-connection-menu.cjs',
);
const { CompactChromeRow } = await bundleComponent(
	'src/workspace/CompactChromeRow.tsx',
	'compact-chrome-row.cjs',
);
const { CompactSwitcher } = await bundleComponent(
	'src/workspace/CompactSwitcher.tsx',
	'compact-switcher.cjs',
);

test.after(() => rm(testDirectory, { force: true, recursive: true }));

const noop = () => {};

/** Every element a hookless component renders that matches. */
function find(element, matches, found = []) {
	if (Array.isArray(element)) {
		for (const child of element) find(child, matches, found);
		return found;
	}
	if (element === null || typeof element !== 'object') return found;
	const props = element.props ?? {};
	if (matches(props, element)) found.push(element);
	find(props.children ?? [], matches, found);
	return found;
}

const row = (overrides) => ({
	profileId: 'remote:vps',
	label: 'VPS',
	version: '5.1.1',
	available: '5.2.0',
	action: 'upgrade',
	reachable: true,
	...overrides,
});

const rows = (list, overrides = {}) =>
	renderToStaticMarkup(
		React.createElement(ServerUpgradeMenuRows, {
			rows: list,
			namesServers: false,
			onUpgrade: noop,
			variant: 'menu',
			...overrides,
		}),
	);

test('a server that can upgrade itself is marked with its version and offers the action', () => {
	const markup = rows([row()]);
	assert.match(markup, /Update available · 5\.2\.0/);
	assert.match(markup, /role="menuitem"[^>]*>(<span>)?Upgrade server…/);
	assert.match(markup, /data-server-upgrade-state="upgrade"/);
	assert.doesNotMatch(markup, /Copy/);
	assert.doesNotMatch(markup, /Upgrading…/);
	// One server needs no naming; more than one does.
	assert.doesNotMatch(markup, /VPS ·/);
	assert.match(rows([row()], { namesServers: true }), /VPS ·/);
});

test('choosing the action names the server and nothing else', () => {
	const chosen = [];
	const tree = ServerUpgradeMenuRows({
		rows: [row(), row({ profileId: 'remote:build', label: 'Build box' })],
		namesServers: true,
		onUpgrade: (profileId) => chosen.push(profileId),
		variant: 'menu',
	});
	const actions = find(tree, (props) => props.role === 'menuitem');
	assert.equal(actions.length, 2);
	actions[1].props.onClick();
	assert.deepEqual(chosen, ['remote:build']);
});

test('a server that cannot upgrade itself shows the reason and a copyable command, and no action', () => {
	const markup = rows([
		row({
			action: 'manual',
			reason: 'This server runs as a system service without the upgrade helper.',
			command: 'sudo terminay daemon upgrade',
		}),
	]);
	assert.match(markup, /Update available · 5\.2\.0/);
	assert.match(markup, /without the upgrade helper/);
	assert.match(markup, /<code>sudo terminay daemon upgrade<\/code>/);
	assert.match(markup, /aria-label="Copy upgrade command"[^>]*>Copy</);
	assert.doesNotMatch(markup, /Upgrade server…/);
});

test('an upgrade in progress says so and offers no action', () => {
	const markup = rows([row({ action: 'upgrading' })]);
	assert.match(markup, /role="status"[^>]*>Upgrading…/);
	assert.doesNotMatch(markup, /Upgrade server…/);
	assert.doesNotMatch(markup, /<button/);
});

test('a rolled-back upgrade is read from the row, and the action waits for the connection', () => {
	const markup = rows([
		row({
			reachable: false,
			failure: 'Upgrading VPS failed: readiness timed out. 5.1.1 is running again.',
		}),
	]);
	assert.match(markup, /Upgrading VPS failed: readiness timed out\. 5\.1\.1 is running again\./);
	assert.match(markup, /<button[^>]*disabled=""[^>]*>(<span>)?Upgrade server…/);
});

test('the phone-width sheet draws the same rows without menu roles', () => {
	const markup = rows([row()], { variant: 'sheet' });
	assert.match(markup, /server-upgrade-row--sheet/);
	assert.match(markup, /Upgrade server…/);
	assert.doesNotMatch(markup, /role="menuitem"/);
	assert.equal(rows([]), '');
});

const entry = (statusOverrides = {}, overrides = {}) => ({
	profileId: 'remote:vps',
	label: 'VPS',
	reachable: true,
	status: {
		version: '5.1.1',
		channel: 'tag',
		available: { version: '5.2.0' },
		canUpgrade: true,
		modes: ['in-place'],
		upgrade: { state: 'none' },
		...statusOverrides,
	},
	...overrides,
});

const confirmation = (overrides = {}) => ({
	entry: entry(),
	mode: 'in-place',
	onModeChange: noop,
	isStarting: false,
	onCancel: noop,
	onConfirm: noop,
	...overrides,
});

test('the confirmation names both versions and the brief disconnect', () => {
	const markup = renderToStaticMarkup(
		React.createElement(ServerUpgradeConfirmation, confirmation()),
	);
	assert.match(markup, /VPS is running <strong>5\.1\.1<\/strong>\./);
	assert.match(markup, /Version <strong>5\.2\.0<\/strong> is available\./);
	assert.match(
		markup,
		/The connection to this server drops briefly while it restarts\. Its terminals keep running\./,
	);
	// One mode on offer is not a choice.
	assert.doesNotMatch(markup, /type="radio"/);
	assert.doesNotMatch(markup, /Recreate the container/);
});

test('nothing is sent before Upgrade is pressed, and cancelling sends nothing', () => {
	const calls = [];
	const tree = ServerUpgradeConfirmation(
		confirmation({
			onCancel: () => calls.push('cancel'),
			onConfirm: () => calls.push('confirm'),
		}),
	);
	assert.deepEqual(calls, []);
	const buttons = find(tree, (_props, element) => element.type === 'button');
	assert.deepEqual(
		buttons.map((button) => button.props.children),
		['Cancel', 'Upgrade'],
	);
	buttons[0].props.onClick();
	assert.deepEqual(calls, ['cancel']);
	buttons[1].props.onClick();
	assert.deepEqual(calls, ['cancel', 'confirm']);
});

test('a container with the socket offers both modes with in place preselected', () => {
	const both = { modes: ['in-place', 'recreate'], recreateEndsTerminals: true };
	const selected = [];
	const props = confirmation({
		entry: entry(both),
		onModeChange: (mode) => selected.push(mode),
	});
	const radios = find(
		ServerUpgradeConfirmation(props),
		(candidate) => candidate.type === 'radio',
	);
	assert.deepEqual(
		radios.map((radio) => [radio.props.value, radio.props.checked]),
		[
			['in-place', true],
			['recreate', false],
		],
	);
	const markup = renderToStaticMarkup(
		React.createElement(ServerUpgradeConfirmation, props),
	);
	assert.match(markup, /role="radiogroup"/);
	assert.match(markup, /Upgrade in place/);
	assert.match(markup, /Recreate the container/);
	assert.match(markup, /Ends every terminal on this server\./);
	assert.match(markup, /Its terminals keep running\./);
	// Choosing recreate changes what the confirmation promises.
	radios[1].props.onChange();
	assert.deepEqual(selected, ['recreate']);
	const recreate = renderToStaticMarkup(
		React.createElement(ServerUpgradeConfirmation, { ...props, mode: 'recreate' }),
	);
	assert.match(recreate, /Every terminal on this server ends\./);
	assert.doesNotMatch(recreate, /keep running/);
});

test('the confirmation cannot start what is already running, or what cannot be reached', () => {
	const primary = (props) =>
		find(
			ServerUpgradeConfirmation(confirmation(props)),
			(candidate) => candidate.className === 'server-upgrade-dialog__primary',
		)[0];
	assert.equal(primary({}).props.disabled, false);
	assert.equal(primary({ isStarting: true }).props.disabled, true);
	assert.equal(primary({ entry: entry({}, { reachable: false }) }).props.disabled, true);
	const running = confirmation({
		entry: entry({ upgrade: { state: 'in-progress', mode: 'in-place', startedAt: 1 } }),
	});
	assert.equal(primary(running).props.disabled, true);
	assert.match(
		renderToStaticMarkup(React.createElement(ServerUpgradeConfirmation, running)),
		/role="alert"[^>]*>An upgrade is already running\./,
	);
	assert.match(
		renderToStaticMarkup(
			React.createElement(
				ServerUpgradeConfirmation,
				confirmation({ error: 'This server is already up to date.' }),
			),
		),
		/role="alert"[^>]*>This server is already up to date\./,
	);
});

test('an outcome is announced and can be dismissed', () => {
	const dismissed = [];
	const notices = [
		{ id: 'vps:77', profileId: 'vps', tone: 'success', text: 'VPS is now on 5.2.0.' },
		{
			id: 'build:80',
			profileId: 'build',
			tone: 'failure',
			text: 'Upgrading Build box failed: readiness timed out. 5.1.1 is running again.',
		},
	];
	const markup = renderToStaticMarkup(
		React.createElement(ServerUpgradeNotices, { notices, onDismiss: noop }),
	);
	assert.match(markup, /role="status"[^>]*><span>VPS is now on 5\.2\.0\./);
	assert.match(markup, /role="alert"[^>]*><span>Upgrading Build box failed/);
	const tree = ServerUpgradeNotices({
		notices,
		onDismiss: (id) => dismissed.push(id),
	});
	find(tree, (props) => props['aria-label'] === 'Dismiss')[1].props.onClick();
	assert.deepEqual(dismissed, ['build:80']);
	assert.equal(ServerUpgradeNotices({ notices: [], onDismiss: noop }), null);
});

const header = (overrides = {}) =>
	renderToStaticMarkup(
		React.createElement(RemoteAccessConnectionMenu, {
			currentServerLabel: 'VPS',
			isOpen: false,
			isToggling: false,
			menuRef: { current: null },
			onOpenConnection: noop,
			onOpenPairingQr: noop,
			onToggleExposure: noop,
			onToggleMenu: noop,
			status: null,
			tone: '',
			...overrides,
		}),
	);

test('the header control warns only while its server has an upgrade, and says so in its name', () => {
	const plain = header();
	assert.doesNotMatch(plain, /data-server-upgrade-indicator/);
	assert.match(plain, /aria-label="Open connection menu, Offline"/);
	const warned = header({ serverUpgradeVersion: '5.2.0' });
	assert.match(
		warned,
		/aria-label="Open connection menu, Offline, upgrade to 5\.2\.0 available"/,
	);
	assert.match(
		warned,
		/remote-access-button__label">VPS<\/span><svg[^>]*remote-access-button__upgrade[^>]*data-server-upgrade-indicator="5\.2\.0"/,
	);
	// Local is passed no version, so it draws no icon and names no upgrade.
	const local = header({ currentServerLabel: 'Local' });
	assert.doesNotMatch(local, /upgrade/);
});

test('the open menu lists the server updates it is given, and none otherwise', () => {
	assert.doesNotMatch(header({ isOpen: true }), /Server updates/);
	const markup = header({
		isOpen: true,
		serverUpgrades: React.createElement(ServerUpgradeMenuRows, {
			rows: [row()],
			namesServers: false,
			onUpgrade: noop,
			variant: 'menu',
		}),
	});
	assert.match(markup, /role="menu"/);
	assert.match(markup, /Server updates/);
	assert.match(markup, /role="menuitem"[^>]*>(<span>)?Upgrade server…/);
});

const compactRow = (connection = {}) =>
	renderToStaticMarkup(
		React.createElement(CompactChromeRow, {
			connection: {
				isExposed: false,
				isReachable: true,
				serverLabel: 'VPS',
				tone: 'remote-access-button--idle',
				...connection,
			},
			isExplorerOpen: false,
			isHomeSelected: false,
			isNotificationsOpen: false,
			isSwitcherOpen: false,
			notificationCount: 0,
			onOpenCommandBar: noop,
			onOpenSwitcher: noop,
			onShowDashboard: noop,
			onToggleExplorer: noop,
			onToggleNotifications: noop,
			projectTitle: 'Paged',
		}),
	);

test('at phone width the connection glyph carries the same warning and name', () => {
	const plain = compactRow();
	assert.doesNotMatch(plain, /data-server-upgrade-indicator/);
	assert.match(plain, /aria-label="Connections — VPS, Offline"/);
	const warned = compactRow({ upgradeVersion: '5.2.0' });
	assert.match(
		warned,
		/aria-label="Connections — VPS, Offline, upgrade to 5\.2\.0 available"/,
	);
	assert.match(warned, /compact-connection__upgrade[^>]*data-server-upgrade-indicator="5\.2\.0"/);
});

test('at phone width the switcher lists the same server updates', () => {
	const sheet = (overrides = {}) =>
		renderToStaticMarkup(
			React.createElement(CompactSwitcher, {
				groups: [],
				onActivatePanel: noop,
				onAddConnection: noop,
				onClosePanel: noop,
				onCloseProject: noop,
				onDismiss: noop,
				onEditPanel: noop,
				onEditProject: noop,
				onNewProject: noop,
				onNewTerminal: noop,
				onNewTerminalInFolder: noop,
				onQueryChange: noop,
				query: '',
				...overrides,
			}),
		);
	assert.doesNotMatch(sheet(), /Server updates/);
	const markup = sheet({
		serverUpgrades: React.createElement(ServerUpgradeMenuRows, {
			rows: [row({ action: 'upgrading' }), row({ profileId: 'remote:build', label: 'Build box' })],
			namesServers: true,
			onUpgrade: noop,
			variant: 'sheet',
		}),
	});
	assert.match(markup, /Server updates/);
	assert.match(markup, /Upgrading…/);
	assert.match(markup, /Build box ·/);
	assert.match(markup, /Upgrade server…/);
});
