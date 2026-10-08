import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const testDirectory = await mkdtemp(
	join(process.cwd(), '.connection-state-servers-test-'),
);

const outputPath = join(testDirectory, 'connection-state-servers.cjs');
await build({
	entryPoints: ['src/web/ConnectionStateServers.tsx'],
	outfile: outputPath,
	bundle: true,
	format: 'cjs',
	platform: 'node',
	jsx: 'automatic',
	external: ['react', 'react/jsx-runtime'],
	loader: { '.css': 'empty' },
	logLevel: 'silent',
});
const { ConnectionStateServerList, ConnectionStateServers, otherServers } =
	require(outputPath);
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

test.after(async () => {
	await rm(testDirectory, { recursive: true, force: true });
});

const PROFILES = [
	{ id: 'box', label: 'Build box', status: 'incompatible' },
	{ id: 'local', label: 'Local', status: 'connected', isLocal: true },
	{ id: 'vm', label: 'VM', status: 'offline' },
];

test('a window can leave for every server but its own, Local first', () => {
	assert.deepEqual(
		otherServers(PROFILES, 'box').map((profile) => profile.id),
		['local', 'vm'],
	);
	assert.deepEqual(
		otherServers(PROFILES, 'local').map((profile) => profile.id),
		['box', 'vm'],
	);
});

/** Every button the list renders, with the props a click would use. */
function buttons(element, found = []) {
	if (Array.isArray(element)) {
		for (const child of element) buttons(child, found);
		return found;
	}
	if (element === null || typeof element !== 'object') return found;
	if (element.type === 'button') found.push(element.props);
	buttons(element.props?.children, found);
	return found;
}

test('a server that cannot be shown offers the switch back to Local', () => {
	const switched = [];
	const list = ConnectionStateServerList({
		servers: otherServers(PROFILES, 'box'),
		onSwitch: (profileId) => switched.push(profileId),
	});
	const rendered = buttons(list);
	assert.deepEqual(
		rendered.map((button) => button.children),
		['Switch to Local', 'Switch to VM'],
	);
	rendered[0].onClick();
	assert.deepEqual(switched, ['local']);
});

test('a switch in progress holds the others, and a failed one says why', () => {
	const switching = buttons(
		ConnectionStateServerList({
			servers: otherServers(PROFILES, 'box'),
			switchingTo: 'vm',
			onSwitch: () => {},
		}),
	);
	assert.deepEqual(
		switching.map((button) => [button.children, button.disabled]),
		[
			['Switch to Local', true],
			['Switching to VM…', true],
		],
	);
	const failed = renderToStaticMarkup(
		createElement(ConnectionStateServerList, {
			servers: otherServers(PROFILES, 'box'),
			failure: 'That server did not answer.',
			onSwitch: () => {},
		}),
	);
	assert.match(failed, /role="alert">That server did not answer\.</);
});

test('nothing is offered where there is nowhere to go', () => {
	assert.equal(
		ConnectionStateServerList({ servers: [], onSwitch: () => {} }),
		null,
	);
	// A browser session's host cannot switch servers at all.
	assert.equal(
		renderToStaticMarkup(
			createElement(ConnectionStateServers, {
				host: { supportsAttach: false, listProfiles: async () => PROFILES },
			}),
		),
		'',
	);
});
