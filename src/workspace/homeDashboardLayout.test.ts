import assert from 'node:assert/strict';
import test from 'node:test';
import {
	HOME_WIDGETS,
	HomeLayoutSaveQueue,
	hiddenWidgets,
	moveWidgetBefore,
	moveWidgetBy,
	resetLayout,
	resolveLayout,
	setWidgetHidden,
	setWidgetSize,
	visibleWidgets,
} from './homeDashboardLayout.ts';

const EMPTY = { widgets: [] };
const ids = (items: readonly { id: string }[]) => items.map((item) => item.id);

test('an empty layout is the default layout', () => {
	const resolved = resolveLayout(EMPTY);
	assert.deepEqual(ids(resolved), ids(HOME_WIDGETS));
	assert.deepEqual(ids(hiddenWidgets(EMPTY)), ['tabs', 'connections']);
	assert.equal(resolved.find((item) => item.id === 'workflows')?.size, 'wide');
});

test('a widget the stored layout does not name is appended at its defaults', () => {
	const stored = {
		widgets: [
			{ id: 'bots', size: 'tall' as const, hidden: false },
			{ id: 'agents', size: 'small' as const, hidden: false },
		],
	};
	const shown = ids(visibleWidgets(stored));
	assert.deepEqual(shown.slice(0, 2), ['bots', 'agents']);
	assert.equal(shown.includes('workflows'), true);
	assert.equal(shown.indexOf('workflows') > 1, true);
});

test('an unknown widget is kept through edits and never shown', () => {
	const stored = {
		widgets: [
			{ id: 'from-the-future', size: 'tall' as const, hidden: false },
			{ id: 'bots', size: 'small' as const, hidden: false },
		],
	};
	assert.equal(
		ids(resolveLayout(stored)).includes('from-the-future' as never),
		false,
	);
	const edited = setWidgetSize(stored, 'bots', 'wide');
	assert.deepEqual(edited.widgets[0], {
		id: 'from-the-future',
		size: 'tall',
		hidden: false,
	});
	const reset = resetLayout(edited);
	assert.equal(
		reset.widgets.some((entry) => entry.id === 'from-the-future'),
		true,
	);
});

test('an unsupported size shows the widget at its default size', () => {
	const stored = {
		widgets: [{ id: 'quick-actions', size: 'tall' as const, hidden: false }],
	};
	assert.equal(resolveLayout(stored)[0]?.size, 'wide');
	assert.deepEqual(setWidgetSize(stored, 'quick-actions', 'tall'), stored);
	assert.equal(
		resolveLayout(setWidgetSize(stored, 'quick-actions', 'small'))[0]?.size,
		'small',
	);
});

test('move earlier and later swap with the shown neighbour', () => {
	const moved = moveWidgetBy(EMPTY, 'bots', -1);
	const shown = ids(visibleWidgets(moved));
	assert.equal(shown.indexOf('bots'), shown.indexOf('workflows') - 1);
	assert.deepEqual(
		ids(visibleWidgets(moveWidgetBy(moved, 'bots', 1))),
		ids(visibleWidgets(EMPTY)),
	);
	// At the ends nothing moves.
	assert.deepEqual(moveWidgetBy(EMPTY, 'quick-actions', -1), EMPTY);
	const last = ids(visibleWidgets(EMPTY)).at(-1) ?? '';
	assert.deepEqual(moveWidgetBy(EMPTY, last, 1), EMPTY);
});

test('moves step over hidden widgets', () => {
	// Hide agents; moving bots earlier then lands before needs-you's neighbour.
	const hidden = setWidgetHidden(EMPTY, 'agents', true);
	const moved = moveWidgetBy(hidden, 'workflows', -1);
	const shown = ids(visibleWidgets(moved));
	assert.equal(shown.indexOf('workflows'), shown.indexOf('needs-you') - 1);
});

test('a drop puts the widget before its target', () => {
	const dropped = moveWidgetBefore(EMPTY, 'recordings', 'quick-actions');
	assert.equal(ids(visibleWidgets(dropped))[0], 'recordings');
	const last = moveWidgetBefore(EMPTY, 'quick-actions', null);
	assert.equal(ids(resolveLayout(last)).at(-1), 'quick-actions');
});

test('hiding and adding back', () => {
	const hidden = setWidgetHidden(EMPTY, 'bots', true);
	assert.equal(ids(visibleWidgets(hidden)).includes('bots'), false);
	assert.equal(ids(hiddenWidgets(hidden)).includes('bots'), true);
	const shown = setWidgetHidden(hidden, 'connections', false);
	assert.equal(ids(visibleWidgets(shown)).at(-1), 'connections');
});

test('reset restores every default', () => {
	let layout = setWidgetHidden(EMPTY, 'bots', true);
	layout = setWidgetSize(layout, 'agents', 'tall');
	layout = moveWidgetBefore(layout, 'recordings', 'quick-actions');
	assert.deepEqual(resolveLayout(resetLayout(layout)), resolveLayout(EMPTY));
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

test('saves run in order and the last edit wins', async () => {
	const saved: string[] = [];
	const gates: ReturnType<typeof deferred<undefined>>[] = [];
	const queue = new HomeLayoutSaveQueue((layout) => {
		saved.push(layout.widgets[0]?.id ?? '');
		const gate = deferred<undefined>();
		gates.push(gate);
		return gate.promise;
	});
	const first = {
		widgets: [{ id: 'bots', size: 'small' as const, hidden: false }],
	};
	const second = {
		widgets: [{ id: 'agents', size: 'small' as const, hidden: false }],
	};
	queue.enqueue(first);
	queue.enqueue(second);
	assert.deepEqual(queue.snapshot().pending, second);
	assert.deepEqual(saved, ['bots']);
	gates[0]?.resolve(undefined);
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.deepEqual(saved, ['bots', 'agents']);
	queue.settle(second);
	assert.deepEqual(queue.snapshot().pending, second, 'still saving');
	gates[1]?.resolve(undefined);
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(queue.snapshot().pending, undefined);
	assert.equal(queue.snapshot().failed, false);
});

test('a failed save drops unconfirmed edits and reports the failure', async () => {
	const queue = new HomeLayoutSaveQueue(() => Promise.reject(new Error('no')));
	const server = { widgets: [] };
	queue.settle(server);
	queue.enqueue({ widgets: [{ id: 'bots', size: 'small', hidden: true }] });
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(queue.snapshot().pending, undefined);
	assert.equal(queue.snapshot().failed, true);
	// The same server value again keeps the notice; a new one clears it.
	queue.settle(server);
	assert.equal(queue.snapshot().failed, true);
	queue.settle({ widgets: [{ id: 'tabs', size: 'small', hidden: false }] });
	assert.equal(queue.snapshot().failed, false);
});
