import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createProjectTabPeekController,
	PROJECT_TAB_PEEK_DWELL_MS,
	PROJECT_TAB_PEEK_LEAVE_MS,
} from '../src/workspace/projectTabPeekModel.ts';

/** A clock that only moves when the test says so. */
function clock() {
	let now = 0;
	let nextHandle = 1;
	const pending = new Map();
	return {
		timer: {
			set: (callback, delayMs) => {
				const handle = nextHandle++;
				pending.set(handle, { callback, at: now + delayMs });
				return handle;
			},
			clear: (handle) => pending.delete(handle),
		},
		advance(ms) {
			const end = now + ms;
			for (;;) {
				const due = [...pending].filter(([, entry]) => entry.at <= end);
				if (due.length === 0) break;
				due.sort((left, right) => left[1].at - right[1].at);
				const [handle, entry] = due[0];
				pending.delete(handle);
				now = entry.at;
				entry.callback();
			}
			now = end;
		},
		pendingCount: () => pending.size,
	};
}

/** A peek with tab `a` in front, hover available, and nothing being dragged. */
function peek(environment = {}) {
	const time = clock();
	const changes = [];
	const controller = createProjectTabPeekController({
		timer: time.timer,
		onChange: (state) => changes.push(state.openTabId),
	});
	const base = { activeTabId: 'a', isDragging: false, canHover: true };
	controller.setEnvironment({ ...base, ...environment });
	return {
		controller,
		changes,
		time,
		set: (next) => controller.setEnvironment({ ...base, ...environment, ...next }),
		open: () => controller.state.openTabId,
		/** Rest on tab `b` until its peek is open. */
		rest(tabId = 'b') {
			controller.pointerEnteredTab(tabId);
			time.advance(PROJECT_TAB_PEEK_DWELL_MS);
		},
	};
}

test('the dwell is about 350 ms', () => {
	assert.equal(PROJECT_TAB_PEEK_DWELL_MS, 350);
});

test('resting the pointer on a tab that is not in front opens its peek', () => {
	const p = peek();
	p.controller.pointerEnteredTab('b');
	p.time.advance(PROJECT_TAB_PEEK_DWELL_MS - 1);
	assert.equal(p.open(), null, 'not before the pointer has rested');
	p.time.advance(1);
	assert.equal(p.open(), 'b');
	assert.equal(p.controller.state.viaKeyboard, false);
});

test('crossing a tab opens nothing', () => {
	const p = peek();
	p.controller.pointerEnteredTab('b');
	p.time.advance(100);
	p.controller.pointerLeftTab('b');
	p.controller.pointerEnteredTab('c');
	p.time.advance(100);
	p.controller.pointerLeftTab('c');
	p.time.advance(5_000);
	assert.equal(p.open(), null);
	assert.deepEqual(p.changes, []);
	assert.equal(p.time.pendingCount(), 0);
});

test('the tab in front never opens a peek', () => {
	const p = peek();
	p.rest('a');
	p.time.advance(5_000);
	assert.equal(p.open(), null);
	p.controller.keyboardOpen('a');
	assert.equal(p.open(), null);
});

test('a tab that comes to the front loses its peek and its pending dwell', () => {
	const open = peek();
	open.rest('b');
	open.set({ activeTabId: 'b' });
	assert.equal(open.open(), null);
	const dwelling = peek();
	dwelling.controller.pointerEnteredTab('b');
	dwelling.time.advance(100);
	dwelling.set({ activeTabId: 'b' });
	dwelling.time.advance(5_000);
	assert.equal(dwelling.open(), null);
});

test('it closes when the pointer has left both the tab and the peek', () => {
	const p = peek();
	p.rest();
	p.controller.pointerLeftTab('b');
	p.time.advance(PROJECT_TAB_PEEK_LEAVE_MS - 1);
	assert.equal(p.open(), 'b', 'the gap between tab and peek can be crossed');
	p.time.advance(1);
	assert.equal(p.open(), null);
});

test('it stays open while the pointer is over the peek, and closes on leaving it', () => {
	const p = peek();
	p.rest();
	p.controller.pointerLeftTab('b');
	p.time.advance(50);
	p.controller.pointerEnteredPeek();
	p.time.advance(5_000);
	assert.equal(p.open(), 'b');
	p.controller.pointerLeftPeek();
	p.time.advance(PROJECT_TAB_PEEK_LEAVE_MS);
	assert.equal(p.open(), null);
});

test('going back from the peek to its tab keeps it open', () => {
	const p = peek();
	p.rest();
	p.controller.pointerLeftTab('b');
	p.controller.pointerEnteredPeek();
	p.controller.pointerLeftPeek();
	p.controller.pointerEnteredTab('b');
	p.time.advance(5_000);
	assert.equal(p.open(), 'b');
});

test('Escape closes it', () => {
	const p = peek();
	p.rest();
	p.controller.close();
	assert.equal(p.open(), null);
	assert.equal(p.time.pendingCount(), 0);
});

test('a press on a tab closes it, and the tab under the press does not reopen it', () => {
	const p = peek();
	p.rest();
	p.controller.pointerDownOnTab();
	assert.equal(p.open(), null);
	// The pointer has not moved: it is still over the tab it pressed.
	p.time.advance(5_000);
	assert.equal(p.open(), null);
});

test('a press during the dwell opens nothing: a click or the start of a drag is not resting', () => {
	const p = peek();
	p.controller.pointerEnteredTab('b');
	p.time.advance(100);
	p.controller.pointerDownOnTab();
	p.time.advance(5_000);
	assert.equal(p.open(), null);
	assert.deepEqual(p.changes, []);
	// Coming back to a tab afterwards is a fresh rest.
	p.controller.pointerLeftTab('b');
	p.rest('c');
	assert.equal(p.open(), 'c');
});

test('it never opens while a tab is being reordered or torn off, or a terminal is dragged', () => {
	const p = peek({ isDragging: true });
	p.rest();
	p.time.advance(5_000);
	assert.equal(p.open(), null);
	p.controller.keyboardOpen('b');
	assert.equal(p.open(), null);
	// A drag that starts during the dwell, as a tear-off does.
	const starting = peek();
	starting.controller.pointerEnteredTab('b');
	starting.time.advance(100);
	starting.set({ isDragging: true });
	starting.time.advance(5_000);
	assert.equal(starting.open(), null);
	assert.deepEqual(starting.changes, []);
});

test('an open peek closes when a drag starts', () => {
	const p = peek();
	p.rest();
	p.set({ isDragging: true });
	assert.equal(p.open(), null);
	// And the drag ending does not bring it back.
	p.set({ isDragging: false });
	p.time.advance(5_000);
	assert.equal(p.open(), null);
});

test('a drag that crosses other tabs opens none of them', () => {
	const p = peek({ isDragging: true });
	for (const tabId of ['b', 'c', 'd']) {
		p.controller.pointerEnteredTab(tabId);
		p.time.advance(PROJECT_TAB_PEEK_DWELL_MS * 2);
		p.controller.pointerLeftTab(tabId);
	}
	assert.deepEqual(p.changes, []);
});

test('the down arrow on a focused tab opens it for the keyboard, at once', () => {
	const p = peek();
	p.controller.keyboardOpen('b');
	assert.equal(p.open(), 'b');
	assert.equal(p.controller.state.viaKeyboard, true);
	// The pointer wandering elsewhere does not close what the keyboard opened.
	p.controller.pointerEnteredPeek();
	p.controller.pointerLeftPeek();
	p.time.advance(5_000);
	assert.equal(p.open(), 'b');
	p.controller.close();
	assert.equal(p.open(), null);
	assert.equal(p.controller.state.viaKeyboard, false);
});

test('without hover there is no peek, by pointer or by keyboard', () => {
	const p = peek({ canHover: false });
	p.rest();
	p.controller.keyboardOpen('b');
	p.time.advance(5_000);
	assert.equal(p.open(), null);
	// A device that loses hover while one is open closes it.
	const lost = peek();
	lost.rest();
	lost.set({ canHover: false });
	assert.equal(lost.open(), null);
});

test('moving to another tab opens that tab\'s peek and closes the first', () => {
	const p = peek();
	p.rest('b');
	p.controller.pointerLeftTab('b');
	p.controller.pointerEnteredTab('c');
	p.time.advance(PROJECT_TAB_PEEK_LEAVE_MS);
	assert.equal(p.open(), null, 'the first closes once the pointer is gone from it');
	p.time.advance(PROJECT_TAB_PEEK_DWELL_MS);
	assert.equal(p.open(), 'c');
});

test('disposing leaves no timer behind', () => {
	const p = peek();
	p.controller.pointerEnteredTab('b');
	p.controller.dispose();
	assert.equal(p.time.pendingCount(), 0);
	p.time.advance(5_000);
	assert.deepEqual(p.changes, []);
});
