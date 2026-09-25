import { EXTENSION_LIMITS } from './constants.js';
import type { Disposable } from './types.js';

/**
 * Worktree properties are the closed, provider-neutral facts an extension may
 * publish about one worktree. Terminay alone decides how they look and what
 * activating them does; an extension supplies facts, never presentation.
 */
export type WorktreePullRequestState = 'open' | 'draft' | 'merged' | 'closed';

export interface WorktreePullRequest {
	/** The forge's pull request number, e.g. 285. */
	number: number;
	title: string;
	/** A credential-free HTTPS URL. */
	url: string;
	state: WorktreePullRequestState;
	mergeable?: boolean;
}

export type WorktreeCheckState = 'passed' | 'failed' | 'pending' | 'skipped';

export interface WorktreeCheckItem {
	name: string;
	state: WorktreeCheckState;
	/** A credential-free HTTPS URL of the check's run. */
	url?: string;
}

/** Counts cover every check; `items` may be truncated to the item limit. */
export interface WorktreeChecks {
	passed: number;
	failed: number;
	pending: number;
	skipped: number;
	total: number;
	url?: string;
	items: WorktreeCheckItem[];
}

export interface WorktreeProperties {
	pullRequest?: WorktreePullRequest;
	checks?: WorktreeChecks;
}

/** Declarative metadata for one worktree insight source. */
export interface WorktreeInsightSourceContribution {
	/** Namespaced: `<extensionId>/<local-id>`. */
	id: string;
	displayName: string;
	description?: string;
}

export interface RepositoryRemote {
	name: string;
	url: string;
}

export interface RepositoryWorktreeUpstream {
	remote: string;
	/** The branch name on the remote, e.g. `feat/gitea`. */
	branch: string;
}

export interface RepositoryWorktree {
	/** Opaque, host-issued; the only key properties may be published under. */
	id: string;
	/** Absolute path on the server. */
	path: string;
	branch: string | null;
	upstream: RepositoryWorktreeUpstream | null;
	head: string | null;
}

/**
 * One open project's repository, issued by the host. It is re-issued with
 * the same id when its worktrees, branches, upstreams, or heads change.
 */
export interface RepositoryContext {
	id: string;
	repositoryRoot: string;
	remotes: RepositoryRemote[];
	worktrees: RepositoryWorktree[];
	/**
	 * Whether a client has this project active. Sources may refresh an active
	 * project more often; a change of activity re-issues the context.
	 */
	active?: boolean;
}

export interface WorktreeSignInRequest {
	/** An HTTPS origin such as `https://git.example.net`. */
	origin: string;
	/** The provider name the prompt shows, e.g. `Gitea`. */
	provider: string;
	/** A credential-free HTTPS page where the user can create a token. */
	tokenPageUrl?: string;
}

export interface WorktreeInsightPublisher {
	/**
	 * Replace one worktree's properties, or clear them with `null`. Calls for a
	 * context or worktree the host did not issue are dropped. After the start
	 * signal aborts, every call is ignored.
	 */
	publish(
		contextId: string,
		worktreeId: string,
		properties: WorktreeProperties | null,
	): void;
	/** Ask Terminay to prompt the user for a credential for one origin. */
	requestSignIn(request: WorktreeSignInRequest): void;
}

export interface WorktreeCredentials {
	/** The token the user stored for this origin through sign-in, if any. */
	token(origin: string): Promise<string | undefined>;
	/** The origin refused the stored token; forget it so sign-in can recur. */
	reject(origin: string): Promise<void>;
	/** Called when the user stores a token for an origin. */
	onAvailable(listener: (origin: string) => void): Disposable;
}

export interface WorktreeInsightSourceStart {
	/** The repository contexts live when the source starts. */
	contexts: readonly RepositoryContext[];
	/** Called with every live context whenever any is issued, re-issued, or cancelled. */
	onContextsChanged(
		listener: (contexts: readonly RepositoryContext[]) => void,
	): Disposable;
	publisher: WorktreeInsightPublisher;
	credentials: WorktreeCredentials;
	/** Aborts when the source is disposed or the extension stops. */
	signal: AbortSignal;
}

export interface WorktreeInsightSourceRuntime {
	start(start: WorktreeInsightSourceStart): void | Promise<void>;
}

export interface WorktreeInsightSourceRegistration extends Disposable {
	readonly sourceId: string;
}

export interface WorktreeInsightSourceRegistry {
	/**
	 * Registers a worktree insight source this manifest contributed. An
	 * undeclared or duplicate id is refused.
	 */
	registerInsightSource(
		sourceId: string,
		runtime: WorktreeInsightSourceRuntime,
	): WorktreeInsightSourceRegistration;
}

export function defineWorktreeInsightSource(
	runtime: WorktreeInsightSourceRuntime,
): WorktreeInsightSourceRuntime {
	return runtime;
}

const pullRequestStates: readonly string[] = [
	'open',
	'draft',
	'merged',
	'closed',
];
const checkStates: readonly string[] = [
	'passed',
	'failed',
	'pending',
	'skipped',
];

/**
 * A credential-free HTTPS URL within the length limit. Anything else could
 * leak a secret into a client or navigate somewhere other than the web.
 */
export function isSafeHttpsUrl(value: unknown): value is string {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.length > EXTENSION_LIMITS.worktreeUrlLength
	)
		return false;
	try {
		const url = new URL(value);
		return (
			url.protocol === 'https:' &&
			url.username === '' &&
			url.password === '' &&
			url.hostname.length > 0
		);
	} catch {
		return false;
	}
}

/** An HTTPS origin with no path, query, fragment, or credentials. */
export function isHttpsOrigin(value: unknown): value is string {
	if (!isSafeHttpsUrl(value)) return false;
	return new URL(value).origin === value;
}

export type WorktreePropertiesValidation =
	| { ok: true; value: WorktreeProperties }
	| { ok: false; reason: string };

/**
 * Validates one publication before it crosses into Terminay. The result is a
 * fresh object holding only known fields, so nothing unvalidated survives.
 */
export function validateWorktreeProperties(
	value: unknown,
): WorktreePropertiesValidation {
	if (!isRecord(value)) return invalid('properties must be an object');
	for (const key of Object.keys(value))
		if (key !== 'pullRequest' && key !== 'checks')
			return invalid(`unknown property ${key}`);
	const result: WorktreeProperties = {};
	if (value.pullRequest !== undefined) {
		const pullRequest = value.pullRequest;
		if (!isRecord(pullRequest)) return invalid('pullRequest must be an object');
		if (
			!Number.isSafeInteger(pullRequest.number) ||
			(pullRequest.number as number) < 1
		)
			return invalid('pullRequest.number must be a positive integer');
		if (!boundedText(pullRequest.title, EXTENSION_LIMITS.worktreeTitleLength))
			return invalid('pullRequest.title is invalid');
		if (!isSafeHttpsUrl(pullRequest.url))
			return invalid('pullRequest.url must be a credential-free HTTPS URL');
		if (!pullRequestStates.includes(pullRequest.state as string))
			return invalid('pullRequest.state is invalid');
		if (
			pullRequest.mergeable !== undefined &&
			typeof pullRequest.mergeable !== 'boolean'
		)
			return invalid('pullRequest.mergeable must be a boolean');
		result.pullRequest = {
			number: pullRequest.number as number,
			title: pullRequest.title as string,
			url: pullRequest.url as string,
			state: pullRequest.state as WorktreePullRequestState,
			...(pullRequest.mergeable === undefined
				? {}
				: { mergeable: pullRequest.mergeable as boolean }),
		};
	}
	if (value.checks !== undefined) {
		const checks = value.checks;
		if (!isRecord(checks)) return invalid('checks must be an object');
		const counts = ['passed', 'failed', 'pending', 'skipped', 'total'] as const;
		for (const count of counts)
			if (
				!Number.isSafeInteger(checks[count]) ||
				(checks[count] as number) < 0 ||
				(checks[count] as number) > EXTENSION_LIMITS.worktreeCheckCount
			)
				return invalid(`checks.${count} is invalid`);
		if (
			(checks.passed as number) +
				(checks.failed as number) +
				(checks.pending as number) +
				(checks.skipped as number) !==
			checks.total
		)
			return invalid('checks counts do not sum to total');
		if (checks.url !== undefined && !isSafeHttpsUrl(checks.url))
			return invalid('checks.url must be a credential-free HTTPS URL');
		if (
			!Array.isArray(checks.items) ||
			checks.items.length > EXTENSION_LIMITS.worktreeCheckItems ||
			checks.items.length > (checks.total as number)
		)
			return invalid('checks.items is invalid');
		const items: WorktreeCheckItem[] = [];
		for (const item of checks.items) {
			if (!isRecord(item)) return invalid('check item must be an object');
			if (!boundedText(item.name, EXTENSION_LIMITS.worktreeCheckNameLength))
				return invalid('check item name is invalid');
			if (!checkStates.includes(item.state as string))
				return invalid('check item state is invalid');
			if (item.url !== undefined && !isSafeHttpsUrl(item.url))
				return invalid('check item url must be a credential-free HTTPS URL');
			items.push({
				name: item.name as string,
				state: item.state as WorktreeCheckState,
				...(item.url === undefined ? {} : { url: item.url as string }),
			});
		}
		result.checks = {
			passed: checks.passed as number,
			failed: checks.failed as number,
			pending: checks.pending as number,
			skipped: checks.skipped as number,
			total: checks.total as number,
			...(checks.url === undefined ? {} : { url: checks.url as string }),
			items,
		};
	}
	return { ok: true, value: result };
}

export type WorktreeSignInValidation =
	| { ok: true; value: WorktreeSignInRequest }
	| { ok: false; reason: string };

export function validateWorktreeSignInRequest(
	value: unknown,
): WorktreeSignInValidation {
	if (!isRecord(value)) return invalid('sign-in request must be an object');
	if (!isHttpsOrigin(value.origin))
		return invalid('origin must be an HTTPS origin');
	if (!boundedText(value.provider, EXTENSION_LIMITS.worktreeProviderNameLength))
		return invalid('provider is invalid');
	if (value.tokenPageUrl !== undefined && !isSafeHttpsUrl(value.tokenPageUrl))
		return invalid('tokenPageUrl must be a credential-free HTTPS URL');
	return {
		ok: true,
		value: {
			origin: value.origin,
			provider: value.provider as string,
			...(value.tokenPageUrl === undefined
				? {}
				: { tokenPageUrl: value.tokenPageUrl as string }),
		},
	};
}

function boundedText(value: unknown, maximum: number): value is string {
	return (
		typeof value === 'string' &&
		value.trim().length > 0 &&
		value.length <= maximum &&
		!value.includes('\0')
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(reason: string): { ok: false; reason: string } {
	return { ok: false, reason };
}
