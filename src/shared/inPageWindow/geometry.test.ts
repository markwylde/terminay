import assert from 'node:assert/strict';
import test from 'node:test';
import {
	clampToViewport,
	defaultRect,
	fitRemembered,
	isCompactViewport,
	rectAfterMove,
	rectAfterResize,
	rectAfterViewportResize,
	rectForViewport,
} from './geometry.ts';

const viewport = { width: 1600, height: 900 };

test('a window opens centred at its default size', () => {
	assert.deepEqual(defaultRect({ width: 1200, height: 800 }, viewport), { x: 200, y: 50, width: 1200, height: 800 });
});

test('a default larger than the viewport is cut to the viewport', () => {
	assert.deepEqual(defaultRect({ width: 1480, height: 820 }, { width: 1000, height: 600 }), { x: 0, y: 0, width: 1000, height: 600 });
});

test('a move follows the pointer', () => {
	const start = { x: 200, y: 50, width: 1200, height: 800 };
	assert.deepEqual(rectAfterMove(start, 200, 0, viewport), { ...start, x: 400 });
});

test('a moved window keeps its whole title bar height and 160px of its width inside', () => {
	const start = { x: 200, y: 50, width: 800, height: 600 };
	assert.equal(rectAfterMove(start, 0, -5000, viewport).y, 0);
	assert.equal(rectAfterMove(start, 0, 5000, viewport).y, 900 - 36);
	assert.equal(rectAfterMove(start, 5000, 0, viewport).x, 1600 - 160);
	assert.equal(rectAfterMove(start, -5000, 0, viewport).x, 160 - 800);
});

test('a resize keeps the opposite edge where it is', () => {
	const start = { x: 200, y: 100, width: 800, height: 600 };
	assert.deepEqual(rectAfterViewportResize(start, { x: 1, y: 0 }, 150, 0, viewport), { x: 200, y: 100, width: 950, height: 600 });
	assert.deepEqual(rectAfterViewportResize(start, { x: -1, y: -1 }, -60, -40, viewport), { x: 140, y: 60, width: 860, height: 640 });
});

test('a resize stops at 480 by 320', () => {
	const start = { x: 200, y: 100, width: 800, height: 600 };
	assert.deepEqual(rectAfterViewportResize(start, { x: 1, y: 1 }, -5000, -5000, viewport), { x: 200, y: 100, width: 480, height: 320 });
	assert.deepEqual(rectAfterViewportResize(start, { x: -1, y: -1 }, 5000, 5000, viewport), { x: 520, y: 380, width: 480, height: 320 });
});

test('a resize stops at the viewport edges', () => {
	const start = { x: 200, y: 100, width: 800, height: 600 };
	assert.deepEqual(rectAfterViewportResize(start, { x: 1, y: 1 }, 5000, 5000, viewport), { x: 200, y: 100, width: 1400, height: 800 });
	assert.deepEqual(rectAfterViewportResize(start, { x: -1, y: -1 }, -5000, -5000, viewport), { x: 0, y: 0, width: 1000, height: 700 });
});

test('a resize without bounds grows freely', () => {
	const start = { x: 100, y: 200, width: 440, height: 300 };
	assert.deepEqual(rectAfterResize(start, { x: 1, y: 1 }, 5000, 0, { minWidth: 220, minHeight: 112 }).width, 5440);
});

test('a remembered rectangle wider than the viewport opens inside it', () => {
	const fitted = fitRemembered({ x: 300, y: 40, width: 1400, height: 800 }, { width: 1000, height: 700 });
	assert.deepEqual(fitted, { x: 0, y: 0, width: 1000, height: 700 });
});

test('a remembered rectangle that still fits is moved, not shrunk', () => {
	assert.deepEqual(fitRemembered({ x: 900, y: 500, width: 600, height: 400 }, { width: 1000, height: 700 }), { x: 400, y: 300, width: 600, height: 400 });
});

test('a viewport smaller than the minimum still gets a window that fits', () => {
	assert.deepEqual(clampToViewport({ x: 0, y: 0, width: 800, height: 600 }, { width: 700, height: 300 }), { x: 0, y: 0, width: 700, height: 300 });
});

test('a shrinking viewport moves the window in and narrows it only when it must', () => {
	const rect = { x: 900, y: 50, width: 600, height: 400 };
	assert.deepEqual(rectForViewport(rect, viewport, { width: 1300, height: 900 }), { x: 700, y: 50, width: 600, height: 400 });
	assert.deepEqual(rectForViewport(rect, viewport, { width: 700, height: 900 }), { x: 100, y: 50, width: 600, height: 400 });
	assert.deepEqual(rectForViewport(rect, viewport, { width: 650, height: 300 }), { x: 50, y: 0, width: 600, height: 300 });
});

test('widening the viewport again gives the placed rectangle back', () => {
	const rect = { x: 900, y: 50, width: 600, height: 400 };
	assert.deepEqual(rectForViewport(rect, viewport, viewport), rect);
	assert.deepEqual(rectForViewport(rect, viewport, { width: 2000, height: 1200 }), rect);
});

test('a window the user hung off the edge stays there while the viewport has not shrunk', () => {
	const rect = { x: 1400, y: 800, width: 600, height: 400 };
	assert.deepEqual(rectForViewport(rect, viewport, viewport), rect);
});

test('compact starts at 640 and is never guessed from an unmeasured viewport', () => {
	assert.equal(isCompactViewport({ width: 640, height: 800 }), true);
	assert.equal(isCompactViewport({ width: 641, height: 800 }), false);
	assert.equal(isCompactViewport({ width: 0, height: 0 }), false);
});
