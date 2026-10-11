import { type JsonValue, protocolError } from '@terminay/protocol';
import type {
	AuthenticatedClient,
	CommandRequest,
	OperationRegistries,
	OrderedEvent,
	OrderedEventJournalLike,
	QueryRequest,
} from '../types.js';
import { NotificationManager } from './manager.js';
import type { NotificationOwner, NotificationRecord } from './types.js';

/** Stable protocol names for the server's published notifications. */
export const NOTIFICATION_OPERATIONS = Object.freeze({
	snapshot: 'notifications.snapshot',
	delta: 'notifications.delta',
	dismiss: 'notifications.dismiss',
	event: 'notifications',
	/**
	 * Asks clients whether their user is interacting with a terminal a process
	 * has just sent a notification to. It names the terminal and nothing else;
	 * a client that is answers with the ordinary activity acknowledgement.
	 */
	probe: 'notifications.probe',
} as const);

export interface NotificationOperationRegistryOptions {
	readonly manager: NotificationManager;
	/** The same journal installed in ServerCore, so notification subscriptions
	 * have normal replay and ordering semantics alongside other server events. */
	readonly eventJournal: OrderedEventJournalLike;
	/**
	 * Acknowledge the terminal a dismissed activity notification belongs to, as
	 * selecting its tab does. The record then leaves through the activity feed.
	 */
	readonly acknowledgeTerminal: (owner: NotificationOwner) => void;
}

export interface NotificationOperationRegistry {
	readonly operations: OperationRegistries;
	readonly close: () => void;
}

/**
 * Expose the published notifications and their dismissal through the
 * authenticated application protocol. The manager remains the sole authority:
 * this layer validates immutable identities and publishes what it committed.
 */
export function createNotificationOperationRegistry(
	options: NotificationOperationRegistryOptions,
): NotificationOperationRegistry {
	if (!(options.manager instanceof NotificationManager))
		throw new TypeError('notification manager is required');
	const { manager } = options;
	const unsubscribe = manager.subscribe((event) => {
		options.eventJournal.append(
			NOTIFICATION_OPERATIONS.event,
			event as unknown as JsonValue,
		);
	});
	const unsubscribeSent = manager.onSent((owner) => {
		options.eventJournal.append(NOTIFICATION_OPERATIONS.probe, {
			projectId: owner.projectId,
			sessionId: owner.sessionId,
		});
	});
	return {
		operations: {
			queries: {
				[NOTIFICATION_OPERATIONS.snapshot]: (request: QueryRequest) => {
					assertReadable(request);
					return manager.snapshot(
						projectClaim(request.context.claims),
					) as unknown as JsonValue;
				},
				[NOTIFICATION_OPERATIONS.delta]: (request: QueryRequest) =>
					delta(request),
			},
			commands: {
				[NOTIFICATION_OPERATIONS.dismiss]: (request: CommandRequest) =>
					dismiss(request),
			},
			policies: {
				[NOTIFICATION_OPERATIONS.snapshot]: { scope: 'read' },
				[NOTIFICATION_OPERATIONS.delta]: { scope: 'read' },
				[NOTIFICATION_OPERATIONS.dismiss]: { scope: 'read' },
			},
		},
		close: () => {
			unsubscribe();
			unsubscribeSent();
		},
	};

	function delta(request: QueryRequest): JsonValue {
		assertReadable(request);
		const payload = objectPayload(request.envelope.payload);
		const revision = uint(payload.revision, 'revision');
		if (stringField(payload.cursor, 'cursor') !== String(revision))
			throw protocolError(
				'validation',
				'notification cursor does not match revision',
			);
		return manager.replay(
			revision,
			projectClaim(request.context.claims),
		) as unknown as JsonValue;
	}

	function dismiss(request: CommandRequest): JsonValue {
		const payload = objectPayload(request.envelope.payload);
		const notificationId = id(payload.id, 'id');
		const owner = {
			projectId: id(payload.projectId, 'projectId'),
			sessionId: id(payload.sessionId, 'sessionId'),
		};
		const claimedProjectId = projectClaim(request.context.claims);
		if (claimedProjectId !== undefined && claimedProjectId !== owner.projectId)
			throw protocolError(
				'forbidden',
				'notification dismissal is outside the authenticated project scope',
			);
		const record = manager.find(notificationId, owner);
		const dismissed = record !== undefined && remove(record);
		return {
			dismissed,
			revision: manager.revision,
			cursor: String(manager.revision),
		};
	}

	function remove(record: NotificationRecord): boolean {
		if (record.source === 'message') return manager.removeById(record.id);
		options.acknowledgeTerminal({
			projectId: record.projectId,
			sessionId: record.sessionId,
		});
		// Acknowledgement normally clears the record through the activity feed.
		// Where it had nothing to clear, the user's dismissal still stands.
		manager.removeById(record.id);
		return true;
	}
}

/** Project notification journal events immediately before transport delivery. */
export function createNotificationEventProjector(): (
	event: OrderedEvent,
	client: AuthenticatedClient | undefined,
) => OrderedEvent | undefined {
	return (event, client) => {
		if (
			event.event !== NOTIFICATION_OPERATIONS.event &&
			event.event !== NOTIFICATION_OPERATIONS.probe
		)
			return event;
		const projectId = projectClaim(client?.claims);
		if (projectId === undefined) return event;
		const payload = event.payload;
		return typeof payload === 'object' &&
			payload !== null &&
			!Array.isArray(payload) &&
			payload.projectId === projectId
			? event
			: undefined;
	};
}

function assertReadable(request: QueryRequest): void {
	if (request.context.authScope === 'none')
		throw protocolError('forbidden', 'notifications require read access');
}

function objectPayload(value: JsonValue): Record<string, JsonValue> {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw protocolError('validation', 'notification payload must be an object');
	return value as Record<string, JsonValue>;
}

function uint(value: JsonValue | undefined, name: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0)
		throw protocolError('validation', `${name} is invalid`);
	return value as number;
}

function stringField(value: JsonValue | undefined, name: string): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > 128)
		throw protocolError('validation', `${name} is invalid`);
	return value;
}

function id(value: JsonValue | undefined, name: string): string {
	const result = stringField(value, name);
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(result))
		throw protocolError('validation', `${name} is invalid`);
	return result;
}

function projectClaim(claims: unknown): string | undefined {
	const record =
		typeof claims === 'object' && claims !== null && !Array.isArray(claims)
			? (claims as Record<string, unknown>)
			: undefined;
	return typeof record?.projectId === 'string' ? record.projectId : undefined;
}
