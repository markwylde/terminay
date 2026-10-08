import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const testDirectory = await mkdtemp(join(process.cwd(), '.connections-control-test-'));

const outputPath = join(testDirectory, 'connections-control.cjs');
await build({
	entryPoints: ['src/workspace/ConnectionsControl.tsx'],
	outfile: outputPath,
	bundle: true,
	format: 'cjs',
	platform: 'node',
	external: ['react'],
	loader: { '.css': 'empty' },
	logLevel: 'silent',
});
const { ConnectionsControl, describeConnection, serverRows } = require(outputPath);

test.after(async () => {
	await rm(testDirectory, { recursive: true, force: true });
});

/** Every element the control renders that matches. */
function find(element, matches, found = []) {
	if (Array.isArray(element)) {
		for (const child of element) find(child, matches, found);
		return found;
	}
	if (element === null || typeof element !== 'object') return found;
	const props = element.props ?? {};
	if (matches(props)) found.push(element);
	find(props.children ?? [], matches, found);
	return found;
}
const radioRows = (element) =>
	find(element, (props) => props.role === 'menuitemradio');
const openWindowButtons = (element) =>
	find(
		element,
		(props) =>
			typeof props['aria-label'] === 'string' &&
			props['aria-label'].endsWith('in new window'),
	);

const servers = [
	{ id: 'remote:build', label: 'Build box', status: 'offline' },
	{ id: 'local', label: 'Local', status: 'connected', isLocal: true },
	{ id: 'remote:vps', label: 'VPS', status: 'offline' },
];
const connection = { profileId: 'local', label: 'Local', phase: 'ready', context: {} };

test('the menu lists every remembered server with Local first and marks the window\'s own', () => {
	assert.deepEqual(
		serverRows(servers, 'remote:vps').map((row) => [row.label, row.isCurrent]),
		[
			['Local', false],
			['Build box', false],
			['VPS', true],
		],
	);
	const rows = radioRows(
		ConnectionsControl({
			connection,
			currentProfileId: 'local',
			currentServerLabel: 'Local',
			onSwitch: () => undefined,
			onOpenWindow: () => undefined,
			servers,
		}),
	);
	assert.deepEqual(
		rows.map((row) => [row.props['aria-label'], row.props['aria-checked']]),
		[
			['Local', true],
			['Build box', false],
			['VPS', false],
		],
	);
});

test('choosing another server switches the window, and choosing its own does nothing', () => {
	const switched = [];
	const rows = radioRows(
		ConnectionsControl({
			connection,
			currentProfileId: 'local',
			currentServerLabel: 'Local',
			onSwitch: (profileId) => switched.push(profileId),
			onOpenWindow: () => undefined,
			servers,
		}),
	);
	rows[0].props.onClick();
	assert.deepEqual(switched, []);
	rows[2].props.onClick();
	assert.deepEqual(switched, ['remote:vps']);
});

test('every other server can be opened in a window of its own', () => {
	const opened = [];
	const buttons = openWindowButtons(
		ConnectionsControl({
			connection,
			currentProfileId: 'local',
			currentServerLabel: 'Local',
			onSwitch: () => undefined,
			onOpenWindow: (profileId) => opened.push(profileId),
			servers,
		}),
	);
	// Not offered for the server the window is already showing.
	assert.deepEqual(
		buttons.map((button) => button.props['aria-label']),
		['Open Build box in new window', 'Open VPS in new window'],
	);
	buttons[1].props.onClick();
	assert.deepEqual(opened, ['remote:vps']);
});

test('a switch in progress is shown, holds further choices, and a failure says why', () => {
	const rendered = ConnectionsControl({
		connection,
		currentProfileId: 'local',
		currentServerLabel: 'Local',
		onSwitch: () => undefined,
		onOpenWindow: () => undefined,
		servers,
		switchingProfileId: 'remote:build',
		switchError: 'Could not connect to the server.',
	});
	assert.deepEqual(
		radioRows(rendered).map((row) => row.props.disabled),
		[true, true, true],
	);
	assert.equal(find(rendered, (props) => props.children === 'Connecting…').length, 1);
	const alerts = find(rendered, (props) => props.role === 'alert');
	assert.equal(alerts.length, 1);
	assert.equal(alerts[0].props.children, 'Could not connect to the server.');
});

test('a host that cannot switch shows the one server this window is on', () => {
	const rendered = ConnectionsControl({
		connection: { profileId: 'session', label: 'Studio', phase: 'reconnecting' },
		currentServerLabel: 'Studio',
		servers: [],
	});
	assert.deepEqual(radioRows(rendered), []);
	assert.equal(find(rendered, (props) => props.children === 'Studio').length, 1);
	assert.equal(find(rendered, (props) => props.children === 'Reconnecting…').length, 1);
	assert.deepEqual(describeConnection({ phase: 'unreachable', error: 'no route to host' }), {
		tone: 'failed',
		summary: 'Unreachable',
		detail: 'no route to host',
	});
});
