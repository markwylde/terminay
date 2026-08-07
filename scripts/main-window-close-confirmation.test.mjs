import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const { bindMainWindowCloseConfirmation } = await importCloseConfirmation();

test('Keep Running is the safe default and leaves the main window open', async () => {
	const window = createWindow();
	let quitCalls = 0;
	let receivedOptions;
	bindMainWindowCloseConfirmation({
		window,
		isQuitting: () => false,
		getRunningTerminalCount: () => 2,
		showConfirmation: async (_window, options) => {
			receivedOptions = options;
			return { response: 1 };
		},
		requestQuit: () => {
			quitCalls += 1;
		},
	});

	const event = window.emitClose();
	await settle();

	assert.equal(event.prevented(), 1);
	assert.equal(quitCalls, 0);
	assert.deepEqual(receivedOptions.buttons, ['Quit Terminay', 'Keep Running']);
	assert.equal(receivedOptions.defaultId, 1);
	assert.equal(receivedOptions.cancelId, 1);
});

test('Quit requests normal application shutdown after preventing the window close', async () => {
	const window = createWindow();
	let quitCalls = 0;
	bindMainWindowCloseConfirmation({
		window,
		isQuitting: () => false,
		getRunningTerminalCount: () => 1,
		showConfirmation: async () => ({ response: 0 }),
		requestQuit: () => {
			quitCalls += 1;
		},
	});

	const event = window.emitClose();
	await settle();

	assert.equal(event.prevented(), 1);
	assert.equal(quitCalls, 1);
});

test('explicit application quit bypasses close confirmation', () => {
	const window = createWindow();
	let dialogCalls = 0;
	bindMainWindowCloseConfirmation({
		window,
		isQuitting: () => true,
		getRunningTerminalCount: () => 1,
		showConfirmation: async () => {
			dialogCalls += 1;
			return { response: 1 };
		},
		requestQuit: () => assert.fail('quit should not be requested twice'),
	});

	const event = window.emitClose();

	assert.equal(event.prevented(), 0);
	assert.equal(dialogCalls, 0);
});

test('an app containing only idle shells closes without a dialog', () => {
	const window = createWindow();
	let dialogCalls = 0;
	bindMainWindowCloseConfirmation({
		window,
		isQuitting: () => false,
		getRunningTerminalCount: () => 0,
		showConfirmation: async () => {
			dialogCalls += 1;
			return { response: 1 };
		},
		requestQuit: () => assert.fail('idle close should use the native path'),
	});
	const event = window.emitClose();
	assert.equal(event.prevented(), 0);
	assert.equal(dialogCalls, 0);
});

test('repeat close attempts share one pending confirmation', async () => {
	const window = createWindow();
	let resolveDialog;
	let dialogCalls = 0;
	const dialogResult = new Promise((resolve) => {
		resolveDialog = resolve;
	});
	bindMainWindowCloseConfirmation({
		window,
		isQuitting: () => false,
		getRunningTerminalCount: () => 1,
		showConfirmation: () => {
			dialogCalls += 1;
			return dialogResult;
		},
		requestQuit: () => undefined,
	});

	const first = window.emitClose();
	const second = window.emitClose();
	assert.equal(first.prevented(), 1);
	assert.equal(second.prevented(), 1);
	assert.equal(dialogCalls, 1);
	resolveDialog({ response: 1 });
	await settle();
});

function createWindow() {
	let listener;
	return {
		isDestroyed: () => false,
		on: (event, nextListener) => {
			assert.equal(event, 'close');
			listener = nextListener;
		},
		emitClose: () => {
			let preventions = 0;
			listener({
				preventDefault: () => {
					preventions += 1;
				},
			});
			return { prevented: () => preventions };
		},
	};
}

async function settle() {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

async function importCloseConfirmation() {
	const directory = await mkdtemp(
		join(tmpdir(), 'terminay-close-confirmation-'),
	);
	const outputPath = join(directory, 'close-confirmation.mjs');
	try {
		await build({
			bundle: true,
			format: 'esm',
			outfile: outputPath,
			platform: 'node',
			stdin: {
				contents: `export { bindMainWindowCloseConfirmation } from ${JSON.stringify(new URL('../electron/mainWindowCloseConfirmation.ts', import.meta.url).pathname)}`,
				loader: 'ts',
				resolveDir: process.cwd(),
			},
			target: 'node24',
		});
		return await import(outputPath);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
