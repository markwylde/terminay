import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import type {
	BotAgentContribution,
	BotAgentLaunch,
	BotAgentModel,
	BotAgentResult,
	BotAgentStatus,
} from '@terminay/extension-api';
import type {
	BotAgent,
	BotDraft,
	BotMessage,
	BotMessageAttachment,
	BotProfile,
	BotSessionOrigin,
	BotSessionRecord,
	BotSessionSnapshot,
	JsonValue,
} from '@terminay/protocol';
import { foldTranscript } from '@terminay/protocol';
import type { OperationRegistries, RequestContext } from '../types.js';
import {
	BotAgentProcess,
	type BotAgentProcessOptions,
	BotCleanupError,
} from './agentProcess.js';
import { assertBotAuthority } from './authority.js';
import { BotConnectionResources } from './connections.js';
import type { BotCredentialLease } from './credentials.js';
import { BOT_KILL_DEADLINE_MS, type EngineDriver } from './engine.js';
import type {
	BotEnvironmentDefinition,
	BotEnvironmentService,
} from './environment.js';
import { botFailure, botFailureCause } from './failure.js';
import { BotFailureFollowUps } from './failureFollowUps.js';

/** Shown while a blocked bot's earlier process cleanup is still unconfirmed. */
const BOT_CLEANUP_UNCONFIRMED =
	"An earlier execution's processes could not be cleaned up in the bot container. Check the container engine, then send a new message.";
import {
	BOT_IMAGE_BYTES,
	botImageMime,
	removeExecutionImages,
	writeExecutionImages,
} from './images.js';
import type { BotMemories } from './memories.js';
import { BotMessageStore } from './messages.js';
import type { BotNativeClient } from './native.js';
import {
	botProcessCount,
	classifyProcessFailure,
} from './processExhaustion.js';
import {
	BOT_CLEANUP_FAILURE_LIMIT,
	type BotQueuedTurn,
	type BotQueueFailure,
	type BotRunResult,
	BotTurnQueue,
} from './queue.js';
import { BotExecutionRuntime } from './runtime.js';
import {
	type BotRuntimeBridge,
	openBotRuntimeBridge,
} from './runtimeBridge.js';
import { BotSessionStore } from './sessions.js';
import { BotBlockedError, BotError, BotStore, text } from './store.js';
import { BotTriggers } from './triggers.js';

export interface BotAgents {
	botAgentContributions(): readonly {
		extensionId: string;
		extensionName?: string;
		contribution: BotAgentContribution;
	}[];
	botAgentModels(id: string): Promise<BotAgentResult<BotAgentModel[]>>;
	botAgentStatus(id: string): Promise<BotAgentResult<BotAgentStatus>>;
	botAgentLaunch(
		id: string,
		request: { modelId: string | null },
	): Promise<BotAgentResult<BotAgentLaunch>>;
}
/**
 * One bot execution's `terminay` relay handler, served by the host that owns
 * the MCP control socket (ADR-0100). It holds the execution's capability.
 */
export interface BotTerminayMcpHandler {
	handle(
		connection: number,
		message: unknown,
		reply: (message: unknown) => void,
	): void;
	closeConnection(connection: number): void;
	/** End every session and revoke the execution's capability. */
	close(): void;
}

/** The host seam through which a bot with Terminay MCP access reaches it. */
export interface BotTerminayMcpHost {
	/**
	 * Mint the execution's capability and serve it, or return undefined when
	 * Terminay MCP is off. `isAllowed` is checked before and after minting, so
	 * a start that races a toggle-off never leaves a capability behind.
	 */
	open(
		botId: string,
		executionId: string,
		isAllowed: () => boolean,
	): BotTerminayMcpHandler | undefined;
	/** Revoke every capability the bot's executions hold, aborting their work. */
	revokeBot(botId: string): void;
}

export interface BotServiceHooks {
	/** Present where the host serves Terminay MCP (ADR-0100). */
	readonly terminayMcp?: BotTerminayMcpHost;
	readonly sources?: import('./sourceRunner.js').BotSourceRunner;
	readonly serverId?: string;
	readonly closeConnection?: (connectionId: string) => void;
	readonly agents: BotAgents;
	readonly environment: Pick<
		BotEnvironmentService,
		'register' | 'prepareSession' | 'remove' | 'stop' | 'reconcileAll' | 'state'
	> &
		Partial<Pick<BotEnvironmentService, 'definition' | 'forget'>>;
	readonly driver: () => Promise<EngineDriver>;
	readonly deletion?: {
		begin(botId: string, deleteHome: boolean): void;
		cleanup(botId: string, deleteHome: boolean): Promise<boolean>;
	};
	readonly credentials: {
		acquire(
			botId: string,
			snapshot: BotSessionSnapshot,
		): Promise<BotCredentialLease>;
	};
	readonly removeHelpers: () => Promise<void>;
	/** Combine with Shell/Desktop counts before calling environment.setActivity. */
	readonly activity: (botId: string, running: number, queued: number) => void;
	readonly process?: (options: BotAgentProcessOptions) => BotAgentProcess;
	readonly now?: () => number;
	readonly removeTriggers?: (botId: string) => Promise<void>;
	readonly validateSignIn?: (
		draft: BotDraft,
		signIn: BotProfile['signIn'],
		agent: BotAgentContribution,
	) => Promise<void>;
	readonly additionalOperations?: () => OperationRegistries;
	readonly dispose?: () => Promise<void>;
	readonly agentInfo?: () => Promise<BotAgent[]>;
}
interface Live {
	runner: BotAgentProcess;
	client?: BotNativeClient;
	stop?: Promise<void>;
	closing: boolean;
	timer?: ReturnType<typeof setTimeout>;
	turn: boolean;
	/** Whether this execution was given the `terminay` server. */
	terminay: boolean;
}
/** Device settings override defaults at matching paths, preserving other files. */
export function botAgentConfigFiles(
	agent: BotAgentContribution,
	device: boolean,
) {
	return [
		...new Map(
			[
				...(agent.botConfigFiles ?? []),
				...(device ? (agent.deviceSignIn?.configFiles ?? []) : []),
			].map((file) => [file.path, file]),
		).values(),
	];
}

/** The server owns profiles, arbitration, ACP, permissions and all stored content. */
export class BotService extends EventEmitter {
	readonly messages: BotMessageStore;
	readonly runtime: BotExecutionRuntime;
	private readonly messageDispatches = new Map<
		string,
		Promise<{ sessionId: string; queueId: string }>
	>();
	readonly queue: BotTurnQueue;
	readonly triggers: BotTriggers;
	readonly failureFollowUps: BotFailureFollowUps;
	readonly connections = new BotConnectionResources((id) =>
		this.hooks.closeConnection?.(id),
	);
	/** The window connection that sent each bot its latest message. */
	private readonly viewers = new Map<
		string,
		{ readonly clientId: string; readonly connectionId: string }
	>();

	/** Record the window that just messaged a bot, so its tools act there. */
	recordViewer(
		botId: string,
		viewer: { readonly clientId: string; readonly connectionId: string },
	): void {
		this.viewers.set(botId, viewer);
	}

	/** The window that sent the bot its latest message, while it is connected. */
	viewerOf(
		botId: string,
	): { readonly clientId: string; readonly connectionId: string } | undefined {
		return this.viewers.get(botId);
	}

	/** A connection closed: no bot is talking to it any more. */
	forgetViewerConnection(connectionId: string): void {
		for (const [botId, viewer] of this.viewers)
			if (viewer.connectionId === connectionId) this.viewers.delete(botId);
	}
	private readonly memoryWatches = new Map<
		string,
		{ connectionId: string; close: () => void }
	>();
	private readonly currentChats = new Map<string, string>();
	private readonly live = new Map<string, Live>();
	private readonly activeRuns = new Map<
		string,
		{ botId: string; task: Promise<BotRunResult> }
	>();
	private readonly deleting = new Map<
		string,
		Promise<{ warning: string | null }>
	>();
	private readonly mutations = new Map<string, Promise<unknown>>();
	readonly now: () => number;
	private revision = 0;
	private initialized = false;
	private reconciling?: Promise<void>;
	private readonly cancelledStarts = new Set<string>();
	/** Turns this process is starting: running, but with no live runner yet. */
	private readonly starting = new Set<string>();
	private readonly stoppingBots = new Set<string>();
	/**
	 * Bumped whenever a bot's Terminay MCP access is taken away, so an
	 * execution that started before then never mints a capability (ADR-0100).
	 */
	private readonly mcpAccessGenerations = new Map<string, number>();
	private readonly detach: (() => void)[] = [];
	constructor(
		readonly bots: BotStore,
		readonly sessions: BotSessionStore,
		readonly memories: BotMemories,
		private readonly hooks: BotServiceHooks,
	) {
		super();
		this.now = hooks.now ?? Date.now;
		this.messages = new BotMessageStore(
			join(sessions.root, '..', 'messages'),
			this.now,
		);
		const messageChanged = (botId: string) => {
			this.emit('messages-changed', {
				botId,
				sequence: this.messages.sequence(botId),
			});
			this.changed(botId);
		};
		this.messages.on('changed', messageChanged);
		this.detach.push(() => this.messages.off('changed', messageChanged));
		this.triggers = new BotTriggers(this, bots, this.now);
		this.failureFollowUps = new BotFailureFollowUps(
			join(sessions.root, '..', 'failure-follow-ups'),
			{
				now: this.now,
				investigates: (botId) => {
					try {
						const bot = this.bots.get(botId);
						return (
							bot.enabled !== false &&
							bot.investigateFailures !== false &&
							!this.deleting.has(botId)
						);
					} catch {
						return false;
					}
				},
				sessions: (botId) => this.sessions.list(botId),
				redact: (botId, value) => this.redactMessage(botId, value),
				dispatch: (botId, prompt, origin, id) =>
					this.send(botId, prompt, undefined, origin, () => true, id),
				abandon: (id) => {
					try {
						const r = this.sessions.get(id);
						if (
							r.state === 'queued' &&
							![
								...this.queue.list(r.botId),
								...this.queue.active(r.botId),
							].some((i) => i.sessionId === id)
						)
							this.sessions.patch(id, {
								state: 'stopped',
								open: false,
								endedAt: this.now(),
								reason: 'The failure investigation could not be queued.',
							});
					} catch {}
				},
				firingFor: (botId, sessionId) => {
					try {
						return (
							this.triggers
								.firings(botId)
								.find((f) => f.sessionId === sessionId)?.id ?? null
						);
					} catch {
						return null;
					}
				},
				setTimeout: (fn, ms) => setTimeout(fn, ms),
				clearTimeout: (handle) =>
					clearTimeout(handle as ReturnType<typeof setTimeout>),
			},
		);
		const sessionState = ({
			record,
		}: {
			record: BotSessionRecord;
			previous: string;
		}) => {
			if (record.state === 'failed' || record.state === 'timed-out')
				void this.failureFollowUps.execution(record);
			else if (!['queued', 'running', 'needs-you'].includes(record.state))
				void this.failureFollowUps.drain(record.botId);
		};
		this.sessions.on('state', sessionState);
		this.detach.push(() => this.sessions.off('state', sessionState));
		this.queue = new BotTurnQueue({
			run: (item) => this.run(item),
			suspend: (id) => this.suspend(id),
			cancelled: (item, reason) => {
				const r = this.sessions.get(item.sessionId);
				this.sessions.patch(r.id, {
					queuedMessage: r.queuedMessage
						? { ...r.queuedMessage, status: 'not-sent' }
						: null,
					state: 'stopped',
					open: false,
					endedAt: this.now(),
					reason,
					...(r.origin.kind === 'chat'
						? {}
						: { firing: 'skipped', state: 'stopped', open: false, reason }),
				});
			},
			changed: (id, active, queued) => {
				this.hooks.activity(
					id,
					active,
					this.bots.get(id).enabled === false ? 0 : queued,
				);
				this.changed(id);
			},
			failure: (item, failure) => this.recordFinishFailure(item, failure),
		});
		for (const bot of bots.list())
			if (bot.enabled === false) this.queue.pause(bot.id);
		this.runtime = new BotExecutionRuntime(
			this,
			() => this.driverForRuntime(),
			hooks.serverId ?? 'server',
		);
		for (const source of [bots, sessions, memories]) {
			const changed = ({ botId }: { botId: string }) => this.changed(botId);
			source.on('changed', changed);
			this.detach.push(() => source.off('changed', changed));
		}
		for (const bot of bots.list()) {
			this.register(bot);
			this.importMessages(bot.id);
		}
	}
	private importMessages(botId: string): void {
		if (this.messages.imported(botId)) return;
		for (const session of [...this.sessions.list(botId)]
			.filter((s) => s.origin.kind === 'chat')
			.sort((a, b) => a.startedAt - b.startedAt)) {
			for (const item of foldTranscript(this.sessions.get(session.id).updates))
				if (item.kind === 'user' || item.kind === 'agent') {
					const message = this.messages.post(
						botId,
						item.kind === 'user' ? 'user' : 'bot',
						item.text,
						item.kind === 'agent' ? session.id : null,
						`import:${session.id}:${item.key}`,
					);
					if (item.kind === 'user')
						this.messages.setDispatch(botId, message.id, {
							state: 'started',
							executionId: session.id,
						});
				}
		}
		this.messages.markImported(botId);
	}
	async watchMemories(botId: string, context: RequestContext): Promise<string> {
		assertBotAuthority(context);
		if (
			[...this.memoryWatches.values()].filter(
				(w) => w.connectionId === context.connectionId,
			).length >= 32
		)
			throw new BotError('resource', 'too many memory watches');
		const unwatch = await this.memories.watch(botId, () => undefined);
		try {
			assertBotAuthority(context);
		} catch (error) {
			unwatch();
			throw error;
		}
		const id = randomBytes(12).toString('hex');
		const close = this.connections.bind(context, () => {
			unwatch();
			this.memoryWatches.delete(id);
		});
		this.memoryWatches.set(id, { connectionId: context.connectionId, close });
		return id;
	}
	unwatchMemories(id: string, context: RequestContext): void {
		assertBotAuthority(context);
		const watch = this.memoryWatches.get(id);
		if (watch?.connectionId !== context.connectionId)
			throw new BotError('not_found', 'memory watch not found');
		watch.close();
	}
	invalidate(botId: string): void {
		this.changed(botId);
	}
	private changed(botId: string): void {
		this.emit('changed', { botId, revision: ++this.revision });
	}
	private register(bot: BotProfile): void {
		const agent = this.hooks.agents
			.botAgentContributions()
			.find((a) => a.contribution.id === bot.agentId)?.contribution;
		let previous: BotEnvironmentDefinition | undefined;
		try {
			previous = this.hooks.environment.definition?.(bot.id);
		} catch {
			/* A new bot has no environment definition yet. */
		}
		this.hooks.environment.register({
			...previous,
			id: bot.id,
			configFiles: agent
				? botAgentConfigFiles(agent, bot.signIn.kind === 'device').map((f) => ({
						path: f.path,
						content: f.contents,
					}))
				: previous?.configFiles,
		});
	}
	additionalOperations(): OperationRegistries {
		return this.hooks.additionalOperations?.() ?? {};
	}
	async agents(): Promise<BotAgent[]> {
		if (this.hooks.agentInfo) return this.hooks.agentInfo();
		return Promise.all(
			this.hooks.agents
				.botAgentContributions()
				.map(async (entry): Promise<BotAgent> => {
					const models = await this.hooks.agents.botAgentModels(
						entry.contribution.id,
					);
					const status = await this.hooks.agents.botAgentStatus(
						entry.contribution.id,
					);
					return {
						extensionId: entry.extensionId,
						extensionName: entry.extensionName ?? entry.extensionId,
						id: entry.contribution.id,
						displayName: entry.contribution.displayName,
						autonomousOnly: entry.contribution.autonomousOnly,
						canLoad: this.bots
							.list()
							.some(
								(b) =>
									b.agentId === entry.contribution.id &&
									this.sessions.list(b.id).some((s) => s.canLoad),
							),
						signInMethods: [
							...(entry.contribution.deviceSignIn ? ['device' as const] : []),
							...(entry.contribution.credentialSecrets?.length
								? ['token' as const]
								: []),
						],
						deviceSignIn: entry.contribution.deviceSignIn
							? {
									label: entry.contribution.deviceSignIn.label,
									help: entry.contribution.deviceSignIn.help,
								}
							: null,
						models: {
							available: models.available,
							value: models.available ? models.value : [],
						},
						status: status.available
							? status.value.state === 'ready'
								? { state: 'ready' }
								: {
										state: 'not-signed-in',
										...(status.value.detail === undefined
											? {}
											: { detail: status.value.detail }),
										action: { label: 'Sign in', kind: 'sign-in' },
									}
							: { state: 'unavailable' },
					};
				}),
		);
	}
	private agent(id: string): BotAgentContribution {
		const found = this.hooks.agents
			.botAgentContributions()
			.find((a) => a.contribution.id === id)?.contribution;
		if (!found) throw new BotError('unavailable', 'bot agent is unavailable');
		return found;
	}
	async save(draft: BotDraft, expectedRevision?: number): Promise<BotProfile> {
		const credentialVariable =
			draft.signIn?.kind === 'token'
				? draft.signIn.environmentVariable
				: undefined;
		const agent = this.agent(draft.agentId);
		const models = await this.hooks.agents.botAgentModels(agent.id);
		if (
			draft.modelId &&
			(!models.available || !models.value.some((m) => m.id === draft.modelId))
		)
			throw new BotError('validation', 'model is not listed by this agent');
		if (
			draft.signIn?.kind === 'token' &&
			!agent.credentialSecrets?.some(
				(s) => s.environmentVariable === credentialVariable,
			)
		)
			throw new BotError(
				'validation',
				'agent does not declare this credential',
			);
		const previous = draft.id ? this.bots.get(draft.id) : undefined;
		const signIn = draft.signIn ?? previous?.signIn ?? { kind: 'none' };
		// A device sign-in is recorded only when the agent's own sign-in
		// succeeds inside the container; a client cannot claim one.
		if (
			signIn.kind === 'device' &&
			(previous?.signIn.kind !== 'device' || previous.agentId !== agent.id)
		)
			throw new BotError(
				'validation',
				`Use ${agent.deviceSignIn?.label ?? 'the agent’s sign-in'} to sign this bot in.`,
			);
		await this.hooks.validateSignIn?.(draft, signIn, agent);
		if (draft.id && this.deleting.has(draft.id))
			throw new BotError('conflict', 'This bot is being deleted.');
		const bot = this.bots.save(
			{
				...draft,
				signIn,
				...(agent.autonomousOnly ? { approvalMode: 'autonomous' } : {}),
			},
			expectedRevision,
		);
		// Taking Terminay MCP access away applies at once, to running
		// executions too, before the save is reported (ADR-0100).
		if (previous?.terminayMcpAccess === true && bot.terminayMcpAccess !== true)
			this.revokeTerminayMcp(bot.id);
		this.register(bot);
		if (bot.investigateFailures === false || bot.enabled === false)
			this.failureFollowUps.clear(bot.id);
		if (previous && previous.enabled !== bot.enabled) {
			this.triggers.availability(bot.id, bot.enabled !== false);
			if (bot.enabled === false) this.queue.pause(bot.id);
			else if (!this.queue.blocked(bot.id)) this.queue.unblock(bot.id);
		}
		return bot;
	}
	/** End every Terminay MCP capability of the bot's executions, and fence
	 * off executions that are still starting (ADR-0100). */
	private revokeTerminayMcp(botId: string): void {
		this.mcpAccessGenerations.set(
			botId,
			(this.mcpAccessGenerations.get(botId) ?? 0) + 1,
		);
		this.hooks.terminayMcp?.revokeBot(botId);
	}

	/**
	 * How an execution opens Terminay MCP, decided from the bot's current
	 * record, not its snapshot. Undefined when the bot has no access.
	 */
	private terminayMcpOpener(
		botId: string,
		executionId: string,
	): (() => BotTerminayMcpHandler | undefined) | undefined {
		const host = this.hooks.terminayMcp;
		if (host === undefined) return undefined;
		const generation = this.mcpAccessGenerations.get(botId) ?? 0;
		const isAllowed = () => {
			if ((this.mcpAccessGenerations.get(botId) ?? 0) !== generation)
				return false;
			try {
				return this.bots.get(botId).terminayMcpAccess === true;
			} catch {
				return false;
			}
		};
		if (!isAllowed()) return undefined;
		return () => host.open(botId, executionId, isAllowed);
	}

	/** Record (or forget) the device sign-in now held in the bot's own home. */
	async setDeviceSignIn(botId: string, signedIn: boolean): Promise<void> {
		const bot = this.bots.get(botId);
		const agent = this.agent(bot.agentId);
		if (signedIn && !agent.deviceSignIn)
			throw new BotError('validation', 'this agent has no device sign-in');
		const saved = this.bots.save({
			...bot,
			signIn: signedIn ? { kind: 'device' } : { kind: 'none' },
		});
		this.register(saved);
		this.changed(botId);
	}
	remove(
		botId: string,
		deleteHome: boolean,
		confirmed: boolean,
	): Promise<{ warning: string | null }> {
		if (!confirmed)
			return Promise.reject(
				new BotError('validation', 'deleting a bot requires confirmation'),
			);
		const existing = this.deleting.get(botId);
		if (existing) return existing;
		const task = this.removeNow(botId, deleteHome, confirmed);
		this.deleting.set(botId, task);
		void task.finally(() => this.deleting.delete(botId)).catch(() => undefined);
		return task;
	}
	private async removeNow(
		botId: string,
		deleteHome: boolean,
		confirmed: boolean,
	): Promise<{ warning: string | null }> {
		if (!confirmed)
			throw new BotError('validation', 'deleting a bot requires confirmation');
		this.bots.get(botId);
		this.hooks.deletion?.begin(botId, deleteHome);
		// Revocation happens before any engine-dependent process cleanup.
		this.revokeTerminayMcp(botId);
		for (const record of this.sessions.list(botId))
			this.runtime.revoke(record.id);
		await this.stopBot(botId).catch(() => undefined);
		await this.mutations.get(botId)?.catch(() => undefined);
		// An unreachable engine cannot confirm process cleanup, but local ACP
		// observations must settle before their diagnostic records are removed.
		await Promise.allSettled(
			this.sessions.list(botId).map(async (record) => {
				this.live.get(record.id)?.client?.dispose();
				await this.closeLive(record.id, 'bot-stop');
			}),
		);
		await Promise.allSettled(
			[...this.activeRuns.values()]
				.filter((r) => r.botId === botId)
				.map((r) => r.task),
		);
		let removed = true;
		if (this.hooks.deletion)
			removed = await this.hooks.deletion.cleanup(botId, deleteHome);
		else await this.hooks.environment.remove(botId, deleteHome);
		this.hooks.environment.forget?.(botId);
		this.triggers.removeBot(botId);
		this.failureFollowUps.removeBot(botId);
		await this.hooks.removeTriggers?.(botId);
		this.sessions.removeBot(botId);
		this.messages.removeBot(botId);
		this.bots.remove(botId);
		this.currentChats.delete(botId);
		return {
			warning: removed
				? null
				: 'Bot deleted. Container resources could not be removed because the original engine is unavailable or could not complete removal. Removal is pending until that engine returns.',
		};
	}
	get sourceRunner() {
		return this.hooks.sources;
	}
	assertEnabled(botId: string): void {
		if (this.bots.get(botId).enabled === false)
			throw new BotBlockedError(
				'disabled',
				'Bot is disabled. Enable bot to run it.',
			);
	}
	enableBot(botId: string, enabled: boolean, revision?: number): void {
		if (typeof enabled !== 'boolean')
			throw new BotError('validation', 'enabled must be boolean');
		const bot = this.bots.get(botId);
		this.bots.save({ ...bot, enabled }, revision);
		if (!enabled) this.failureFollowUps.clear(botId);
		this.triggers.availability(botId, enabled);
		if (enabled) {
			if (!this.queue.blocked(botId)) this.queue.unblock(botId);
		} else {
			this.queue.pause(botId);
			this.hooks.activity(botId, this.queue.active(botId).length, 0);
		}
	}
	driverForRuntime(): Promise<EngineDriver> {
		return this.hooks.driver();
	}
	async redactMessage(botId: string, value: string): Promise<string> {
		const bot = this.bots.get(botId);
		value = this.runtime.sanitizeSecrets(botId, value);
		const snapshot = { ...bot, context: '', signIn: bot.signIn };
		let lease: BotCredentialLease | undefined;
		try {
			lease = await this.hooks.credentials.acquire(botId, snapshot);
			return lease.redact(value);
		} catch {
			if (bot.signIn.kind === 'none') return value;
			throw new BotError(
				'unavailable',
				'Unable to safely persist message with the current sign-in',
			);
		} finally {
			lease?.release();
		}
	}
	/** Stage one user-supplied image; its bytes are untrusted and sniffed by the store. */
	async uploadUserImage(
		botId: string,
		name: string,
		bytes: Uint8Array,
	): Promise<{ token: string; attachment: Omit<BotMessageAttachment, 'id'> }> {
		this.assertEnabled(botId);
		if (bytes.length < 1 || bytes.length > BOT_IMAGE_BYTES)
			throw new BotError('validation', 'Images must be 2 MiB or smaller');
		return this.serialize(botId, async () => {
			if (this.deleting.has(botId))
				throw new BotError('conflict', 'This bot is being deleted.');
			const safe = await this.redactMessage(botId, name);
			try {
				botImageMime(bytes);
			} catch {
				throw new BotError(
					'validation',
					'Only PNG, JPEG, GIF and WebP images can be attached',
				);
			}
			return this.messages.stage(botId, safe, bytes);
		});
	}
	async postUserMessage(
		botId: string,
		body: string,
		key: string,
		uploads: readonly string[] = [],
	): Promise<{
		message: BotMessage;
		sessionId?: string;
		queueId?: string;
		error?: string;
	}> {
		this.assertEnabled(botId);
		text(body, 65536, 'message', uploads.length > 0);
		const message = await this.serialize(botId, async () => {
			if (this.deleting.has(botId))
				throw new BotError('conflict', 'This bot is being deleted.');
			this.bots.get(botId);
			this.importMessages(botId);
			const safe = await this.redactMessage(botId, body),
				safeKey = await this.redactMessage(botId, key);
			return this.messages.post(
				botId,
				'user',
				safe,
				null,
				safeKey,
				[],
				uploads,
			);
		});
		if (message.dispatch?.state === 'started' && message.dispatch.executionId)
			return { message, sessionId: message.dispatch.executionId };
		if (message.dispatch?.state === 'failed')
			return { message, error: message.dispatch.error };
		let work = this.messageDispatches.get(message.id);
		if (!work) {
			work = this.dispatchExecution(botId, message.text, undefined, {
				kind: 'chat',
				messageId: message.id,
			});
			this.messageDispatches.set(message.id, work);
		}
		try {
			const sent = await work;
			this.messages.setDispatch(botId, message.id, {
				state: 'started',
				executionId: sent.sessionId,
			});
			return { message: this.messages.get(botId, message.id), ...sent };
		} catch (failure) {
			const error =
				failure instanceof BotError &&
				failure.message === BOT_CLEANUP_UNCONFIRMED
					? BOT_CLEANUP_UNCONFIRMED
					: this.bots.get(botId).signIn.kind === 'none'
						? 'This bot is not signed in. Choose how it signs in under Configure › Profile › Sign-in.'
						: 'The execution could not start. Check sign-in and the container engine, then send a new message.';
			try {
				this.messages.setDispatch(botId, message.id, {
					state: 'failed',
					executionId: null,
					error,
				});
			} catch {
				throw new BotError(
					'conflict',
					'The message log changed before this post could start',
				);
			}
			return { message: this.messages.get(botId, message.id), error };
		} finally {
			if (this.messageDispatches.get(message.id) === work)
				this.messageDispatches.delete(message.id);
		}
	}
	async postBotMessage(
		executionId: string,
		body: string,
		key: string,
		captured: readonly { name: string; bytes: Uint8Array }[] = [],
	): Promise<BotMessage> {
		this.runtime.assertPosting(executionId);
		const record = this.sessions.get(executionId);
		const safe = await this.redactMessage(record.botId, body),
			safeKey = await this.redactMessage(record.botId, key);
		const files = await Promise.all(
			captured.map(async (file) => ({
				...file,
				name: await this.redactMessage(record.botId, file.name),
			})),
		);
		this.runtime.assertPosting(executionId);
		try {
			const attachments = files.map((file) =>
				this.messages.putAttachment(record.botId, file.name, file.bytes),
			);
			return this.messages.post(
				record.botId,
				'bot',
				safe,
				executionId,
				safeKey,
				attachments,
			);
		} catch (error) {
			this.messages.pruneAttachments(record.botId);
			throw error;
		}
	}

	async clearMessages(botId: string): Promise<void> {
		await this.serialize(botId, async () => {
			this.bots.get(botId);
			for (const r of this.sessions.list(botId))
				if (['queued', 'running', 'needs-you'].includes(r.state))
					this.runtime.revoke(r.id);
			await this.stopBot(botId);
			this.messages.clear(botId);
		});
	}
	async send(
		botId: string,
		prompt: string,
		id?: string,
		origin: BotSessionOrigin = { kind: 'chat' },
		accept: () => boolean = () => true,
		reservedId?: string,
	): Promise<{ sessionId: string; queueId: string }> {
		if (origin.kind === 'chat' && !origin.messageId) {
			if (id) this.ownedSession(botId, id);
			const result = await this.postUserMessage(
				botId,
				prompt,
				randomBytes(12).toString('hex'),
			);
			if (!result.sessionId)
				throw new BotError(
					'unavailable',
					result.error ?? 'Execution did not start',
				);
			return {
				sessionId: result.sessionId,
				queueId: result.queueId ?? result.sessionId,
			};
		}
		return this.dispatchExecution(
			botId,
			prompt,
			id,
			origin,
			accept,
			reservedId,
		);
	}
	private async dispatchExecution(
		botId: string,
		prompt: string,
		id?: string,
		origin: BotSessionOrigin = { kind: 'chat' },
		accept: () => boolean = () => true,
		reservedId?: string,
	): Promise<{ sessionId: string; queueId: string }> {
		if (!this.initialized) await this.reconcile();
		if (!this.initialized)
			throw new BotBlockedError(
				'engine',
				'bot restart reconciliation is not complete',
			);
		this.assertEnabled(botId);
		// An image-only chat message has empty text; its images are the content.
		text(
			prompt,
			(origin.kind === 'chat' ? 64 : 80) * 1024,
			'message',
			origin.kind === 'chat' && !!origin.messageId,
		);
		return this.serialize(botId, async () => {
			if (this.deleting.has(botId))
				throw new BotError('conflict', 'This bot is being deleted.');
			if (this.stoppingBots.has(botId))
				throw new BotError('busy', 'bot is stopping');
			this.assertEnabled(botId);
			await this.retryCleanup(botId);
			this.queue.unblock(botId);
			const bot = this.bots.get(botId);
			if (origin.kind === 'chat' && origin.messageId)
				this.messages.get(botId, origin.messageId);
			this.requireSignIn(bot.signIn);
			if (id) this.ownedSession(botId, id);
			let record: BotSessionRecord | undefined;
			if (reservedId) {
				const existing = this.sessions
					.list(botId)
					.find((r) => r.id === reservedId);
				if (existing) {
					if (
						existing.state !== 'queued' ||
						[...this.queue.list(botId), ...this.queue.active(botId)].some(
							(i) => i.sessionId === reservedId,
						)
					)
						return {
							sessionId: existing.id,
							queueId: existing.queuedMessage?.id ?? existing.id,
						};
					record = existing;
				}
			}
			const waiting = this.queue.list(botId);
			if (
				waiting.length >= 20 ||
				waiting.some((i) =>
					origin.kind === 'chat' ? i.sessionId === id : false,
				)
			)
				throw new BotError(
					'busy',
					'bot queue is full or this work is already queued',
				);
			if (!record) {
				const agent = this.agent(bot.agentId);
				const snapshot: BotSessionSnapshot = {
					agentId: bot.agentId,
					modelId: bot.modelId,
					signIn: structuredClone(bot.signIn),
					approvalMode: agent.autonomousOnly ? 'autonomous' : bot.approvalMode,
					instructions: bot.instructions,
					context: await this.memories.context(bot),
					maxTurnMs: bot.maxTurnMs,
				};
				const lease = await this.hooks.credentials.acquire(botId, snapshot);
				try {
					record = this.sessions.create(
						botId,
						origin,
						{
							...snapshot,
							instructions: lease.redact(snapshot.instructions),
							context: lease.redact(snapshot.context),
						},
						reservedId,
					);
				} finally {
					lease.release();
				}
			}
			// Queued content is redacted before persistence too. The lease closes at once;
			// the process acquires its own lease when this item takes the turn lease.
			const credential = await this.hooks.credentials.acquire(
				botId,
				record.snapshot,
			);
			let safe: string;
			try {
				safe = credential.redact(prompt);
			} finally {
				credential.release();
			}
			if (this.deleting.has(botId))
				throw new BotError('conflict', 'This bot is being deleted.');
			const queued = this.queue.list(botId);
			if (
				queued.length >= 20 ||
				queued.some((i) =>
					origin.kind === 'chat' ? i.sessionId === record!.id : false,
				)
			)
				throw new BotError(
					'busy',
					'bot queue is full or this work is already queued',
				);
			if (!accept() || this.bots.get(botId).enabled === false) {
				if (origin.kind !== 'chat')
					this.sessions.patch(record.id, {
						state: 'stopped',
						open: false,
						firing: 'skipped',
						reason: 'cancelled',
					});
				throw new BotError('conflict', 'firing cancelled');
			}
			this.runtime.register(record.id);
			const queueId = randomBytes(12).toString('hex');
			this.sessions.patch(record.id, {
				queuedMessage: { id: queueId, text: safe, status: 'queued' },
			});
			const item = this.queue.enqueue(
				{ id: queueId, botId, sessionId: record.id, origin, prompt: safe },
				this.now(),
			);

			return { sessionId: record.id, queueId: item.id };
		});
	}
	async reviseMessage(..._args: unknown[]): Promise<{ sessionId: string }> {
		throw new BotError(
			'validation',
			'Edit the shared message log instead of an execution transcript',
		);
	}
	async clearChat(..._args: unknown[]): Promise<void> {
		throw new BotError(
			'validation',
			'Clear the shared message log instead of an execution transcript',
		);
	}
	async newChat(botId: string): Promise<void> {
		this.bots.get(botId);
		throw new BotError(
			'validation',
			'Bots use one shared message log; send a message to start a fresh execution',
		);
	}
	continue(botId: string, id: string): void {
		this.ownedSession(botId, id);
		throw new BotError(
			'unavailable',
			'Executions are immutable diagnostics; send a new message instead',
		);
	}
	private ownedSession(botId: string, id: string): BotSessionRecord {
		const record = this.sessions.get(id);
		if (record.botId !== botId)
			throw new BotError('not_found', 'session not found');
		return record;
	}
	async stop(botId: string, id: string): Promise<void> {
		this.ownedSession(botId, id);
		this.runtime.revoke(id);
		for (const item of this.queue.list(botId))
			if (item.sessionId === id) this.queue.cancel(botId, item.id);
		await this.closeLive(id, 'stop');
		this.runtime.release(id);
	}
	async end(botId: string, id: string): Promise<void> {
		this.ownedSession(botId, id);
		for (const item of this.queue.list(botId))
			if (item.sessionId === id) this.queue.cancel(botId, item.id);
		await this.closeLive(id, 'end');
		this.sessions.patch(id, {
			open: false,
			state: 'completed',
			endedAt: this.now(),
		});
		this.sessions.retain(botId);
		if (this.currentChats.get(botId) === id) this.currentChats.delete(botId);
	}
	decide(
		botId: string,
		id: string,
		permissionId: string,
		optionId: string,
	): void {
		this.ownedSession(botId, id);
		const live = this.live.get(id);
		if (!live?.client)
			throw new BotError('conflict', 'permission request is no longer active');
		live.client.answer(permissionId, optionId);
	}
	async stopBot(botId: string): Promise<void> {
		this.stoppingBots.add(botId);
		try {
			if (this.bots.get(botId).enabled === false) this.queue.pause(botId);
			else await this.queue.block(botId);
			for (const record of this.sessions.list(botId))
				if (
					this.live.has(record.id) ||
					['running', 'needs-you'].includes(record.state)
				)
					await this.closeLive(record.id, 'bot-stop');
		} finally {
			this.stoppingBots.delete(botId);
		}
	}
	/**
	 * A bot blocked by unconfirmed process cleanup retries ending only those
	 * sessions' process groups before new work, so it recovers without a
	 * server restart. Other running executions are never ended.
	 */
	private async retryCleanup(botId: string): Promise<void> {
		if (!this.queue.blocked(botId)) return;
		for (const sessionId of this.queue.uncleaned(botId)) {
			try {
				await (await this.hooks.driver()).exec(
					`terminay-bot-${botId}`,
					['terminay-run', '--kill', sessionId],
					{ user: 'root', deadlineMs: BOT_KILL_DEADLINE_MS },
				);
			} catch {
				throw new BotBlockedError('engine', BOT_CLEANUP_UNCONFIRMED);
			}
			this.queue.cleaned(botId, sessionId);
			this.sessions.runner(sessionId, 'Session cleanup confirmed on retry.\n');
		}
	}
	private async suspend(id: string): Promise<void> {
		if (this.live.has(id)) await this.closeLive(id, 'suspend');
	}
	private requireSignIn(signIn: BotProfile['signIn']): void {
		if (signIn.kind === 'none')
			throw new BotBlockedError(
				'agent',
				'This bot is not signed in. Choose how it signs in under Configure › Profile › Sign-in.',
			);
	}
	/**
	 * A device login lives only in the bot's home volume, so it is gone if
	 * that volume is removed. Run the agent's own status check as `bot`; when
	 * it reports no login, record the bot as Not signed in and refuse, rather
	 * than let the agent fail on a missing credential. An engine failure is
	 * not evidence either way and leaves the sign-in unchanged.
	 */
	private async requireDeviceLogin(
		driver: EngineDriver,
		botId: string,
		agent: BotAgentContribution,
	): Promise<void> {
		const status = agent.deviceSignIn?.statusCommand;
		if (!status) return;
		const output = await driver.exec(
			`terminay-bot-${botId}`,
			[
				'sh',
				'-c',
				'"$@" >/dev/null 2>&1; echo "terminay-status=$?"',
				'sh',
				status.executable,
				...status.args,
			],
			{
				user: 'bot',
				env: { HOME: '/home/bot' },
				environmentNames: ['HOME'],
				deadlineMs: 30_000,
				maxBytes: 4096,
			},
		);
		const code = /terminay-status=(\d+)/.exec(output)?.[1];
		if (code === undefined || code === '0') return;
		await this.setDeviceSignIn(botId, false);
		throw new BotBlockedError(
			'agent',
			`This bot's ${agent.deviceSignIn?.label ?? 'device sign-in'} login is no longer in its home. Sign it in again under Configure › Profile › Sign-in.`,
		);
	}
	private run(item: BotQueuedTurn): Promise<BotRunResult> {
		const task = this.runNow(item);
		this.activeRuns.set(item.sessionId, { botId: item.botId, task });
		void task
			.finally(() => this.activeRuns.delete(item.sessionId))
			.catch(() => undefined);
		return task;
	}
	private async runNow(item: BotQueuedTurn): Promise<BotRunResult> {
		const record = this.sessions.get(item.sessionId);
		let live = this.live.get(record.id);
		let bridge: BotRuntimeBridge | undefined;
		let pendingCredential: BotCredentialLease | undefined;
		this.sessions.patch(record.id, {
			state: 'running',
			queuedMessage: null,
			firing: record.firing === 'pending' ? 'sent' : record.firing,
			permission: null,
			permissions: [],
			reason: null,
		});
		this.runtime.changed(record.id, 'execution.running');
		let failureReason = 'agent not ready';
		let cleanupFailure: BotCleanupError | undefined;
		this.starting.add(record.id);
		// The trigger message's images, as snapshotted at dispatch.
		let images: { mime: string; bytes: Uint8Array }[] = [];
		let imagePaths: string[] = [];
		let imageDriver: EngineDriver | undefined;
		try {
			this.requireSignIn(this.bots.get(record.botId).signIn);
			const snapshot = record.runtime?.triggerAttachments ?? [];
			try {
				images = snapshot.map((a) =>
					this.messages.attachment(record.botId, a.id),
				);
			} catch {
				throw new BotError(
					'not_found',
					'An attached image is no longer available; send it again.',
				);
			}
			if (!live) {
				const agent = this.agent(record.snapshot.agentId);
				failureReason = 'container engine unavailable';
				let driver: EngineDriver | undefined = await this.hooks.driver();
				const sessionEnvironment = await this.hooks.environment.prepareSession(
					record.botId,
				);
				if (this.cancelledStarts.delete(record.id)) return { cleanup: 'ok' };
				driver ??= await this.hooks.driver();
				failureReason = 'agent not ready';
				const status = await this.hooks.agents.botAgentStatus(agent.id);
				if (!status.available)
					throw new BotBlockedError(
						'agent',
						'The bot agent is not ready. Check its sign-in and rebuild the bot image.',
					);
				const configFiles = botAgentConfigFiles(
					agent,
					record.snapshot.signIn.kind === 'device',
				);
				if (configFiles.length)
					await driver.exec(
						`terminay-bot-${record.botId}`,
						['terminay-init', '--config'],
						{
							user: 'root',
							input: JSON.stringify(
								configFiles.map((f) => ({
									path: f.path,
									content: f.contents,
								})),
							),
						},
					);
				if (record.snapshot.signIn.kind === 'device')
					await this.requireDeviceLogin(driver, record.botId, agent);
				if (images.length) {
					failureReason =
						'The attached images could not be copied into the bot container.';
					imageDriver = driver;
					imagePaths = await writeExecutionImages(
						driver,
						this.hooks.serverId ?? 'server',
						record.botId,
						record.id,
						images,
					);
				}
				const credential = await this.hooks.credentials.acquire(
					record.botId,
					record.snapshot,
				);
				pendingCredential = credential;
				if (this.cancelledStarts.delete(record.id)) {
					credential.release();
					pendingCredential = undefined;
					return { cleanup: 'ok' };
				}
				failureReason =
					'The terminay_bot MCP relay could not start. See Runner output for details.';
				bridge = await openBotRuntimeBridge(
					driver,
					record.botId,
					record.id,
					this.runtime,
					(value) =>
						this.sessions.runner(
							record.id,
							`Bot MCP: ${credential.redact(value)}\n`,
						),
					this.terminayMcpOpener(record.botId, record.id),
				);
				if (this.cancelledStarts.delete(record.id)) {
					await bridge.close();
					credential.release();
					pendingCredential = undefined;
					return { cleanup: 'ok' };
				}
				failureReason =
					'The agent process failed. See Runner output for details.';
				const runner = (this.hooks.process ?? ((o) => new BotAgentProcess(o)))({
					driver,
					botId: record.botId,
					sessionId: record.id,
					snapshot: record.snapshot,
					images: imagePaths,
					agent,
					sessionEnvironment: { ...sessionEnvironment, ...bridge.environment },
					credential: bridge.wrapCredential(credential),
					mcpServers: bridge.servers,
					cleanupRuntime: () => bridge!.close(),
					loadId: record.acpSessionId,
					launch: async (modelId) => {
						const launch = await this.hooks.agents.botAgentLaunch(agent.id, {
							modelId,
						});
						if (!launch.available)
							throw new BotError('unavailable', 'agent launch unavailable');
						return launch.value;
					},
					onClient: (client) => this.bindClient(record.id, client),
				});
				live = {
					runner,
					closing: false,
					turn: true,
					terminay: bridge.servers.some(
						(server) =>
							typeof server === 'object' &&
							server !== null &&
							!Array.isArray(server) &&
							server.name === 'terminay',
					),
				};
				pendingCredential = undefined;
				this.live.set(record.id, live);
				const client = await runner.open();
				live.client = client;
				this.sessions.patch(record.id, {
					acpSessionId: client.session,
					runtimeDriver: agent.nativeDriver,
					runtimeVersion: agent.runtimeVersion,
					canLoad: client.canLoad,
				});
			}
			if (live.closing) {
				await live.stop;
				return { cleanup: 'ok' };
			}
			live.turn = true;
			live.timer = setTimeout(() => {
				void this.closeLive(record.id, 'timeout').catch(() =>
					this.emit('cleanup-failed', { botId: record.botId }),
				);
			}, record.snapshot.maxTurnMs);
			this.sessions.append(record.id, { kind: 'user', text: item.prompt });
			const first = record.acpSessionId === null;
			await live.runner.client.prompt(
				`${first ? `${record.snapshot.context}\n\n` : ''}${this.runtime.briefing(record.id, live.terminay)}\n\n${record.origin.kind === 'chat' ? '' : item.prompt}`,
				record.snapshot.maxTurnMs,
				first ? images : [],
			);
			if (!live.closing) bridge?.assertConnected();
			if (!live.closing)
				this.sessions.patch(record.id, {
					state: 'completed',
					durationMs: Math.max(0, this.now() - record.startedAt),
					permission: null,
					permissions: [],
					...(item.origin.kind === 'chat'
						? { open: false, endedAt: this.now() }
						: { open: false, endedAt: this.now() }),
				});
		} catch (error) {
			if (!live?.closing) {
				const cause = error instanceof Error ? error.message : failureReason;
				const detail = await this.redactMessage(
					record.botId,
					cause.slice(0, 8192),
				).catch(
					() =>
						'Startup diagnostics unavailable: sign-in could not be read safely.',
				);
				// The agent's stderr (with any EAGAIN) is in the runner output tail.
				const processFailure = await classifyProcessFailure(
					`${cause}\n${this.sessions.get(record.id).runnerOutput.slice(-8192)}`,
					async () =>
						botProcessCount(
							await this.hooks.driver(),
							`terminay-bot-${record.botId}`,
						),
				).catch(() => null);
				const reason = await this.redactMessage(
					record.botId,
					processFailure?.reason ?? botFailure(error)?.message ?? failureReason,
				).catch(() => failureReason);
				this.sessions.runner(
					record.id,
					`\nBot execution failed: ${reason}\n${detail}\n`,
				);
				this.sessions.patch(record.id, {
					state: 'failed',
					reason,
					cause: processFailure ? processFailure.cause : botFailureCause(error),
					endedAt: this.now(),
					permission: null,
					permissions: [],
				});
				if (live) await this.closeLive(record.id, 'failure');
			}
		} finally {
			this.starting.delete(record.id);
			if (!live) {
				try {
					await bridge?.close();
				} finally {
					pendingCredential?.release();
				}
			}
			if (live?.timer) clearTimeout(live.timer);
			if (live) live.turn = false;
			try {
				if (live?.closing) await live.stop;
				else if (live) await this.closeLive(record.id, 'end');
			} catch (error) {
				// Only an unconfirmed agent process group counts; anything else
				// still escapes and blocks the bot at once.
				// biome-ignore lint/correctness/noUnsafeFinally: an unexpected finish failure must reach the queue, as it did before.
				if (!(error instanceof BotCleanupError)) throw error;
				cleanupFailure = error;
			}
			if (imageDriver)
				await removeExecutionImages(imageDriver, record.botId, record.id);
			this.runtime.revoke(record.id);
			this.runtime.release(record.id);
			this.runtime.changed(record.id, 'execution.finished');
			this.sessions.commit(record.id);
			this.sessions.retain(record.botId);
		}
		return cleanupFailure === undefined
			? { cleanup: 'ok' }
			: { cleanup: 'failed', error: cleanupFailure };
	}
	/** Records a failure to finish an execution without rewriting the turn's outcome unless it blocks the bot. */
	private async recordFinishFailure(
		item: BotQueuedTurn,
		failure: BotQueueFailure,
	): Promise<void> {
		const raw =
			failure.error instanceof Error
				? failure.error.message
				: String(failure.error);
		const detail = await this.redactMessage(
			item.botId,
			raw.slice(0, 8192),
		).catch(() => 'cleanup error unavailable');
		console.error(
			`[terminay] bot cleanup failed: bot=${item.botId} session=${item.sessionId}: ${detail}`,
		);
		this.sessions.runner(item.sessionId, `\nCleanup failed: ${detail}\n`);
		if (failure.blocked)
			this.sessions.patch(item.sessionId, {
				state: 'failed',
				reason: failure.cleanup
					? `bot blocked after ${BOT_CLEANUP_FAILURE_LIMIT} consecutive cleanup failures`
					: 'session cleanup failed; bot remains blocked',
				cause: 'engine',
			});
		this.sessions.commit(item.sessionId);
	}
	private bindClient(id: string, client: BotNativeClient): void {
		client.on('update', (update: JsonValue) =>
			this.sessions.append(id, update),
		);
		client.on('runner', (chunk: string) => this.sessions.runner(id, chunk));
		client.on('permission-request', (permission) => {
			this.sessions.append(id, {
				kind: 'permission-request',
				permission: permission as unknown as JsonValue,
			});
			this.sessions.commit(id);
		});
		client.on('permission', () =>
			this.sessions.patch(id, {
				state: 'needs-you',
				permission: client.permissions[0] ?? null,
				permissions: client.permissions,
			}),
		);
		client.on('permission-answered', () => {
			const live = this.live.get(id);
			if (!live?.turn || live.closing) return;
			const permissions = client.permissions;
			this.sessions.patch(id, {
				state: permissions.length ? 'needs-you' : 'running',
				permission: permissions[0] ?? null,
				permissions,
			});
		});
		const failed = () => {
			const live = this.live.get(id);
			if (live && !live.closing && !live.turn)
				void this.closeLive(id, 'failure').catch(() =>
					this.emit('cleanup-failed', { botId: this.sessions.get(id).botId }),
				);
		};
		client.on('failure', failed);
		client.on('closed', failed);
	}
	private closeLive(
		id: string,
		reason: 'stop' | 'end' | 'suspend' | 'timeout' | 'bot-stop' | 'failure',
	): Promise<void> {
		try {
			this.runtime.revoke(id);
		} catch {
			this.emit('cleanup-failed', { botId: this.sessions.get(id).botId });
		}
		const live = this.live.get(id);
		if (!live) {
			const record = this.sessions.get(id);
			if (
				['running', 'needs-you'].includes(record.state) &&
				!this.starting.has(id)
			) {
				// Running in the record but not in this process: a turn the last
				// process left behind when it died, before reconcile reached it.
				this.sessions.patch(id, {
					state: 'interrupted',
					open: false,
					permission: null,
					permissions: [],
					endedAt: this.now(),
				});
				return Promise.resolve();
			}
			if (['running', 'needs-you'].includes(record.state)) {
				this.cancelledStarts.add(id);
				this.sessions.patch(id, {
					state: reason === 'timeout' ? 'timed-out' : 'stopped',
					open: false,
					permission: null,
					permissions: [],
					endedAt: this.now(),
				});
			}
			return Promise.resolve();
		}
		if (live.stop) return live.stop;
		live.closing = true;
		if (live.timer) clearTimeout(live.timer);
		live.stop = (async () => {
			let cleanup: unknown;
			try {
				await live.runner.close(reason === 'failure' ? 'end' : reason);
			} catch (error) {
				// The session is still recorded and its work ownership released;
				// the caller counts the failure.
				cleanup = error;
			}
			this.runtime.release(id);
			this.live.delete(id);
			const record = this.sessions.get(id);
			const state =
				reason === 'suspend'
					? 'suspended'
					: reason === 'timeout'
						? 'timed-out'
						: reason === 'failure'
							? 'failed'
							: reason === 'end'
								? 'completed'
								: 'stopped';
			const open = false;
			this.sessions.patch(id, {
				state,
				permission: null,
				permissions: [],
				open,
				endedAt: open ? null : this.now(),
				durationMs: Math.max(0, this.now() - record.startedAt),
			});
			if (cleanup !== undefined) throw cleanup;
		})();
		return live.stop;
	}
	/** Startup never adopts an ACP stream or a permission from the previous server. */
	async reconcile(): Promise<void> {
		if (this.reconciling) return this.reconciling;
		const work = this.reconcileNow();
		this.reconciling = work;
		try {
			await work;
		} finally {
			this.reconciling = undefined;
		}
	}
	private async reconcileNow(): Promise<void> {
		for (const bot of this.bots.list()) this.register(bot);
		this.initialized = false;
		let driver: EngineDriver | undefined;
		try {
			// The driver first: it checks the engine, so the environments below
			// read their containers' real state, and a running one gets its
			// leftover agent processes ended.
			driver = await this.hooks.driver();
			await this.hooks.environment.reconcileAll();
		} catch {
			/* Records still reconcile while the engine is unavailable. */
			driver = undefined;
		}
		let cleaned = !!driver;
		for (const bot of this.bots.list()) {
			for (const r of this.sessions.list(bot.id)) {
				if (
					r.state === 'queued' &&
					r.origin.kind !== 'chat' &&
					this.triggers.observations
						.pending(bot.id)
						.some((e) => e.sessionId === r.id)
				)
					continue;
				const interrupted = ['running', 'suspended', 'needs-you'].includes(
					r.state,
				);
				this.sessions.patch(r.id, {
					...(interrupted
						? { state: 'interrupted', open: false, endedAt: this.now() }
						: {}),
					permission: null,
					permissions: [],
					queuedMessage: r.queuedMessage
						? { ...r.queuedMessage, status: 'not-sent' }
						: null,
					...(r.state === 'queued'
						? { state: 'stopped', open: false, reason: 'server restarted' }
						: {}),
					...(r.firing === 'pending'
						? { firing: 'skipped', reason: 'server restarted' }
						: {}),
				});
			}
			if (driver) {
				try {
					if (this.hooks.environment.state(bot.id) === 'running')
						await driver.exec(
							`terminay-bot-${bot.id}`,
							['terminay-run', '--kill-all'],
							{ user: 'root', deadlineMs: BOT_KILL_DEADLINE_MS },
						);
					this.hooks.activity(bot.id, 0, 0);
					this.queue.unblock(bot.id, true);
					if (bot.enabled === false) this.queue.pause(bot.id);
				} catch {
					cleaned = false;
				}
			}
			this.sessions.retain(bot.id);
		}
		if (driver) {
			try {
				await this.hooks.removeHelpers();
			} catch {
				cleaned = false;
			}
		}
		for (const bot of this.bots.list())
			for (const message of this.messages.pending(bot.id)) {
				const execution = this.sessions
					.list(bot.id)
					.find(
						(record) =>
							record.origin.kind === 'chat' &&
							record.origin.messageId === message.id,
					);
				this.messages.setDispatch(
					bot.id,
					message.id,
					execution
						? { state: 'started', executionId: execution.id }
						: {
								state: 'failed',
								executionId: null,
								error:
									'Server restarted before this message started. Send a new message to retry.',
							},
				);
			}
		this.initialized = cleaned;
		if (cleaned)
			void this.failureFollowUps.reconcile(this.bots.list().map((b) => b.id));
	}

	async shutdown(): Promise<void> {
		this.failureFollowUps.stop();
		this.triggers.stop();
		await this.triggers.idle();
		this.initialized = false;
		for (const bot of this.bots.list()) await this.stopBot(bot.id);
		this.connections.close();
		this.sessions.close();
		for (const detach of this.detach) detach();
		await this.hooks.dispose?.();
	}
	private serialize<T>(botId: string, work: () => Promise<T>): Promise<T> {
		const next = (this.mutations.get(botId) ?? Promise.resolve())
			.catch(() => undefined)
			.then(work);
		this.mutations.set(botId, next);
		void next
			.finally(() => {
				if (this.mutations.get(botId) === next) this.mutations.delete(botId);
			})
			.catch(() => undefined);
		return next;
	}
}
