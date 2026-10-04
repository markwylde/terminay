import assert from 'node:assert/strict';
import test from 'node:test';
import {
	layoutAppWindows,
	railHeightFor,
	tabOffsetAfterDrag,
	type LayoutWindow,
} from './windowLayout.ts';

const open = (id: string, contentHeight?: number): LayoutWindow => ({ id, state: 'open', tabWidth: 150, ...(contentHeight === undefined ? {} : { contentHeight }) });
const tab = (id: string, extra: Partial<LayoutWindow> = {}): LayoutWindow => ({ id, state: 'minimised', tabWidth: 150, ...extra });

test('short content on a desktop pane: bottom-left, 440 wide, sized to its content, no rail', () => {
	const layout = layoutAppWindows({ paneWidth: 1250, paneHeight: 700, windows: [open('a', 240)] });
	assert.equal(layout.narrow, false);
	assert.equal(layout.railHeight, 0);
	const [placed] = layout.windows;
	assert.equal(placed.placement, 'window');
	assert.deepEqual(placed.rect, { x: 12, y: 700 - 12 - (32 + 240), width: 440, height: 272 });
	assert.equal(placed.bodyWidth, 440);
	assert.equal(placed.bodyMaxHeight, 388);
});

test('tall content is capped at 60% of the pane and scrolls inside', () => {
	const [placed] = layoutAppWindows({ paneWidth: 1250, paneHeight: 700, windows: [open('a', 5000)] }).windows;
	assert.equal(placed.rect.height, 420);
	assert.equal(placed.rect.y, 700 - 12 - 420);
});

test('a view that has not reported a size yet gets a provisional height', () => {
	const [placed] = layoutAppWindows({ paneWidth: 1250, paneHeight: 700, windows: [open('a')] }).windows;
	assert.equal(placed.rect.height, 32 + 180);
});

test('a phone-width pane shows a sheet across the bottom with a taller title bar', () => {
	const layout = layoutAppWindows({ paneWidth: 390, paneHeight: 700, windows: [open('a', 240)] });
	assert.equal(layout.narrow, true);
	const [placed] = layout.windows;
	assert.equal(placed.placement, 'sheet');
	assert.deepEqual(placed.rect, { x: 0, y: 700 - (40 + 240), width: 390, height: 280 });
	assert.equal(placed.bodyMaxHeight, 380);
});

test('the breakpoint is 560 pixels', () => {
	assert.equal(layoutAppWindows({ paneWidth: 559, paneHeight: 700, windows: [open('a')] }).windows[0].placement, 'sheet');
	assert.equal(layoutAppWindows({ paneWidth: 560, paneHeight: 700, windows: [open('a')] }).windows[0].placement, 'window');
});

test('a narrow desktop pane never makes a window wider than the pane', () => {
	const [placed] = layoutAppWindows({ paneWidth: 600, paneHeight: 700, windows: [{ ...open('a', 100) }] }).windows;
	assert.equal(placed.rect.width, 440);
	const tight = layoutAppWindows({ paneWidth: 560, paneHeight: 400, windows: [open('a', 100)] }).windows[0];
	assert.ok(tight.rect.x + tight.rect.width <= 560 - 12);
});

test('minimising the only window shows a tab on the bottom edge and a rail under the terminal', () => {
	const layout = layoutAppWindows({ paneWidth: 1250, paneHeight: 700, windows: [tab('a')] });
	assert.equal(layout.railHeight, railHeightFor(false));
	assert.equal(layout.railHeight, 33);
	assert.deepEqual(layout.windows[0], { id: 'a', placement: 'tab', rect: { x: 16, y: 672, width: 150, height: 28 }, bodyWidth: 150 });
});

test('with no minimised window there is no rail, and with no windows nothing at all', () => {
	assert.equal(layoutAppWindows({ paneWidth: 1250, paneHeight: 700, windows: [open('a')] }).railHeight, 0);
	assert.deepEqual(layoutAppWindows({ paneWidth: 1250, paneHeight: 700, windows: [] }), { narrow: false, railHeight: 0, windows: [] });
});

test('tabs line up from the left in creation order, and an open window sits above the rail', () => {
	const layout = layoutAppWindows({ paneWidth: 1250, paneHeight: 700, windows: [tab('a'), open('b', 200), tab('c', { tabWidth: 120 })] });
	const [a, b, c] = layout.windows;
	assert.equal(a.rect.x, 16);
	assert.equal(c.rect.x, 16 + 150 + 6);
	assert.equal(c.rect.width, 120);
	assert.equal(b.rect.y + b.rect.height, 700 - 33 - 12);
});

test('a dragged tab keeps its place on the edge, is clamped to the pane, and never moves vertically', () => {
	const moved = layoutAppWindows({ paneWidth: 1250, paneHeight: 700, windows: [tab('a', { tabOffset: 400 })] }).windows[0];
	assert.deepEqual([moved.rect.x, moved.rect.y], [400, 672]);
	const tooFar = layoutAppWindows({ paneWidth: 1250, paneHeight: 700, windows: [tab('a', { tabOffset: 5000 })] }).windows[0];
	assert.equal(tooFar.rect.x, 1250 - 150 - 12);
	assert.equal(tabOffsetAfterDrag(16, 300, 150, 1250), 316);
	assert.equal(tabOffsetAfterDrag(16, -500, 150, 1250), 12);
	assert.equal(tabOffsetAfterDrag(16, 5000, 150, 1250), 1088);
});

test('a long title cannot make a tab wider than its limit or than a phone pane', () => {
	assert.equal(layoutAppWindows({ paneWidth: 1250, paneHeight: 700, windows: [tab('a', { tabWidth: 900 })] }).windows[0].rect.width, 260);
	const phone = layoutAppWindows({ paneWidth: 200, paneHeight: 700, windows: [tab('a', { tabWidth: 900 })] }).windows[0];
	assert.equal(phone.rect.width, 176);
	assert.equal(phone.rect.height, 34);
});

test('a window that fills the pane covers it, hides the others, and drops the rail', () => {
	const layout = layoutAppWindows({ paneWidth: 1250, paneHeight: 700, windows: [tab('a'), open('b', 200)], fullscreenId: 'b' });
	assert.equal(layout.railHeight, 0);
	assert.equal(layout.windows[0].placement, 'hidden');
	assert.deepEqual(layout.windows[1].rect, { x: 0, y: 0, width: 1250, height: 700 });
	assert.equal(layout.windows[1].bodyHeight, 668);
	assert.equal(layout.windows[1].bodyMaxHeight, undefined);
});

test('a fill request for a minimised window is ignored', () => {
	const layout = layoutAppWindows({ paneWidth: 1250, paneHeight: 700, windows: [tab('a')], fullscreenId: 'a' });
	assert.equal(layout.windows[0].placement, 'tab');
	assert.equal(layout.railHeight, 33);
});
