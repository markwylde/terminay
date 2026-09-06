import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

async function loadMenuModule() {
	const directory = await mkdtemp(join(tmpdir(), 'terminay-diagnostics-menu-'));
	const electronStub = join(directory, 'electron-stub.mjs');
	const output = join(directory, 'menu.mjs');
	await writeFile(
		electronStub,
		`export const dialog = { showMessageBox: (options) => globalThis.__terminayTestShowMessageBox(options) };\nexport const shell = { openPath: (path) => globalThis.__terminayTestOpenPath(path) };\n`,
		'utf8',
	);
	await build({
		bundle: true,
		entryPoints: ['electron/diagnostics/menu.ts'],
		format: 'esm',
		logLevel: 'silent',
		outfile: output,
		platform: 'node',
		plugins: [
			{
				name: 'electron-test-stub',
				setup(buildApi) {
					buildApi.onResolve({ filter: /^electron$/ }, () => ({
						path: electronStub,
					}));
				},
			},
		],
		target: 'node20',
	});
	return {
		module: await import(pathToFileURL(output).href),
		remove: () => rm(directory, { recursive: true, force: true }),
	};
}

test('native defaults use a cancel-by-default confirmation and the canonical path', async () => {
	const loaded = await loadMenuModule();
	try {
		const calls = [];
		globalThis.__terminayTestOpenPath = async (path) => {
			calls.push(['open', path]);
			return '';
		};
		globalThis.__terminayTestShowMessageBox = async (options) => {
			calls.push(['confirm', options]);
			return { response: 1 };
		};

		await loaded.module.revealDiagnosticsFolder('/canonical/diagnostics');
		const cleared = await loaded.module.clearDiagnosticsWithConfirmation({
			directory: '/canonical/diagnostics',
			clearManagedArtifacts: async () => calls.push(['clear']),
			recordCleared: async () => calls.push(['record']),
		});

		assert.equal(cleared, false);
		assert.deepEqual(calls[0], ['open', '/canonical/diagnostics']);
		assert.deepEqual(calls[1][1].buttons, ['Clear Diagnostics', 'Cancel']);
		assert.equal(calls[1][1].defaultId, 1);
		assert.equal(calls[1][1].cancelId, 1);
		assert.equal(calls[1][1].noLink, true);
		assert.equal(
			calls.some(([operation]) => operation === 'clear'),
			false,
		);
	} finally {
		delete globalThis.__terminayTestOpenPath;
		delete globalThis.__terminayTestShowMessageBox;
		await loaded.remove();
	}
});

test('reveal opens exactly the canonical diagnostics directory', async () => {
	const loaded = await loadMenuModule();
	try {
		const opened = [];
		await loaded.module.revealDiagnosticsFolder('/canonical/diagnostics', {
			openPath: async (path) => {
				opened.push(path);
				return '';
			},
			confirmClear: async () => false,
		});
		assert.deepEqual(opened, ['/canonical/diagnostics']);

		await assert.rejects(
			loaded.module.revealDiagnosticsFolder('/canonical/diagnostics', {
				openPath: async () => 'not found',
				confirmClear: async () => false,
			}),
			/could not reveal the Diagnostics folder: not found/u,
		);
	} finally {
		await loaded.remove();
	}
});

test('clear is cancel-safe and records the clear only after managed artifacts are cleared', async () => {
	const loaded = await loadMenuModule();
	try {
		const calls = [];
		const options = {
			directory: '/canonical/diagnostics',
			clearManagedArtifacts: async () => calls.push('clear'),
			recordCleared: async () => calls.push('record'),
		};
		const cancelled = await loaded.module.clearDiagnosticsWithConfirmation(
			options,
			{
				openPath: async () => '',
				confirmClear: async () => {
					calls.push('confirm-cancel');
					return false;
				},
			},
		);
		assert.equal(cancelled, false);
		assert.deepEqual(calls, ['confirm-cancel']);

		calls.length = 0;
		const cleared = await loaded.module.clearDiagnosticsWithConfirmation(
			options,
			{
				openPath: async () => '',
				confirmClear: async () => {
					calls.push('confirm-clear');
					return true;
				},
			},
		);
		assert.equal(cleared, true);
		assert.deepEqual(calls, ['confirm-clear', 'clear', 'record']);
	} finally {
		await loaded.remove();
	}
});

test('Help menu actions do not depend on a renderer or local server and contain failures', async () => {
	const loaded = await loadMenuModule();
	try {
		const failures = [];
		let confirmCalls = 0;
		const items = loaded.module.createDiagnosticsHelpMenuItems(
			{
				directory: '/canonical/diagnostics',
				clearManagedArtifacts: async () => {
					throw new Error('writer degraded');
				},
				recordCleared: async () =>
					assert.fail('must not record a failed clear'),
				reportFailure: (operation, error) =>
					failures.push([operation, error.message]),
			},
			{
				openPath: async () => 'shell failed',
				confirmClear: async () => {
					confirmCalls += 1;
					return true;
				},
			},
		);

		assert.deepEqual(
			items.map((item) => item.label),
			['Reveal Diagnostics Folder', 'Clear Diagnostics…'],
		);
		items[0].click();
		items[1].click();
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(confirmCalls, 1);
		assert.deepEqual(failures, [
			['reveal', 'could not reveal the Diagnostics folder: shell failed'],
			['clear', 'writer degraded'],
		]);
	} finally {
		await loaded.remove();
	}
});

test('Help menu opens the Performance Log window', async () => {
	const loaded = await loadMenuModule();
	try {
		const opened = [];
		const items = loaded.module.createDiagnosticsHelpMenuItems(
			{
				directory: '/canonical/diagnostics',
				clearManagedArtifacts: async () =>
					assert.fail('must not clear from the Performance Log item'),
				recordCleared: async () =>
					assert.fail('must not record a clear from the Performance Log item'),
				performanceLog: {
					canOpen: () => true,
					open: async () => {
						opened.push('performance-log');
					},
				},
			},
			{
				openPath: async () => '',
				confirmClear: async () => false,
			},
		);
		assert.equal(items[0].label, 'Performance Log');
		assert.equal(items[0].enabled, true);
		// It is an action, not a state toggle: the opt-in collector's control
		// lives only in Settings now.
		assert.equal(items[0].type, undefined);
		assert.equal(items[0].checked, undefined);
		assert.equal(items[1].type, 'separator');
		assert.equal(items[2].label, 'Reveal Diagnostics Folder');
		items[0].click();
		await new Promise((resolve) => setImmediate(resolve));
		assert.deepEqual(opened, ['performance-log']);
	} finally {
		await loaded.remove();
	}
});

test('no Help item toggles performance logging any more', async () => {
	const loaded = await loadMenuModule();
	try {
		const items = loaded.module.createDiagnosticsHelpMenuItems(
			{
				directory: '/canonical/diagnostics',
				clearManagedArtifacts: async () => undefined,
				recordCleared: async () => undefined,
				performanceLog: { canOpen: () => true, open: () => undefined },
			},
			{ openPath: async () => '', confirmClear: async () => false },
		);
		for (const item of items) {
			assert.notEqual(item.label, 'Performance Logging');
			assert.notEqual(item.type, 'checkbox');
		}
	} finally {
		await loaded.remove();
	}
});

test('Performance Log is unavailable with no window while reveal and clear work', async () => {
	const loaded = await loadMenuModule();
	try {
		const revealed = [];
		let cleared = false;
		const items = loaded.module.createDiagnosticsHelpMenuItems(
			{
				directory: '/canonical/diagnostics',
				clearManagedArtifacts: async () => {
					cleared = true;
				},
				recordCleared: async () => undefined,
				performanceLog: {
					canOpen: () => false,
					open: () => assert.fail('must not open without a window'),
				},
			},
			{
				openPath: async (path) => {
					revealed.push(path);
					return '';
				},
				confirmClear: async () => true,
			},
		);
		assert.equal(items[0].label, 'Performance Log');
		assert.equal(items[0].enabled, false);

		items[2].click();
		await new Promise((resolve) => setImmediate(resolve));
		assert.deepEqual(revealed, ['/canonical/diagnostics']);

		items[3].click();
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(cleared, true);
	} finally {
		await loaded.remove();
	}
});
