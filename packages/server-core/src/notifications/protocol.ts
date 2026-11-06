import { type JsonValue, protocolError } from '@terminay/protocol';
import type {
	AuthenticatedClient,
	CommandRequest,
	OperationRegistries,
	OrderedEvent,
	OrderedEventJournalLike,
	QueryRequest,
} from '../types.js';
import { canReadBotEvents } from '../botService/authority.js';
import { NotificationManager, visible } from './manager.js';
import type {
	NotificationOwner,
	NotificationRecord,
	NotificationVisibility,
} from './types.js';

/** Stable protocol names for the server's published notifications. */
export const NOTIFICATION_OPERATIONS = Object.freeze({
	snapshot: 'notifications.snapshot',
	delta: 'notifications.delta',
	dismiss: 'notifications.dismiss',
	event: 'notifications',
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
	/**
	 * Acknowledge a bot's posts through the sequence of the record dismissed, so
	 * a post racing the dismissal keeps its notification. Absent on a server
	 * without bots, where no bot record exists to dismiss.
	 */
	readonly acknowledgeBot?: (botId: string, throughSequence: number) => void;
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
	return {
		operations: {
			queries: {
				[NOTIFICATION_OPERATIONS.snapshot]: (request: QueryRequest) => {
					assertReadable(request);
					return manager.snapshot(
						visibilityOf(request.context),
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
			visibilityOf(request.context),
		) as unknown as JsonValue;
	}

	function dismiss(request: CommandRequest): JsonValue {
		const payload = objectPayload(request.envelope.payload);
		const notificationId = id(payload.id, 'id');
		const names = {
			terminal: payload.projectId !== undefined || payload.sessionId !== undefined,
			bot: payload.botId !== undefined,
		};
		if (names.terminal === names.bot)
			throw protocolError(
				'validation',
				'notification dismissal names exactly one terminal or one bot',
			);
		if (names.bot) return dismissBot(request, notificationId, payload);
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

	function dismissBot(
		request: CommandRequest,
		notificationId: string,
		payload: Record<string, JsonValue>,
	): JsonValue {
		const botId = id(payload.botId, 'botId');
		if (!visibilityOf(request.context).bots)
			throw protocolError(
				'forbidden',
				'bot notifications require bot authority on this server',
			);
		// The sequence the client was shown. The record may have been updated in
		// place by a newer post since, which this dismissal must not cover.
		const seen =
			payload.throughSequence === undefined
				? undefined
				: uint(payload.throughSequence, 'throughSequence');
		const record = manager.findBot(notificationId, botId);
		if (record !== undefined) {
			options.acknowledgeBot?.(
				botId,
				seen === undefined
					? record.throughSequence
					: Math.min(seen, record.throughSequence),
			);
			// Acknowledgement normally withdraws the record through the bot feed.
			// A post racing the dismissal is then re-raised by that feed.
			if (options.acknowledgeBot === undefined) manager.removeById(record.id);
		}
		return {
			dismissed: record !== undefined,
			revision: manager.revision,
			cursor: String(manager.revision),
		};
	}

	function remove(record: NotificationRecord): boolean {
		if (record.owner === 'bot') return false;
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
		if (event.event !== NOTIFICATION_OPERATIONS.event) return event;
		const payload = event.payload;
		if (typeof payload !== 'object' || payload === null || Array.isArray(payload))
			return undefined;
		// Owner identity is on every event, removals included. An event that
		// names no owner is a terminal event from before owners were explicit.
		const owner = payload.owner === 'bot' ? 'bot' : 'terminal';
		const item =
			owner === 'bot'
				? { owner, botId: payload.botId }
				: { owner, projectId: payload.projectId };
		return visible(
			item as Parameters<typeof visible>[0],
			visibilityOf(client),
		)
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

/** What a reader may see: its project claim, and whether it holds bot
 * authority, revalidated on every read. */
function visibilityOf(
	context:
		| Pick<AuthenticatedClient, 'clientId' | 'authScope' | 'claims'>
		| undefined,
): NotificationVisibility {
	const projectId = projectClaim(context?.claims);
	const bots =
		context !== undefined &&
		canReadBotEvents({
			clientId: context.clientId,
			authScope: context.authScope,
			claims: context.claims,
		} as AuthenticatedClient);
	return projectId === undefined ? { bots } : { projectId, bots };
}

function projectClaim(claims: unknown): string | undefined {
	const record =
		typeof claims === 'object' && claims !== null && !Array.isArray(claims)
			? (claims as Record<string, unknown>)
			: undefined;
	return typeof record?.projectId === 'string' ? record.projectId : undefined;
}
