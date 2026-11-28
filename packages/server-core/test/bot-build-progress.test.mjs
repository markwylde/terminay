import assert from 'node:assert/strict';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseBotBuildProgress } from '@terminay/protocol';
import { BotBuildTracker } from '../dist/botService/buildProgress.js';

test('classic Docker and Podman records survive chunk splitting and cache', () => {
	for (const prefix of ['Step', 'STEP']) {
		const p = new BotBuildTracker();
		p.start('engine', 'fp', true);
		const data = `${prefix} 1/3: FROM node\nUsing cache\n${prefix} 2/3: RUN apt-get install xfce4-panel\nInstalled\n`;
		for (const c of data) p.output(c);
		assert.equal(
			p.snapshot.steps.find((s) => s.id === 'step-1').state,
			'cached',
		);
		assert.equal(
			p.snapshot.steps.find((s) => s.id === 'step-2').state,
			'running',
		);
		assert.equal(
			parseBotBuildProgress(p.snapshot).previousImageAvailable,
			true,
		);
		p.finish(false);
		assert.equal(p.snapshot.state, 'failed');
		assert.equal(
			p.snapshot.steps.find((s) => s.id === 'step-2').state,
			'failed',
		);
	}
});
test('BuildKit parallel vertices, cached outcomes and publication failure remain truthful', () => {
	const p = new BotBuildTracker();
	p.start('e', 'f', false);
	p.output('#1 [base 1/2] FROM node\n#2 [tools 1/2] RUN install\n');
	assert.equal(
		p.snapshot.steps.filter(
			(s) => s.id.startsWith('vertex') && s.state === 'running',
		).length,
		2,
	);
	p.output('#1 CACHED\n#2 DONE 1.2s\n');
	p.step('publish', 'Publishing the local bot image', 'running');
	p.finish(false);
	assert.equal(p.snapshot.state, 'failed');
	assert.equal(
		p.snapshot.steps.find((s) => s.id === 'publish').state,
		'failed',
	);
	assert.equal(
		p.snapshot.steps.find((s) => s.id === 'vertex-1').state,
		'cached',
	);
});
test('unrecognized output is readable and progress/logs stay bounded', () => {
	const p = new BotBuildTracker();
	p.start('e', 'f', false);
	p.output('unrecognized engine output\n');
	assert.match(p.snapshot.steps[0].log, /unrecognized/);
	assert.equal(p.snapshot.state, 'running');
	for (let i = 0; i < 150; i++)
		p.output(`#${i} [stage ${i}] RUN install\n${'a'.repeat(5000)}\n`);
	assert.ok(p.snapshot.steps.length <= 128);
	assert.equal(p.snapshot.truncated, true);
	assert.ok(p.snapshot.steps.every((s) => s.log.length <= 4096));
});
test('restart marks an unfinished build interrupted and retry creates a distinct build', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'build-progress-'));
	t.after(() => rmSync(root, { force: true, recursive: true }));
	const path = join(root, 'build.json');
	const p = new BotBuildTracker(path);
	p.start('e', 'f', true);
	p.output('STEP 1/2: FROM node\n');
	p.step('build', 'Building', 'running');
	const id = p.snapshot.id;
	const restored = new BotBuildTracker(path);
	assert.equal(restored.snapshot.id, id);
	assert.equal(restored.snapshot.state, 'interrupted');
	assert.match(restored.retainedOutput, /FROM node/);
	restored.start('e', 'f', true);
	assert.notEqual(restored.snapshot.id, id);
	assert.equal(restored.snapshot.steps.length, 1);
	restored.finish(true);
	assert.equal(new BotBuildTracker(path).snapshot.state, 'completed');
	assert.ok(readFileSync(path, 'utf8'));
});
test('wire validation rejects malformed, oversized and duplicate steps', () => {
	const p = new BotBuildTracker();
	p.start('e', 'f', false);
	const state = p.snapshot;
	assert.throws(
		() =>
			parseBotBuildProgress({
				...state,
				steps: [state.steps[0], state.steps[0]],
			}),
		/build step/,
	);
	assert.throws(
		() =>
			parseBotBuildProgress({
				...state,
				steps: [{ ...state.steps[0], log: 'x'.repeat(4097) }],
			}),
		/build step/,
	);
});

test('credential-shaped build output is redacted before retention across chunk boundaries', () => {
	const p = new BotBuildTracker();
	p.start('e', 'f', false);
	for (const c of 'Authorization: Bearer test-secret\nAPI_KEY="private key"\nhttps://user:pass@example.com/build\n')
		p.output(c);
	p.finish(false);
	const data = JSON.stringify(p.snapshot) + p.retainedOutput;
	assert.doesNotMatch(data, /test-secret|private key|user:pass/);
	assert.match(data, /redacted/);
});

function recordPath(t) {
	const root = mkdtempSync(join(tmpdir(), 'build-notice-'));
	t.after(() => rmSync(root, { force: true, recursive: true }));
	return join(root, 'state', 'build.json');
}
function built(tracker, fingerprint = 'fp', engine = 'engine') {
	tracker.start(engine, fingerprint, true);
	tracker.finish(true);
	return tracker.snapshot;
}

test('an acknowledgement belongs to the image, across rebuilds and restarts', (t) => {
	const path = recordPath(t);
	mkdirSync(join(path, '..'));
	const p = new BotBuildTracker(path);
	const first = built(p);
	assert.equal(first.acknowledged, false);
	assert.equal(p.acknowledge(first.id), true);
	assert.equal(p.snapshot.acknowledged, true);
	assert.ok(p.snapshot.revision > first.revision);
	assert.equal(p.acknowledge(first.id), false);
	assert.equal(new BotBuildTracker(path).snapshot.acknowledged, true);

	const again = built(p);
	assert.notEqual(again.id, first.id);
	assert.equal(again.acknowledged, true);
	assert.equal(built(p, 'other').acknowledged, false);
	assert.equal(built(p, 'fp', 'other-engine').acknowledged, false);

	p.start('engine', 'fp', true);
	assert.equal(p.snapshot.acknowledged, false);
	p.finish(false);
	assert.equal(p.snapshot.acknowledged, false);
	assert.equal(built(new BotBuildTracker(path)).acknowledged, true);
});

test('only the latest completed build can be acknowledged', () => {
	const p = new BotBuildTracker();
	assert.equal(p.acknowledge('none'), false);
	const old = built(p);
	p.start('engine', 'next', true);
	assert.equal(p.acknowledge(old.id), false);
	assert.equal(p.acknowledge(p.snapshot.id), false);
	p.finish(false);
	assert.equal(p.acknowledge(p.snapshot.id), false);
	assert.equal(built(p).acknowledged, false);
});

test('the 32 newest acknowledgements are kept', () => {
	const p = new BotBuildTracker();
	for (let i = 0; i < 33; i++) p.acknowledge(built(p, `fp-${i}`).id);
	assert.equal(built(p, 'fp-1').acknowledged, true);
	assert.equal(built(p, 'fp-32').acknowledged, true);
	assert.equal(built(p, 'fp-0').acknowledged, false);
});

test('an acknowledgement that cannot be saved is not made, and can be retried', (t) => {
	const path = recordPath(t);
	const directory = join(path, '..');
	mkdirSync(directory);
	const p = new BotBuildTracker(path);
	const { id, revision } = built(p);
	// A file where the directory was refuses the write, even for root.
	rmSync(directory, { recursive: true });
	writeFileSync(directory, '');
	assert.throws(() => p.acknowledge(id));
	assert.equal(p.snapshot.acknowledged, false);
	assert.equal(p.snapshot.revision, revision);
	rmSync(directory);
	mkdirSync(directory);
	assert.equal(p.acknowledge(id), true);
	assert.equal(new BotBuildTracker(path).snapshot.acknowledged, true);
});

test('an absent or malformed acknowledgement list never loses the build record', (t) => {
	const path = recordPath(t);
	mkdirSync(join(path, '..'));
	const first = built(new BotBuildTracker(path));
	const record = JSON.parse(readFileSync(path, 'utf8'));
	const load = (acknowledged) => {
		writeFileSync(path, JSON.stringify({ ...record, acknowledged }));
		return new BotBuildTracker(path).snapshot;
	};
	for (const bad of [undefined, 'nope', {}, [null, 1, { fingerprint: 'fp' }]]) {
		assert.equal(load(bad).id, first.id);
		assert.equal(load(bad).acknowledged, false);
	}
	const entry = { engineIdentity: 'engine', fingerprint: 'fp' };
	assert.equal(load([null, entry, entry]).acknowledged, true);
});

test('the wire accepts a missing or boolean acknowledged flag only', () => {
	const state = built(new BotBuildTracker());
	const { acknowledged: _, ...without } = state;
	assert.ok(parseBotBuildProgress(without));
	assert.ok(parseBotBuildProgress({ ...state, acknowledged: true }));
	for (const bad of ['true', 1, null])
		assert.throws(
			() => parseBotBuildProgress({ ...state, acknowledged: bad }),
			/build progress/,
		);
});
