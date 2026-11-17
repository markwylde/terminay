import assert from 'node:assert/strict';
import test from 'node:test';
import {
	botsRailResizable,
	botsRailWidthBounds,
	drawnBotsRailWidth,
} from './botsRailWidth.ts';

test('the rail is bounded by its own limits in an unmeasured row', () => {
	assert.deepEqual(botsRailWidthBounds(undefined), { min: 240, max: 560 });
	assert.equal(drawnBotsRailWidth(300, undefined), 300);
	assert.equal(drawnBotsRailWidth(900, undefined), 560);
	assert.equal(drawnBotsRailWidth(100, undefined), 240);
	assert.equal(drawnBotsRailWidth(400.4, undefined), 400);
});

test('the column beside the rail keeps 420 pixels while there is room', () => {
	assert.deepEqual(botsRailWidthBounds(900), { min: 240, max: 480 });
	assert.equal(drawnBotsRailWidth(560, 900), 480);
	assert.equal(drawnBotsRailWidth(560, 1_400), 560);
});

test('narrowing then widening the row returns to the chosen width', () => {
	const chosen = 560;
	assert.equal(drawnBotsRailWidth(chosen, 900), 480);
	assert.equal(drawnBotsRailWidth(chosen, 1_400), 560);
});

test('a row with no room for more than the minimum draws the minimum', () => {
	assert.deepEqual(botsRailWidthBounds(600), { min: 240, max: 240 });
	assert.equal(drawnBotsRailWidth(400, 600), 240);
});

test('the separator is offered only in a wide window with room to resize', () => {
	assert.equal(botsRailResizable(undefined, false), true);
	assert.equal(botsRailResizable(1_200, false), true);
	assert.equal(botsRailResizable(661, false), true);
	assert.equal(botsRailResizable(660, false), false);
	assert.equal(botsRailResizable(600, false), false);
	assert.equal(botsRailResizable(1_200, true), false);
});
