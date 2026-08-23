/**
 * Geometry for the project sidebar's single vertical pane stack.
 *
 * This module deliberately has no React or DOM dependency. The renderer gives
 * it measured title heights and project-owned preferred pane heights; it gives
 * the renderer finite allocations and sash constraints. Keeping this boundary
 * pure prevents a drag from needing to mutate canonical workspace state.
 */

export type SidebarPanelLayoutPane = Readonly<{
	id: string;
	/** The measured, rendered height of this pane's title row. */
	titleHeight: number;
	/** Collapsed panes reserve their title only and retain their preference. */
	collapsed: boolean;
	/** The project-owned preferred total pane height, including its title. */
	preferredHeight: number;
}>;

export type SidebarPanelAllocation = Readonly<{
	id: string;
	collapsed: boolean;
	titleHeight: number;
	totalHeight: number;
	bodyHeight: number;
	offset: number;
}>;

export type SidebarPanelSeparatorState =
	| 'enabled'
	| 'at-minimum'
	| 'at-maximum'
	| 'disabled';

export type SidebarPanelSeparator = Readonly<{
	/** The following pane's index. A separator is never before the first pane. */
	boundaryIndex: number;
	/** The top edge of the following pane title, in stack-local pixels. */
	offset: number;
	minimum: number;
	maximum: number;
	state: SidebarPanelSeparatorState;
}>;

export type SidebarPanelLayout = Readonly<{
	requestedContainerHeight: number;
	/** The smallest container that can display every title. */
	requiredTitleHeight: number;
	/**
	 * False means the host has violated its minimum-height contract. There is no
	 * valid title-visible allocation inside the requested height, so allocations
	 * contain the explicit title-only minimum instead of silently clipping.
	 */
	feasible: boolean;
	/** The sum of pane allocations, excluding any explicit trailing slack. */
	allocatedHeight: number;
	/**
	 * Space after the final pane when no expanded pane is eligible to own it.
	 * Collapsed panes stay exactly title-height; the renderer leaves this as an
	 * inert trailing region rather than growing a collapsed title row.
	 */
	trailingSlack: number;
	allocations: readonly SidebarPanelAllocation[];
	separators: readonly SidebarPanelSeparator[];
}>;

export type SidebarPanelResizeResult = Readonly<{
	layout: SidebarPanelLayout;
	appliedDelta: number;
	changedIds: readonly string[];
}>;

const EPSILON = 0.0001;

/**
 * Convert a completed rendered resize into project-owned preferences.
 *
 * `preferredHeight` is a relative body-size weight, not a direct CSS height.
 * Consequently, a partial patch is not a stable representation of a rendered
 * layout: leaving an unmodified expanded pane at its old weight changes the
 * next normalization and makes the boundary jump when its local preview ends.
 * Commit every expanded pane from the same layout snapshot as one vector.
 * Collapsed panes deliberately retain their previous preference because their
 * title-only rendered allocation carries no information about the body size to
 * restore when they are expanded.
 */
export function sidebarPanelCommitHeights(
	startLayout: SidebarPanelLayout,
	latestLayout: SidebarPanelLayout,
): Record<string, number> {
	const startById = new Map(
		startLayout.allocations.map((allocation) => [
			allocation.id,
			allocation.totalHeight,
		]),
	);
	const didResize = latestLayout.allocations.some((allocation) => {
		const startHeight = startById.get(allocation.id);
		return (
			startHeight !== undefined &&
			Math.abs(allocation.totalHeight - startHeight) > EPSILON
		);
	});
	if (!didResize) return {};

	const heights: Record<string, number> = {};
	for (const allocation of latestLayout.allocations) {
		if (!allocation.collapsed) {
			heights[allocation.id] = Math.round(allocation.totalHeight);
		}
	}
	return heights;
}

function finiteNonNegative(value: number): number {
	return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function assertUniquePaneIds(panes: readonly SidebarPanelLayoutPane[]): void {
	const ids = new Set<string>();
	for (const pane of panes) {
		if (!pane.id) throw new TypeError('Sidebar pane ids must be non-empty.');
		if (ids.has(pane.id)) {
			throw new TypeError(`Sidebar pane id "${pane.id}" is duplicated.`);
		}
		ids.add(pane.id);
	}
}

function totalBodyCapacity(
	allocations: readonly SidebarPanelAllocation[],
	start: number,
	end: number,
): number {
	let capacity = 0;
	for (let index = start; index < end; index += 1) {
		const allocation = allocations[index];
		if (allocation !== undefined && !allocation.collapsed) {
			capacity += allocation.bodyHeight;
		}
	}
	return capacity;
}

function hasExpandedPane(
	allocations: readonly SidebarPanelAllocation[],
	start: number,
	end: number,
): boolean {
	for (let index = start; index < end; index += 1) {
		if (allocations[index]?.collapsed === false) return true;
	}
	return false;
}

function createLayout(
	requestedContainerHeight: number,
	requiredTitleHeight: number,
	feasible: boolean,
	allocations: readonly Omit<SidebarPanelAllocation, 'offset'>[],
): SidebarPanelLayout {
	let offset = 0;
	const positioned = allocations.map((allocation) => {
		const next: SidebarPanelAllocation = { ...allocation, offset };
		offset += allocation.totalHeight;
		return next;
	});
	const separators: SidebarPanelSeparator[] = [];
	for (
		let boundaryIndex = 1;
		boundaryIndex < positioned.length;
		boundaryIndex += 1
	) {
		const offset = positioned[boundaryIndex]?.offset ?? 0;
		const aboveCapacity = totalBodyCapacity(positioned, 0, boundaryIndex);
		const belowCapacity = totalBodyCapacity(
			positioned,
			boundaryIndex,
			positioned.length,
		);
		const hasExpandedAbove = hasExpandedPane(positioned, 0, boundaryIndex);
		const hasExpandedBelow = hasExpandedPane(
			positioned,
			boundaryIndex,
			positioned.length,
		);
		const canMoveUp = aboveCapacity > EPSILON;
		const canMoveDown = belowCapacity > EPSILON;
		separators.push({
			boundaryIndex,
			offset,
			minimum:
				hasExpandedAbove && hasExpandedBelow ? offset - aboveCapacity : offset,
			maximum:
				hasExpandedAbove && hasExpandedBelow ? offset + belowCapacity : offset,
			state:
				!hasExpandedAbove || !hasExpandedBelow
					? 'disabled'
					: canMoveUp && canMoveDown
						? 'enabled'
						: canMoveDown
							? 'at-minimum'
							: canMoveUp
								? 'at-maximum'
								: 'disabled',
		});
	}
	return {
		requestedContainerHeight,
		requiredTitleHeight,
		feasible,
		allocatedHeight: offset,
		trailingSlack: feasible
			? Math.max(0, requestedContainerHeight - offset)
			: 0,
		allocations: positioned,
		separators,
	};
}

/**
 * Resolve every pane together. Expanded pane bodies receive the container
 * height left after reserving all measured title rows. Preferred body sizes are
 * normalized as weights, so no position (including the final pane) receives
 * special flex-fill treatment. When every pane is collapsed, their exact title
 * allocations leave an explicit trailing slack region.
 */
export function normalizeSidebarPanelLayout(
	panes: readonly SidebarPanelLayoutPane[],
	containerHeight: number,
): SidebarPanelLayout {
	assertUniquePaneIds(panes);
	const requestedContainerHeight = finiteNonNegative(containerHeight);
	const normalized = panes.map((pane) => ({
		...pane,
		titleHeight: finiteNonNegative(pane.titleHeight),
		preferredHeight: finiteNonNegative(pane.preferredHeight),
	}));
	const requiredTitleHeight = normalized.reduce(
		(total, pane) => total + pane.titleHeight,
		0,
	);
	const feasible = requestedContainerHeight + EPSILON >= requiredTitleHeight;
	const bodyBudget = feasible
		? Math.max(0, requestedContainerHeight - requiredTitleHeight)
		: 0;
	const expanded = normalized.filter((pane) => !pane.collapsed);
	const preferredBodyWeights = expanded.map((pane) =>
		Math.max(0, pane.preferredHeight - pane.titleHeight),
	);
	const weightTotal = preferredBodyWeights.reduce(
		(total, weight) => total + weight,
		0,
	);
	const useEqualWeights = expanded.length > 0 && weightTotal <= EPSILON;
	const resolvedWeightTotal = useEqualWeights ? expanded.length : weightTotal;
	let remainingBody = bodyBudget;
	let expandedIndex = 0;
	const allocations = normalized.map((pane) => {
		if (pane.collapsed) {
			return {
				id: pane.id,
				collapsed: true,
				titleHeight: pane.titleHeight,
				totalHeight: pane.titleHeight,
				bodyHeight: 0,
			};
		}
		const isLastExpanded = expandedIndex === expanded.length - 1;
		const weight = useEqualWeights
			? 1
			: (preferredBodyWeights[expandedIndex] ?? 0);
		const bodyHeight = isLastExpanded
			? remainingBody
			: bodyBudget * (weight / resolvedWeightTotal);
		remainingBody -= bodyHeight;
		expandedIndex += 1;
		return {
			id: pane.id,
			collapsed: false,
			titleHeight: pane.titleHeight,
			totalHeight: pane.titleHeight + bodyHeight,
			bodyHeight,
		};
	});
	return createLayout(
		requestedContainerHeight,
		requiredTitleHeight,
		feasible,
		allocations,
	);
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(Math.max(value, minimum), maximum);
}

function nearestExpandedIndex(
	allocations: readonly SidebarPanelAllocation[],
	start: number,
	end: number,
	direction: 1 | -1,
): number | null {
	for (let index = start; index >= 0 && index < end; index += direction) {
		if (allocations[index]?.collapsed === false) return index;
	}
	return null;
}

function shrinkNearest(
	allocations: Array<{ totalHeight: number; bodyHeight: number }>,
	start: number,
	end: number,
	direction: 1 | -1,
	amount: number,
): void {
	let remaining = amount;
	for (
		let index = start;
		index >= 0 && index < end && remaining > EPSILON;
		index += direction
	) {
		const allocation = allocations[index];
		if (allocation === undefined || allocation.bodyHeight <= EPSILON) continue;
		const reduction = Math.min(allocation.bodyHeight, remaining);
		allocation.bodyHeight -= reduction;
		allocation.totalHeight -= reduction;
		remaining -= reduction;
	}
}

/**
 * Move one boundary from a rendered layout snapshot. A positive delta moves it
 * down: the nearest expandable pane above grows while panes below yield body
 * space nearest-first. A negative delta does the inverse. This mirrors the
 * direct-neighbour feel of a native split view while cascading at a hard title
 * minimum instead of clipping another pane.
 */
export function resizeSidebarPanelBoundary(
	layout: SidebarPanelLayout,
	boundaryIndex: number,
	requestedDelta: number,
): SidebarPanelResizeResult {
	const separator = layout.separators.find(
		(candidate) => candidate.boundaryIndex === boundaryIndex,
	);
	if (
		!layout.feasible ||
		separator === undefined ||
		separator.state === 'disabled' ||
		!Number.isFinite(requestedDelta)
	) {
		return { layout, appliedDelta: 0, changedIds: [] };
	}
	const allocations = layout.allocations.map((allocation) => ({
		...allocation,
	}));
	const aboveCapacity = totalBodyCapacity(allocations, 0, boundaryIndex);
	const belowCapacity = totalBodyCapacity(
		allocations,
		boundaryIndex,
		allocations.length,
	);
	const appliedDelta = clamp(requestedDelta, -aboveCapacity, belowCapacity);
	if (Math.abs(appliedDelta) <= EPSILON) {
		return { layout, appliedDelta: 0, changedIds: [] };
	}

	if (appliedDelta > 0) {
		const growIndex = nearestExpandedIndex(
			allocations,
			boundaryIndex - 1,
			boundaryIndex,
			-1,
		);
		if (growIndex === null) return { layout, appliedDelta: 0, changedIds: [] };
		allocations[growIndex]!.totalHeight += appliedDelta;
		allocations[growIndex]!.bodyHeight += appliedDelta;
		shrinkNearest(
			allocations,
			boundaryIndex,
			allocations.length,
			1,
			appliedDelta,
		);
	} else {
		const amount = -appliedDelta;
		const growIndex = nearestExpandedIndex(
			allocations,
			boundaryIndex,
			allocations.length,
			1,
		);
		if (growIndex === null) return { layout, appliedDelta: 0, changedIds: [] };
		shrinkNearest(allocations, boundaryIndex - 1, boundaryIndex, -1, amount);
		allocations[growIndex]!.totalHeight += amount;
		allocations[growIndex]!.bodyHeight += amount;
	}

	const nextLayout = createLayout(
		layout.requestedContainerHeight,
		layout.requiredTitleHeight,
		true,
		allocations,
	);
	const changedIds = nextLayout.allocations
		.filter(
			(allocation, index) =>
				Math.abs(
					allocation.totalHeight -
						(layout.allocations[index]?.totalHeight ?? 0),
				) > EPSILON,
		)
		.map((allocation) => allocation.id);
	return { layout: nextLayout, appliedDelta, changedIds };
}
