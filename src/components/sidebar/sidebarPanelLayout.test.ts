import assert from 'node:assert/strict';
import test from 'node:test';
import {
	normalizeSidebarPanelLayout,
	resizeSidebarPanelBoundary,
	type SidebarPanelLayoutPane,
	sidebarPanelCommitHeights,
} from './sidebarPanelLayout.ts';

const panes = (
	preferences: readonly number[] = [100, 100, 100],
	options: Partial<SidebarPanelLayoutPane>[] = [],
): SidebarPanelLayoutPane[] =>
	preferences.map((preferredHeight, index) => ({
		id: `pane-${index + 1}`,
		titleHeight: 20,
		collapsed: false,
		preferredHeight,
		...options[index],
	}));

function sum(values: readonly number[]): number {
	return values.reduce((total, value) => total + value, 0);
}

function assertClose(actual: number, expected: number): void {
	assert.ok(
		Math.abs(actual - expected) < 0.0001,
		`${actual} should equal ${expected}`,
	);
}

function assertTitleSafe(
	layout: ReturnType<typeof normalizeSidebarPanelLayout>,
): void {
	for (const allocation of layout.allocations) {
		assert.ok(allocation.totalHeight >= allocation.titleHeight);
		assert.ok(allocation.bodyHeight >= 0);
		assert.ok(Number.isFinite(allocation.totalHeight));
	}
}

test('normalizes the whole stack, including the final pane, to the available height', () => {
	const layout = normalizeSidebarPanelLayout(panes([120, 80, 40]), 300);
	assert.equal(layout.feasible, true);
	assertClose(layout.requiredTitleHeight, 60);
	assertClose(layout.allocatedHeight, 300);
	assertClose(
		sum(layout.allocations.map((allocation) => allocation.bodyHeight)),
		240,
	);
	assert.deepEqual(
		layout.allocations.map((allocation) => allocation.id),
		['pane-1', 'pane-2', 'pane-3'],
	);
	assert.ok(
		layout.allocations[2]!.bodyHeight > 0,
		'the final pane has an independent allocation',
	);
	assertTitleSafe(layout);
});

test('uses collapsed title rows as exact hard minima and shares all remaining body pixels', () => {
	const layout = normalizeSidebarPanelLayout(
		panes([100, 100, 100], [{}, { collapsed: true }, {}]),
		180,
	);
	assert.equal(layout.allocations[1]!.totalHeight, 20);
	assert.equal(layout.allocations[1]!.bodyHeight, 0);
	assertClose(layout.allocatedHeight, 180);
	assertTitleSafe(layout);
});

test('leaves trailing slack when every pane is collapsed instead of growing a title row', () => {
	const layout = normalizeSidebarPanelLayout(
		panes(
			[100, 100, 100],
			[{ collapsed: true }, { collapsed: true }, { collapsed: true }],
		),
		360.25,
	);
	assert.deepEqual(
		layout.allocations.map((allocation) => allocation.totalHeight),
		[20, 20, 20],
	);
	assertClose(layout.allocatedHeight, 60);
	assertClose(layout.trailingSlack, 300.25);
	assertClose(layout.allocatedHeight + layout.trailingSlack, 360.25);
	assertTitleSafe(layout);
});

test('reports an unsupported title budget explicitly instead of manufacturing a clipped allocation', () => {
	const layout = normalizeSidebarPanelLayout(panes([50, 50, 50]), 40);
	assert.equal(layout.feasible, false);
	assert.equal(layout.requiredTitleHeight, 60);
	assert.equal(layout.allocatedHeight, 60);
	assert.deepEqual(
		layout.allocations.map((allocation) => allocation.totalHeight),
		[20, 20, 20],
	);
	assertTitleSafe(layout);
});

test('keeps fractional measurements finite and normalizes idempotently without pixel drift', () => {
	const input = panes(
		[151.2, 99.8, 75.1],
		[{ titleHeight: 20.25 }, { titleHeight: 19.75 }, { titleHeight: 20.5 }],
	);
	const first = normalizeSidebarPanelLayout(input, 401.25);
	const second = normalizeSidebarPanelLayout(
		first.allocations.map((allocation) => ({
			id: allocation.id,
			titleHeight: allocation.titleHeight,
			collapsed: allocation.collapsed,
			preferredHeight: allocation.totalHeight,
		})),
		401.25,
	);
	assertClose(first.allocatedHeight, 401.25);
	for (const [index, allocation] of first.allocations.entries()) {
		assertClose(second.allocations[index]!.totalHeight, allocation.totalHeight);
	}
});

test('preserves id-owned preferences through reorder, registration changes, and shrink/regrow', () => {
	const source = panes([300, 200, 100]);
	const baseline = normalizeSidebarPanelLayout(source, 600);
	const shrunk = normalizeSidebarPanelLayout(source, 210);
	const regrown = normalizeSidebarPanelLayout(source, 600);
	assert.deepEqual(
		regrown.allocations.map((allocation) => allocation.totalHeight),
		baseline.allocations.map((allocation) => allocation.totalHeight),
	);
	assert.ok(
		shrunk.allocations.every((allocation) => allocation.bodyHeight >= 0),
	);

	const reordered = normalizeSidebarPanelLayout(
		[source[2]!, source[0]!, source[1]!],
		600,
	);
	const originalById = new Map(
		baseline.allocations.map((allocation) => [
			allocation.id,
			allocation.totalHeight,
		]),
	);
	for (const allocation of reordered.allocations) {
		assertClose(allocation.totalHeight, originalById.get(allocation.id)!);
	}

	const withoutMiddle = normalizeSidebarPanelLayout(
		[source[0]!, source[2]!],
		600,
	);
	const restored = normalizeSidebarPanelLayout(source, 600);
	assert.equal(withoutMiddle.allocations.length, 2);
	assert.deepEqual(
		restored.allocations.map((allocation) => allocation.totalHeight),
		baseline.allocations.map((allocation) => allocation.totalHeight),
	);
});

test('places every separator at the following title and clamps each drag through all eligible panes', () => {
	const initial = normalizeSidebarPanelLayout(panes([80, 80, 80]), 180);
	const firstSeparator = initial.separators[0]!;
	assertClose(firstSeparator.offset, initial.allocations[1]!.offset);
	assert.equal(firstSeparator.state, 'enabled');

	const down = resizeSidebarPanelBoundary(initial, 1, 1_000);
	assertClose(down.appliedDelta, 80);
	assert.deepEqual(down.changedIds, ['pane-1', 'pane-2', 'pane-3']);
	assert.deepEqual(
		down.layout.allocations.map((allocation) => allocation.totalHeight),
		[140, 20, 20],
	);
	assertClose(down.layout.allocatedHeight, 180);
	assertTitleSafe(down.layout);

	const up = resizeSidebarPanelBoundary(down.layout, 1, -1_000);
	assertClose(up.appliedDelta, -120);
	assert.deepEqual(
		up.layout.allocations.map((allocation) => allocation.totalHeight),
		[20, 140, 20],
	);
	assertClose(up.layout.allocatedHeight, 180);
	assertTitleSafe(up.layout);
});

test('communicates exhausted separator directions and leaves impossible or inert drags unchanged', () => {
	const layout = normalizeSidebarPanelLayout(
		panes([80, 80, 80], [{ collapsed: true }, {}, { collapsed: true }]),
		120,
	);
	assert.equal(layout.separators[0]!.state, 'disabled');
	assert.equal(layout.separators[1]!.state, 'disabled');
	assert.equal(layout.separators[0]!.minimum, layout.separators[0]!.offset);
	assert.equal(layout.separators[1]!.maximum, layout.separators[1]!.offset);
	assert.equal(resizeSidebarPanelBoundary(layout, 1, -20).appliedDelta, 0);
	assert.equal(resizeSidebarPanelBoundary(layout, 2, 20).appliedDelta, 0);

	const impossible = normalizeSidebarPanelLayout(panes(), 10);
	assert.equal(resizeSidebarPanelBoundary(impossible, 1, 20).appliedDelta, 0);
});

test('keeps a directional limit enabled when expanded panes exist on both sides', () => {
	const layout = normalizeSidebarPanelLayout(panes([20, 80]), 100);
	const separator = layout.separators[0]!;
	assert.equal(separator.state, 'at-minimum');
	assert.ok(separator.maximum > separator.offset);
	const resized = resizeSidebarPanelBoundary(layout, 1, 30);
	assert.equal(resized.appliedDelta, 30);
	assert.deepEqual(
		resized.layout.allocations.map((allocation) => allocation.totalHeight),
		[50, 50],
	);
});

test('commits the complete expanded preference vector so pointer-up round-trips exactly', () => {
	const ids = ['explorer', 'agents', 'git', 'documentation'];
	const preferences = [320, 200, 240, 220];
	const source: SidebarPanelLayoutPane[] = preferences.map(
		(preferredHeight, index) => ({
			id: ids[index]!,
			titleHeight: 30,
			collapsed: index === 3,
			preferredHeight,
		}),
	);
	const initial = normalizeSidebarPanelLayout(source, 1_200);
	const resized = resizeSidebarPanelBoundary(initial, 1, 100);
	assert.deepEqual(
		resized.layout.allocations.map((allocation) =>
			Math.round(allocation.totalHeight),
		),
		[597, 204, 369, 30],
	);

	const committed: Record<string, number> = sidebarPanelCommitHeights(
		initial,
		resized.layout,
	);
	assert.deepEqual(committed, {
		explorer: 597,
		agents: 204,
		git: 369,
	});
	assert.equal('documentation' in committed, false);
	const persistedHeights = new Map<string, number>(Object.entries(committed));
	const restored = normalizeSidebarPanelLayout(
		source.map((pane) => ({
			...pane,
			preferredHeight: persistedHeights.get(pane.id) ?? pane.preferredHeight,
		})),
		1_200,
	);
	for (const [index, allocation] of restored.allocations.entries()) {
		assert.ok(
			Math.abs(
				allocation.totalHeight - resized.layout.allocations[index]!.totalHeight,
			) <= 1,
			'persisted integer dimensions must not visibly move a completed boundary',
		);
	}
	const stabilized = normalizeSidebarPanelLayout(
		restored.allocations.map((allocation) => ({
			id: allocation.id,
			titleHeight: allocation.titleHeight,
			collapsed: allocation.collapsed,
			preferredHeight: allocation.totalHeight,
		})),
		1_200,
	);
	for (const [index, allocation] of stabilized.allocations.entries()) {
		assertClose(
			allocation.totalHeight,
			restored.allocations[index]!.totalHeight,
		);
	}

	const noMovement = sidebarPanelCommitHeights(initial, initial);
	assert.deepEqual(noMovement, {});
});

test('rejects duplicate identity rather than transferring one pane preference to another', () => {
	assert.throws(
		() =>
			normalizeSidebarPanelLayout(
				[
					{
						id: 'same',
						titleHeight: 20,
						collapsed: false,
						preferredHeight: 80,
					},
					{
						id: 'same',
						titleHeight: 20,
						collapsed: false,
						preferredHeight: 80,
					},
				],
				200,
			),
		/duplicated/u,
	);
});
