import { localTimeZone } from '@terminay/cron';
import { type JsonValue, protocolError } from '@terminay/protocol';
import type {
	CommandRequest,
	OperationRegistries,
	OrderedEventJournalLike,
	QueryRequest,
	RequestContext,
} from '../types.js';
import { AutomationServiceError } from './errors.js';
import { AUTOMATION_ID_PATTERN } from './normalize.js';
import { AutomationRepository } from './repository.js';
import { AutomationRunLog } from './runLog.js';
import type {
	AutomationApplyResult,
	AutomationRunController,
	AutomationRunEntry,
	AutomationState,
	AutomationSubject,
} from './types.js';

export const AUTOMATION_OPERATIONS = Object.freeze({
	get: 'automations.get',
	upsert: 'automations.upsert',
	remove: 'automations.remove',
	// Operation names are lowercase on the wire (protocol operationPattern).
	setEnabled: 'automations.set-enabled',
	run: 'automations.run',
	stop: 'automations.stop',
	runs: 'automations.runs',
	dismissMissed: 'automations.missed.dismiss',
} as const);

export const AUTOMATION_EVENTS = Object.freeze({
	changed: 'automations.changed',
	runChanged: 'automations.run.changed',
	missedChanged: 'automations.missed.changed',
} as const);

export type AutomationAuditRecord =
	| {
			readonly type: 'definition';
			readonly operation: string;
			readonly automationId?: string;
			readonly revision: number;
			readonly actor: { readonly clientId: string; readonly connectionId: string };
	  }
	| {
			readonly type: 'run';
			readonly operation: string;
			readonly automationId: string;
			readonly runId: string;
			readonly actor: { readonly clientId: string; readonly connectionId: string };
	  };

export interface AutomationOperationRegistryOptions {
	readonly serverId: string;
	readonly repository: AutomationRepository;
	readonly runLog: AutomationRunLog;
	readonly eventJournal: OrderedEventJournalLike;
	/** Starts and stops runs. Defaults to one that refuses "run now". */
	readonly controller?: AutomationRunController;
	readonly onAudit?: (record: AutomationAuditRecord) => void;
	/** The IANA zone schedules are evaluated in; the scheduler's zone.
	 * Defaults to the host's zone. Clients preview next runs in it. */
	readonly timeZone?: string;
}

export interface AutomationOperationRegistry {
	readonly operations: OperationRegistries;
	/** Detach the repository and run-log observers. */
	readonly dispose: () => void;
}

/** Until a scheduler/executor is composed, "run now" is refused and "stop"
 * finds nothing to stop. */
export const unavailableAutomationRunController: AutomationRunController =
	Object.freeze({
		start: async () => {
			throw new AutomationServiceError(
				'unavailable',
				'automation execution is unavailable on this server',
			);
		},
		stop: async () => false,
	});

/**
 * The same authority `terminal.create` requires: a write-scoped caller that is
 * not bound to one session. Automations are workspace-wide and run outside any
 * project, so a caller bound to one project is refused too. MCP has no route
 * here at all.
 */
export function assertAutomationAuthority(context: RequestContext): void {
	if (context.authScope !== 'write' && context.authScope !== 'admin')
		throw new AutomationServiceError(
			'forbidden',
			'automations require authority to create terminals on this server',
		);
	const claims = context.claims;
	if (
		typeof claims === 'object' &&
		claims !== null &&
		!Array.isArray(claims) &&
		(typeof claims.sessionId === 'string' || typeof claims.projectId === 'string')
	)
		throw new AutomationServiceError(
			'forbidden',
			'a session- or project-bound authorization cannot manage automations',
		);
}

/** Bind automation definitions, the run log, and run control to the
 * canonical query/command dispatcher. */
export function createAutomationOperationRegistry(
	options: AutomationOperationRegistryOptions,
): AutomationOperationRegistry {
	if (!(options.repository instanceof AutomationRepository))
		throw new TypeError('automation repository is required');
	if (!(options.runLog instanceof AutomationRunLog))
		throw new TypeError('automation run log is required');
	const controller = options.controller ?? unavailableAutomationRunController;
	const { repository, runLog, eventJournal } = options;
	const timeZone = options.timeZone ?? localTimeZone();

	const unsubscribes = [
		repository.subscribe((state) => {
			eventJournal.append(AUTOMATION_EVENTS.changed, asJson(changedEvent(state)));
		}),
		runLog.subscribe((change) => {
			if (change.type === 'run')
				eventJournal.append(
					AUTOMATION_EVENTS.runChanged,
					asJson(eventRun(change.run)),
				);
			else
				eventJournal.append(
					AUTOMATION_EVENTS.missedChanged,
					asJson({ missed: change.missed }),
				);
		}),
	];

	// Every operation — reads included, since definitions and the run log are
	// available only to clients with authority over automations — carries the
	// terminal-create scope policy, then revalidates claims per request.
	const policy = { scope: 'write' } as const;
	const operations: OperationRegistries = {
		queries: {
			[AUTOMATION_OPERATIONS.get]: guardQuery(get),
			[AUTOMATION_OPERATIONS.runs]: guardQuery(listRuns),
		},
		commands: {
			[AUTOMATION_OPERATIONS.upsert]: guardCommand(upsert),
			[AUTOMATION_OPERATIONS.remove]: guardCommand(remove),
			[AUTOMATION_OPERATIONS.setEnabled]: guardCommand(setEnabled),
			[AUTOMATION_OPERATIONS.run]: guardCommand(run),
			[AUTOMATION_OPERATIONS.stop]: guardCommand(stop),
			[AUTOMATION_OPERATIONS.dismissMissed]: guardCommand(dismissMissed),
		},
		policies: Object.fromEntries(
			Object.values(AUTOMATION_OPERATIONS).map((operation) => [
				operation,
				policy,
			]),
		),
	};

	return {
		operations,
		dispose: () => {
			for (const unsubscribe of unsubscribes) unsubscribe();
		},
	};

	function guardQuery(
		handler: (request: QueryRequest) => Promise<JsonValue>,
	): (request: QueryRequest) => Promise<JsonValue> {
		return async (request) => {
			try {
				assertAutomationAuthority(request.context);
				return await handler(request);
			} catch (error) {
				throw toProtocolError(error);
			}
		};
	}

	function guardCommand<T>(
		handler: (request: CommandRequest) => Promise<T>,
	): (request: CommandRequest) => Promise<T> {
		return async (request) => {
			try {
				assertAutomationAuthority(request.context);
				return await handler(request);
			} catch (error) {
				throw toProtocolError(error);
			}
		};
	}

	async function get(_request: QueryRequest): Promise<JsonValue> {
		// Schedules fire in the server's zone, never the client's, so a client
		// previews next runs in the zone named here.
		return asJson({ ...(await repository.load()), timeZone });
	}

	async function listRuns(request: QueryRequest): Promise<JsonValue> {
		const payload = objectPayload(request.envelope.payload);
		const automationId =
			payload.automationId === undefined
				? undefined
				: boundedId(payload.automationId, 'automation id');
		await runLog.load();
		return asJson({
			runs: runLog.list(automationId),
			missed: runLog.listMissed(),
		});
	}

	async function upsert(request: CommandRequest) {
		const payload = objectPayload(request.envelope.payload);
		if (payload.automation === undefined)
			throw new AutomationServiceError(
				'invalid_automation',
				'automation upsert payload is invalid',
			);
		return applied(
			request,
			await repository.upsert(
				payload.automation,
				request.envelope.expectedRevision,
				request.envelope.commandId,
			),
			idOf(payload.automation),
		);
	}

	async function remove(request: CommandRequest) {
		const automationId = boundedId(
			objectPayload(request.envelope.payload).automationId,
			'automation id',
		);
		const result = await repository.remove(
			automationId,
			request.envelope.expectedRevision,
			request.envelope.commandId,
		);
		// Runs in progress are not stopped; only the missed notice goes.
		if (result.ok) await runLog.dismissMissed(automationId);
		return applied(request, result, automationId);
	}

	async function setEnabled(request: CommandRequest) {
		const payload = objectPayload(request.envelope.payload);
		const automationId = boundedId(payload.automationId, 'automation id');
		if (typeof payload.enabled !== 'boolean')
			throw new AutomationServiceError(
				'invalid_automation',
				'automation enabled must be true or false',
			);
		return applied(
			request,
			await repository.setEnabled(
				automationId,
				payload.enabled,
				request.envelope.expectedRevision,
				request.envelope.commandId,
			),
			automationId,
		);
	}

	function applied(
		request: CommandRequest,
		result: AutomationApplyResult,
		automationId: string | undefined,
	): { readonly result: JsonValue; readonly revision: number } {
		if (!result.ok)
			throw protocolError('conflict', result.conflict.message, {
				details: {
					currentRevision: result.conflict.currentRevision,
					currentCursor: result.conflict.currentCursor,
				},
				retryable: true,
			});
		options.onAudit?.({
			type: 'definition',
			operation: request.envelope.operation,
			...(automationId === undefined ? {} : { automationId }),
			revision: result.revision,
			actor: actorOf(request.context),
		});
		return { result: asJson(result.state), revision: result.revision };
	}

	async function run(request: CommandRequest): Promise<JsonValue> {
		const payload = objectPayload(request.envelope.payload);
		const automationId = boundedId(payload.automationId, 'automation id');
		await repository.load();
		const automation = repository.find(automationId);
		if (automation === undefined)
			throw new AutomationServiceError(
				'automation_not_found',
				'automation is unavailable',
			);
		const subject =
			payload.subject === undefined || payload.subject === null
				? undefined
				: parseSubject(payload.subject, options.serverId);
		if (automation.action.kind !== 'runCommand') {
			// A subject action run by hand needs a terminal chosen by the user.
			if (subject?.kind !== 'terminal')
				throw new AutomationServiceError(
					'invalid_combination',
					'running this automation now needs a subject terminal',
					{ reason: 'a subject terminal is required' },
				);
		}
		const entry = await controller.start({
			automation,
			startedBy: 'user',
			firedAt: Date.now(),
			...(automation.trigger.kind === 'event'
				? { event: automation.trigger.event }
				: {}),
			...(subject === undefined ? {} : { subject }),
			actor: actorOf(request.context),
		});
		// Running an automation clears its missed-run notice on every client.
		await runLog.dismissMissed(automationId);
		options.onAudit?.({
			type: 'run',
			operation: request.envelope.operation,
			automationId,
			runId: entry.runId,
			actor: actorOf(request.context),
		});
		return asJson(entry);
	}

	async function stop(request: CommandRequest): Promise<JsonValue> {
		const runId = boundedId(
			objectPayload(request.envelope.payload).runId,
			'run id',
		);
		await runLog.load();
		const entry = runLog.get(runId);
		if (entry === undefined)
			throw new AutomationServiceError(
				'run_not_found',
				'automation run is unavailable',
			);
		const stopped = await controller.stop(runId);
		options.onAudit?.({
			type: 'run',
			operation: request.envelope.operation,
			automationId: entry.automationId,
			runId,
			actor: actorOf(request.context),
		});
		return { runId, stopped };
	}

	async function dismissMissed(request: CommandRequest): Promise<JsonValue> {
		const payload = objectPayload(request.envelope.payload);
		const automationId =
			payload.automationId === undefined
				? undefined
				: boundedId(payload.automationId, 'automation id');
		await runLog.dismissMissed(automationId);
		return asJson({ missed: runLog.listMissed() });
	}
}

/**
 * Journal events reach every subscriber whatever its authority, so they carry
 * only non-sensitive metadata: ids, revision, enums, counts, and timestamps.
 * Never a name, command line, text, cwd, macro field value, subject, reason,
 * or output. Clients with authority refetch through `automations.get` and
 * `automations.runs`.
 */
export interface AutomationsChangedEvent {
	readonly revision: number;
	readonly cursor: string;
	readonly automations: readonly {
		readonly id: string;
		readonly enabled: boolean;
	}[];
}

export type AutomationRunChangedEvent = Pick<
	AutomationRunEntry,
	| 'runId'
	| 'automationId'
	| 'triggerKind'
	| 'event'
	| 'startedBy'
	| 'status'
	| 'outcome'
	| 'skipReason'
	| 'exitCode'
	| 'firedAt'
	| 'startedAt'
	| 'finishedAt'
	| 'durationMs'
	| 'suppressedEvents'
>;

function changedEvent(state: AutomationState): AutomationsChangedEvent {
	return {
		revision: state.revision,
		cursor: state.cursor,
		automations: state.automations.map(({ id, enabled }) => ({ id, enabled })),
	};
}

function eventRun(run: AutomationRunEntry): AutomationRunChangedEvent {
	return {
		runId: run.runId,
		automationId: run.automationId,
		triggerKind: run.triggerKind,
		...(run.event === undefined ? {} : { event: run.event }),
		startedBy: run.startedBy,
		status: run.status,
		...(run.outcome === undefined ? {} : { outcome: run.outcome }),
		...(run.skipReason === undefined ? {} : { skipReason: run.skipReason }),
		...(run.exitCode === undefined ? {} : { exitCode: run.exitCode }),
		firedAt: run.firedAt,
		startedAt: run.startedAt,
		...(run.finishedAt === undefined ? {} : { finishedAt: run.finishedAt }),
		...(run.durationMs === undefined ? {} : { durationMs: run.durationMs }),
		suppressedEvents: run.suppressedEvents,
	};
}

function parseSubject(value: JsonValue, serverId: string): AutomationSubject {
	const record = objectPayload(value);
	if (record.kind !== 'terminal')
		throw new AutomationServiceError(
			'invalid_automation',
			'only a terminal can be chosen as a run subject',
		);
	if (record.serverId !== serverId)
		throw new AutomationServiceError(
			'forbidden',
			'automation subject is outside this server',
		);
	return {
		kind: 'terminal',
		serverId,
		projectId: boundedId(record.projectId, 'project id'),
		sessionId: boundedId(record.sessionId, 'session id'),
	};
}

function actorOf(context: RequestContext) {
	return { clientId: context.clientId, connectionId: context.connectionId };
}

function objectPayload(
	value: JsonValue | undefined,
): Readonly<Record<string, JsonValue>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? value
		: {};
}

function idOf(value: JsonValue): string | undefined {
	const id = objectPayload(value).id;
	return typeof id === 'string' ? id : undefined;
}

function boundedId(value: JsonValue | undefined, name: string): string {
	if (typeof value !== 'string' || !AUTOMATION_ID_PATTERN.test(value))
		throw new AutomationServiceError('invalid_automation', `${name} is invalid`);
	return value;
}

function asJson(value: unknown): JsonValue {
	return value as JsonValue;
}

function toProtocolError(error: unknown): unknown {
	if (!(error instanceof AutomationServiceError)) return error;
	const code = (
		{
			invalid_automation: 'validation',
			invalid_combination: 'validation',
			automation_not_found: 'not_found',
			run_not_found: 'not_found',
			conflict: 'conflict',
			limit: 'resource',
			forbidden: 'forbidden',
			unavailable: 'unavailable',
		} as const
	)[error.code];
	return protocolError(
		code,
		error.message,
		error.details === undefined ? {} : { details: error.details },
	);
}
