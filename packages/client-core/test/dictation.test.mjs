import assert from 'node:assert/strict';
import test from 'node:test';
import { DictationCaptureClient } from '../dist/index.js';

const target = {
	serverId: 'server-a',
	projectId: 'project-a',
	panelId: 'panel-a',
	sessionId: 'session-a',
};

const disclosure = {
	serverLabel: 'Staging server',
	provider: 'openai',
	credentialStatus: 'configured',
	confirmed: true,
};

test('dictation binds an immutable target and disclosure to one bounded request', () => {
	let now = 10_000;
	const client = new DictationCaptureClient({
		now: () => now,
		createRequestId: () => 'request-a',
	});
	const requestedTarget = { ...target };
	const requestedDisclosure = { ...disclosure };
	const started = client.begin(requestedTarget, requestedDisclosure, {
		mimeType: 'audio/wav',
	});
	requestedTarget.projectId = 'other-project';
	requestedDisclosure.serverLabel = 'Other server';
	assert.equal(started.status, 'recording');
	assert.equal(started.target.projectId, 'project-a');

	client.append(new Uint8Array([1, 2]));
	now += 1250;
	client.append(new Uint8Array([3, 4]));
	const request = client.finish();

	assert.equal(request.requestId, 'request-a');
	assert.deepEqual(request.target, {
		serverId: 'server-a',
		projectId: 'project-a',
		panelId: 'panel-a',
		sessionId: 'session-a',
	});
	assert.deepEqual([...request.audio], [1, 2, 3, 4]);
	assert.equal(request.durationMs, 1250);
	assert.deepEqual(request.disclosure, {
		serverLabel: 'Staging server',
		provider: 'openai',
		credentialStatus: 'configured',
		confirmed: true,
	});
	assert.equal(Object.isFrozen(request), true);
	assert.equal(Object.isFrozen(request.target), true);
	assert.equal(Object.isFrozen(request.disclosure), true);
	assert.equal(client.snapshot().status, 'ready');
});

test('dictation enforces MIME, byte, duration, and cancellation boundaries', () => {
	let now = 0;
	const client = new DictationCaptureClient({
		now: () => now,
		createRequestId: () => 'request-b',
		maxDurationMs: 100,
		maxBytes: 3,
		mimeTypes: ['audio/wav'],
	});

	assert.throws(
		() => client.begin(target, disclosure, { mimeType: 'audio/mp4' }),
		/MIME/,
	);
	assert.throws(
		() => client.begin(target, { ...disclosure, confirmed: false }),
		/disclosure/,
	);
	assert.throws(
		() =>
			client.begin(target, {
				...disclosure,
				credentialStatus: 'not-configured',
			}),
		/disclosure/,
	);
	client.begin(target, disclosure);
	assert.throws(() => client.begin(target, disclosure), /already active/);
	client.append(new Uint8Array([1, 2]));
	assert.throws(() => client.append(new Uint8Array([3, 4])), /byte limit/);
	const disconnected = client.cancel('disconnected');
	assert.equal(disconnected.status, 'cancelled');
	assert.equal(disconnected.cancelReason, 'disconnected');
	assert.equal(disconnected.bytes, 0);

	client.reset();
	client.begin(target, disclosure);
	now = 101;
	assert.throws(() => client.append(new Uint8Array([3])), /duration/);
	assert.equal(client.snapshot().status, 'cancelled');
	assert.equal(client.snapshot().bytes, 0);
	assert.throws(() => client.finish(), /cancelled/);
	assert.equal(client.cancel('disconnected').status, 'cancelled');
	assert.equal(client.reset().status, 'idle');
});

test('dictation disclosure rejects credential-shaped fields', () => {
	const client = new DictationCaptureClient({
		createRequestId: () => 'request-c',
	});
	assert.throws(
		() => client.begin(target, { ...disclosure, apiKey: 'never-send-this' }),
		/credentials/,
	);
});
