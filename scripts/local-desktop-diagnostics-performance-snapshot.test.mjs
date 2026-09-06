import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const main = await readFile(
	new URL('../electron/main.ts', import.meta.url),
	'utf8',
);
const nativeActions = await readFile(
	new URL('../src/host/nativeActions.ts', import.meta.url),
	'utf8',
);
const nativeEvents = await readFile(
	new URL('../src/host/nativeEvents.ts', import.meta.url),
	'utf8',
);

function handlerBody() {
	const start = main.indexOf("case 'diagnostics.performance-snapshot.read':");
	assert.ok(start > 0, 'the snapshot action is not handled in main');
	return main.slice(start, main.indexOf('\n\t\t\t\t}', start));
}

test('a window bound to a remote profile is refused the snapshot', () => {
	const body = handlerBody();
	assert.match(
		body,
		/launch\.context\.profileId !== embeddedLocalProfileId/u,
		'the handler does not check the requesting profile',
	);
	assert.match(body, /throw new Error\(/u, 'a remote profile is not refused');
	// The refusal must precede any sampling work.
	assert.ok(
		body.indexOf('embeddedLocalProfileId') <
			body.indexOf('buildPerformanceSnapshot'),
	);
});

test('the snapshot carries values only, never a path or reading capability', () => {
	const start = main.indexOf('async function buildPerformanceSnapshot');
	assert.ok(start > 0);
	// Compare code only: the comments explain what is deliberately excluded.
	const body = main
		.slice(start, main.indexOf('\n}', start))
		.replaceAll(/\/\/[^\n]*/gu, '');
	for (const forbidden of [
		'directory',
		'getPath',
		'readFile',
		'filePath',
		'desktopDiagnostics',
		'title',
		'cwd',
	]) {
		assert.ok(
			!body.includes(forbidden),
			`the snapshot must not expose ${forbidden}`,
		);
	}
	// Sessions cross as identity only.
	assert.match(body, /sessionId: session\.sessionId/u);
	assert.match(body, /projectId: session\.projectId/u);
});

test('sampling is refcounted by window and released on close', () => {
	const start = main.indexOf('function bindPerformanceLogWindow');
	const body = main.slice(start, main.indexOf('\n}', start));
	assert.ok(start > 0, 'no window binding exists');
	assert.match(body, /desktopRuntimeMetrics\.subscribe\(\)/u);
	assert.match(body, /window\.once\('closed', release\)/u);
	assert.match(body, /window\.webContents\.once\('destroyed', release\)/u);
	// A repeat bind must not take a second subscription for one window.
	assert.match(body, /if \(performanceLogWindows\.has\(id\)\) return;/u);
});

test('snapshots are broadcast only to Performance Log windows', () => {
	const start = main.indexOf('async function broadcastPerformanceSnapshot');
	const body = main.slice(start, main.indexOf('\n}', start));
	assert.ok(start > 0);
	assert.match(body, /if \(performanceLogWindows\.size === 0\) return;/u);
	assert.match(
		body,
		/if \(!performanceLogWindows\.has\(window\.webContents\.id\)\) continue;/u,
	);
	// A sampling failure must not take down the window or the collector.
	assert.match(body, /catch \{[\s\S]{0,160}return;/u);
});

test('the renderer helpers are inert in a browser host', () => {
	const actionStart = nativeActions.indexOf(
		'export async function readDesktopPerformanceSnapshot',
	);
	assert.ok(actionStart > 0);
	const actionBody = nativeActions.slice(
		actionStart,
		nativeActions.indexOf('\n}', actionStart),
	);
	assert.match(actionBody, /if \(!response\.handled\) return null;/u);

	const eventStart = nativeEvents.indexOf(
		'export function subscribeDesktopPerformanceSnapshot',
	);
	assert.ok(eventStart > 0);
	const eventBody = nativeEvents.slice(
		eventStart,
		nativeEvents.indexOf('\n}', eventStart),
	);
	assert.match(eventBody, /typeof window === 'undefined'/u);
	assert.match(eventBody, /host === undefined\) return \(\) => undefined;/u);
});

test('the snapshot rides the existing bridge and is never replayed stale', async () => {
	const preload = await readFile(
		new URL('../electron/serverUiPreload.ts', import.meta.url),
		'utf8',
	);
	// No new preload channel: it uses requestAction and server-ui-host:event.
	assert.ok(!preload.includes('performance-snapshot'));
	assert.match(preload, /'server-ui-host:event'/u);
	// A snapshot is superseded every second, so replaying one to a late
	// subscriber would show stale numbers. It stays out of the replay set.
	const replayStart = preload.indexOf('const isReplayableHostEvent');
	const replaySet = preload.slice(
		replayStart,
		preload.indexOf(';', replayStart),
	);
	assert.ok(!replaySet.includes('performance-snapshot'));
});
