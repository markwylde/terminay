/**
 * Which finished workflows the user has seen on this device, by completion
 * (a workflow's id and its latest step end). Device-local, shared by every
 * window of this client, never sent to a server (ADR-0097).
 */

import { useEffect, useRef, useSyncExternalStore } from 'react';

export const WORKFLOW_SEEN_STORAGE_KEY = 'terminay.workflowSeen.v1';
/** The most recent seen completions kept; older ones may show again. */
export const WORKFLOW_SEEN_LIMIT = 500;

const listeners = new Set<() => void>();
let memory: readonly string[] = [];
let cache: ReadonlySet<string> | undefined;

function parse(raw: string | null | undefined): string[] {
	if (raw === null || raw === undefined) return [];
	try {
		const value: unknown = JSON.parse(raw);
		return Array.isArray(value)
			? value.filter((item): item is string => typeof item === 'string')
			: [];
	} catch {
		return [];
	}
}

/** The stored list, newest first, or the in-memory one without storage. */
function load(): readonly string[] {
	try {
		const storage = globalThis.localStorage;
		if (storage === undefined) return memory;
		const stored = parse(storage.getItem(WORKFLOW_SEEN_STORAGE_KEY));
		// Entries this window could not write are kept too.
		return merge(stored, memory);
	} catch {
		return memory;
	}
}

function merge(first: readonly string[], second: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const key of [...first, ...second]) {
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(key);
		if (out.length >= WORKFLOW_SEEN_LIMIT) break;
	}
	return out;
}

function seenSet(): ReadonlySet<string> {
	if (cache === undefined) cache = new Set(load());
	return cache;
}

export function isWorkflowCompletionSeen(key: string): boolean {
	return seenSet().has(key);
}

export function markWorkflowCompletionSeen(key: string): void {
	if (seenSet().has(key)) return;
	// Re-read before writing, so another window's entries are not dropped.
	const next = merge([key], load());
	memory = next;
	try {
		globalThis.localStorage?.setItem(
			WORKFLOW_SEEN_STORAGE_KEY,
			JSON.stringify(next),
		);
	} catch {
		// Storage may be unavailable; the record still holds in this window.
	}
	cache = undefined;
	for (const listener of [...listeners]) listener();
}

export function subscribeWorkflowSeen(listener: () => void): () => void {
	listeners.add(listener);
	const onStorage = (event: StorageEvent) => {
		if (event.key !== WORKFLOW_SEEN_STORAGE_KEY && event.key !== null) return;
		cache = undefined;
		listener();
	};
	globalThis.addEventListener?.('storage', onStorage);
	return () => {
		listeners.delete(listener);
		globalThis.removeEventListener?.('storage', onStorage);
	};
}

/** Whether this completion has been seen; false for no completion. */
export function useWorkflowCompletionSeen(key: string | undefined): boolean {
	return useSyncExternalStore(
		subscribeWorkflowSeen,
		() => (key === undefined ? false : isWorkflowCompletionSeen(key)),
		() => false,
	);
}

/**
 * Marks a completion seen once its terminal has been active while finished
 * and then stops being active, or goes away. A completion that changes first
 * is not marked.
 */
export function useMarkWorkflowSeen(
	key: string | undefined,
	isActive: boolean,
): void {
	const tracker = useRef<WorkflowSeenTracker | undefined>(undefined);
	if (tracker.current === undefined)
		tracker.current = new WorkflowSeenTracker(markWorkflowCompletionSeen);
	const current = tracker.current;
	useEffect(() => {
		current.update(key, isActive);
	}, [current, key, isActive]);
	useEffect(() => () => current.end(), [current]);
}

/**
 * The pending completion of one terminal: set while it is active and
 * finished, committed when it stops being active or goes away, dropped when
 * the completion changes first.
 */
export class WorkflowSeenTracker {
	private pending: string | undefined;
	private key: string | undefined;

	constructor(private readonly commit: (key: string) => void) {}

	update(key: string | undefined, isActive: boolean): void {
		if (this.pending !== undefined && this.pending !== key)
			this.pending = undefined;
		this.key = key;
		if (isActive) {
			if (key !== undefined) this.pending = key;
			return;
		}
		this.flush();
	}

	/** The terminal went away: what it was showing has been seen. */
	end(): void {
		this.flush();
	}

	private flush(): void {
		const pending = this.pending;
		this.pending = undefined;
		if (pending !== undefined && pending === this.key) this.commit(pending);
	}
}

/** For tests: forget everything this window holds in memory. */
export function resetWorkflowSeenForTests(): void {
	memory = [];
	cache = undefined;
	listeners.clear();
}
