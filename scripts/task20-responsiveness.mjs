export const RESPONSIVENESS_PROFILE = Object.freeze({
	frameCount: 120,
	frameBudgetMs: 16.667,
	inputCostMs: 0.9,
	inputCount: 72,
	maxInputLatencyMs: 16.667,
	maxQueuedUpdates: 4,
	streams: Object.freeze([
		Object.freeze({
			key: 'terminal-output',
			intervalFrames: 1,
			updatesPerTick: 8,
			costMs: 0.7,
		}),
		Object.freeze({
			key: 'agent-events',
			intervalFrames: 2,
			updatesPerTick: 4,
			costMs: 0.8,
		}),
		Object.freeze({
			key: 'file-watch',
			intervalFrames: 3,
			updatesPerTick: 3,
			costMs: 0.6,
		}),
		Object.freeze({
			key: 'transfer-progress',
			intervalFrames: 4,
			updatesPerTick: 2,
			costMs: 0.9,
		}),
	]),
});

const EPSILON = 1e-9;

/**
 * Run a virtual 60 Hz shared-UI scheduler with fixed background streams.
 *
 * The probe intentionally has no wall-clock, browser, or platform dependency.
 * Each stream is coalesced by key before rendering, while input work is
 * handled first in every frame. This makes the local scheduling contract
 * repeatable without pretending to be a native Desktop/mobile measurement.
 */
export function runResponsivenessProbe(profile = RESPONSIVENESS_PROFILE) {
	const framePeriodMs = profile.frameBudgetMs;
	const streams = profile.streams;
	const backgroundQueue = new Map();
	const pendingInputs = [];
	const inputSchedule = createInputSchedule(profile);
	const metrics = {
		appliedBackgroundUpdates: 0,
		coalescedBackgroundUpdates: 0,
		framesWithInput: 0,
		framesWithBackground: 0,
		framesWithDeferredBackground: 0,
		handledInputs: 0,
		inputFramesWithDeferredBackground: 0,
		maxFrameWorkMs: 0,
		maxInputLatencyMs: 0,
		maxPendingInputs: 0,
		maxQueuedUpdates: 0,
		producedBackgroundUpdates: 0,
		remainingBackgroundUpdates: 0,
		remainingInputs: 0,
	};
	let inputIndex = 0;
	let sequence = 0;

	for (let frame = 0; frame < profile.frameCount; frame += 1) {
		const frameStartMs = frame * framePeriodMs;
		for (const stream of streams) {
			if (frame % stream.intervalFrames !== 0) continue;
			for (let update = 0; update < stream.updatesPerTick; update += 1) {
				sequence += 1;
				metrics.producedBackgroundUpdates += 1;
				if (backgroundQueue.has(stream.key))
					metrics.coalescedBackgroundUpdates += 1;
				backgroundQueue.set(stream.key, {
					key: stream.key,
					sequence,
					costMs: stream.costMs,
				});
			}
		}

		while (
			inputIndex < inputSchedule.length &&
			inputSchedule[inputIndex].arrivalAtMs <= frameStartMs + EPSILON
		) {
			pendingInputs.push(inputSchedule[inputIndex]);
			inputIndex += 1;
		}

		metrics.maxPendingInputs = Math.max(
			metrics.maxPendingInputs,
			pendingInputs.length,
		);
		metrics.maxQueuedUpdates = Math.max(
			metrics.maxQueuedUpdates,
			backgroundQueue.size,
		);
		let frameWorkMs = 0;
		let handledInputsThisFrame = 0;

		while (pendingInputs.length > 0) {
			const input = pendingInputs.shift();
			const latencyMs = frameStartMs - input.arrivalAtMs;
			metrics.maxInputLatencyMs = Math.max(
				metrics.maxInputLatencyMs,
				Number(latencyMs.toFixed(3)),
			);
			metrics.handledInputs += 1;
			handledInputsThisFrame += 1;
			frameWorkMs += profile.inputCostMs;
		}
		if (handledInputsThisFrame > 0) metrics.framesWithInput += 1;

		let appliedThisFrame = 0;
		for (const [key, update] of backgroundQueue) {
			if (frameWorkMs + update.costMs > framePeriodMs + EPSILON) break;
			frameWorkMs += update.costMs;
			metrics.appliedBackgroundUpdates += 1;
			appliedThisFrame += 1;
			backgroundQueue.delete(key);
		}
		if (appliedThisFrame > 0) metrics.framesWithBackground += 1;
		if (backgroundQueue.size > 0) {
			metrics.framesWithDeferredBackground += 1;
			if (handledInputsThisFrame > 0)
				metrics.inputFramesWithDeferredBackground += 1;
		}
		metrics.maxFrameWorkMs = Math.max(
			metrics.maxFrameWorkMs,
			Number(frameWorkMs.toFixed(3)),
		);
	}

	while (inputIndex < inputSchedule.length) {
		pendingInputs.push(inputSchedule[inputIndex]);
		inputIndex += 1;
	}
	metrics.remainingBackgroundUpdates = backgroundQueue.size;
	metrics.remainingInputs = pendingInputs.length;
	return metrics;
}

function createInputSchedule(profile) {
	const lastArrivalFrame = profile.frameCount - 2;
	return Array.from({ length: profile.inputCount }, (_, index) => {
		const baseFrame = (index * 7) % lastArrivalFrame;
		const offsetMs = index % 2 === 0 ? 0.15 : 15.8;
		return {
			id: `input-${String(index).padStart(2, '0')}`,
			arrivalAtMs: baseFrame * profile.frameBudgetMs + offsetMs,
		};
	}).sort((left, right) => left.arrivalAtMs - right.arrivalAtMs);
}
