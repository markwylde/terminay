/**
 * Client-side view of one server's upgrade status (ADR-0062).
 *
 * A client shows what the server it is attached to has published and decides
 * nothing about releases itself. It may ask for the upgrade to begin, naming
 * a mode the status offers and nothing else. Each connection has its own
 * client and store, so one server's status never describes another.
 */

import {
	FEATURE_CAPABILITIES,
	parseServerUpgradeStatus,
	SERVER_UPGRADE_OPERATIONS,
	type ServerUpgradeMode,
	type ServerUpgradeStatus,
} from '@terminay/protocol';
import type { QueryCommandTransport } from './queryCommand.js';
import type { ClientEvent } from './types.js';

export type { ServerUpgradeMode, ServerUpgradeStatus };
export { SERVER_UPGRADE_OPERATIONS };

export type ServerUpgradeStatusListener = (
	status: ServerUpgradeStatus | undefined,
) => void;

export interface ServerUpgradeClientTransport extends QueryCommandTransport {
	/** The status is a live server-owned projection, as notifications are. */
	subscribe: (
		event: string,
		listener: (event: ClientEvent<unknown>) => void,
		onResync?: () => void,
	) => (() => void) | Promise<() => void>;
}

/** Whether a server's hello says it publishes an upgrade status. A server
 * that does not is shown with no upgrade indication and is sent nothing. */
export function serverPublishesUpgradeStatus(
	capabilities: readonly string[],
): boolean {
	return capabilities.includes(FEATURE_CAPABILITIES.serverUpgrade);
}

/** Whether a status has an upgrade for a person to be told about. */
export function serverUpgradeAvailable(
	status: ServerUpgradeStatus | undefined,
): status is ServerUpgradeStatus & {
	readonly available: { readonly version: string };
} {
	return status?.available !== undefined;
}

/** The latest status one server published, or `undefined` before any. */
export class ServerUpgradeStatusStore {
	private readonly listeners = new Set<ServerUpgradeStatusListener>();
	private current: ServerUpgradeStatus | undefined;

	get status(): ServerUpgradeStatus | undefined {
		return this.current;
	}

	subscribe(listener: ServerUpgradeStatusListener): () => void {
		if (typeof listener !== 'function')
			throw new TypeError('server upgrade listener must be a function');
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Replace the status with what the server published. Every publication is
	 * the whole status, so there is nothing to merge. */
	apply(status: unknown): boolean {
		const next = parseServerUpgradeStatus(status);
		if (
			this.current !== undefined &&
			JSON.stringify(next) === JSON.stringify(this.current)
		)
			return false;
		this.current = next;
		this.publish();
		return true;
	}

	/** Forget the status, as when the connection it came over is gone for good. */
	clear(): void {
		if (this.current === undefined) return;
		this.current = undefined;
		this.publish();
	}

	private publish(): void {
		for (const listener of this.listeners) {
			try {
				listener(this.current);
			} catch {
				/* observer failures cannot roll back state */
			}
		}
	}
}

/** A thin client boundary around one server's upgrade status and request. */
export class ServerUpgradeClient {
	private unsubscribe: (() => void) | undefined;

	constructor(
		private readonly transport: ServerUpgradeClientTransport,
		readonly store = new ServerUpgradeStatusStore(),
	) {
		if (typeof transport.subscribe !== 'function') {
			throw new Error(
				'server upgrade subscriptions are required on this transport',
			);
		}
	}

	get status(): ServerUpgradeStatus | undefined {
		return this.store.status;
	}

	async refresh(): Promise<ServerUpgradeStatus> {
		this.store.apply(
			await this.transport.query(SERVER_UPGRADE_OPERATIONS.status),
		);
		return this.store.status as ServerUpgradeStatus;
	}

	/**
	 * Ask the server to upgrade itself. The mode is one its status offers; the
	 * server chooses the release. A refusal rejects with the server's
	 * structured error, whose `details.reason` says why.
	 */
	async startServerUpgrade(
		mode: ServerUpgradeMode,
	): Promise<ServerUpgradeStatus> {
		const status = await this.transport.command(
			SERVER_UPGRADE_OPERATIONS.start,
			{ mode },
		);
		this.store.apply(status);
		return this.store.status as ServerUpgradeStatus;
	}

	async subscribe(): Promise<() => void> {
		if (this.unsubscribe !== undefined) return this.unsubscribe;
		const refresh = () => void this.refresh().catch(() => undefined);
		const unsubscribe = await this.transport.subscribe(
			SERVER_UPGRADE_OPERATIONS.event,
			(event) => {
				// A publication this client cannot read is dropped; the status it
				// already holds stands until the next one.
				try {
					this.store.apply(event.payload);
				} catch {
					/* an unreadable status changes nothing */
				}
			},
			refresh,
		);
		this.unsubscribe = () => {
			try {
				unsubscribe();
			} catch {
				/* expected disconnect cleanup is local */
			}
			this.unsubscribe = undefined;
		};
		// Subscribe before the snapshot so no publication falls between them.
		try {
			await this.refresh();
		} catch (error) {
			this.unsubscribe?.();
			throw error;
		}
		return this.unsubscribe;
	}

	close(): void {
		this.unsubscribe?.();
	}
}
