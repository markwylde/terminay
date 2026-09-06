import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const {
	STARTUP_PHASE_IDS,
	STARTUP_SUB_PHASE_IDS,
	StartupTimeline,
	startupPhaseLabel,
} = await importBundled('../electron/diagnostics/startupTimeline.ts');

function createClock(start = 0) {
	let now = start;
	return {
		now: () => now,
		advance(ms) {
			now += ms;
		},
	};
}

test('phases record ordered offsets and durations', () => {
	const clock = createClock(500);
	const timeline = new StartupTimeline({ now: clock.now });

	timeline.begin('electron-ready');
	clock.advance(40);
	timeline.end('electron-ready');
	clock.advance(10);
	timeline.begin('workspace-restore');
	clock.advance(250);
	timeline.end('workspace-restore');

	const { phases, totalMs } = timeline.snapshot();
	assert.equal(phases.length, 2);
	assert.deepEqual(
		phases.map((phase) => [phase.id, phase.startOffsetMs, phase.durationMs]),
		[
			['electron-ready', 0, 40],
			['workspace-restore', 50, 250],
		],
	);
	assert.equal(totalMs, 300);
	assert.ok(phases.every((phase) => phase.outcome === 'completed'));
});

test('a phase left open reports as running with no duration', () => {
	const clock = createClock();
	const timeline = new StartupTimeline({ now: clock.now });

	timeline.begin('server-compose');
	clock.advance(80);

	const [phase] = timeline.snapshot().phases;
	assert.equal(phase.outcome, 'running');
	assert.equal(phase.durationMs, undefined);
	assert.equal(timeline.currentLabel(), startupPhaseLabel('server-compose'));
});

test('failure closes every running phase and preserves earlier durations', () => {
	const clock = createClock();
	const timeline = new StartupTimeline({ now: clock.now });

	timeline.begin('electron-ready');
	clock.advance(20);
	timeline.end('electron-ready');
	timeline.begin('workspace-restore');
	clock.advance(100);
	timeline.fail('workspace persistence could not be read');

	const { phases, complete } = timeline.snapshot();
	assert.equal(complete, false);
	assert.equal(phases[0].outcome, 'completed');
	assert.equal(phases[0].durationMs, 20);
	assert.equal(phases[1].outcome, 'failed');
	assert.equal(phases[1].durationMs, 100);
	assert.equal(
		phases[1].failureReason,
		'workspace persistence could not be read',
	);
});

test('sub-phases attribute to the top-level phase that was running', () => {
	const timeline = new StartupTimeline({ now: createClock().now });

	timeline.begin('server-compose');
	timeline.begin('vault-open');
	timeline.end('vault-open');
	timeline.begin('shell-profiles-load');
	timeline.end('shell-profiles-load');
	timeline.end('server-compose');

	const byId = new Map(
		timeline.snapshot().phases.map((phase) => [phase.id, phase]),
	);
	assert.equal(byId.get('vault-open').parentId, 'server-compose');
	assert.equal(byId.get('shell-profiles-load').parentId, 'server-compose');
	assert.equal(byId.get('server-compose').parentId, undefined);
});

test('re-opening a running phase and closing an unopened one are ignored', () => {
	const clock = createClock();
	const timeline = new StartupTimeline({ now: clock.now });

	timeline.begin('native-menu');
	clock.advance(30);
	timeline.begin('native-menu');
	timeline.end('vault-unlock');
	clock.advance(10);
	timeline.end('native-menu');

	const { phases } = timeline.snapshot();
	assert.equal(phases.length, 1);
	assert.equal(phases[0].durationMs, 40);
});

test('completing the handoff marks the timeline complete', () => {
	const timeline = new StartupTimeline({ now: createClock().now });
	timeline.begin('ui-handoff');
	assert.equal(timeline.snapshot().complete, false);
	timeline.end('ui-handoff');
	assert.equal(timeline.snapshot().complete, true);
});

test('every phase id has a distinct product-authored label', () => {
	const ids = [...STARTUP_PHASE_IDS, ...STARTUP_SUB_PHASE_IDS];
	for (const id of ids) {
		const label = startupPhaseLabel(id);
		assert.equal(typeof label, 'string');
		assert.ok(label.length > 0, `${id} has no label`);
		// The label must never be the id itself, so no identifier can be painted.
		assert.notEqual(label, id);
		assert.ok(
			/^[A-Za-z][A-Za-z -]*[A-Za-z]$/u.test(label),
			`${id} label "${label}" is not plain product prose`,
		);
	}
	assert.equal(new Set(ids).size, ids.length);
});

test('currentLabel reports the most recently opened running phase', () => {
	const timeline = new StartupTimeline({ now: createClock().now });
	timeline.begin('server-compose');
	timeline.begin('project-environments-load');
	assert.equal(
		timeline.currentLabel(),
		startupPhaseLabel('project-environments-load'),
	);
	timeline.end('project-environments-load');
	assert.equal(timeline.currentLabel(), startupPhaseLabel('server-compose'));
	timeline.end('server-compose');
	assert.equal(timeline.currentLabel(), undefined);
});

test('main opens and closes every startup phase exactly once, in order', async () => {
	const main = await readFile(
		new URL('../electron/main.ts', import.meta.url),
		'utf8',
	);
	// Both call shapes: the direct timeline calls used around the first paint,
	// and the begin/endStartupPhase helpers that also repaint the phase line.
	const pattern =
		/(?:(begin|end)StartupPhase\('([a-z-]+)'\)|desktopStartupTimeline\.(begin|end)\('([a-z-]+)'\))/gu;
	const calls = [...main.matchAll(pattern)].map((match) => ({
		action: match[1] ?? match[3],
		id: match[2] ?? match[4],
	}));

	const begun = calls.filter((call) => call.action === 'begin');
	const ended = calls.filter((call) => call.action === 'end');
	assert.deepEqual(
		begun.map((call) => call.id),
		[...STARTUP_PHASE_IDS],
		'phases are not begun exactly once in declared order',
	);
	assert.deepEqual(
		ended.map((call) => call.id),
		[...STARTUP_PHASE_IDS],
		'phases are not ended exactly once in declared order',
	);
	// Each phase closes before the next opens.
	for (let index = 0; index < calls.length; index += 2) {
		assert.equal(calls[index].action, 'begin');
		assert.equal(calls[index + 1].action, 'end');
		assert.equal(calls[index].id, calls[index + 1].id);
	}
});

async function importBundled(relativePath) {
	const temporaryDirectory = await mkdtemp(
		join(tmpdir(), 'terminay-startup-timeline-bundle-'),
	);
	const outputPath = join(temporaryDirectory, 'startupTimeline.mjs');
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
