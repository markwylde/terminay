import assert from 'node:assert/strict';
import test from 'node:test';
import {
	RESPONSIVENESS_PROFILE,
	runResponsivenessProbe,
} from './task20-responsiveness.mjs';

const EXPECTED = {
	appliedBackgroundUpdates: 250,
	coalescedBackgroundUpdates: 1_130,
	framesWithInput: 72,
	framesWithBackground: 120,
	framesWithDeferredBackground: 0,
	handledInputs: 72,
	inputFramesWithDeferredBackground: 0,
	maxFrameWorkMs: 3.9,
	maxInputLatencyMs: 16.517,
	maxPendingInputs: 1,
	maxQueuedUpdates: 4,
	producedBackgroundUpdates: 1_380,
	remainingBackgroundUpdates: 0,
	remainingInputs: 0,
};

test('bounded background streams preserve the shared UI input budget', () => {
	const result = runResponsivenessProbe();

	assert.deepEqual(result, EXPECTED);
	assert.equal(
		result.maxInputLatencyMs <= RESPONSIVENESS_PROFILE.maxInputLatencyMs,
		true,
	);
	assert.equal(
		result.maxQueuedUpdates <= RESPONSIVENESS_PROFILE.maxQueuedUpdates,
		true,
	);
	assert.equal(
		result.maxFrameWorkMs <= RESPONSIVENESS_PROFILE.frameBudgetMs,
		true,
	);
	assert.equal(result.remainingBackgroundUpdates, 0);
	assert.equal(result.remainingInputs, 0);
});

test('the virtual responsiveness probe is deterministic across immediate repeats', () => {
	assert.deepEqual(runResponsivenessProbe(), runResponsivenessProbe());
});

test('input work defers competing background updates without exceeding its frame budget', () => {
	const result = runResponsivenessProbe({
		...RESPONSIVENESS_PROFILE,
		inputCostMs: 14,
	});

	assert.equal(result.handledInputs, RESPONSIVENESS_PROFILE.inputCount);
	assert.equal(result.remainingInputs, 0);
	assert.equal(result.remainingBackgroundUpdates, 0);
	assert.equal(result.inputFramesWithDeferredBackground > 0, true);
	assert.equal(
		result.maxFrameWorkMs <= RESPONSIVENESS_PROFILE.frameBudgetMs,
		true,
	);
	assert.equal(
		result.maxInputLatencyMs <= RESPONSIVENESS_PROFILE.maxInputLatencyMs,
		true,
	);
});
