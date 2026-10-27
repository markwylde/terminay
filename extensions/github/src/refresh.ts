import type {
	RepositoryContext,
	WorktreeInsightSourceRuntime,
	WorktreeInsightSourceStart,
} from '@terminay/extension-api';
import type { CliTokenStore } from './ghConfig.js';
import {
	type GitHubPullRequest,
	type GitHubRef,
	toProperties,
	trackedBranch,
} from './mapping.js';
import type { FetchLike, GitHubProbe } from './probe.js';
import { buildQuery, chunkBranches } from './query.js';
import {
	type ForgeRepository,
	graphqlEndpoint,
	parseRemoteUrl,
	pickRemote,
	tokenPageUrl,
} from './remote.js';

/**
 * Remote state has no event source, so it is refreshed on these floors: a
 * project the user has active refreshes every 10 s, any other every 45 s,
 * and one refreshes at once when it becomes active. This is a poll: the
 * repository owner approved it under ADR-0028 on 2026-10-16, recorded in
 * change `github-worktree-status` (design.md). It runs only while the
 * repository's context is live and stops when the context is cancelled.
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
/** A rate-limit answer that names no reset time waits this long. */
const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REQUESTS_PER_ORIGIN = 4;

export interface Clock {
	now(): number;
	setTimeout(callback: () => void, delayMs: number): unknown;
	clearTimeout(handle: unknown): void;
}

export const systemClock: Clock = {
	now: () => Date.now(),
	setTimeout(callback, delayMs) {
		const handle = setTimeout(callback, delayMs);
		handle.unref?.();
		return handle;
	},
	clearTimeout(handle) {
		clearTimeout(handle as ReturnType<typeof setTimeout>);
	},
};

export interface GitHubRuntimeOptions {
	fetch: FetchLike;
	probe: GitHubProbe;
	cli: CliTokenStore;
	clock?: Clock;
}

/**
 * `ok` reschedules on the floor, `failed` backs off, `idle` waits for a
 * change, and `limited` waits for the origin's rate-limit reset.
 */
type Outcome = 'ok' | 'failed' | 'idle' | 'limited';

interface Credential {
	token: string;
	source: 'cli' | 'stored';
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
class RateLimited extends Error {}
class MissingCountFields extends Error {}

export function createGitHubInsightRuntime(
	options: GitHubRuntimeOptions,
): WorktreeInsightSourceRuntime {
	return {
		start(start) {
			new GitHubInsightSession(options, start).begin();
		},
	};
}

class GitHubInsightSession {
	private readonly clock: Clock;
	private readonly watchers = new Map<string, Watcher>();
	private readonly signInRequested = new Set<string>();
	private readonly limiters = new Map<string, Limiter>();
	/** Per origin, the time before which no request may be made. */
	private readonly notBefore = new Map<string, number>();
	/** Origins whose GraphQL schema lacks the per-state check totals. */
	private readonly withoutCounts = new Set<string>();

	constructor(
		private readonly options: GitHubRuntimeOptions,
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
		} catch (error) {
			outcome = error instanceof RateLimited ? 'limited' : 'failed';
		} finally {
			watcher.running = false;
		}
		if (
			this.start.signal.aborted ||
			this.watchers.get(watcher.context.id) !== watcher
		)
			return;
		if (watcher.rerun && outcome !== 'limited') {
			watcher.rerun = false;
			void this.run(watcher);
			return;
		}
		watcher.rerun = false;
		if (outcome === 'idle') return;
		let delay = refreshIntervalFor(watcher.context);
		if (outcome === 'ok') watcher.failures = 0;
		else if (outcome === 'limited') {
			// A one-shot wait for the reset GitHub reported: a bounded retry,
			// not a poll (ADR-0028 decision 3).
			delay = Math.max(
				delay,
				(this.notBefore.get(watcher.origin ?? '') ?? 0) - this.clock.now(),
			);
		} else {
			watcher.failures += 1;
			delay =
				FAILURE_BACKOFF_MS[
					Math.min(watcher.failures, FAILURE_BACKOFF_MS.length) - 1
				] ?? delay;
		}
		// ADR-0028 approved poll (change github-worktree-status); see
		// refreshIntervalFor. Failures and rate limits only widen it.
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
		const isGitHub = await this.options.probe.isGitHub(forge.origin, signal);
		if (isGitHub === undefined) return 'failed';
		if (!isGitHub) {
			this.clearAll(watcher);
			return 'idle';
		}
		if ((this.notBefore.get(forge.origin) ?? 0) > this.clock.now())
			return 'limited';
		// One retry covers a rejected gh token falling back to a stored one.
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
		const worktrees = watcher.context.worktrees;
		const branches = [
			...new Set(
				worktrees
					.map((worktree) => trackedBranch(worktree))
					.filter((branch): branch is string => branch !== undefined),
			),
		];
		const refs = new Map<string, GitHubRef | null>();
		let merged: readonly (GitHubPullRequest | null)[] = [];
		for (const chunk of chunkBranches(branches)) {
			const found = await this.queryBranches(forge, chunk, token);
			for (const [branch, ref] of found.refs) refs.set(branch, ref);
			merged = found.merged;
		}
		for (const worktree of worktrees) {
			const branch = trackedBranch(worktree);
			this.publish(
				watcher,
				worktree.id,
				branch === undefined
					? null
					: toProperties(
							refs.get(branch),
							branch,
							forge.owner,
							forge.repo,
							merged,
						),
			);
		}
	}

	/**
	 * One GraphQL request for up to 50 branches; each branch's `ref`, and the
	 * repository's recently merged pull requests.
	 */
	private async queryBranches(
		forge: ForgeRepository,
		branches: readonly string[],
		token: string,
	): Promise<{
		refs: Map<string, GitHubRef | null>;
		merged: readonly (GitHubPullRequest | null)[];
	}> {
		const counts = !this.withoutCounts.has(forge.origin);
		const request = buildQuery(forge.owner, forge.repo, branches, { counts });
		let data: unknown;
		try {
			data = await this.graphql(forge.origin, request, token);
		} catch (error) {
			if (!(error instanceof MissingCountFields) || !counts) throw error;
			this.withoutCounts.add(forge.origin);
			return this.queryBranches(forge, branches, token);
		}
		const repository =
			typeof data === 'object' && data !== null
				? (data as { repository?: Record<string, unknown> | null }).repository
				: undefined;
		if (repository === undefined || repository === null)
			throw new Error('GitHub returned no repository');
		const refs = new Map<string, GitHubRef | null>();
		for (const [branch, alias] of request.aliases)
			refs.set(branch, (repository[alias] as GitHubRef | null) ?? null);
		const nodes = (
			repository.mergedPullRequests as
				| { nodes?: readonly (GitHubPullRequest | null)[] | null }
				| null
				| undefined
		)?.nodes;
		return { refs, merged: Array.isArray(nodes) ? nodes : [] };
	}

	private async credential(origin: string): Promise<Credential | undefined> {
		const cli = await this.options.cli.token(origin);
		if (cli !== undefined) return { token: cli, source: 'cli' };
		const stored = await this.start.credentials.token(origin);
		if (stored !== undefined && stored.length > 0)
			return { token: stored, source: 'stored' };
		return undefined;
	}

	private async rejectCredential(
		origin: string,
		credential: Credential,
	): Promise<void> {
		if (credential.source === 'cli') this.options.cli.reject(origin);
		else await this.start.credentials.reject(origin);
	}

	private requestSignIn(origin: string): void {
		if (this.signInRequested.has(origin)) return;
		this.signInRequested.add(origin);
		this.start.publisher.requestSignIn({
			origin,
			provider: 'GitHub',
			tokenPageUrl: tokenPageUrl(origin),
		});
	}

	/** POST one GraphQL request; its `data`, or a typed failure. */
	private graphql(
		origin: string,
		request: { query: string; variables: Record<string, string> },
		token: string,
	): Promise<unknown> {
		return this.limiter(origin)(async () => {
			if ((this.notBefore.get(origin) ?? 0) > this.clock.now())
				throw new RateLimited('rate limited');
			const response = await this.options.fetch(graphqlEndpoint(origin), {
				method: 'POST',
				headers: {
					accept: 'application/json',
					authorization: `bearer ${token}`,
					'content-type': 'application/json',
				},
				body: JSON.stringify({
					query: request.query,
					variables: request.variables,
				}),
				signal: AbortSignal.any([
					this.start.signal,
					AbortSignal.timeout(REQUEST_TIMEOUT_MS),
				]),
			});
			if (response.status === 401) throw new Unauthorized('unauthorized');
			const reset = this.rateLimitReset(response);
			if (reset !== undefined) {
				this.notBefore.set(origin, reset);
				throw new RateLimited('rate limited');
			}
			if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
			// This answer spent the last of the budget: the next waits.
			if (response.headers.get('x-ratelimit-remaining') === '0') {
				const at = this.headerReset(response);
				if (at !== undefined) this.notBefore.set(origin, at);
			}
			const body = (await response.json()) as {
				data?: unknown;
				errors?: readonly { type?: unknown; extensions?: { code?: unknown } }[];
			} | null;
			const errors = Array.isArray(body?.errors) ? body.errors : [];
			if (errors.some((error) => error?.type === 'RATE_LIMITED')) {
				this.notBefore.set(
					origin,
					this.headerReset(response) ??
						this.clock.now() + DEFAULT_RATE_LIMIT_WAIT_MS,
				);
				throw new RateLimited('rate limited');
			}
			if (
				errors.some(
					(error) =>
						error?.extensions?.code === 'undefinedField' ||
						error?.extensions?.code === 'selectionMismatch',
				)
			)
				throw new MissingCountFields('schema lacks per-state counts');
			const data = body?.data;
			const rateLimit =
				typeof data === 'object' && data !== null
					? (data as { rateLimit?: { remaining?: unknown; resetAt?: unknown } })
							.rateLimit
					: undefined;
			if (rateLimit?.remaining === 0 && typeof rateLimit.resetAt === 'string') {
				const at = Date.parse(rateLimit.resetAt);
				if (Number.isFinite(at)) this.notBefore.set(origin, at);
			}
			return data;
		});
	}

	/** When a response says the limit is spent, the time it resets. */
	private rateLimitReset(response: {
		status: number;
		headers: { get(name: string): string | null };
	}): number | undefined {
		if (response.status !== 403 && response.status !== 429) return undefined;
		const retryAfter = Number(response.headers.get('retry-after'));
		if (Number.isFinite(retryAfter) && retryAfter > 0)
			return this.clock.now() + retryAfter * 1_000;
		if (
			response.headers.get('x-ratelimit-remaining') === '0' ||
			response.status === 429
		)
			return (
				this.headerReset(response) ??
				this.clock.now() + DEFAULT_RATE_LIMIT_WAIT_MS
			);
		return undefined;
	}

	private headerReset(response: {
		headers: { get(name: string): string | null };
	}): number | undefined {
		const reset = Number(response.headers.get('x-ratelimit-reset'));
		return Number.isFinite(reset) && reset > 0 ? reset * 1_000 : undefined;
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
