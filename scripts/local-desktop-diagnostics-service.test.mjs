import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const serviceModule = await importBundled(
	'../electron/diagnostics/service.ts',
	'service',
);
const eventsModule = await importBundled(
	'../electron/diagnostics/electronEvents.ts',
	'electron-events',
);

const {
	bindFatalProcessDiagnostics,
	initializeDesktopDiagnostics,
} = serviceModule;
const {
	bindAppChildDiagnostics,
	bindWebContentsDiagnostics,
	classifyDiagnosticUrl,
} = eventsModule;

async function readEvents(directory) {
	const names = (await readdir(directory)).filter((name) => name.endsWith('.jsonl'));
	const events = [];
	for (const name of names) {
		const content = await readFile(join(directory, name), 'utf8');
		for (const line of content.split('\n')) {
			if (line.length > 0) events.push(JSON.parse(line));
		}
	}
	return events;
}

test('Desktop diagnostics initializes local Crashpad, captures output, and marks a clean launch', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'terminay-diagnostics-service-'));
	const paths = new Map([['logs', directory]]);
	const crashStarts = [];
	const app = {
		getPath: (name) => paths.get(name),
		getVersion: () => '1.2.3-test',
		setPath: (name, value) => paths.set(name, value),
	};
	try {
		const diagnostics = await initializeDesktopDiagnostics({
			app,
			crashReporter: { start: (options) => crashStarts.push(options) },
			launchId: 'service-launch',
		});
		assert.deepEqual(crashStarts, [{ uploadToServer: false }]);
		assert.equal(paths.get('crashDumps'), join(directory, 'crash-dumps'));
		process.stdout.write('diagnostic stdout canary\n');
		process.stderr.write('diagnostic stderr canary\n');
		await diagnostics.record(
			{
				component: 'local-server',
				event: 'local-server.ready',
				severity: 'info',
				source: 'local-server',
			},
			{ channel: 'lifecycle' },
		);
		await diagnostics.close({ clean: true });

		const events = await readEvents(directory);
		assert.ok(events.some(({ event }) => event === 'diagnostics.launch.started'));
		assert.ok(events.some(({ event }) => event === 'main.stdout'));
		assert.ok(events.some(({ event }) => event === 'main.stderr'));
		assert.ok(events.some(({ event }) => event === 'local-server.ready'));
		assert.ok(events.some(({ event }) => event === 'diagnostics.launch.clean-exit'));
		const marker = JSON.parse(
			await readFile(join(directory, 'terminay-launch-v1.json'), 'utf8'),
		);
		assert.equal(marker.state, 'clean');
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});

test('fatal observation records synchronously and cannot turn failure into continued execution', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'terminay-diagnostics-fatal-'));
	const paths = new Map([['logs', directory]]);
	try {
		const diagnostics = await initializeDesktopDiagnostics({
			app: {
				getPath: (name) => paths.get(name),
				getVersion: () => 'test',
				setPath: (name, value) => paths.set(name, value),
			},
			crashReporter: { start: () => undefined },
			launchId: 'fatal-launch',
		});
		const uncaughtBefore = process.listenerCount('uncaughtException');
		const existingUncaughtHandlers = new Set(
			process.listeners('uncaughtException'),
		);
		let terminationRequested = false;
		const unbind = bindFatalProcessDiagnostics(diagnostics, {
			terminate: () => {
				terminationRequested = true;
			},
		});
		assert.equal(
			process.listenerCount('uncaughtException'),
			uncaughtBefore + 1,
		);
		const installedHandler = process
			.listeners('uncaughtException')
			.find((handler) => !existingUncaughtHandlers.has(handler));
		assert.ok(installedHandler);
		installedHandler(
			new Error('fatal monitor canary'),
			'uncaughtException',
		);
		assert.equal(terminationRequested, true);
		unbind();
		await diagnostics.close({ clean: false });
		const events = await readEvents(directory);
		assert.ok(events.some(({ event }) => event === 'main.uncaught-exception'));
		const source = await readFile(
			new URL('../electron/diagnostics/service.ts', import.meta.url),
			'utf8',
		);
		assert.match(source, /process\.prependListener\('uncaughtException'/u);
		assert.match(source, /process\.abort\(\)/u);
		assert.match(source, /process\.on\('unhandledRejection'/u);
		assert.match(source, /setImmediate\(\(\) => \{[\s\S]*throw reason/u);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});

test('an unusable diagnostics directory degrades without preventing application startup', async () => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-diagnostics-unusable-'));
	const occupied = join(root, 'occupied');
	await writeFile(occupied, 'not a directory');
	let diagnostics;
	try {
		diagnostics = await initializeDesktopDiagnostics({
			app: {
				getPath: (name) =>
					name === 'logs' ? occupied : join(root, String(name)),
				getVersion: () => 'test',
				setPath: () => undefined,
			},
			crashReporter: { start: () => undefined },
			launchId: 'degraded-launch',
		});
		await diagnostics.record({
			component: 'main',
			event: 'main.ready',
			severity: 'info',
			source: 'main-lifecycle',
		});
		await diagnostics.close({ clean: false });
	} finally {
		await diagnostics?.close({ clean: false });
		await rm(root, { force: true, recursive: true });
	}
});

test('URL classification never returns path, credentials, host, query, or fragment', () => {
	for (const [value, expected] of [
		['file:///Users/person/private/index.html?secret=yes#token', 'file-app'],
		['https://person:password@example.test/private?secret=yes#token', 'network-document'],
		['data:text/html,private-content', 'data-document'],
		['not a URL', 'invalid-document'],
	]) {
		assert.equal(classifyDiagnosticUrl(value), expected);
	}
});

test('WebContents events are registered once and classify load, crash, hang, and stack outcomes', async () => {
	const records = [];
	let now = 1_000;
	const diagnostics = {
		record: async (input, options) => {
			records.push({ input, options });
		},
	};
	const app = new EventEmitter();
	app.getAppMetrics = () => [
		{
			cpu: { idleWakeupsPerSecond: 2, percentCPUUsage: 3 },
			memory: { workingSetSize: 4 },
			pid: 42,
			type: 'Tab',
		},
	];
	const contents = new EventEmitter();
	contents.id = 7;
	contents.getOSProcessId = () => 42;
	contents.mainFrame = {
		collectJavaScriptCallStack: async () => 'at blocked (app.js:10:2)',
	};

	bindWebContentsDiagnostics({ app, contents, diagnostics, now: () => now });
	bindWebContentsDiagnostics({ app, contents, diagnostics, now: () => now });
	contents.emit('console-message', { level: 'warning', message: 'one warning' });
	contents.emit(
		'preload-error',
		{},
		'/Users/private/preload.js',
		new Error('preload failed'),
	);
	contents.emit(
		'did-fail-load',
		{},
		-105,
		'NAME_NOT_RESOLVED',
		'https://person:secret@example.test/private?token=yes',
		true,
	);
	contents.emit('unresponsive');
	contents.emit('unresponsive');
	await new Promise((resolve) => setImmediate(resolve));
	now += 250;
	contents.emit('responsive');
	contents.emit('render-process-gone', {}, { exitCode: 9, reason: 'oom' });
	contents.emit('destroyed');
	await new Promise((resolve) => setImmediate(resolve));

	const names = records.map(({ input }) => input.event);
	assert.equal(names.filter((name) => name === 'renderer.console').length, 1);
	assert.equal(names.filter((name) => name === 'renderer.unresponsive').length, 1);
	assert.ok(names.includes('renderer.stack-collected'));
	assert.ok(names.includes('renderer.responsive'));
	assert.ok(names.includes('renderer.process-gone'));
	const load = records.find(({ input }) => input.event === 'renderer.load-failed');
	assert.deepEqual(load.input.fields, {
		errorCode: -105,
		isMainFrame: true,
		urlClass: 'network-document',
	});
	const gone = records.find(({ input }) => input.event === 'renderer.process-gone');
	assert.equal(gone.input.fields.reason, 'oom');
	assert.equal(gone.input.fields.metrics.memoryWorkingSetKiB, 4);
	const responsive = records.find(({ input }) => input.event === 'renderer.responsive');
	assert.equal(responsive.input.fields.durationMs, 250);
	assert.equal(JSON.stringify(records).includes('example.test'), false);
});

test('Electron child failures have a separate lifecycle source', async () => {
	const records = [];
	const app = new EventEmitter();
	const unbind = bindAppChildDiagnostics({
		app,
		diagnostics: { record: async (input, options) => records.push({ input, options }) },
	});
	app.emit('child-process-gone', {}, {
		exitCode: 11,
		name: 'GPU Process',
		reason: 'crashed',
		serviceName: 'gpu',
		type: 'GPU',
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(records.length, 1);
	assert.equal(records[0].input.event, 'electron-child.process-gone');
	assert.equal(records[0].input.fields.reason, 'crashed');
	assert.equal(records[0].options.channel, 'lifecycle');
	unbind();
	app.emit('child-process-gone', {}, { exitCode: 0, reason: 'clean-exit', type: 'Utility' });
	assert.equal(records.length, 1);
});

async function importBundled(relativePath, name) {
	const temporaryDirectory = await mkdtemp(
		join(tmpdir(), `terminay-diagnostics-${name}-bundle-`),
	);
	const outputPath = join(temporaryDirectory, `${name}.mjs`);
	try {
		await build({
			bundle: true,
			entryPoints: [new URL(relativePath, import.meta.url).pathname],
			format: 'esm',
			outfile: outputPath,
			platform: 'node',
			target: 'node24',
		});
		return await import(outputPath);
	} finally {
		await rm(temporaryDirectory, { force: true, recursive: true });
	}
}
