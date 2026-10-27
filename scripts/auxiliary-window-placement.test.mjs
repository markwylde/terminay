import assert from 'node:assert/strict';
import test from 'node:test';
import {
	AUXILIARY_WINDOW_PREFERRED_SIZE,
	closesAuxiliaryWindow,
	fitAuxiliaryWindowBounds,
} from '../electron/auxiliaryWindowPlacement.ts';

test('a large display keeps the preferred size, centred in its work area', () => {
	const bounds = fitAuxiliaryWindowBounds(AUXILIARY_WINDOW_PREFERRED_SIZE, {
		x: 0,
		y: 25,
		width: 1920,
		height: 1055,
	});
	assert.deepEqual(bounds, { x: 370, y: 143, width: 1180, height: 820 });
});

test('a small display shrinks the window so its title bar stays on screen', () => {
	const workArea = { x: 0, y: 25, width: 1024, height: 743 };
	const bounds = fitAuxiliaryWindowBounds(
		AUXILIARY_WINDOW_PREFERRED_SIZE,
		workArea,
	);
	assert.deepEqual(bounds, { x: 0, y: 25, width: 1024, height: 743 });
	assert.ok(bounds.y >= workArea.y);
	assert.ok(bounds.y + bounds.height <= workArea.y + workArea.height);
});

test('a secondary display offsets the window into that display', () => {
	const bounds = fitAuxiliaryWindowBounds(AUXILIARY_WINDOW_PREFERRED_SIZE, {
		x: -1280,
		y: 0,
		width: 1280,
		height: 720,
	});
	assert.deepEqual(bounds, { x: -1230, y: 0, width: 1180, height: 720 });
});

test('only the close command closes an auxiliary window', () => {
	assert.equal(closesAuxiliaryWindow('close-active'), true);
	assert.equal(closesAuxiliaryWindow('split-horizontal'), false);
});
