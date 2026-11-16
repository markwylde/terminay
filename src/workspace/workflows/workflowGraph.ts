/**
 * The shape of a workflow, worked out from its steps' dependencies alone
 * (ADR-0127). Every view — the vertical panel and its rail, the horizontal
 * drawer and strip, Home's columns, and the template outline — draws from
 * these functions, so the same dependencies are always drawn the same way.
 * Pure: nothing here talks to a server or the DOM.
 */

import type { WorkflowStepStatus } from '@terminay/client-core';

export interface GraphStep {
	readonly id: string;
	/** Ids of earlier steps this step waits on. */
	readonly after: readonly string[];
}

/** One item of a sequence: a step id, or a bracket of tracks run alongside each other. */
export type StageItem = string | StageGroup;

export interface StageGroup {
	/** Each track is a sequence; tracks run alongside each other. */
	readonly tracks: readonly (readonly StageItem[])[];
}

export interface StageAnalysis {
	/** The top-level sequence. */
	readonly tree: readonly StageItem[];
	/** Each step's dependencies without those it waits on through another of them. */
	readonly reduced: ReadonlyMap<string, readonly string[]>;
	/** What each step's position implies it waits on. */
	readonly implied: ReadonlyMap<string, readonly string[]>;
}

/** Collapsed rail width: 36px, 8px more per nesting level beyond the first, at most 72px. */
export const WORKFLOW_RAIL_BASE_WIDTH = 36;
export const WORKFLOW_RAIL_NEST_STEP = 8;
export const WORKFLOW_RAIL_MAX_WIDTH = 72;

/** Each step's dependencies, keeping only steps above it in the list. */
function dependenciesOf(steps: readonly GraphStep[]): Map<string, readonly string[]> {
	const position = new Map(steps.map((step, index) => [step.id, index]));
	return new Map(
		steps.map((step, index) => [
			step.id,
			step.after.filter((id) => {
				const at = position.get(id);
				return at !== undefined && at < index;
			}),
		]),
	);
}

function ancestorsOf(
	steps: readonly GraphStep[],
	dependencies: ReadonlyMap<string, readonly string[]>,
): Map<string, ReadonlySet<string>> {
	const ancestors = new Map<string, ReadonlySet<string>>();
	for (const step of steps) {
		const all = new Set<string>();
		for (const id of dependencies.get(step.id) ?? []) {
			all.add(id);
			for (const above of ancestors.get(id) ?? []) all.add(above);
		}
		ancestors.set(step.id, all);
	}
	return ancestors;
}

/**
 * Brackets from dependencies. A set of steps is split in series at every
 * step comparable with all the others (a "cut"); otherwise into parallel
 * tracks by the connected components of the comparability graph; otherwise,
 * when it is connected but has no cut, into layers by local rank.
 */
export function analyzeStages(steps: readonly GraphStep[]): StageAnalysis {
	const ids = steps.map((step) => step.id);
	const position = new Map(ids.map((id, index) => [id, index]));
	const dependencies = dependenciesOf(steps);
	const ancestors = ancestorsOf(steps, dependencies);
	const reduced = new Map<string, readonly string[]>();
	for (const step of steps) {
		const direct = dependencies.get(step.id) ?? [];
		reduced.set(
			step.id,
			direct.filter(
				(id) =>
					!direct.some(
						(other) => other !== id && ancestors.get(other)?.has(id) === true,
					),
			),
		);
	}
	const related = (a: string, b: string) =>
		ancestors.get(a)?.has(b) === true || ancestors.get(b)?.has(a) === true;
	const byPosition = (a: string, b: string) =>
		(position.get(a) ?? 0) - (position.get(b) ?? 0);

	function decompose(set: readonly string[]): StageItem[] {
		if (set.length === 0) return [];
		if (set.length === 1) return [set[0] as string];
		const cuts = new Set(
			set.filter((id) => set.every((other) => other === id || related(other, id))),
		);
		if (cuts.size > 0) {
			const out: StageItem[] = [];
			let segment: string[] = [];
			for (const id of set) {
				if (cuts.has(id)) {
					out.push(...decompose(segment), id);
					segment = [];
				} else segment.push(id);
			}
			out.push(...decompose(segment));
			return out;
		}
		const seen = new Set<string>();
		const components: string[][] = [];
		for (const start of set) {
			if (seen.has(start)) continue;
			const component: string[] = [];
			const queue = [start];
			seen.add(start);
			while (queue.length > 0) {
				const id = queue.pop() as string;
				component.push(id);
				for (const other of set)
					if (!seen.has(other) && related(id, other)) {
						seen.add(other);
						queue.push(other);
					}
			}
			components.push(component.sort(byPosition));
		}
		if (components.length > 1)
			return [{ tracks: components.map((component) => decompose(component)) }];
		// Connected, with no cut: layers by rank within the set.
		const inSet = new Set(set);
		const rank = new Map<string, number>();
		for (const id of set) {
			let level = 0;
			for (const dependency of dependencies.get(id) ?? [])
				if (inSet.has(dependency))
					level = Math.max(level, (rank.get(dependency) ?? 0) + 1);
			rank.set(id, level);
		}
		const layers: string[][] = [];
		for (const id of set) {
			const level = rank.get(id) ?? 0;
			const layer = layers[level] ?? [];
			layer.push(id);
			layers[level] = layer;
		}
		return layers
			.filter((layer) => layer.length > 0)
			.map((layer) =>
				layer.length > 1
					? { tracks: layer.map((id) => [id]) }
					: (layer[0] as string),
			);
	}

	const tree = decompose(ids);
	const implied = new Map<string, readonly string[]>();
	const walk = (items: readonly StageItem[], entry: readonly string[]): readonly string[] => {
		let current = entry;
		for (const item of items) {
			if (typeof item === 'string') {
				implied.set(item, current);
				current = [item];
			} else current = item.tracks.flatMap((track) => walk(track, current));
		}
		return current;
	};
	walk(tree, []);
	return { tree, reduced, implied };
}

/** Every step id in an item, in drawing order. */
export function stageIds(item: StageItem): readonly string[] {
	return typeof item === 'string'
		? [item]
		: item.tracks.flatMap((track) => track.flatMap(stageIds));
}

/** How deep brackets nest: 0 for a plain sequence, 1 for brackets with no bracket inside. */
export function stageDepth(items: readonly StageItem[]): number {
	let depth = 0;
	for (const item of items)
		if (typeof item !== 'string')
			depth = Math.max(depth, 1 + Math.max(0, ...item.tracks.map(stageDepth)));
	return depth;
}

/** The collapsed rail's width for a stage tree. */
export function railWidth(items: readonly StageItem[]): number {
	return Math.min(
		WORKFLOW_RAIL_MAX_WIDTH,
		WORKFLOW_RAIL_BASE_WIDTH +
			WORKFLOW_RAIL_NEST_STEP * Math.max(0, stageDepth(items) - 1),
	);
}

/**
 * The dependencies of `id` its position does not imply, to show as "after …";
 * empty when the brackets already say it.
 */
export function unimpliedDependencies(
	analysis: StageAnalysis,
	id: string,
): readonly string[] {
	const real = analysis.reduced.get(id) ?? [];
	const implied = analysis.implied.get(id) ?? [];
	const same =
		real.length === implied.length && real.every((dependency) => implied.includes(dependency));
	return same ? [] : real;
}

/** How many dependencies a tree's arrangement implies in total. */
export function impliedDependencyCount(analysis: StageAnalysis): number {
	let count = 0;
	for (const dependencies of analysis.implied.values()) count += dependencies.length;
	return count;
}

export type GroupTone = 'alert' | 'running' | 'done' | 'idle';

/** A bracket's colour from the steps it holds. */
export function groupTone(statuses: readonly WorkflowStepStatus[]): GroupTone {
	if (statuses.some((status) => status === 'needs_input' || status === 'failed'))
		return 'alert';
	if (statuses.some((status) => status === 'running')) return 'running';
	if (statuses.length > 0 && statuses.every((status) => status === 'done' || status === 'skipped'))
		return 'done';
	return 'idle';
}

/** Every step `id` waits on, directly or through other steps, and every step that waits on it. */
export function traceDependencies(
	steps: readonly GraphStep[],
	id: string,
): { readonly upstream: ReadonlySet<string>; readonly downstream: ReadonlySet<string> } {
	const dependencies = dependenciesOf(steps);
	const upstream = new Set<string>();
	const climb = (current: string) => {
		for (const dependency of dependencies.get(current) ?? [])
			if (!upstream.has(dependency)) {
				upstream.add(dependency);
				climb(dependency);
			}
	};
	climb(id);
	const downstream = new Set<string>();
	const descend = (current: string) => {
		for (const step of steps)
			if ((dependencies.get(step.id) ?? []).includes(current) && !downstream.has(step.id)) {
				downstream.add(step.id);
				descend(step.id);
			}
	};
	descend(id);
	return { upstream, downstream };
}

export interface MetroNode {
	readonly id: string;
	readonly column: number;
	readonly lane: number;
}

export interface MetroEdge {
	readonly from: string;
	readonly to: string;
}

export interface MetroLayout {
	readonly nodes: ReadonlyMap<string, MetroNode>;
	readonly edges: readonly MetroEdge[];
	readonly columns: number;
	readonly lanes: number;
}

/**
 * The metro map: a step's column is one further right than the furthest of
 * its dependencies; its lane is the first free lane in that column, preferring
 * a lane one of its dependencies runs on.
 */
export function metroLayout(steps: readonly GraphStep[]): MetroLayout {
	const dependencies = dependenciesOf(steps);
	const nodes = new Map<string, MetroNode>();
	const occupied: Set<number>[] = [];
	const edges: MetroEdge[] = [];
	for (const step of steps) {
		const waits = dependencies.get(step.id) ?? [];
		const column =
			waits.length === 0
				? 0
				: Math.max(...waits.map((id) => nodes.get(id)?.column ?? 0)) + 1;
		const taken = occupied[column] ?? new Set<number>();
		occupied[column] = taken;
		const preferred = waits
			.map((id) => nodes.get(id)?.lane ?? 0)
			.sort((a, b) => a - b);
		let lane = preferred.find((candidate) => !taken.has(candidate));
		if (lane === undefined) {
			lane = 0;
			while (taken.has(lane)) lane += 1;
		}
		taken.add(lane);
		nodes.set(step.id, { id: step.id, column, lane });
		for (const from of waits) edges.push({ from, to: step.id });
	}
	let columns = 0;
	let lanes = 0;
	for (const node of nodes.values()) {
		columns = Math.max(columns, node.column + 1);
		lanes = Math.max(lanes, node.lane + 1);
	}
	return { nodes, edges, columns, lanes };
}
