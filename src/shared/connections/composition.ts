/**
 * The window's composition: which servers are attached, and the one order the
 * tab strip interleaves their projects in.
 *
 * This is client-owned presentation state, in the same class as window
 * geometry. It is never sent to a server, and no server can see another
 * server's tabs in it. A tab handle is `(serverId, projectId)` because project
 * ids are per-server namespaces and two servers restored from one data root
 * will collide.
 */

import type { TerminayWorkspaceComposition } from '@terminay/protocol';

export type CompositionTabHandle = Readonly<{
	serverId: string;
	projectId: string;
}>;

/** A composition handle rendered as one string, for React keys, drag ids, and
 * route segments. Both halves are escaped so no server id containing the
 * separator can forge a handle for another server. */
export function compositionTabKey(
	serverId: string,
	projectId: string,
): string {
	return `${encodeURIComponent(serverId)}:${encodeURIComponent(projectId)}`;
}

export function parseCompositionTabKey(
	key: string,
): CompositionTabHandle | undefined {
	const separator = key.indexOf(':');
	if (separator <= 0 || separator === key.length - 1) return undefined;
	try {
		return Object.freeze({
			serverId: decodeURIComponent(key.slice(0, separator)),
			projectId: decodeURIComponent(key.slice(separator + 1)),
		});
	} catch {
		return undefined;
	}
}

export function sameCompositionTab(
	left: CompositionTabHandle,
	right: CompositionTabHandle,
): boolean {
	return (
		left.serverId === right.serverId && left.projectId === right.projectId
	);
}

/**
 * Order the tabs that exist by the order the window remembers.
 *
 * A remembered order is a hint, never an instruction: projects appear and
 * disappear on their own server while this window is closed. Handles the
 * order does not mention keep their own relative order and land at the end,
 * grouped after everything remembered, so attaching a new server appends its
 * projects rather than interleaving them by accident.
 */
export function orderCompositionTabs(
	live: readonly CompositionTabHandle[],
	remembered: readonly CompositionTabHandle[],
): readonly CompositionTabHandle[] {
	const pending = new Map(
		live.map((handle) => [
			compositionTabKey(handle.serverId, handle.projectId),
			handle,
		]),
	);
	const ordered: CompositionTabHandle[] = [];
	for (const handle of remembered) {
		const key = compositionTabKey(handle.serverId, handle.projectId);
		const match = pending.get(key);
		if (match === undefined) continue;
		pending.delete(key);
		ordered.push(match);
	}
	return Object.freeze([...ordered, ...pending.values()]);
}

/** Move one tab to a position in the strip, keeping every other tab's
 * relative order. Cross-server moves are ordinary here: the strip interleaves
 * servers. Moving a *panel* across servers is a different thing, and is not
 * offered at all. */
export function moveCompositionTab(
	order: readonly CompositionTabHandle[],
	moved: CompositionTabHandle,
	toIndex: number,
): readonly CompositionTabHandle[] {
	const without = order.filter((handle) => !sameCompositionTab(handle, moved));
	if (without.length === order.length) return order;
	const index = Math.max(0, Math.min(toIndex, without.length));
	return Object.freeze([
		...without.slice(0, index),
		moved,
		...without.slice(index),
	]);
}

export function buildComposition(
	primaryProfileId: string,
	attached: readonly Readonly<{ profileId: string; viewId?: string }>[],
	tabOrder: readonly CompositionTabHandle[],
): TerminayWorkspaceComposition {
	return Object.freeze({
		version: 1,
		primaryProfileId,
		attached: Object.freeze(
			attached.map((entry) =>
				Object.freeze({
					profileId: entry.profileId,
					...(entry.viewId === undefined ? {} : { viewId: entry.viewId }),
				}),
			),
		),
		tabOrder: Object.freeze(
			tabOrder.map((handle) =>
				Object.freeze({
					serverId: handle.serverId,
					projectId: handle.projectId,
				}),
			),
		),
	});
}

/**
 * Where a composition is kept between runs.
 *
 * Desktop persists it through the host, beside window geometry. A browser
 * session persists it through the manager when the session host offers that,
 * and otherwise in this origin's `localStorage` keyed by the primary server,
 * so two servers opened in one browser do not overwrite each other.
 */
export interface CompositionPersistence {
	read(): Promise<TerminayWorkspaceComposition | undefined>;
	write(composition: TerminayWorkspaceComposition): Promise<void>;
}

export type HostCompositionWriter = (
	composition: TerminayWorkspaceComposition,
) => Promise<void>;

/** Desktop: `connections.composition.write` through the existing host action
 * path, with the composition the host handed back in the bootstrap context as
 * the restore value. */
export function createHostCompositionPersistence(
	read: () => Promise<TerminayWorkspaceComposition | undefined>,
	write: HostCompositionWriter,
): CompositionPersistence {
	const persistence: CompositionPersistence = {
		read: async () => await read().catch(() => undefined),
		write: async (composition) => {
			// A window that cannot persist its composition still works; it just
			// starts in default order next time.
			await write(composition).catch(() => undefined);
		},
	};
	return Object.freeze(persistence);
}

const STORAGE_PREFIX = 'terminay.workspace.composition.v1';

/** Browser fallback. Keyed by the primary server so one browser profile can
 * hold a composition per server it has opened. */
export function createLocalCompositionPersistence(
	primaryServerId: string,
	storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis
		.localStorage,
): CompositionPersistence {
	const key = `${STORAGE_PREFIX}:${primaryServerId}`;
	const persistence: CompositionPersistence = {
		read: async () => {
			try {
				const raw = storage?.getItem(key);
				if (raw === null || raw === undefined) return undefined;
				return normalizeComposition(JSON.parse(raw));
			} catch {
				return undefined;
			}
		},
		write: async (composition) => {
			try {
				storage?.setItem(key, JSON.stringify(composition));
			} catch {
				/* Storage that is full or disabled is a normal condition. */
			}
		},
	};
	return Object.freeze(persistence);
}

/**
 * One window's use of one composition record, in the order the two halves have
 * to happen in: restore, then persist.
 *
 * Restoring and persisting are the same record read and written by the same
 * owner, so the gate lives here rather than in a flag some other component
 * sets. Until `restore` has finished, `persist` refuses — a window that
 * persisted its default (nothing attached, no order) before reading would
 * overwrite the real record with an empty one, and every attached server would
 * be lost on reload.
 *
 * A window that changes where its composition lives — the primary decides once
 * it knows its server — takes a new session, which closes the gate again.
 */
export interface CompositionSession {
	restore(
		apply: (composition: TerminayWorkspaceComposition) => void,
	): Promise<void>;
	/** True when the composition was written; false while still ungated. */
	persist(composition: TerminayWorkspaceComposition): boolean;
	readonly restored: boolean;
}

export function createCompositionSession(
	persistence: CompositionPersistence,
): CompositionSession {
	let restored = false;
	const session: CompositionSession = {
		restore: async (apply) => {
			try {
				const stored = await persistence.read();
				if (stored !== undefined) apply(stored);
			} catch {
				// A record that cannot be read is a window with no remembered
				// composition, not a window that may never persist one.
			} finally {
				restored = true;
			}
		},
		persist: (composition) => {
			if (!restored) return false;
			void persistence.write(composition);
			return true;
		},
		get restored() {
			return restored;
		},
	};
	return session;
}

export const NO_COMPOSITION_PERSISTENCE: CompositionPersistence = Object.freeze(
	{
		read: async () => undefined,
		write: async () => undefined,
	},
);

/** Validate a composition read back from storage. Anything malformed is
 * discarded whole rather than partially trusted. */
export function normalizeComposition(
	value: unknown,
): TerminayWorkspaceComposition | undefined {
	if (typeof value !== 'object' || value === null) return undefined;
	const record = value as Record<string, unknown>;
	if (record.version !== 1) return undefined;
	if (typeof record.primaryProfileId !== 'string') return undefined;
	if (!Array.isArray(record.attached) || !Array.isArray(record.tabOrder))
		return undefined;
	const attached: Array<Readonly<{ profileId: string; viewId?: string }>> = [];
	for (const entry of record.attached) {
		if (typeof entry !== 'object' || entry === null) return undefined;
		const item = entry as Record<string, unknown>;
		if (typeof item.profileId !== 'string') return undefined;
		attached.push(
			Object.freeze({
				profileId: item.profileId,
				...(typeof item.viewId === 'string' ? { viewId: item.viewId } : {}),
			}),
		);
	}
	const tabOrder: CompositionTabHandle[] = [];
	for (const entry of record.tabOrder) {
		if (typeof entry !== 'object' || entry === null) return undefined;
		const item = entry as Record<string, unknown>;
		if (typeof item.serverId !== 'string' || typeof item.projectId !== 'string')
			return undefined;
		tabOrder.push(
			Object.freeze({ serverId: item.serverId, projectId: item.projectId }),
		);
	}
	return buildComposition(record.primaryProfileId, attached, tabOrder);
}
