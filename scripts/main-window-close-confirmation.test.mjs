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
		isLastWindow: () => true,
		showConfirmation: async (_window, options) => {
			receivedOptions = options;
			return { response: 1 };
		},
		requestQuit: () => {
			quitCalls += 1;
		},
		requestClose: () => assert.fail('the last window must request quit'),
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
		isLastWindow: () => true,
		showConfirmation: async () => ({ response: 0 }),
		requestQuit: () => {
			quitCalls += 1;
		},
		requestClose: () => assert.fail('the last window must request quit'),
	});

	const event = window.emitClose();
	await settle();

	assert.equal(event.prevented(), 1);
	assert.equal(quitCalls, 1);
});

test('confirming a busy non-final window closes only that window', async () => {
	const window = createWindow();
	let closeCalls = 0;
	let quitCalls = 0;
	let receivedOptions;
	bindMainWindowCloseConfirmation({
		window,
		isQuitting: () => false,
		getRunningTerminalCount: () => 1,
		isLastWindow: () => false,
		showConfirmation: async (_window, options) => {
			receivedOptions = options;
			return { response: 0 };
		},
		requestQuit: () => {
			quitCalls += 1;
		},
		requestClose: () => {
			closeCalls += 1;
			window.emitClose();
		},
	});

	const event = window.emitClose();
	await settle();

	assert.equal(event.prevented(), 1);
	assert.equal(closeCalls, 1);
	assert.equal(quitCalls, 0);
	assert.deepEqual(receivedOptions.buttons, ['Close Window', 'Keep Running']);
});

test('a renderer-confirmed project close bypasses the native window warning once', () => {
	const window = createWindow();
	let confirmed = true;
	let dialogCalls = 0;
	bindMainWindowCloseConfirmation({
		window,
		isQuitting: () => false,
		getRunningTerminalCount: () => 1,
		isLastWindow: () => false,
		consumeConfirmedClose: () => {
			const value = confirmed;
			confirmed = false;
			return value;
		},
		showConfirmation: async () => {
			dialogCalls += 1;
			return { response: 1 };
		},
		requestQuit: () => assert.fail('confirmed window close must not quit'),
		requestClose: () => assert.fail('the native close is already in progress'),
	});

	const event = window.emitClose();
	assert.equal(event.prevented(), 0);
	assert.equal(dialogCalls, 0);
});

test('explicit application quit bypasses close confirmation', () => {
	const window = createWindow();
	let dialogCalls = 0;
	bindMainWindowCloseConfirmation({
		window,
		isQuitting: () => true,
		getRunningTerminalCount: () => 1,
		isLastWindow: () => true,
		showConfirmation: async () => {
			dialogCalls += 1;
			return { response: 1 };
		},
		requestQuit: () => assert.fail('quit should not be requested twice'),
		requestClose: () => assert.fail('close should not be requested while quitting'),
	});

	const event = window.emitClose();

	assert.equal(event.prevented(), 0);
	assert.equal(dialogCalls, 0);
});

test('an app containing only idle shells closes without a dialog', async () => {
	const window = createWindow();
	let dialogCalls = 0;
	let closeCalls = 0;
	bindMainWindowCloseConfirmation({
		window,
		isQuitting: () => false,
		getRunningTerminalCount: () => 0,
		isLastWindow: () => true,
		showConfirmation: async () => {
			dialogCalls += 1;
			return { response: 1 };
		},
		requestQuit: () => assert.fail('idle close should not quit'),
		requestClose: () => {
			closeCalls += 1;
			window.emitClose();
		},
	});
	const event = window.emitClose();
	assert.equal(event.prevented(), 1);
	await settle();
	assert.equal(dialogCalls, 0);
	assert.equal(closeCalls, 1);
});

test('a delayed busy observation still warns before closing', async () => {
	const window = createWindow();
	let dialogCalls = 0;
	let closeCalls = 0;
	let receivedOptions;
	bindMainWindowCloseConfirmation({
		window,
		isQuitting: () => false,
		getRunningTerminalCount: async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
			return 1;
		},
		isLastWindow: () => false,
		showConfirmation: async (_window, options) => {
			dialogCalls += 1;
			receivedOptions = options;
			return { response: 1 };
		},
		requestQuit: () => assert.fail('Keep Running must not quit'),
		requestClose: () => {
			closeCalls += 1;
		},
	});

	const event = window.emitClose();
	assert.equal(event.prevented(), 1);
	assert.equal(dialogCalls, 0);
	await new Promise((resolve) => setTimeout(resolve, 50));
	assert.equal(dialogCalls, 1);
	assert.equal(closeCalls, 0);
	assert.deepEqual(receivedOptions.buttons, ['Close Window', 'Keep Running']);
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
		isLastWindow: () => true,
		showConfirmation: () => {
			dialogCalls += 1;
			return dialogResult;
		},
		requestQuit: () => undefined,
		requestClose: () => assert.fail('the last window must request quit'),
	});

	const first = window.emitClose();
	const second = window.emitClose();
	assert.equal(first.prevented(), 1);
	assert.equal(second.prevented(), 1);
	assert.equal(dialogCalls, 0);
	await settle();
	assert.equal(dialogCalls, 1);
	const third = window.emitClose();
	assert.equal(third.prevented(), 1);
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
