import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
