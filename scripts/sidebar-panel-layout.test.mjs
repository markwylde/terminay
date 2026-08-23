import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const outputDirectory = await mkdtemp(
	join(tmpdir(), 'terminay-sidebar-panel-layout-'),
);
await build({
	absWorkingDir: process.cwd(),
	bundle: true,
	entryPoints: ['src/components/sidebar/sidebarPanelLayout.ts'],
	format: 'esm',
	outdir: outputDirectory,
	platform: 'node',
});
const {
	normalizeSidebarPanelLayout,
	resizeSidebarPanelBoundary,
	sidebarPanelCommitHeights,
} = await import(
	pathToFileURL(join(outputDirectory, 'sidebarPanelLayout.js')).href
);

test.after(async () => {
	await rm(outputDirectory, { recursive: true, force: true });
});

function panes(preferredHeights, options = []) {
	return preferredHeights.map((preferredHeight, index) => ({
		collapsed: false,
		id: `pane-${index + 1}`,
		preferredHeight,
		titleHeight: 20,
		...options[index],
	}));
}

function assertClose(actual, expected) {
	assert.ok(
		Math.abs(actual - expected) < 0.001,
		`${actual} should be within 0.001px of ${expected}`,
	);
}

function assertValidLayout(layout, containerHeight) {
	for (const allocation of layout.allocations) {
		assert.ok(Number.isFinite(allocation.totalHeight));
		assert.ok(Number.isFinite(allocation.bodyHeight));
		assert.ok(allocation.totalHeight >= allocation.titleHeight);
		assert.ok(allocation.bodyHeight >= 0);
	}
	if (layout.feasible) {
		assert.ok(layout.trailingSlack >= 0);
		assertClose(layout.allocatedHeight + layout.trailingSlack, containerHeight);
	}
}

test('flat sidebar solver reserves every title, including all collapsed combinations', () => {
	const combinations = 2 ** 4;
	for (let bits = 0; bits < combinations; bits += 1) {
		const input = panes([320, 200, 240, 220]).map((pane, index) => ({
			...pane,
			collapsed: (bits & (1 << index)) !== 0,
			titleHeight: 19.5 + index * 0.75,
		}));
		const layout = normalizeSidebarPanelLayout(input, 360.25);
		assert.equal(layout.feasible, true);
		assertValidLayout(layout, 360.25);
		for (const allocation of layout.allocations) {
			if (allocation.collapsed) {
				assertClose(allocation.totalHeight, allocation.titleHeight);
				assert.equal(allocation.bodyHeight, 0);
			}
		}
	}
});

test('flat sidebar solver preserves per-id preferences across last-pane, reorder, registration, and shrink/regrow cases', () => {
	const source = panes([360, 220, 180, 420]);
	const initial = normalizeSidebarPanelLayout(source, 800);
	const byId = new Map(
		initial.allocations.map((allocation) => [
			allocation.id,
			allocation.totalHeight,
		]),
	);
	assert.ok(byId.get('pane-4') > 20, 'last pane must receive an allocation');

	const reordered = normalizeSidebarPanelLayout(
		[source[3], source[1], source[0], source[2]],
		800,
	);
	for (const allocation of reordered.allocations) {
		assertClose(allocation.totalHeight, byId.get(allocation.id));
	}

	const constrained = normalizeSidebarPanelLayout(source, 180);
	assertValidLayout(constrained, 180);
	const restored = normalizeSidebarPanelLayout(source, 800);
	assert.deepEqual(
		restored.allocations.map((allocation) => allocation.totalHeight),
		initial.allocations.map((allocation) => allocation.totalHeight),
	);
	assert.equal(
		normalizeSidebarPanelLayout([source[0], source[3]], 800).allocations.length,
		2,
	);
});

test('dragging every boundary is bounded, title-safe, and preserves total geometry', () => {
	const initial = normalizeSidebarPanelLayout(panes([160, 120, 200, 100]), 520);
	for (const separator of initial.separators) {
		for (const requestedDelta of [-10_000, -37.5, 37.5, 10_000]) {
			const result = resizeSidebarPanelBoundary(
				initial,
				separator.boundaryIndex,
				requestedDelta,
			);
			assert.ok(Math.abs(result.appliedDelta) <= Math.abs(requestedDelta));
			assertValidLayout(result.layout, 520);
			assertClose(
				result.layout.separators[separator.boundaryIndex - 1].offset,
				result.layout.allocations[separator.boundaryIndex].offset,
			);
		}
	}
});

test('a completed resize persists every expanded preference needed to preserve its preview', () => {
	const source = panes([320, 200, 240, 220], [{}, {}, {}, { collapsed: true }]);
	const initial = normalizeSidebarPanelLayout(source, 1_200);
	const preview = resizeSidebarPanelBoundary(initial, 1, 100).layout;
	const committed = sidebarPanelCommitHeights(initial, preview);
	assert.deepEqual(
		committed,
		Object.fromEntries(
			preview.allocations
				.filter((allocation) => !allocation.collapsed)
				.map((allocation) => [
					allocation.id,
					Math.round(allocation.totalHeight),
				]),
		),
	);
	assert.equal('pane-4' in committed, false);

	const reconciled = normalizeSidebarPanelLayout(
		source.map((pane) => ({
			...pane,
			preferredHeight: committed[pane.id] ?? pane.preferredHeight,
		})),
		1_200,
	);
	for (const [index, allocation] of reconciled.allocations.entries()) {
		assertClose(allocation.totalHeight, preview.allocations[index].totalHeight);
	}
});

test('impossible title budgets are explicit and cannot manufacture an off-screen title', () => {
	const layout = normalizeSidebarPanelLayout(
		panes(
			[100, 100, 100],
			[{ titleHeight: 30 }, { titleHeight: 25 }, { titleHeight: 35 }],
		),
		40,
	);
	assert.equal(layout.feasible, false);
	assert.equal(layout.requiredTitleHeight, 90);
	assert.equal(layout.allocatedHeight, 90);
	assert.deepEqual(resizeSidebarPanelBoundary(layout, 1, 20), {
		appliedDelta: 0,
		changedIds: [],
		layout,
	});
});
