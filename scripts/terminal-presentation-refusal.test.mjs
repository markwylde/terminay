import assert from 'node:assert/strict';
import test from 'node:test';
// The source module carries a TypeScript parameter property that Node's
// strip-only loader rejects, so the built package supplies the classifier.
import { isRecoverableSkip } from '../packages/client-core/dist/index.js';
import { presentationRefusalSkip } from '../src/components/terminalPresentationRefusal.ts';
import { isTerminalRetryActionable } from '../src/components/terminalPanelBindingFence.ts';

/**
 * A reconnected phone whose shell kept printing while it was away resumes
 * from a position the server no longer retains. The server refuses, correctly.
 * The client used to show that refusal as a dead error with no Retry; it must
 * instead treat a refused resume as a discontinuity and request a fresh
 * presentation through the recovery it already has.
 */

const refused = Object.freeze({
	type: 'presentation_unavailable',
	serverId: 'server-1',
	projectId: 'project-1',
	sessionId: 'session-1',
	clientId: 'client-1',
	attachmentId: 'attachment-1',
	requestedFromPosition: 1_024,
	replayFrom: 4_096,
	outputPosition: 9_000,
});

test('a refused resume becomes a recoverable skip over the range the display missed', () => {
	const skip = presentationRefusalSkip(refused, { freshPresentation: false });
	assert.deepEqual(skip, {
		serverId: 'server-1',
		projectId: 'project-1',
		sessionId: 'session-1',
		type: 'skip',
		fromPosition: 1_024,
		toPosition: 9_000,
		reason: 'attachment_closed',
	});
	assert.equal(isRecoverableSkip(skip), true, 'the recovery controller must admit it');
});

test('a refused fresh presentation is not a skip: there is no better request to make', () => {
	assert.equal(presentationRefusalSkip(refused, { freshPresentation: true }), undefined);
});

test('other events are never classified as a refusal', () => {
	for (const event of [
		{ ...refused, type: 'output', bytes: new Uint8Array([1]), position: 0, nextPosition: 1 },
		{ ...refused, type: 'skip', fromPosition: 0, toPosition: 1, reason: 'congestion' },
		{ ...refused, type: 'dimensions', cols: 80, rows: 24 },
	]) {
		assert.equal(presentationRefusalSkip(event, { freshPresentation: false }), undefined, event.type);
	}
});

test('a skip never runs backwards even if the server reports a head behind the request', () => {
	const skip = presentationRefusalSkip(
		{ ...refused, requestedFromPosition: 500, outputPosition: 400 },
		{ freshPresentation: false },
	);
	assert.equal(skip.fromPosition, 500);
	assert.equal(skip.toPosition, 500);
});

test('Retry is hidden only for a terminal that has ended, never for a refused presentation', () => {
	assert.equal(
		isTerminalRetryActionable({ presentationUnavailable: true, sessionEnded: false }),
		true,
		'a refused presentation is retryable',
	);
	assert.equal(
		isTerminalRetryActionable({ presentationUnavailable: false, sessionEnded: false }),
		true,
	);
	assert.equal(
		isTerminalRetryActionable({ presentationUnavailable: true, sessionEnded: true }),
		false,
		'an exited terminal has nothing to retry',
	);
	assert.equal(
		isTerminalRetryActionable({ presentationUnavailable: false, sessionEnded: true }),
		false,
	);
});
