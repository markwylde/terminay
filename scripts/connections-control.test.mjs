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
const { ConnectionsControl, describeConnection } = require(outputPath);

test.after(async () => {
	await rm(testDirectory, { recursive: true, force: true });
});

/** Every row the control renders as part of its radio group. */
function radioRows(element, found = []) {
	if (Array.isArray(element)) {
		for (const child of element) radioRows(child, found);
		return found;
	}
	if (element === null || typeof element !== 'object') return found;
	const props = element.props ?? {};
	if (props.role === 'menuitemradio') found.push(element);
	radioRows(props.children ?? [], found);
	return found;
}

function connection(profileId, serverId, label, overrides = {}) {
	return {
		profileId,
		serverId,
		label,
		role: profileId === 'local' ? 'primary' : 'attached',
		phase: 'ready',
		context: {},
		...overrides,
	};
}

test('choosing a connection row activates that server', () => {
	const selected = [];
	const rows = radioRows(
		ConnectionsControl({
			activeServerId: 'server-a',
			connections: [
				connection('local', 'server-a', 'Laptop'),
				connection('build', 'server-b', 'Build box'),
			],
			currentServerLabel: 'Laptop',
			onAttach: () => undefined,
			onDetach: () => undefined,
			onSelect: (serverId) => selected.push(serverId),
			profiles: [],
			supportsAttach: true,
		}),
	);
	assert.equal(rows.length, 2);
	// The active server is the checked row of the group.
	assert.deepEqual(
		rows.map((row) => row.props['aria-checked']),
		[true, false],
	);
	rows[1].props.onClick();
	assert.deepEqual(selected, ['server-b']);
});

test('a connection with no live context cannot be gone to', () => {
	const selected = [];
	const rows = radioRows(
		ConnectionsControl({
			connections: [
				connection('build', 'server-b', 'Build box', {
					phase: 'unreachable',
					context: undefined,
					error: 'no route to host',
				}),
			],
			currentServerLabel: 'Laptop',
			onAttach: () => undefined,
			onDetach: () => undefined,
			onSelect: (serverId) => selected.push(serverId),
			profiles: [],
			supportsAttach: true,
		}),
	);
	assert.equal(rows[0].props.disabled, true);
	assert.deepEqual(describeConnection({ phase: 'unreachable', error: 'no route to host' }), {
		tone: 'failed',
		summary: 'Unreachable',
		detail: 'no route to host',
	});
	assert.deepEqual(selected, []);
});
