import assert from 'node:assert/strict';
import test from 'node:test';
import { settleEditTabSubmission } from './projectEditSettlement.ts';
import {
	isEditTabAwaitingInput,
	setEditTabAwaitingInput,
} from '../shared/editTabInputHold.ts';

test('a pending commit holds terminal input and cannot close a newer editor', async () => {
	let finish!: () => void;
	let current = true;
	let closed = false;
	setEditTabAwaitingInput(true);
	try {
		const saving = settleEditTabSubmission(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
			() => current,
			() => {
				closed = true;
				setEditTabAwaitingInput(false);
			},
		);
		assert.equal(isEditTabAwaitingInput(), true);
		current = false;
		finish();
		await saving;
		assert.equal(closed, false);
		assert.equal(isEditTabAwaitingInput(), true);
	} finally {
		setEditTabAwaitingInput(false);
	}
});

test('a failed commit wait still releases the current editor', async () => {
	let closed = false;
	await assert.rejects(
		settleEditTabSubmission(
			async () => {
				throw new Error('store closed');
			},
			() => true,
			() => {
				closed = true;
			},
		),
		/store closed/u,
	);
	assert.equal(closed, true);
});
