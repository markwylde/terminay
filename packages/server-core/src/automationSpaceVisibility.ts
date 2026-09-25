import { type JsonValue, protocolError } from '@terminay/protocol';
import type {
	AuthenticatedClient,
	CommandHandler,
	CommandRequest,
	OrderedEvent,
	QueryHandler,
	QueryRequest,
} from './types.js';
import {
	canSeeAutomationSpace,
	isAutomationSpace,
	type WorkspaceStore,
} from './workspace.js';

/**
 * Withhold the automation terminal space (ADR-0029) from every terminal and
 * session listing and event a connection without `automations.v1` receives.
 * The workspace projection itself is withheld in `workspaceProtocol.ts`; this
 * covers the terminal, activity, and agent surfaces that name sessions and
 * projects independently of it.
 */
export interface AutomationSpaceHiddenIds {
	readonly projectIds: ReadonlySet<string>;
	readonly sessionIds: ReadonlySet<string>;
}

export interface AutomationSpaceVisibility {
	/** Ids withheld from a connection with these capabilities, or undefined
	 * when nothing is withheld from it. */
	readonly hiddenFor: (
		capabilities: readonly string[] | undefined,
	) => AutomationSpaceHiddenIds | undefined;
	readonly isProjectHidden: (
		request: QueryRequest | CommandRequest,
		projectId: string,
	) => boolean;
}

export function createAutomationSpaceVisibility(
	workspace: WorkspaceStore,
	listSessions?: () => readonly {
		readonly projectId: string;
		readonly sessionId: string;
	}[],
): AutomationSpaceVisibility {
	const spaceIds = (): ReadonlySet<string> => {
		const ids = new Set<string>();
		for (const project of Object.values(workspace.state.projects))
			if (isAutomationSpace(project)) ids.add(project.id);
		return ids;
	};
	return {
		hiddenFor(capabilities) {
			if (canSeeAutomationSpace(capabilities)) return undefined;
			const state = workspace.state;
			const projectIds = spaceIds();
			if (projectIds.size === 0) return undefined;
			const sessionIds = new Set<string>();
			for (const session of Object.values(state.terminalSessions))
				if (projectIds.has(session.projectId)) sessionIds.add(session.id);
			for (const session of listSessions?.() ?? [])
				if (projectIds.has(session.projectId))
					sessionIds.add(session.sessionId);
			return { projectIds, sessionIds };
		},
		isProjectHidden(request, projectId) {
			return (
				!canSeeAutomationSpace(request.context.clientCapabilities) &&
				spaceIds().has(projectId)
			);
		},
	};
}

type JsonRecord = Record<string, JsonValue>;
function isRecord(value: unknown): value is JsonRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hiddenSession(
	hidden: AutomationSpaceHiddenIds,
	value: JsonValue | undefined,
): boolean {
	return typeof value === 'string' && hidden.sessionIds.has(value);
}
function hiddenProject(
	hidden: AutomationSpaceHiddenIds,
	value: JsonValue | undefined,
): boolean {
	return typeof value === 'string' && hidden.projectIds.has(value);
}

/** Activity sessions keyed by session id. */
function withholdActivitySessions(
	sessions: JsonValue | undefined,
	hidden: AutomationSpaceHiddenIds,
): JsonValue | undefined {
	if (!isRecord(sessions)) return sessions;
	return Object.fromEntries(
		Object.entries(sessions).filter(
			([id, session]) =>
				!hidden.sessionIds.has(id) &&
				!(isRecord(session) && hiddenProject(hidden, session.projectId)),
		),
	);
}

function hiddenActivityEvent(
	event: JsonValue,
	hidden: AutomationSpaceHiddenIds,
): boolean {
	if (!isRecord(event)) return false;
	return (
		hiddenSession(hidden, event.sessionId) ||
		(isRecord(event.snapshot) &&
			hiddenProject(hidden, event.snapshot.projectId))
	);
}

function withholdActivitySnapshot(
	snapshot: JsonValue,
	hidden: AutomationSpaceHiddenIds,
): JsonValue {
	if (!isRecord(snapshot) || !isRecord(snapshot.sessions)) return snapshot;
	return {
		...snapshot,
		sessions: withholdActivitySessions(snapshot.sessions, hidden) ?? {},
	};
}

/** An agent running in an automation terminal is withheld; a session that
 * also belongs to a user project by directory keeps only that project. */
function withholdAgentEntries(
	entries: JsonValue | undefined,
	hidden: AutomationSpaceHiddenIds,
): JsonValue | undefined {
	if (!isRecord(entries)) return entries;
	const kept: JsonRecord = {};
	for (const [id, entry] of Object.entries(entries)) {
		if (!isRecord(entry)) continue;
		if (
			hiddenSession(hidden, entry.activationTerminalSessionId) ||
			hiddenSession(hidden, entry.terminalSessionId)
		)
			continue;
		const projectIds = Array.isArray(entry.projectIds) ? entry.projectIds : [];
		const visible = projectIds.filter(
			(projectId) => !hiddenProject(hidden, projectId),
		);
		if (projectIds.length > 0 && visible.length === 0) continue;
		kept[id] =
			visible.length === projectIds.length
				? entry
				: { ...entry, projectIds: visible };
	}
	return kept;
}

function withholdAgentSnapshot(
	snapshot: JsonValue,
	hidden: AutomationSpaceHiddenIds,
): JsonValue {
	if (!isRecord(snapshot) || !isRecord(snapshot.entries)) return snapshot;
	return {
		...snapshot,
		entries: withholdAgentEntries(snapshot.entries, hidden) ?? {},
	};
}

/** Project journal events for a connection immediately before delivery. */
export function createAutomationSpaceEventProjector(
	visibility: AutomationSpaceVisibility,
): (
	event: OrderedEvent,
	client: AuthenticatedClient | undefined,
	connection?: { readonly clientCapabilities?: readonly string[] },
) => OrderedEvent | undefined {
	return (event, _client, connection) => {
		const hidden = visibility.hiddenFor(connection?.clientCapabilities);
		if (hidden === undefined) return event;
		const payload = event.payload;
		if (!isRecord(payload)) return event;
		switch (event.event) {
			case 'workspace.changed':
				return hiddenProject(hidden, payload.projectId)
					? { ...event, payload: { ...payload, projectId: null } }
					: event;
			case 'activity':
				return hiddenActivityEvent(payload, hidden) ? undefined : event;
			case 'agent':
				return isRecord(payload.entries)
					? { ...event, payload: withholdAgentSnapshot(payload, hidden) }
					: event;
			default:
				return hiddenProject(hidden, payload.projectId) ||
					hiddenSession(hidden, payload.sessionId)
					? undefined
					: event;
		}
	};
}

const RESULT_FILTERS: Readonly<
	Record<
		string,
		(result: JsonValue, hidden: AutomationSpaceHiddenIds) => JsonValue
	>
> = {
	'activity.snapshot': withholdActivitySnapshot,
	'activity.delta': (result, hidden) => {
		if (!isRecord(result)) return result;
		return {
			...result,
			...(Array.isArray(result.events)
				? {
						events: result.events.filter(
							(event) => !hiddenActivityEvent(event, hidden),
						),
					}
				: {}),
			...(result.snapshot === undefined
				? {}
				: { snapshot: withholdActivitySnapshot(result.snapshot, hidden) }),
		};
	},
	'agent.snapshot': withholdAgentSnapshot,
};

/** Requests naming a hidden project or session are refused as not found. */
const TARGETED_OPERATIONS = new Set([
	'activity.closePreflight',
	'activity.acknowledge',
	'agent.acknowledge',
]);

function assertTargetVisible(
	operation: string,
	payload: JsonValue,
	hidden: AutomationSpaceHiddenIds | undefined,
): void {
	if (hidden === undefined || !TARGETED_OPERATIONS.has(operation)) return;
	if (
		isRecord(payload) &&
		(hiddenProject(hidden, payload.projectId) ||
			hiddenSession(hidden, payload.sessionId))
	)
		throw protocolError('conflict', 'terminal session was not found');
}

function entries<T>(
	value: ReadonlyMap<string, T> | Record<string, T> | undefined,
): [string, T][] {
	if (value === undefined) return [];
	return value instanceof Map
		? [...value.entries()]
		: Object.entries(value as Record<string, T>);
}

/** Wrap the session-listing operations so their results never name the
 * automation space for a connection without `automations.v1`. */
export function withholdAutomationSpaceOperations<
	T extends {
		readonly queries: ReadonlyMap<string, QueryHandler>;
		readonly commands: ReadonlyMap<string, CommandHandler>;
	},
>(registries: T, visibility: AutomationSpaceVisibility): T {
	const queries = new Map(
		entries(registries.queries).map(
			([operation, handler]): [string, QueryHandler] => {
				const filter = RESULT_FILTERS[operation];
				if (filter === undefined && !TARGETED_OPERATIONS.has(operation))
					return [operation, handler];
				return [
					operation,
					async (request) => {
						const hidden = visibility.hiddenFor(
							request.context.clientCapabilities,
						);
						assertTargetVisible(operation, request.envelope.payload, hidden);
						const result = await handler(request);
						if (hidden === undefined || filter === undefined) return result;
						if (isRecord(result) && result.body instanceof Uint8Array)
							return result;
						return filter(result as JsonValue, hidden);
					},
				];
			},
		),
	);
	const commands = new Map(
		entries(registries.commands).map(
			([operation, handler]): [string, CommandHandler] => {
				if (!TARGETED_OPERATIONS.has(operation)) return [operation, handler];
				return [
					operation,
					(request) => {
						assertTargetVisible(
							operation,
							request.envelope.payload,
							visibility.hiddenFor(request.context.clientCapabilities),
						);
						return handler(request);
					},
				];
			},
		),
	);
	return { ...registries, queries, commands };
}
