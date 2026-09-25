import type {
	RepositoryContext,
	WorktreeInsightSourceRuntime,
	WorktreeInsightSourceStart,
} from '@terminay/extension-api';
import {
	type GiteaCommitStatus,
	type GiteaPullRequest,
	matchPullRequest,
	toProperties,
} from './mapping.js';
import type { FetchLike, GiteaProbe } from './probe.js';
import { type ForgeRepository, parseRemoteUrl, pickRemote } from './remote.js';
import type { TeaTokenStore } from './teaConfig.js';

/**
 * Remote state has no event source, so it is refreshed on these floors: a
 * project the user has active refreshes every 10 s, any other every 45 s,
 * and one refreshes at once when it becomes active. This is a poll: the
 * repository owner approved it under ADR-0028 (2026-09-24, revised to these
 * intervals on 2026-09-25), recorded in change `gitea-worktree-status`
 * (design.md). It runs only while the repository's context is live and stops
 * when the context is cancelled.
 */
export const ACTIVE_REFRESH_INTERVAL_MS = 10_000;
export const INACTIVE_REFRESH_INTERVAL_MS = 45_000;

export function refreshIntervalFor(context: RepositoryContext): number {
	return context.active === true
		? ACTIVE_REFRESH_INTERVAL_MS
		: INACTIVE_REFRESH_INTERVAL_MS;
}
/** Consecutive failures widen the interval, and one success resets it. */
export const FAILURE_BACKOFF_MS = Object.freeze([
	60_000, 120_000, 300_000, 600_000,
]);
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REQUESTS_PER_ORIGIN = 4;

export interface Clock {
	setTimeout(callback: () => void, delayMs: number): unknown;
	clearTimeout(handle: unknown): void;
}

export const systemClock: Clock = {
	setTimeout(callback, delayMs) {
		const handle = setTimeout(callback, delayMs);
		handle.unref?.();
		return handle;
	},
	clearTimeout(handle) {
		clearTimeout(handle as ReturnType<typeof setTimeout>);
	},
};

export interface GiteaRuntimeOptions {
	fetch: FetchLike;
	probe: GiteaProbe;
	tea: TeaTokenStore;
	clock?: Clock;
}

/** `ok` reschedules on the floor, `failed` backs off, `idle` waits for a change. */
type Outcome = 'ok' | 'failed' | 'idle';

interface Credential {
	token: string;
	source: 'tea' | 'stored';
}

interface Watcher {
	context: RepositoryContext;
	fingerprint: string;
	origin?: string;
	timer?: unknown;
	failures: number;
	running: boolean;
	rerun: boolean;
	/** What each worktree was last published as, serialised. */
	published: Map<string, string>;
}

class Unauthorized extends Error {}

export function createGiteaInsightRuntime(
	options: GiteaRuntimeOptions,
): WorktreeInsightSourceRuntime {
	return {
		start(start) {
			new GiteaInsightSession(options, start).begin();
		},
	};
}

class GiteaInsightSession {
	private readonly clock: Clock;
	private readonly watchers = new Map<string, Watcher>();
	private readonly signInRequested = new Set<string>();
	private readonly limiters = new Map<string, Limiter>();

	constructor(
		private readonly options: GiteaRuntimeOptions,
		private readonly start: WorktreeInsightSourceStart,
	) {
		this.clock = options.clock ?? systemClock;
	}

	begin(): void {
		const { signal } = this.start;
		if (signal.aborted) return;
		const contexts = this.start.onContextsChanged((next) => this.apply(next));
		const credentials = this.start.credentials.onAvailable((origin) => {
			this.signInRequested.delete(origin);
			for (const watcher of this.watchers.values())
				if (watcher.origin === origin) this.refreshNow(watcher);
		});
		signal.addEventListener(
			'abort',
			() => {
				for (const watcher of this.watchers.values()) this.cancelTimer(watcher);
				this.watchers.clear();
				void contexts.dispose();
				void credentials.dispose();
			},
			{ once: true },
		);
		this.apply(this.start.contexts);
	}

	private apply(contexts: readonly RepositoryContext[]): void {
		if (this.start.signal.aborted) return;
		const live = new Set<string>();
		for (const context of contexts) {
			live.add(context.id);
			// Activity is not content: becoming active refreshes at once,
			// becoming inactive only slows the next refresh.
			const fingerprint = JSON.stringify({ ...context, active: undefined });
			const existing = this.watchers.get(context.id);
			if (existing !== undefined) {
				const becameActive =
					context.active === true && existing.context.active !== true;
				const changed = existing.fingerprint !== fingerprint;
				existing.context = context;
				existing.fingerprint = fingerprint;
				if (changed || becameActive) this.refreshNow(existing);
				continue;
			}
			const watcher: Watcher = {
				context,
				fingerprint,
				failures: 0,
				running: false,
				rerun: false,
				published: new Map(),
			};
			this.watchers.set(context.id, watcher);
			this.refreshNow(watcher);
		}
		for (const [id, watcher] of this.watchers)
			if (!live.has(id)) {
				this.cancelTimer(watcher);
				this.watchers.delete(id);
			}
	}

	private refreshNow(watcher: Watcher): void {
		this.cancelTimer(watcher);
		if (watcher.running) {
			watcher.rerun = true;
			return;
		}
		void this.run(watcher);
	}

	private async run(watcher: Watcher): Promise<void> {
		watcher.running = true;
		let outcome: Outcome;
		try {
			outcome = await this.refresh(watcher);
		} catch {
			outcome = 'failed';
		} finally {
			watcher.running = false;
		}
		if (
			this.start.signal.aborted ||
			this.watchers.get(watcher.context.id) !== watcher
		)
			return;
		if (watcher.rerun) {
			watcher.rerun = false;
			void this.run(watcher);
			return;
		}
		if (outcome === 'idle') return;
		let delay = refreshIntervalFor(watcher.context);
		if (outcome === 'ok') watcher.failures = 0;
		else {
			watcher.failures += 1;
			delay =
				FAILURE_BACKOFF_MS[
					Math.min(watcher.failures, FAILURE_BACKOFF_MS.length) - 1
				] ?? delay;
		}
		// ADR-0028 approved poll (change gitea-worktree-status); see
		// refreshIntervalFor. Failures only widen it.
		watcher.timer = this.clock.setTimeout(() => {
			watcher.timer = undefined;
			if (this.watchers.get(watcher.context.id) === watcher)
				void this.run(watcher);
		}, delay);
	}

	private cancelTimer(watcher: Watcher): void {
		if (watcher.timer === undefined) return;
		this.clock.clearTimeout(watcher.timer);
		watcher.timer = undefined;
	}

	private async refresh(watcher: Watcher): Promise<Outcome> {
		const { signal } = this.start;
		const remote = pickRemote(watcher.context.remotes);
		const forge = remote === undefined ? undefined : parseRemoteUrl(remote.url);
		if (forge === undefined) {
			this.clearAll(watcher);
			return 'idle';
		}
		watcher.origin = forge.origin;
		const isGitea = await this.options.probe.isGitea(forge.origin, signal);
		if (isGitea === undefined) return 'failed';
		if (!isGitea) {
			this.clearAll(watcher);
			return 'idle';
		}
		// One retry covers a rejected tea token falling back to a stored one.
		for (let attempt = 0; attempt < 2; attempt += 1) {
			const credential = await this.credential(forge.origin);
			if (credential === undefined) {
				this.requestSignIn(forge.origin);
				return 'idle';
			}
			try {
				await this.refreshWith(watcher, forge, credential.token);
				return 'ok';
			} catch (error) {
				if (!(error instanceof Unauthorized)) throw error;
				await this.rejectCredential(forge.origin, credential);
			}
		}
		this.requestSignIn(forge.origin);
		return 'idle';
	}

	private async refreshWith(
		watcher: Watcher,
		forge: ForgeRepository,
		token: string,
	): Promise<void> {
		const base = `/repos/${encodeURIComponent(forge.owner)}/${encodeURIComponent(forge.repo)}`;
		const pulls = await this.get(
			forge.origin,
			`${base}/pulls?state=open&limit=50`,
			token,
		);
		const pullList = Array.isArray(pulls) ? (pulls as GiteaPullRequest[]) : [];
		const worktrees = watcher.context.worktrees;
		const results = await Promise.all(
			worktrees.map(async (worktree) => {
				if (worktree.upstream === null) return null;
				const pull = matchPullRequest(
					pullList,
					worktree,
					forge.owner,
					forge.repo,
				);
				const sha = pull?.head?.sha;
				const ref =
					typeof sha === 'string' && sha.length > 0
						? sha
						: worktree.upstream.branch;
				const status = await this.get(
					forge.origin,
					`${base}/commits/${encodeURIComponent(ref)}/status?limit=100`,
					token,
					true,
				);
				const statuses =
					typeof status === 'object' &&
					status !== null &&
					Array.isArray((status as { statuses?: unknown }).statuses)
						? (status as { statuses: GiteaCommitStatus[] }).statuses
						: [];
				return toProperties(pull, statuses, forge.origin);
			}),
		);
		for (const [index, worktree] of worktrees.entries())
			this.publish(watcher, worktree.id, results[index] ?? null);
	}

	private async credential(origin: string): Promise<Credential | undefined> {
		const tea = await this.options.tea.token(origin);
		if (tea !== undefined) return { token: tea, source: 'tea' };
		const stored = await this.start.credentials.token(origin);
		if (stored !== undefined && stored.length > 0)
			return { token: stored, source: 'stored' };
		return undefined;
	}

	private async rejectCredential(
		origin: string,
		credential: Credential,
	): Promise<void> {
		if (credential.source === 'tea') this.options.tea.reject(origin);
		else await this.start.credentials.reject(origin);
	}

	private requestSignIn(origin: string): void {
		if (this.signInRequested.has(origin)) return;
		this.signInRequested.add(origin);
		this.start.publisher.requestSignIn({
			origin,
			provider: 'Gitea',
			tokenPageUrl: `${origin}/user/settings/applications`,
		});
	}

	/** GET one Gitea API path; a missing resource is `undefined` when allowed. */
	private get(
		origin: string,
		path: string,
		token: string,
		allowMissing = false,
	): Promise<unknown> {
		return this.limiter(origin)(async () => {
			const response = await this.options.fetch(`${origin}/api/v1${path}`, {
				headers: {
					accept: 'application/json',
					authorization: `token ${token}`,
				},
				signal: AbortSignal.any([
					this.start.signal,
					AbortSignal.timeout(REQUEST_TIMEOUT_MS),
				]),
			});
			if (response.status === 401) throw new Unauthorized('unauthorized');
			if (allowMissing && response.status === 404) return undefined;
			if (!response.ok) throw new Error(`Gitea answered ${response.status}`);
			return response.json();
		});
	}

	private limiter(origin: string): Limiter {
		let limiter = this.limiters.get(origin);
		if (limiter === undefined) {
			limiter = createLimiter(MAX_REQUESTS_PER_ORIGIN);
			this.limiters.set(origin, limiter);
		}
		return limiter;
	}

	private publish(
		watcher: Watcher,
		worktreeId: string,
		properties: ReturnType<typeof toProperties>,
	): void {
		const serialised = JSON.stringify(properties);
		const previous = watcher.published.get(worktreeId);
		if (previous === serialised) return;
		if (previous === undefined && properties === null) return;
		watcher.published.set(worktreeId, serialised);
		this.start.publisher.publish(watcher.context.id, worktreeId, properties);
	}

	private clearAll(watcher: Watcher): void {
		for (const worktreeId of [...watcher.published.keys()])
			this.publish(watcher, worktreeId, null);
	}
}

type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

function createLimiter(maximum: number): Limiter {
	let active = 0;
	const queue: Array<() => void> = [];
	return async (task) => {
		if (active >= maximum)
			await new Promise<void>((resolve) => queue.push(resolve));
		active += 1;
		try {
			return await task();
		} finally {
			active -= 1;
			queue.shift()?.();
		}
	};
}
