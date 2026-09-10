import type {
	LanguageDiagnosticDto,
	LanguagePosition,
	LanguageSessionState,
} from '@terminay/protocol';
import type { ExtensionLanguageInvocation } from '../extensions/host.js';
import type {
	ExtensionLanguageDiagnosticsNotification,
	ExtensionLanguageSessionExit,
} from '../extensions/languageProtocol.js';
import type { LanguageServerProvider } from '../extensions/manager.js';
import type { ExtensionHostStatus } from '../extensions/types.js';

/**
 * What the session manager needs from the extension platform.
 *
 * `ExtensionHostManager` satisfies it structurally; tests supply a double so a
 * session lifetime can be exercised without a real child process.
 */
export interface LanguageExtensionBridge {
	languageServersFor(selector: string): readonly LanguageServerProvider[];
	invokeLanguage(
		extensionId: string,
		invocation: ExtensionLanguageInvocation,
	): Promise<unknown>;
	onLanguageDiagnostics(
		listener: (
			notification: ExtensionLanguageDiagnosticsNotification & {
				readonly extensionId: string;
			},
		) => void,
	): () => void;
	onLanguageSessionExit(
		listener: (
			exit: ExtensionLanguageSessionExit & { readonly extensionId: string },
		) => void,
	): () => void;
	onHostStateChanged(listener: (status: ExtensionHostStatus) => void): () => void;
}

export interface LanguageDiagnosticsFanoutEvent {
	readonly projectId: string;
	readonly languageServerId: string;
	readonly path: string;
	readonly revision?: number;
	readonly diagnostics: readonly LanguageDiagnosticDto[];
	readonly isTruncated: boolean;
}

export interface LanguageSessionManagerOptions {
	readonly extensions: LanguageExtensionBridge;
	/** Canonical absolute root of one project on this server. */
	readonly projectRoot: (projectId: string) => Promise<string>;
	readonly onDiagnostics?: (event: LanguageDiagnosticsFanoutEvent) => void;
	/** Concurrent language sessions this server will run. */
	readonly maxSessions?: number;
	/** Idle period with no open document and no request before a reap. */
	readonly idleMs?: number;
	/** How long a failed session refuses to be started again. */
	readonly failureCooldownMs?: number;
	readonly requestDeadlineMs?: number;
	readonly now?: () => number;
	readonly schedule?: (
		callback: () => void,
		milliseconds: number,
	) => ReturnType<typeof setTimeout>;
	readonly cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
}

/**
 * Why a session cannot serve, in the small fixed vocabulary a client sees.
 *
 * Deliberately a closed set: the underlying failure text can name host paths,
 * argv, and environment, none of which belongs on the wire. The detail stays
 * server-side on the record for logs and diagnostics.
 */
export type LanguageUnavailableReason =
	| 'launch-failed'
	| 'crashed'
	| 'stopped'
	| 'capacity';

export interface LanguageSessionDescription {
	readonly state: LanguageSessionState;
	readonly languageServerId?: string;
	readonly languageId?: string;
	readonly reason?: LanguageUnavailableReason;
}

const DEFAULT_MAX_SESSIONS = 8;
const DEFAULT_IDLE_MS = 5 * 60_000;
const DEFAULT_FAILURE_COOLDOWN_MS = 30_000;
const DEFAULT_REQUEST_DEADLINE_MS = 10_000;

interface SessionRecord {
	readonly key: string;
	readonly projectId: string;
	readonly provider: LanguageServerProvider;
	readonly sessionId: string;
	state: LanguageSessionState;
	reason?: LanguageUnavailableReason;
	/** The unbounded failure text, kept server-side for logs and diagnostics. */
	detail?: string;
	starting?: Promise<void>;
	readonly openDocuments: Map<string, number>;
	inFlight: number;
	lastActivity: number;
	retryAfter: number;
	idleTimer?: ReturnType<typeof setTimeout>;
}

/**
 * One language session per project and language server, shared by every client.
 *
 * A session starts on the first request that needs it, is reaped after a
 * bounded idle period with nothing open and nothing asked, and ends whenever
 * its extension stops, fails, or is quarantined. Beyond the per-server cap a
 * request returns a typed unavailable outcome instead of starting one more.
 */
export class LanguageSessionManager {
	private readonly sessions = new Map<string, SessionRecord>();
	private readonly bySessionId = new Map<string, SessionRecord>();
	private readonly unsubscribes: Array<() => void> = [];
	private readonly maxSessions: number;
	private readonly idleMs: number;
	private readonly failureCooldownMs: number;
	private readonly requestDeadlineMs: number;
	private readonly now: () => number;
	private readonly schedule: (
		callback: () => void,
		milliseconds: number,
	) => ReturnType<typeof setTimeout>;
	private readonly cancelSchedule: (
		timer: ReturnType<typeof setTimeout>,
	) => void;
	private sequence = 0;

	constructor(private readonly options: LanguageSessionManagerOptions) {
		this.maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
		this.idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
		this.failureCooldownMs =
			options.failureCooldownMs ?? DEFAULT_FAILURE_COOLDOWN_MS;
		this.requestDeadlineMs =
			options.requestDeadlineMs ?? DEFAULT_REQUEST_DEADLINE_MS;
		this.now = options.now ?? Date.now;
		this.schedule =
			options.schedule ??
			((callback, milliseconds) => {
				const timer = setTimeout(callback, milliseconds);
				timer.unref?.();
				return timer;
			});
		this.cancelSchedule = options.cancelSchedule ?? ((timer) => clearTimeout(timer));
		this.unsubscribes.push(
			options.extensions.onLanguageDiagnostics((notification) =>
				this.publishDiagnostics(notification),
			),
			options.extensions.onLanguageSessionExit((exit) =>
				this.failSession(
					exit.sessionId,
					exit.reason === 'stopped'
						? 'stopped'
						: exit.reason === 'start-failed'
							? 'launch-failed'
							: 'crashed',
					exit.failure ??
						(exit.reason === 'start-failed'
							? 'language server failed to start'
							: 'language server exited'),
					exit.reason !== 'stopped',
				),
			),
			options.extensions.onHostStateChanged((status) => {
				if (status.state === 'running' || status.state === 'starting') return;
				void this.stopExtension(status.extensionId);
			}),
		);
	}

	/** The language server that serves this project-relative path, if any. */
	providerFor(path: string): LanguageServerProvider | undefined {
		const extension = fileExtension(path);
		if (extension === undefined) return undefined;
		return this.options.extensions.languageServersFor(extension)[0];
	}

	/**
	 * What a client can expect for this file right now, starting the session if
	 * one is needed. Absence of a provider is a state, never an error.
	 */
	describe(projectId: string, path: string): LanguageSessionDescription {
		const provider = this.providerFor(path);
		if (provider === undefined) return { state: 'none' };
		const record = this.sessions.get(sessionKey(projectId, provider));
		const languageId =
			provider.contribution.languageIds?.[0] ?? fileExtension(path)?.slice(1);
		const base = {
			languageServerId: provider.languageServerId,
			...(languageId === undefined ? {} : { languageId }),
		};
		if (record === undefined) {
			void this.session(projectId, provider).catch(() => undefined);
			return { ...base, state: 'starting' };
		}
		return {
			...base,
			state: record.state,
			...(record.reason === undefined ? {} : { reason: record.reason }),
		};
	}

	async openDocument(
		projectId: string,
		path: string,
		languageId: string,
		text: string,
		revision: number,
	): Promise<void> {
		const record = await this.readySession(projectId, path);
		await this.invoke(record, 'language.document.open', {
			sessionId: record.sessionId,
			path,
			languageId,
			text,
			revision,
		});
		record.openDocuments.set(path, revision);
	}

	async changeDocument(
		projectId: string,
		path: string,
		text: string,
		revision: number,
	): Promise<void> {
		const record = await this.readySession(projectId, path);
		if (!record.openDocuments.has(path)) {
			await this.openDocument(
				projectId,
				path,
				record.provider.contribution.languageIds?.[0] ?? 'plaintext',
				text,
				revision,
			);
			return;
		}
		await this.invoke(record, 'language.document.change', {
			sessionId: record.sessionId,
			path,
			text,
			revision,
		});
		record.openDocuments.set(path, revision);
	}

	async closeDocument(projectId: string, path: string): Promise<void> {
		const provider = this.providerFor(path);
		if (provider === undefined) return;
		const record = this.sessions.get(sessionKey(projectId, provider));
		if (record === undefined || record.state !== 'ready') return;
		record.openDocuments.delete(path);
		await this.invoke(record, 'language.document.close', {
			sessionId: record.sessionId,
			path,
		}).catch(() => undefined);
	}

	async positionRequest(
		projectId: string,
		path: string,
		method: 'language.completion' | 'language.hover' | 'language.definition',
		position: LanguagePosition,
		options: { readonly signal?: AbortSignal; readonly deadlineMs?: number } = {},
	): Promise<unknown> {
		const record = await this.readySession(projectId, path);
		return this.invoke(
			record,
			method,
			{ sessionId: record.sessionId, path, position },
			options,
		);
	}

	/** Tell every session of this project that files changed on disk. */
	notifyWatchedFiles(
		projectId: string,
		changes: readonly {
			readonly path: string;
			readonly kind: 'created' | 'changed' | 'deleted';
		}[],
	): void {
		if (changes.length === 0) return;
		for (const record of this.sessions.values()) {
			if (record.projectId !== projectId || record.state !== 'ready') continue;
			void this.invoke(record, 'language.watched-files.changed', {
				sessionId: record.sessionId,
				changes: changes.slice(0, 256),
			}).catch(() => undefined);
		}
	}

	async stopExtension(extensionId: string): Promise<void> {
		for (const record of [...this.sessions.values()])
			if (record.provider.extensionId === extensionId)
				await this.stopSession(record, 'extension stopped');
	}

	async shutdown(): Promise<void> {
		for (const unsubscribe of this.unsubscribes.splice(0))
			try {
				unsubscribe();
			} catch {
				/* an observer teardown cannot fail a shutdown */
			}
		for (const record of [...this.sessions.values()])
			await this.stopSession(record, 'server stopping');
	}

	/** Live session states, for tests and diagnostics. */
	states(): readonly {
		readonly projectId: string;
		readonly languageServerId: string;
		readonly state: LanguageSessionState;
		readonly openDocuments: number;
		/** The failure text behind `reason`, for logs and support bundles. */
		readonly detail?: string;
	}[] {
		return Object.freeze(
			[...this.sessions.values()].map((record) =>
				Object.freeze({
					projectId: record.projectId,
					languageServerId: record.provider.languageServerId,
					state: record.state,
					openDocuments: record.openDocuments.size,
					...(record.detail === undefined ? {} : { detail: record.detail }),
				}),
			),
		);
	}

	private async readySession(
		projectId: string,
		path: string,
	): Promise<SessionRecord> {
		const provider = this.providerFor(path);
		if (provider === undefined)
			throw unavailable('no language server serves this file');
		const record = await this.session(projectId, provider);
		if (record.state !== 'ready')
			throw unavailable(record.reason ?? 'language session is unavailable');
		return record;
	}

	private async session(
		projectId: string,
		provider: LanguageServerProvider,
	): Promise<SessionRecord> {
		const key = sessionKey(projectId, provider);
		const existing = this.sessions.get(key);
		if (existing !== undefined) {
			if (existing.state === 'unavailable') {
				if (this.now() < existing.retryAfter) return existing;
				this.forget(existing);
			} else {
				if (existing.starting !== undefined)
					await existing.starting.catch(() => undefined);
				this.touch(existing);
				return existing;
			}
		}
		if (this.sessions.size >= this.maxSessions)
			throw unavailable('capacity');
		this.sequence += 1;
		const record: SessionRecord = {
			key,
			projectId,
			provider,
			sessionId: `ls-${this.sequence}-${Math.random().toString(36).slice(2, 10)}`,
			state: 'starting',
			openDocuments: new Map(),
			inFlight: 0,
			lastActivity: this.now(),
			retryAfter: 0,
		};
		this.sessions.set(key, record);
		this.bySessionId.set(record.sessionId, record);
		record.starting = (async () => {
			try {
				const projectRoot = await this.options.projectRoot(projectId);
				await this.options.extensions.invokeLanguage(provider.extensionId, {
					method: 'language.session.start',
					input: {
						sessionId: record.sessionId,
						languageServerId: provider.contribution.id,
						projectRoot,
					},
				});
				if (record.state === 'starting') record.state = 'ready';
			} catch (error) {
				record.state = 'unavailable';
				// The client is told only that the launch failed; the text, which can
				// name host paths and argv, stays on the record for logs.
				record.reason = 'launch-failed';
				record.detail = boundedReason(error);
				record.retryAfter = this.now() + this.failureCooldownMs;
			} finally {
				record.starting = undefined;
			}
		})();
		await record.starting;
		this.touch(record);
		return record;
	}

	private async invoke(
		record: SessionRecord,
		method: ExtensionLanguageInvocation['method'],
		input: Record<string, unknown>,
		options: { readonly signal?: AbortSignal; readonly deadlineMs?: number } = {},
	): Promise<unknown> {
		record.inFlight += 1;
		this.touch(record);
		try {
			return await this.options.extensions.invokeLanguage(
				record.provider.extensionId,
				{
					method,
					input,
					deadlineMs: options.deadlineMs ?? this.requestDeadlineMs,
					...(options.signal === undefined ? {} : { signal: options.signal }),
				},
			);
		} catch (error) {
			if (options.signal?.aborted === true) throw error;
			throw unavailable(boundedReason(error));
		} finally {
			record.inFlight -= 1;
			this.touch(record);
		}
	}

	private publishDiagnostics(
		notification: ExtensionLanguageDiagnosticsNotification,
	): void {
		const record = this.bySessionId.get(notification.sessionId);
		if (record === undefined) return;
		const revision =
			notification.revision ?? record.openDocuments.get(notification.path);
		this.options.onDiagnostics?.({
			projectId: record.projectId,
			languageServerId: record.provider.languageServerId,
			path: notification.path,
			...(revision === undefined ? {} : { revision }),
			diagnostics: notification.diagnostics,
			isTruncated: notification.isTruncated,
		});
	}

	private failSession(
		sessionId: string,
		reason: LanguageUnavailableReason,
		detail: string,
		cooldown: boolean,
	): void {
		const record = this.bySessionId.get(sessionId);
		if (record === undefined) return;
		record.state = 'unavailable';
		record.reason = reason;
		record.detail = detail.slice(0, 500);
		record.openDocuments.clear();
		if (cooldown) record.retryAfter = this.now() + this.failureCooldownMs;
		else this.forget(record);
	}

	private async stopSession(
		record: SessionRecord,
		detail: string,
	): Promise<void> {
		this.forget(record);
		// A session started fire-and-forget by `describe()` may still be starting:
		// its child is alive, so it has to be told to stop or it is orphaned.
		if (record.starting !== undefined)
			await record.starting.catch(() => undefined);
		if (record.state !== 'ready') return;
		record.state = 'unavailable';
		record.reason = 'stopped';
		record.detail = detail;
		await this.options.extensions
			.invokeLanguage(record.provider.extensionId, {
				method: 'language.session.stop',
				input: { sessionId: record.sessionId },
			})
			.catch(() => undefined);
	}

	private forget(record: SessionRecord): void {
		if (record.idleTimer !== undefined) {
			this.cancelSchedule(record.idleTimer);
			record.idleTimer = undefined;
		}
		if (this.sessions.get(record.key) === record) this.sessions.delete(record.key);
		this.bySessionId.delete(record.sessionId);
	}

	private touch(record: SessionRecord): void {
		record.lastActivity = this.now();
		if (record.idleTimer !== undefined) this.cancelSchedule(record.idleTimer);
		record.idleTimer = this.schedule(() => {
			record.idleTimer = undefined;
			if (
				record.openDocuments.size > 0 ||
				record.inFlight > 0 ||
				this.now() - record.lastActivity < this.idleMs
			) {
				this.touch(record);
				return;
			}
			void this.stopSession(record, 'language session was idle');
		}, this.idleMs);
	}
}

function sessionKey(projectId: string, provider: LanguageServerProvider): string {
	return `${projectId}\u0000${provider.languageServerId}`;
}

function fileExtension(path: string): string | undefined {
	const leaf = path.slice(path.lastIndexOf('/') + 1);
	const dot = leaf.lastIndexOf('.');
	return dot <= 0 ? undefined : leaf.slice(dot).toLowerCase();
}

function boundedReason(error: unknown): string {
	return error instanceof Error
		? (error.message.replace(/[\r\n]/gu, ' ').slice(0, 200) ||
				'language session is unavailable')
		: 'language session is unavailable';
}

/** The typed outcome a client sees for a session that cannot serve it. It is
 * deliberately a protocol `unavailable`, not an internal error. */
export function unavailable(message: string): Error {
	return Object.assign(new Error(message), {
		code: 'unavailable',
		retryable: true,
	});
}
