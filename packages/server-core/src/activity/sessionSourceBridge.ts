import {
	type AgentSessionSnapshot,
	type AgentSessionSourceDiagnostic,
	EXTENSION_LIMITS,
	isNamespacedId,
	validateAgentSessionReset,
	validateAgentSessionSnapshot,
	validateAgentSessionSourceDiagnostic,
} from '@terminay/extension-api';
import type { AgentStatusService, AgentTerminal } from './agentService.js';
import { agentIdSegment, makeAgentStatusEntryId } from './agentStore.js';
import type {
	AgentCompletionOutcome,
	AgentState,
	AgentStatusEntry,
	AgentToolStatus,
	RootAgentStatusEntry,
	SubagentStatusEntry,
} from './agentTypes.js';
import { ProcessAncestry } from './processAncestry.js';
import type { ProjectAgentScope } from './projectAgentScope.js';

/** One harness a source declared. */
export interface SessionSourceHarness {
	readonly id: string;
	readonly displayName: string;
}

/** A source as its manifest declared it. */
export interface SessionSourceDeclaration {
	readonly id: string;
	readonly extensionId: string;
	readonly harnesses: readonly SessionSourceHarness[];
}

/**
 * One batch of publisher calls, validated in full before any of it applies.
 * A `reset` replaces every session the source reported before; upserts and
 * removals then apply in that order.
 */
export interface SessionSourcePublication {
	readonly reset?: readonly unknown[];
	readonly upserts?: readonly unknown[];
	readonly removals?: readonly unknown[];
}

export interface SessionSourcePublicationResult {
	readonly ok: boolean;
	/** The source must resend its full live set as a reset. */
	readonly resend?: boolean;
	readonly failure?: string;
}

export interface SessionSourceDiagnosticRecord {
	readonly sourceId: string;
	readonly extensionId: string;
	readonly diagnostic: AgentSessionSourceDiagnostic;
}

export interface SessionSourceBridgeOptions {
	readonly agents: AgentStatusService;
	readonly scope: ProjectAgentScope;
	readonly ancestry?: ProcessAncestry;
	readonly now?: () => number;
	readonly maximumQueuedPublications?: number;
	readonly acknowledgementDeadlineMs?: number;
	readonly onDiagnostic?: (record: SessionSourceDiagnosticRecord) => void;
}

interface LiveSession {
	readonly snapshot: AgentSessionSnapshot;
	readonly cwd: string;
	readonly createdAt: number;
	/** Session id of the terminal whose process tree owns the session. */
	terminalSessionId: string | null;
}

interface SourceState {
	readonly declaration: SessionSourceDeclaration;
	readonly harnesses: ReadonlyMap<string, string>;
	enabled: ReadonlySet<string>;
	readonly sessions: Map<string, LiveSession>;
	tail: Promise<void>;
	queued: number;
	/** Bumped when a publication expires; work queued under an older
	 * generation is discarded and the source asked to resend. */
	generation: number;
	retired: boolean;
}

const ATTENTION_STATES: ReadonlySet<AgentState> = new Set([
	'waiting',
	'blocked',
	'done',
]);

/**
 * Reduces session-source snapshots into canonical agent entries.
 *
 * It owns the host half of the session-source contract: per-source ordering
 * and flow control, full-batch validation, which project each session belongs
 * to, and which terminal — by process ancestry the host reads itself — owns
 * it. It interprets no provider file and infers nothing a snapshot did not say.
 */
export class SessionSourceBridge {
	private readonly agents: AgentStatusService;
	private readonly scope: ProjectAgentScope;
	private readonly ancestry: ProcessAncestry;
	private readonly now: () => number;
	private readonly maximumQueued: number;
	private readonly deadlineMs: number;
	private readonly onDiagnostic?: (
		record: SessionSourceDiagnosticRecord,
	) => void;
	private readonly sources = new Map<string, SourceState>();
	private readonly unsubscribe: Array<() => void> = [];
	private disposed = false;

	constructor(options: SessionSourceBridgeOptions) {
		this.agents = options.agents;
		this.scope = options.scope;
		this.ancestry = options.ancestry ?? new ProcessAncestry();
		this.now = options.now ?? Date.now;
		this.maximumQueued = options.maximumQueuedPublications ?? 64;
		this.deadlineMs = options.acknowledgementDeadlineMs ?? 5_000;
		if (
			!Number.isSafeInteger(this.deadlineMs) ||
			this.deadlineMs <= 0 ||
			this.deadlineMs > 300_000
		)
			throw new RangeError(
				'session source acknowledgement deadline is invalid',
			);
		this.onDiagnostic = options.onDiagnostic;
		this.unsubscribe.push(
			this.scope.onChanged(() => this.republishAll()),
			this.agents.observeTerminals((edge) => {
				if (edge.kind === 'started') this.terminalStarted();
				else if (edge.kind === 'exited') this.terminalExited(edge.terminal);
				else this.foregroundChanged(edge.terminal, edge.shellForeground);
			}),
		);
	}

	/** Admit a source the host started. Re-registering replaces its state. */
	registerSource(
		declaration: SessionSourceDeclaration,
		enabledHarnesses: readonly string[],
	): void {
		if (this.disposed) return;
		if (!isNamespacedId(declaration.id, declaration.extensionId))
			throw new Error('session source is outside its extension namespace');
		this.retireSource(declaration.id);
		const harnesses = new Map(
			declaration.harnesses.map((harness) => [harness.id, harness.displayName]),
		);
		this.sources.set(declaration.id, {
			declaration,
			harnesses,
			enabled: new Set(enabledHarnesses.filter((id) => harnesses.has(id))),
			sessions: new Map(),
			tail: Promise.resolve(),
			queued: 0,
			generation: 0,
			retired: false,
		});
	}

	hasSource(sourceId: string): boolean {
		return this.sources.has(sourceId);
	}

	/** Forget a source and every entry it reported. */
	retireSource(sourceId: string): void {
		const source = this.sources.get(sourceId);
		if (source === undefined) return;
		source.retired = true;
		source.generation += 1;
		this.sources.delete(sourceId);
		const removals = [...source.sessions.values()].flatMap((session) =>
			this.entryIdsFor(sourceId, session),
		);
		for (const session of source.sessions.values())
			this.ancestry.forget(session.snapshot.pid);
		this.agents.applyEntries([], removals);
	}

	/** Host-side filter: a harness switched off is dropped at once, whatever
	 * the source does next. */
	setEnabledHarnesses(sourceId: string, enabledHarnesses: readonly string[]) {
		const source = this.sources.get(sourceId);
		if (source === undefined) return;
		source.enabled = new Set(
			enabledHarnesses.filter((id) => source.harnesses.has(id)),
		);
		const removals: string[] = [];
		for (const [sessionId, session] of source.sessions) {
			if (source.enabled.has(session.snapshot.harness)) continue;
			removals.push(...this.entryIdsFor(sourceId, session));
			source.sessions.delete(sessionId);
		}
		this.agents.applyEntries([], removals);
	}

	/** Publish one validated batch for a source. Serialized per source. */
	publish(
		request: Readonly<{
			extensionId: string;
			sourceId: string;
			publication: SessionSourcePublication;
		}>,
		signal?: AbortSignal,
	): Promise<SessionSourcePublicationResult> {
		const source = this.sources.get(request.sourceId);
		if (
			source === undefined ||
			source.retired ||
			source.declaration.extensionId !== request.extensionId
		)
			return Promise.resolve(
				Object.freeze({ ok: false, failure: 'session source is not running' }),
			);
		if (source.queued >= this.maximumQueued)
			return Promise.resolve(
				Object.freeze({
					ok: false,
					resend: true,
					failure: 'session source publication queue is full',
				}),
			);
		const validated = this.validate(source, request.publication);
		if (typeof validated === 'string')
			return Promise.resolve(Object.freeze({ ok: false, failure: validated }));
		const generation = source.generation;
		return this.enqueue(source, signal, async (stillCurrent) => {
			if (source.generation !== generation)
				return { ok: false, resend: true, failure: 'publication expired' };
			const next = new Map(
				validated.reset === undefined ? source.sessions : undefined,
			);
			if (validated.reset !== undefined)
				for (const snapshot of validated.reset)
					next.set(snapshot.id, await this.live(source, snapshot));
			for (const snapshot of validated.upserts)
				next.set(snapshot.id, await this.live(source, snapshot));
			for (const sessionId of validated.removals) next.delete(sessionId);
			if (!stillCurrent() || source.generation !== generation)
				return { ok: false, resend: true, failure: 'publication expired' };
			this.commit(request.sourceId, source, next);
			return { ok: true };
		});
	}

	/** A source's typed diagnostic, forwarded to the host's records. */
	diagnostic(
		request: Readonly<{
			extensionId: string;
			sourceId: string;
			diagnostic: unknown;
		}>,
	): boolean {
		const source = this.sources.get(request.sourceId);
		if (source?.declaration.extensionId !== request.extensionId) return false;
		const validated = validateAgentSessionSourceDiagnostic(request.diagnostic);
		if (!validated.ok) return false;
		try {
			this.onDiagnostic?.({
				sourceId: request.sourceId,
				extensionId: request.extensionId,
				diagnostic: validated.value,
			});
		} catch {
			/* a diagnostic sink cannot affect the source */
		}
		return true;
	}

	/** Settles once every queued publication and re-binding has. */
	async settled(): Promise<void> {
		await this.scope.settled();
		for (const source of this.sources.values()) await source.tail;
	}

	dispose(): void {
		this.disposed = true;
		for (const stop of this.unsubscribe.splice(0)) stop();
		for (const sourceId of [...this.sources.keys()])
			this.retireSource(sourceId);
	}

	private validate(
		source: SourceState,
		publication: SessionSourcePublication,
	):
		| {
				readonly reset?: readonly AgentSessionSnapshot[];
				readonly upserts: readonly AgentSessionSnapshot[];
				readonly removals: readonly string[];
		  }
		| string {
		if (typeof publication !== 'object' || publication === null)
			return 'session source publication is invalid';
		let reset: readonly AgentSessionSnapshot[] | undefined;
		if (publication.reset !== undefined) {
			const result = validateAgentSessionReset(
				publication.reset,
				source.enabled,
			);
			if (!result.ok) return 'session source reset is invalid';
			reset = result.value;
		}
		const upserts: AgentSessionSnapshot[] = [];
		const upsertValues = publication.upserts ?? [];
		if (
			!Array.isArray(upsertValues) ||
			upsertValues.length > EXTENSION_LIMITS.agentSessionsPerReset
		)
			return 'session source upserts are invalid';
		for (const value of upsertValues) {
			const result = validateAgentSessionSnapshot(value, source.enabled);
			if (!result.ok) return 'session source snapshot is invalid';
			upserts.push(result.value);
		}
		const removalValues = publication.removals ?? [];
		if (
			!Array.isArray(removalValues) ||
			removalValues.length > EXTENSION_LIMITS.agentSessionsPerReset ||
			removalValues.some(
				(id) =>
					typeof id !== 'string' ||
					id.length === 0 ||
					id.length > EXTENSION_LIMITS.agentSessionIdLength,
			)
		)
			return 'session source removals are invalid';
		return {
			...(reset === undefined ? {} : { reset }),
			upserts,
			removals: removalValues as string[],
		};
	}

	/** Canonicalise the cwd and read the owning terminal for one snapshot. */
	private async live(
		source: SourceState,
		snapshot: AgentSessionSnapshot,
	): Promise<LiveSession> {
		const previous = source.sessions.get(snapshot.id);
		const cwd =
			previous?.snapshot.cwd === snapshot.cwd
				? previous.cwd
				: await this.scope.canonical(snapshot.cwd);
		const samePid = previous?.snapshot.pid === snapshot.pid;
		if (previous !== undefined && !samePid)
			this.ancestry.forget(previous.snapshot.pid);
		const terminalSessionId =
			samePid && previous !== undefined
				? previous.terminalSessionId
				: await this.ownerOf(snapshot.pid);
		return {
			snapshot,
			cwd,
			createdAt: previous?.createdAt ?? this.now(),
			terminalSessionId,
		};
	}

	private async ownerOf(pid: number, refresh = false): Promise<string | null> {
		const shells = this.shellTerminals();
		const chain = await this.ancestry.chain(
			pid,
			new Set(shells.keys()),
			refresh,
		);
		const shell = ProcessAncestry.owner(chain, new Set(shells.keys()));
		return shell === undefined ? null : shells.get(shell)!.identity.sessionId;
	}

	private shellTerminals(): Map<number, AgentTerminal> {
		const shells = new Map<number, AgentTerminal>();
		for (const terminal of this.agents.liveTerminals())
			if (terminal.shellPid !== undefined)
				shells.set(terminal.shellPid, terminal);
		return shells;
	}

	/** Replace a source's live set and apply the resulting entry changes in
	 * one revision. */
	private commit(
		sourceId: string,
		source: SourceState,
		next: Map<string, LiveSession>,
	): void {
		const removals: string[] = [];
		for (const [sessionId, session] of source.sessions)
			if (!next.has(sessionId)) {
				removals.push(...this.entryIdsFor(sourceId, session));
				this.ancestry.forget(session.snapshot.pid);
			}
		const snapshot = this.agents.getSnapshot();
		const upserts: AgentStatusEntry[] = [];
		for (const [sessionId, session] of next) {
			const entries = this.entriesFor(sourceId, source, session, snapshot);
			upserts.push(...entries);
			const previous = source.sessions.get(sessionId);
			if (previous !== undefined) {
				const kept = new Set(entries.map((entry) => entry.entryId));
				for (const entryId of this.entryIdsFor(sourceId, previous))
					if (!kept.has(entryId)) removals.push(entryId);
			}
		}
		source.sessions.clear();
		for (const [sessionId, session] of next)
			source.sessions.set(sessionId, session);
		this.agents.applyEntries(upserts, removals);
	}

	private entryIdsFor(sourceId: string, session: LiveSession): string[] {
		return [
			makeAgentStatusEntryId(sourceId, session.snapshot.id),
			...(session.snapshot.subagents ?? []).map((subagent) =>
				makeAgentStatusEntryId(sourceId, session.snapshot.id, subagent.id),
			),
		];
	}

	private entriesFor(
		sourceId: string,
		source: SourceState,
		session: LiveSession,
		current: ReturnType<AgentStatusService['getSnapshot']>,
	): AgentStatusEntry[] {
		const snapshot = session.snapshot;
		const now = this.now();
		const sessionKey = agentIdSegment(snapshot.id);
		const rootId = makeAgentStatusEntryId(sourceId, snapshot.id);
		const previous = current.entries[rootId] as
			| RootAgentStatusEntry
			| undefined;
		const terminal =
			session.terminalSessionId === null
				? undefined
				: this.agents.terminal(session.terminalSessionId);
		const external = terminal === undefined;
		const projectIds = [
			...new Set([
				...this.scope.projectIdsFor(session.cwd),
				...(terminal === undefined ? [] : [terminal.identity.projectId]),
			]),
		].sort();
		const harnessDisplayName = source.harnesses.get(snapshot.harness);
		const common = {
			provider: sourceId,
			harness: snapshot.harness,
			...(harnessDisplayName === undefined
				? {}
				: {
						harnessDisplayName,
						providerDisplayName: harnessDisplayName,
					}),
			sessionId: sessionKey,
			activationTerminalSessionId: terminal?.identity.sessionId ?? null,
			external,
			projectIds,
			createdAt: session.createdAt,
		};
		const root = rootState(snapshot, previous, session.createdAt, now);
		const openSubagents = (snapshot.subagents ?? []).filter(
			(subagent) => subagent.status === 'running',
		).length;
		const rootEntry: RootAgentStatusEntry = {
			entryId: rootId,
			kind: 'root',
			...common,
			agentId: sessionKey,
			...(snapshot.title === undefined ? {} : { displayName: snapshot.title }),
			...(snapshot.model === undefined
				? {}
				: { model: { id: snapshot.model } }),
			state: root.state,
			stateStartedAt:
				previous?.state === root.state ? previous.stateStartedAt : now,
			updatedAt: now,
			active: true,
			activeTools: toolsFor(snapshot.tool, previous?.activeTools, now),
			...(root.waitingReason === undefined
				? {}
				: { waitingReason: root.waitingReason }),
			...(root.outcome === undefined
				? {}
				: { completionOutcome: root.outcome }),
			...(root.summary === undefined ? {} : { summary: root.summary }),
			unread: unreadFor(external, previous, root.state),
			...(previous?.acknowledgedAt === undefined
				? {}
				: { acknowledgedAt: previous.acknowledgedAt }),
			terminalSessionId: terminal?.identity.sessionId ?? null,
			inProcess: false,
			openSubagents,
		};
		const known = new Set(
			(snapshot.subagents ?? []).map((subagent) => subagent.id),
		);
		const children = (snapshot.subagents ?? []).map(
			(subagent): SubagentStatusEntry => {
				const agentId = agentIdSegment(subagent.id);
				const entryId = makeAgentStatusEntryId(
					sourceId,
					snapshot.id,
					subagent.id,
				);
				const prior = current.entries[entryId];
				const parentId =
					subagent.parentId !== undefined && known.has(subagent.parentId)
						? subagent.parentId
						: undefined;
				const parentAgentId =
					parentId === undefined ? sessionKey : agentIdSegment(parentId);
				const child = subagentState(subagent.status);
				return {
					entryId,
					kind: 'subagent',
					...common,
					createdAt: prior?.createdAt ?? now,
					agentId,
					...(subagent.title === undefined
						? { displayName: subagent.type }
						: { displayName: subagent.title }),
					state: child.state,
					stateStartedAt:
						prior?.state === child.state ? prior.stateStartedAt : now,
					updatedAt: now,
					active: subagent.status === 'running',
					activeTools: [],
					...(child.outcome === undefined
						? {}
						: { completionOutcome: child.outcome }),
					unread: unreadFor(external, prior, child.state),
					...(prior?.acknowledgedAt === undefined
						? {}
						: { acknowledgedAt: prior.acknowledgedAt }),
					terminalSessionId: null,
					inProcess: true,
					parentAgentId,
					parentEntryId: makeAgentStatusEntryId(
						sourceId,
						snapshot.id,
						parentId,
					),
				};
			},
		);
		return [rootEntry, ...children];
	}

	/** Recompute every entry, for a project or terminal change. */
	private republishAll(): void {
		for (const [sourceId, source] of this.sources)
			void this.enqueue(source, undefined, async () => {
				this.commit(sourceId, source, new Map(source.sessions));
				return { ok: true };
			});
	}

	/** A new shell may be an ancestor of a session already reported. Cached
	 * chains are re-matched; nothing is read. */
	private terminalStarted(): void {
		const shells = this.shellTerminals();
		const shellPids = new Set(shells.keys());
		for (const [sourceId, source] of this.sources)
			void this.enqueue(source, undefined, async () => {
				for (const session of source.sessions.values()) {
					if (session.terminalSessionId !== null) continue;
					const chain = this.ancestry.cached(session.snapshot.pid);
					const shell =
						chain === undefined
							? undefined
							: ProcessAncestry.owner(chain, shellPids);
					if (shell !== undefined)
						session.terminalSessionId = shells.get(shell)!.identity.sessionId;
				}
				this.commit(sourceId, source, new Map(source.sessions));
				return { ok: true };
			});
	}

	/** A closed terminal revokes its claim on every session it owned. */
	private terminalExited(terminal: AgentTerminal): void {
		if (terminal.shellPid !== undefined)
			this.ancestry.forgetThrough(terminal.shellPid);
		const sessionId = terminal.identity.sessionId;
		for (const [sourceId, source] of this.sources) {
			let revoked = false;
			for (const session of source.sessions.values())
				if (session.terminalSessionId === sessionId) {
					session.terminalSessionId = null;
					revoked = true;
				}
			if (!revoked) continue;
			this.commit(sourceId, source, new Map(source.sessions));
		}
	}

	/**
	 * A foreground edge re-reads ancestry for the few sessions it can affect:
	 * those no terminal owns yet, and — when the shell is back in front — those
	 * this terminal owned, which may since have exited.
	 */
	private foregroundChanged(
		terminal: AgentTerminal,
		shellForeground: boolean,
	): void {
		const sessionId = terminal.identity.sessionId;
		for (const [sourceId, source] of this.sources) {
			const affected = [...source.sessions.values()].filter(
				(session) =>
					session.terminalSessionId === null ||
					(shellForeground && session.terminalSessionId === sessionId),
			);
			if (affected.length === 0) continue;
			void this.enqueue(source, undefined, async () => {
				for (const session of affected) {
					if (source.sessions.get(session.snapshot.id) !== session) continue;
					session.terminalSessionId = await this.ownerOf(
						session.snapshot.pid,
						true,
					);
				}
				this.commit(sourceId, source, new Map(source.sessions));
				return { ok: true };
			});
		}
	}

	/** Serialize work for one source, bounded by the acknowledgement deadline.
	 * A deadline expires this work and everything queued behind it. */
	private enqueue(
		source: SourceState,
		signal: AbortSignal | undefined,
		work: (
			stillCurrent: () => boolean,
		) => Promise<SessionSourcePublicationResult>,
	): Promise<SessionSourcePublicationResult> {
		source.queued += 1;
		const prior = source.tail;
		let release!: () => void;
		source.tail = new Promise<void>((resolve) => {
			release = resolve;
		});
		return (async (): Promise<SessionSourcePublicationResult> => {
			let expired = false;
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				await prior;
				if (source.retired || signal?.aborted)
					return Object.freeze({
						ok: false,
						failure: 'session source publication cancelled',
					});
				const deadline = new Promise<SessionSourcePublicationResult>(
					(resolve) => {
						timer = setTimeout(() => {
							expired = true;
							source.generation += 1;
							resolve({
								ok: false,
								resend: true,
								failure: 'session source acknowledgement timed out',
							});
						}, this.deadlineMs);
					},
				);
				return Object.freeze(
					await Promise.race([
						work(() => !expired && !source.retired && !signal?.aborted),
						deadline,
					]),
				);
			} catch (error) {
				return Object.freeze({
					ok: false,
					failure:
						error instanceof Error
							? error.message.slice(0, 1_000)
							: 'session source publication failed',
				});
			} finally {
				if (timer !== undefined) clearTimeout(timer);
				source.queued -= 1;
				release();
			}
		})();
	}
}

function rootState(
	snapshot: AgentSessionSnapshot,
	previous: RootAgentStatusEntry | undefined,
	createdAt: number,
	now: number,
): {
	state: AgentState;
	waitingReason?: string;
	outcome?: AgentCompletionOutcome;
	summary?: string;
} {
	switch (snapshot.status) {
		case 'running':
			return { state: 'working' };
		case 'waiting':
			return {
				state: 'waiting',
				...(snapshot.waitingFor === undefined
					? {}
					: { waitingReason: snapshot.waitingFor }),
			};
		case 'blocked':
			return {
				state: 'blocked',
				...(snapshot.waitingFor === undefined
					? {}
					: { waitingReason: snapshot.waitingFor }),
			};
		case 'idle': {
			// A session seen going from running to idle ended its turn now, even
			// when the source cannot say when.
			const endedAt =
				snapshot.lastTurnEndedAt ??
				(previous !== undefined &&
				previous.state !== 'idle' &&
				previous.state !== 'done'
					? now
					: undefined);
			const fresh =
				endedAt !== undefined &&
				endedAt > createdAt &&
				endedAt > (previous?.acknowledgedAt ?? Number.NEGATIVE_INFINITY);
			if (!fresh) return { state: 'idle' };
			if (snapshot.lastTurn === 'failed')
				return {
					state: 'done',
					outcome: 'error',
					...(snapshot.error === undefined ? {} : { summary: snapshot.error }),
				};
			if (snapshot.lastTurn === 'interrupted')
				return { state: 'done', outcome: 'cancelled' };
			return { state: 'done', outcome: 'success' };
		}
		default:
			return previous === undefined
				? { state: 'idle' }
				: {
						state: previous.state,
						...(previous.waitingReason === undefined
							? {}
							: { waitingReason: previous.waitingReason }),
						...(previous.completionOutcome === undefined
							? {}
							: { outcome: previous.completionOutcome }),
						...(previous.summary === undefined
							? {}
							: { summary: previous.summary }),
					};
	}
}

function subagentState(
	status: NonNullable<AgentSessionSnapshot['subagents']>[number]['status'],
): { state: AgentState; outcome?: AgentCompletionOutcome } {
	switch (status) {
		case 'running':
			return { state: 'working' };
		case 'completed':
			return { state: 'done', outcome: 'success' };
		case 'failed':
			return { state: 'done', outcome: 'error' };
		case 'cancelled':
			return { state: 'done', outcome: 'cancelled' };
	}
}

/** External entries never carry unread treatment. A bound entry becomes
 * unread on entering an attention state and stays so until acknowledged. */
function unreadFor(
	external: boolean,
	previous: AgentStatusEntry | undefined,
	state: AgentState,
): boolean {
	if (external) return false;
	if (previous === undefined || previous.external || previous.state !== state)
		return ATTENTION_STATES.has(state);
	return previous.unread;
}

function toolsFor(
	tool: string | undefined,
	previous: readonly AgentToolStatus[] | undefined,
	now: number,
): readonly AgentToolStatus[] {
	if (tool === undefined) return [];
	const prior = previous?.find((candidate) => candidate.name === tool);
	return [{ id: tool, name: tool, startedAt: prior?.startedAt ?? now }];
}
