import assert from 'node:assert/strict';
import test from 'node:test';
import {
	isTerminalRetryActionable,
	TerminalPanelBindingFence,
} from '../src/components/terminalPanelBindingFence.ts';

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((onResolve, onReject) => {
		resolve = onResolve;
		reject = onReject;
	});
	return { promise, resolve, reject };
}

test('late attach and render completions from a retired binding cannot hydrate the replacement', async () => {
	const fence = new TerminalPanelBindingFence();
	const stale = fence.begin();
	const staleAttach = deferred();
	const staleRender = deferred();
	const current = fence.begin();
	const commits = [];

	const commitHydration = async (binding, operation) => {
		await operation;
		if (fence.isCurrent(binding)) commits.push(binding.generation);
	};

	const staleAttachCompletion = commitHydration(stale, staleAttach.promise);
	const staleRenderCompletion = commitHydration(stale, staleRender.promise);
	const currentCompletion = commitHydration(current, Promise.resolve());
	staleAttach.resolve();
	staleRender.resolve();
	await Promise.all([
		staleAttachCompletion,
		staleRenderCompletion,
		currentCompletion,
	]);

	assert.deepEqual(commits, [current.generation]);
});

test('late renewal and detach failures from a retired binding cannot publish a current error', async () => {
	const fence = new TerminalPanelBindingFence();
	const stale = fence.begin();
	const renewal = deferred();
	const detach = deferred();
	const errors = [];

	const publishFailure = async (binding, operation) => {
		try {
			await operation;
		} catch (error) {
			if (fence.isCurrent(binding)) errors.push(error.message);
		}
	};

	const renewalCompletion = publishFailure(stale, renewal.promise);
	const detachCompletion = publishFailure(stale, detach.promise);
	const current = fence.begin();
	renewal.reject(new Error('retired renewal failed'));
	detach.reject(new Error('retired detach failed'));
	await Promise.all([renewalCompletion, detachCompletion]);
	assert.deepEqual(errors, []);

	await publishFailure(
		current,
		Promise.reject(new Error('current renewal failed')),
	);
	assert.deepEqual(errors, ['current renewal failed']);
});

test('retiring the mounted binding fences unmount completions until a new binding begins', () => {
	const fence = new TerminalPanelBindingFence();
	const mounted = fence.begin();
	assert.equal(fence.isCurrent(mounted), true);
	fence.retire(mounted);
	assert.equal(fence.isCurrent(mounted), false);
	const replacement = fence.begin();
	fence.retire(mounted);
	assert.equal(fence.isCurrent(replacement), true);
});

test('retry is actionable for a failed live attach, not an unavailable presentation', () => {
	assert.equal(isTerminalRetryActionable(false), true);
	assert.equal(isTerminalRetryActionable(true), false);
});
