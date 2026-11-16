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
	parseServerUpgradeAttemptState,
	parseServerUpgradeStatus,
	SERVER_UPGRADE_OPERATIONS,
	type ServerUpgradeAttempt,
	type ServerUpgradeMode,
	type ServerUpgradeStatus,
} from '@terminay/protocol';
import type { QueryCommandTransport } from './queryCommand.js';
import type { ClientEvent } from './types.js';

export type { ServerUpgradeAttempt, ServerUpgradeMode, ServerUpgradeStatus };
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

/** Whether a server's hello says it publishes its upgrade attempts
 * (ADR-0125). A server that does not is followed by its status alone. */
export function serverPublishesUpgradeAttempts(
	capabilities: readonly string[],
): boolean {
	return capabilities.includes(FEATURE_CAPABILITIES.serverUpgradeAttempts);
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

export type ServerUpgradeAttemptListener = (
	attempt: ServerUpgradeAttempt | null | undefined,
) => void;

/**
 * The last upgrade attempt one server published: `undefined` before it has
 * said, `null` when it has never had one.
 */
export class ServerUpgradeAttemptStore {
	private readonly listeners = new Set<ServerUpgradeAttemptListener>();
	private current: ServerUpgradeAttempt | null | undefined;

	get attempt(): ServerUpgradeAttempt | null | undefined {
		return this.current;
	}

	subscribe(listener: ServerUpgradeAttemptListener): () => void {
		if (typeof listener !== 'function')
			throw new TypeError('server upgrade listener must be a function');
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Replace the attempt with what the server published. */
	apply(state: unknown): boolean {
		const next = parseServerUpgradeAttemptState(state).attempt;
		if (
			this.current !== undefined &&
			JSON.stringify(next) === JSON.stringify(this.current)
		)
			return false;
		this.current = next;
		for (const listener of this.listeners) {
			try {
				listener(this.current);
			} catch {
				/* observer failures cannot roll back state */
			}
		}
		return true;
	}
}

/** A thin client boundary around one server's upgrade status and request. */
export class ServerUpgradeClient {
	private unsubscribe: (() => void) | undefined;
	/** Present when the server publishes its attempts (ADR-0125). */
	readonly attempts: ServerUpgradeAttemptStore | undefined;

	constructor(
		private readonly transport: ServerUpgradeClientTransport,
		readonly store = new ServerUpgradeStatusStore(),
		options: { readonly attempts?: boolean } = {},
	) {
		this.attempts =
			options.attempts === true ? new ServerUpgradeAttemptStore() : undefined;
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

	/** Read the server's last attempt again. Nothing without attempts. */
	async refreshAttempt(): Promise<ServerUpgradeAttempt | null | undefined> {
		const attempts = this.attempts;
		if (attempts === undefined) return undefined;
		attempts.apply(
			await this.transport.query(SERVER_UPGRADE_OPERATIONS.attempt),
		);
		return attempts.attempt;
	}

	/**
	 * Ask the server to upgrade itself. The mode is one its status offers; the
	 * server chooses the release. `allowOlder` asks for the channel's latest
	 * release even when it is older than the running one (ADR-0117); it is sent
	 * only when set. A refusal rejects with the server's structured error,
	 * whose `details.reason` says why.
	 */
	async startServerUpgrade(
		mode: ServerUpgradeMode,
		options: { readonly allowOlder?: boolean; readonly requestId?: string } = {},
	): Promise<ServerUpgradeStatus> {
		// A server that predates attempts refuses a field it does not know, so
		// the request id goes only to one that publishes them.
		const requestId =
			this.attempts === undefined ? undefined : options.requestId;
		const status = await this.transport.command(
			SERVER_UPGRADE_OPERATIONS.start,
			{
				mode,
				...(options.allowOlder === true ? { allowOlder: true } : {}),
				...(requestId === undefined ? {} : { requestId }),
			},
		);
		this.store.apply(status);
		return this.store.status as ServerUpgradeStatus;
	}

	/**
	 * Ask the server to read its release channel now. Resolves with the status
	 * that check produced; a server that could not read it rejects with a
	 * `check-failed` refusal, and one that predates the request with the
	 * protocol's unknown-operation error.
	 */
	async checkForServerUpgrade(): Promise<ServerUpgradeStatus> {
		const status = await this.transport.command(
			SERVER_UPGRADE_OPERATIONS.check,
			{},
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
		let unsubscribeAttempt: (() => void) | undefined;
		const attempts = this.attempts;
		if (attempts !== undefined) {
			const refreshAttempt = () =>
				void this.refreshAttempt().catch(() => undefined);
			try {
				unsubscribeAttempt = await this.transport.subscribe(
					SERVER_UPGRADE_OPERATIONS.attemptEvent,
					(event) => {
						try {
							attempts.apply(event.payload);
						} catch {
							/* an unreadable attempt changes nothing */
						}
					},
					refreshAttempt,
				);
			} catch (error) {
				try {
					unsubscribe();
				} catch {
					/* expected disconnect cleanup is local */
				}
				throw error;
			}
		}
		this.unsubscribe = () => {
			for (const stop of [unsubscribe, unsubscribeAttempt]) {
				try {
					stop?.();
				} catch {
					/* expected disconnect cleanup is local */
				}
			}
			this.unsubscribe = undefined;
		};
		// Subscribe before the snapshot so no publication falls between them.
		try {
			await this.refresh();
			await this.refreshAttempt();
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
