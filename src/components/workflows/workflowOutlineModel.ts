/**
 * A template's steps as the editor's outline (ADR-0128): a sequence of steps
 * and brackets, each bracket a set of tracks run alongside each other. The
 * outline is the plan's shape. Opening a template draws it as the vertical
 * panel would; changing the shape derives every step's dependencies from it.
 * Pure: steps are named by their editor keys.
 */

import {
	analyzeStages,
	type GraphStep,
	type StageItem,
	stageIds,
} from '../../workspace/workflows/workflowGraph.ts';

export type OutlineItem = StageItem;
export type Outline = readonly OutlineItem[];

interface Group {
	readonly tracks: readonly Outline[];
}

/** The arrangement the vertical panel would draw for these steps. */
export function outlineFromSteps(steps: readonly GraphStep[]): Outline {
	return analyzeStages(steps).tree;
}

/** Every step key in outline order: a track's steps before the next track's. */
export function outlineKeys(outline: Outline): readonly string[] {
	return outline.flatMap(stageIds);
}

/** A group's name in the editor: its first step's key. */
export function groupKey(group: Group): string {
	return stageIds(group as OutlineItem)[0] ?? '';
}

/**
 * Every step's dependencies as the outline implies them: the step before it in
 * its track; for a track's first step, what its bracket waits on; after a
 * bracket, the last step of each of its tracks; nothing for the first step.
 */
export function dependenciesFromOutline(outline: Outline): ReadonlyMap<string, readonly string[]> {
	const after = new Map<string, readonly string[]>();
	const walk = (items: Outline, entry: readonly string[]): readonly string[] => {
		let current = entry;
		for (const item of items) {
			if (typeof item === 'string') {
				after.set(item, current);
				current = [item];
			} else current = item.tracks.flatMap((track) => walk(track, current));
		}
		return current;
	};
	walk(outline, []);
	return after;
}

/** How many dependencies the outline implies in all. */
export function impliedLinkCount(outline: Outline): number {
	let count = 0;
	for (const after of dependenciesFromOutline(outline).values()) count += after.length;
	return count;
}

/**
 * Rewrites the sequence holding `key` with `update`, wherever it is.
 * `update` gets the sequence and the key's index in it; the parent group, when
 * there is one, and the track's index in it come along so a caller can work
 * on the bracket.
 */
function editSequence(
	outline: Outline,
	key: string,
	update: (sequence: Outline, index: number) => Outline,
): Outline {
	const visit = (items: Outline): Outline | undefined => {
		const index = items.indexOf(key);
		if (index >= 0) return update(items, index);
		for (const [position, item] of items.entries()) {
			if (typeof item === 'string') continue;
			for (const [trackIndex, track] of item.tracks.entries()) {
				const next = visit(track);
				if (next === undefined) continue;
				const tracks = item.tracks.map((existing, at) => (at === trackIndex ? next : existing));
				return items.map((existing, at) => (at === position ? { tracks } : existing));
			}
		}
		return undefined;
	};
	return normalize(visit(outline) ?? outline);
}

/** Removes empty tracks and empty brackets, and opens a one-track bracket into its sequence. */
function normalize(items: Outline): Outline {
	const out: OutlineItem[] = [];
	for (const item of items) {
		if (typeof item === 'string') {
			out.push(item);
			continue;
		}
		const tracks = item.tracks.map(normalize).filter((track) => track.length > 0);
		if (tracks.length === 0) continue;
		if (tracks.length === 1) out.push(...(tracks[0] as Outline));
		else out.push({ tracks });
	}
	return out;
}

/** "+ then": a new step directly after `key` in its track. */
export function addThen(outline: Outline, key: string, added: string): Outline {
	return editSequence(outline, key, (sequence, index) => [
		...sequence.slice(0, index + 1),
		added,
		...sequence.slice(index + 1),
	]);
}

/**
 * "+ alongside": a new step that runs alongside `key`. A step alone in a
 * bracket's track gains a new track beside it; any other step becomes a
 * bracket of itself and the new step.
 */
export function addAlongside(outline: Outline, key: string, added: string): Outline {
	const parent = groupHoldingTrack(outline, key);
	if (parent !== undefined) return addTrack(outline, groupKey(parent), added);
	return editSequence(outline, key, (sequence, index) => [
		...sequence.slice(0, index),
		{ tracks: [[key], [added]] },
		...sequence.slice(index + 1),
	]);
}

/** The bracket one of whose tracks is exactly `[key]`, if any. */
function groupHoldingTrack(outline: Outline, key: string): Group | undefined {
	for (const item of outline) {
		if (typeof item === 'string') continue;
		if (item.tracks.some((track) => track.length === 1 && track[0] === key)) return item;
		for (const track of item.tracks) {
			const found = groupHoldingTrack(track, key);
			if (found !== undefined) return found;
		}
	}
	return undefined;
}

/** "+ another track alongside": a new track of one new step in the bracket named by its first step. */
export function addTrack(outline: Outline, group: string, added: string): Outline {
	const visit = (items: Outline): Outline =>
		items.map((item) => {
			if (typeof item === 'string') return item;
			if (groupKey(item) === group) return { tracks: [...item.tracks, [added]] };
			return { tracks: item.tracks.map(visit) };
		});
	return normalize(visit(outline));
}

/** "+ Add step at the end". */
export function addAtEnd(outline: Outline, added: string): Outline {
	return [...outline, added];
}

/** Removes a step; a track left empty goes, and a bracket left with one track becomes a sequence. */
export function removeStep(outline: Outline, key: string): Outline {
	return editSequence(outline, key, (sequence, index) => [
		...sequence.slice(0, index),
		...sequence.slice(index + 1),
	]);
}

/** Moves a step one place within its track; the same outline when it cannot move. */
export function moveWithinTrack(outline: Outline, key: string, direction: -1 | 1): Outline {
	let moved = false;
	const next = editSequence(outline, key, (sequence, index) => {
		const target = index + direction;
		if (target < 0 || target >= sequence.length) return sequence;
		moved = true;
		const items = [...sequence];
		const [item] = items.splice(index, 1);
		items.splice(target, 0, item as OutlineItem);
		return items;
	});
	return moved ? next : outline;
}

/**
 * Moves a step to stand before `before` in the same track (a step, or a
 * bracket named by its first step), or to the end of its track when `before`
 * is null. The same outline when they share no track.
 */
export function moveBeforeInTrack(outline: Outline, key: string, before: string | null): Outline {
	if (before === key) return outline;
	let moved = false;
	const next = editSequence(outline, key, (sequence, index) => {
		const items = [...sequence];
		items.splice(index, 1);
		const target =
			before === null
				? items.length
				: items.findIndex(
						(item) => item === before || (typeof item !== 'string' && groupKey(item) === before),
					);
		if (target < 0) return sequence;
		items.splice(target, 0, key);
		moved = items.some((item, at) => item !== sequence[at]);
		return items;
	});
	return moved ? next : outline;
}

/** The track (sequence) holding `key`, in order; empty when the key is not in the outline. */
export function trackOf(outline: Outline, key: string): Outline {
	if (outline.includes(key)) return outline;
	for (const item of outline) {
		if (typeof item === 'string') continue;
		for (const track of item.tracks) {
			const found = trackOf(track, key);
			if (found.length > 0) return found;
		}
	}
	return [];
}
