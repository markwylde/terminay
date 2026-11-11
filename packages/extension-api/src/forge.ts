import { EXTENSION_LIMITS } from './constants.js';
import type { Disposable } from './types.js';
import {
	isHttpsOrigin,
	isSafeHttpsUrl,
	type WorktreeChecks,
	type WorktreeCredentials,
	validateWorktreeProperties,
} from './worktree.js';

/**
 * Forge sources answer Terminay's questions about pull requests and issues on
 * the forge accounts an extension can act as (ADR-0105). They are pull-based:
 * Terminay asks, a source answers one page, and keeps no list state. Every
 * answer is a closed set of typed facts; Terminay owns presentation, joins,
 * caching, and every action that touches Git or terminals.
 */

export type ForgeItemKind = 'pullRequest' | 'issue';
export type ForgePullRequestState = 'open' | 'draft' | 'merged' | 'closed';
export type ForgeIssueState = 'open' | 'closed';
export type ForgeItemState = ForgePullRequestState | ForgeIssueState;

/** A repository on one forge origin. */
export interface ForgeRepository {
	/** An HTTPS origin such as `https://git.example.net`. */
	origin: string;
	owner: string;
	name: string;
}

export interface ForgeItemReference extends ForgeRepository {
	kind: ForgeItemKind;
	number: number;
}

export interface ForgeLabel {
	name: string;
	/** Six hex digits without `#`, e.g. `d73a4a`. */
	color: string;
}

export interface ForgePullRequestFacts {
	headBranch: string;
	baseBranch: string;
	/** The repository the head branch lives in; differs from the item's for forks. */
	headOwner: string;
	headName: string;
	headCommit?: string;
	checks?: WorktreeChecks;
}

export interface ForgeItemSummary {
	reference: ForgeItemReference;
	title: string;
	/** Canonical, credential-free HTTPS URL on the item's origin. */
	url: string;
	state: ForgeItemState;
	author: string;
	labels: ForgeLabel[];
	comments: number;
	/** ISO 8601 times. */
	createdAt: string;
	updatedAt: string;
	pullRequest?: ForgePullRequestFacts;
}

export interface ForgeComment {
	author: string;
	createdAt: string;
	body: string;
}

export interface ForgeItemDetail {
	summary: ForgeItemSummary;
	body: string;
	/** At most the ten most recent, oldest first. */
	comments: ForgeComment[];
}

export type ForgePullRequestScope =
	| 'reviewRequested'
	| 'authored'
	| 'involved'
	| 'all';
export type ForgeIssueScope = 'assigned' | 'authored' | 'mentioned' | 'all';
export type ForgeScope = ForgePullRequestScope | ForgeIssueScope;
export type ForgeQueryState = 'open' | 'merged' | 'closed' | 'all';

export interface ForgeRepositoryName {
	owner: string;
	name: string;
}

export interface ForgeQuery {
	kind: ForgeItemKind;
	scope: ForgeScope;
	state: ForgeQueryState;
	/** The account the query is for. */
	origin: string;
	/** Absent means unrestricted; never empty. */
	repositories?: ForgeRepositoryName[];
	/** Absent means unrestricted; never empty. */
	owners?: string[];
	text?: string;
	cursor?: string;
	pageSize: number;
}

export interface ForgePage {
	/** Most recently updated first. A page may be short and still continue. */
	items: ForgeItemSummary[];
	nextCursor?: string;
	totalCount?: number;
}

export type ForgeCredentialSource =
	| 'environment'
	| 'cli-config'
	| 'cli'
	| 'sign-in';

export interface ForgeAccount {
	origin: string;
	login: string;
	credentialSource: ForgeCredentialSource;
	state: 'ready' | 'rejected';
	/** The account's login and the organisations it belongs to. */
	owners: string[];
}

export interface ForgeRemote {
	name: string;
	url: string;
}

/** What the `all` scope reaches for a source. */
export type ForgeAllReach = 'readable' | 'owners';

/** Declarative metadata for one forge source. */
export interface ForgeSourceContribution {
	/** Namespaced: `<extensionId>/<local-id>`. */
	id: string;
	displayName: string;
	description?: string;
	kinds: ForgeItemKind[];
	allReach: ForgeAllReach;
}

export interface ForgeSourceRuntime {
	/** The accounts the source can act as, at most one per origin. */
	accounts(signal: AbortSignal): Promise<ForgeAccount[]>;
	/** The repository a remote maps to on one of the source's origins, if any. */
	claim(
		remote: ForgeRemote,
		signal: AbortSignal,
	): Promise<ForgeRepository | null>;
	/** One page of item summaries for one account's query. */
	query(query: ForgeQuery, signal: AbortSignal): Promise<ForgePage>;
	/** One item's detail. */
	detail(
		reference: ForgeItemReference,
		signal: AbortSignal,
	): Promise<ForgeItemDetail>;
}

export interface ForgeSourceRegistration extends Disposable {
	readonly sourceId: string;
	/** Hint that results for an origin changed; Terminay refreshes visible lists. */
	invalidate(origin: string): void;
}

export interface ForgeSourceRegistry {
	/**
	 * Registers a forge source this manifest contributed. An undeclared id, a
	 * second registration of the same id, or a registration after deactivation
	 * is refused.
	 */
	registerSource(
		sourceId: string,
		runtime: ForgeSourceRuntime,
	): ForgeSourceRegistration;
	/** Tokens the user stored for this extension's origins through sign-in. */
	credentials: WorktreeCredentials;
}

export function defineForgeSource(
	runtime: ForgeSourceRuntime,
): ForgeSourceRuntime {
	return runtime;
}

export type ForgeValidation<T> =
	| { ok: true; value: T }
	| { ok: false; reason: string };

const kinds: readonly string[] = ['pullRequest', 'issue'];
const pullRequestStates: readonly string[] = [
	'open',
	'draft',
	'merged',
	'closed',
];
const issueStates: readonly string[] = ['open', 'closed'];
const pullRequestScopes: readonly string[] = [
	'reviewRequested',
	'authored',
	'involved',
	'all',
];
const issueScopes: readonly string[] = [
	'assigned',
	'authored',
	'mentioned',
	'all',
];
const credentialSources: readonly string[] = [
	'environment',
	'cli-config',
	'cli',
	'sign-in',
];

/** Scopes valid for a kind. */
export function forgeScopesFor(kind: ForgeItemKind): readonly ForgeScope[] {
	return (
		kind === 'pullRequest' ? pullRequestScopes : issueScopes
	) as readonly ForgeScope[];
}

/** Query states valid for a kind. */
export function forgeStatesFor(
	kind: ForgeItemKind,
): readonly ForgeQueryState[] {
	return kind === 'pullRequest'
		? ['open', 'merged', 'closed', 'all']
		: ['open', 'closed', 'all'];
}

/** A forge owner, repository, login, or branch-like name: bounded, single line. */
function isName(value: unknown, maximum: number): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		value.length <= maximum &&
		// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is refused
		!/[\u0000-\u001f\u007f\s]/.test(value)
	);
}

function isOwnerOrRepo(value: unknown): value is string {
	return (
		isName(value, EXTENSION_LIMITS.forgeRepositoryNameLength) &&
		!value.includes('/')
	);
}

function isText(value: unknown, maximum: number, allowEmpty = false) {
	return (
		typeof value === 'string' &&
		(allowEmpty || value.trim().length > 0) &&
		value.length <= maximum &&
		!value.includes('\0')
	);
}

function isTime(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length <= 64 &&
		!Number.isNaN(Date.parse(value))
	);
}

function isCount(value: unknown): value is number {
	return (
		Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 1e9
	);
}

/** The lower-case host of an HTTPS, SSH, or scp-style Git remote URL. */
export function forgeRemoteHost(url: string): string | null {
	const trimmed = url.trim();
	const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)/.exec(trimmed);
	if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed))
		return scp[1].toLowerCase();
	try {
		const parsed = new URL(trimmed);
		return parsed.hostname ? parsed.hostname.toLowerCase() : null;
	} catch {
		return null;
	}
}

/** Validates a repository reference, returning a fresh object. */
export function validateForgeRepository(
	value: unknown,
): ForgeValidation<ForgeRepository> {
	if (!isRecord(value)) return invalid('repository must be an object');
	if (!isHttpsOrigin(value.origin))
		return invalid('origin must be an HTTPS origin');
	if (!isOwnerOrRepo(value.owner)) return invalid('owner is invalid');
	if (!isOwnerOrRepo(value.name)) return invalid('name is invalid');
	return {
		ok: true,
		value: { origin: value.origin, owner: value.owner, name: value.name },
	};
}

export function validateForgeReference(
	value: unknown,
): ForgeValidation<ForgeItemReference> {
	const repository = validateForgeRepository(value);
	if (!repository.ok) return repository;
	const record = value as Record<string, unknown>;
	if (!kinds.includes(record.kind as string)) return invalid('kind is invalid');
	if (!Number.isSafeInteger(record.number) || (record.number as number) < 1)
		return invalid('number must be a positive integer');
	return {
		ok: true,
		value: {
			...repository.value,
			kind: record.kind as ForgeItemKind,
			number: record.number as number,
		},
	};
}

export function sameForgeReference(
	a: ForgeItemReference,
	b: ForgeItemReference,
): boolean {
	return (
		a.kind === b.kind &&
		a.origin === b.origin &&
		a.number === b.number &&
		a.owner.toLowerCase() === b.owner.toLowerCase() &&
		a.name.toLowerCase() === b.name.toLowerCase()
	);
}

/**
 * Validates one summary. The canonical URL must be on the item's origin; a
 * check's URL may be any credential-free HTTPS URL, since CI often runs
 * elsewhere.
 */
export function validateForgeSummary(
	value: unknown,
): ForgeValidation<ForgeItemSummary> {
	if (!isRecord(value)) return invalid('summary must be an object');
	const reference = validateForgeReference(value.reference);
	if (!reference.ok) return invalid(`reference: ${reference.reason}`);
	const kind = reference.value.kind;
	if (!isText(value.title, EXTENSION_LIMITS.forgeTitleLength))
		return invalid('title is invalid');
	if (
		!isSafeHttpsUrl(value.url) ||
		new URL(value.url).origin !== reference.value.origin
	)
		return invalid('url must be a credential-free HTTPS URL on the origin');
	const states = kind === 'pullRequest' ? pullRequestStates : issueStates;
	if (!states.includes(value.state as string))
		return invalid('state is invalid for the kind');
	if (!isName(value.author, EXTENSION_LIMITS.forgeLoginLength))
		return invalid('author is invalid');
	if (
		!Array.isArray(value.labels) ||
		value.labels.length > EXTENSION_LIMITS.forgeLabels
	)
		return invalid('labels is invalid');
	const labels: ForgeLabel[] = [];
	for (const label of value.labels) {
		if (
			!isRecord(label) ||
			!isText(label.name, EXTENSION_LIMITS.forgeLabelNameLength) ||
			typeof label.color !== 'string' ||
			!/^[0-9a-fA-F]{6}$/.test(label.color)
		)
			return invalid('label is invalid');
		labels.push({ name: label.name as string, color: label.color.toLowerCase() });
	}
	if (!isCount(value.comments)) return invalid('comments is invalid');
	if (!isTime(value.createdAt) || !isTime(value.updatedAt))
		return invalid('times are invalid');
	const summary: ForgeItemSummary = {
		reference: reference.value,
		title: value.title as string,
		url: value.url,
		state: value.state as ForgeItemState,
		author: value.author,
		labels,
		comments: value.comments,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
	if (kind === 'pullRequest') {
		const facts = value.pullRequest;
		if (!isRecord(facts)) return invalid('pullRequest facts are required');
		if (
			!isName(facts.headBranch, EXTENSION_LIMITS.forgeBranchLength) ||
			!isName(facts.baseBranch, EXTENSION_LIMITS.forgeBranchLength)
		)
			return invalid('branches are invalid');
		if (!isOwnerOrRepo(facts.headOwner) || !isOwnerOrRepo(facts.headName))
			return invalid('head repository is invalid');
		if (
			facts.headCommit !== undefined &&
			!(
				typeof facts.headCommit === 'string' &&
				/^[0-9a-f]{7,64}$/i.test(facts.headCommit)
			)
		)
			return invalid('headCommit is invalid');
		let checks: WorktreeChecks | undefined;
		if (facts.checks !== undefined) {
			const result = validateWorktreeProperties({ checks: facts.checks });
			if (!result.ok || !result.value.checks)
				return invalid(`checks: ${result.ok ? 'missing' : result.reason}`);
			checks = result.value.checks;
		}
		summary.pullRequest = {
			headBranch: facts.headBranch,
			baseBranch: facts.baseBranch,
			headOwner: facts.headOwner,
			headName: facts.headName,
			...(facts.headCommit === undefined
				? {}
				: { headCommit: facts.headCommit as string }),
			...(checks ? { checks } : {}),
		};
	} else if (value.pullRequest !== undefined)
		return invalid('an issue has no pullRequest facts');
	return { ok: true, value: summary };
}

/** Validates a detail and checks it answers the reference that was asked for. */
export function validateForgeDetail(
	value: unknown,
	requested: ForgeItemReference,
): ForgeValidation<ForgeItemDetail> {
	if (!isRecord(value)) return invalid('detail must be an object');
	const summary = validateForgeSummary(value.summary);
	if (!summary.ok) return invalid(`summary: ${summary.reason}`);
	if (!sameForgeReference(summary.value.reference, requested))
		return invalid('detail is for a different item');
	if (!isText(value.body, EXTENSION_LIMITS.forgeBodyLength, true))
		return invalid('body is invalid');
	if (
		!Array.isArray(value.comments) ||
		value.comments.length > EXTENSION_LIMITS.forgeComments
	)
		return invalid('comments is invalid');
	const comments: ForgeComment[] = [];
	for (const comment of value.comments) {
		if (
			!isRecord(comment) ||
			!isName(comment.author, EXTENSION_LIMITS.forgeLoginLength) ||
			!isTime(comment.createdAt) ||
			!isText(comment.body, EXTENSION_LIMITS.forgeCommentLength, true)
		)
			return invalid('comment is invalid');
		comments.push({
			author: comment.author,
			createdAt: comment.createdAt,
			body: comment.body as string,
		});
	}
	return {
		ok: true,
		value: { summary: summary.value, body: value.body as string, comments },
	};
}

/** Validates a query before it is sent to a source. */
export function validateForgeQuery(value: unknown): ForgeValidation<ForgeQuery> {
	if (!isRecord(value)) return invalid('query must be an object');
	if (!kinds.includes(value.kind as string)) return invalid('kind is invalid');
	const kind = value.kind as ForgeItemKind;
	if (!forgeScopesFor(kind).includes(value.scope as ForgeScope))
		return invalid('scope is invalid for the kind');
	if (!forgeStatesFor(kind).includes(value.state as ForgeQueryState))
		return invalid('state is invalid for the kind');
	if (!isHttpsOrigin(value.origin))
		return invalid('origin must be an HTTPS origin');
	const query: ForgeQuery = {
		kind,
		scope: value.scope as ForgeScope,
		state: value.state as ForgeQueryState,
		origin: value.origin,
		pageSize: 0,
	};
	if (value.repositories !== undefined) {
		if (
			!Array.isArray(value.repositories) ||
			value.repositories.length === 0 ||
			value.repositories.length > EXTENSION_LIMITS.forgeQueryRepositories
		)
			return invalid('repositories must be a non-empty bounded list');
		query.repositories = [];
		for (const repository of value.repositories) {
			if (
				!isRecord(repository) ||
				!isOwnerOrRepo(repository.owner) ||
				!isOwnerOrRepo(repository.name)
			)
				return invalid('repository is invalid');
			query.repositories.push({
				owner: repository.owner,
				name: repository.name,
			});
		}
	}
	if (value.owners !== undefined) {
		if (
			!Array.isArray(value.owners) ||
			value.owners.length === 0 ||
			value.owners.length > EXTENSION_LIMITS.forgeQueryOwners ||
			!value.owners.every(isOwnerOrRepo)
		)
			return invalid('owners must be a non-empty bounded list');
		query.owners = [...(value.owners as string[])];
	}
	if (value.text !== undefined) {
		if (!isText(value.text, EXTENSION_LIMITS.forgeTextLength, true))
			return invalid('text is invalid');
		// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is refused
		if (/[\u0000-\u001f\u007f]/.test(value.text as string))
			return invalid('text is invalid');
		if ((value.text as string).trim()) query.text = (value.text as string).trim();
	}
	if (value.cursor !== undefined) {
		if (!isText(value.cursor, EXTENSION_LIMITS.forgeCursorLength))
			return invalid('cursor is invalid');
		query.cursor = value.cursor as string;
	}
	if (
		!Number.isSafeInteger(value.pageSize) ||
		(value.pageSize as number) < 1 ||
		(value.pageSize as number) > EXTENSION_LIMITS.forgePageSize
	)
		return invalid('pageSize is invalid');
	query.pageSize = value.pageSize as number;
	return { ok: true, value: query };
}

export interface ForgePageValidation {
	page: ForgePage;
	/** How many items were dropped as invalid or outside the query. */
	dropped: number;
}

/**
 * Validates a page against the query it answers. Invalid items and items
 * outside the query's origin, kind, repositories, or owners are dropped; the
 * rest of the page is kept. A malformed page as a whole is refused.
 */
export function validateForgePage(
	value: unknown,
	query: ForgeQuery,
): ForgeValidation<ForgePageValidation> {
	if (!isRecord(value)) return invalid('page must be an object');
	if (
		!Array.isArray(value.items) ||
		value.items.length > EXTENSION_LIMITS.forgePageSize
	)
		return invalid('items must be a bounded list');
	if (
		value.nextCursor !== undefined &&
		!isText(value.nextCursor, EXTENSION_LIMITS.forgeCursorLength)
	)
		return invalid('nextCursor is invalid');
	if (value.totalCount !== undefined && !isCount(value.totalCount))
		return invalid('totalCount is invalid');
	const repositories = query.repositories?.map(
		(repository) =>
			`${repository.owner.toLowerCase()}/${repository.name.toLowerCase()}`,
	);
	const owners = query.owners?.map((owner) => owner.toLowerCase());
	const items: ForgeItemSummary[] = [];
	let dropped = 0;
	for (const raw of value.items) {
		const result = validateForgeSummary(raw);
		if (!result.ok) {
			dropped += 1;
			continue;
		}
		const reference = result.value.reference;
		const owner = reference.owner.toLowerCase();
		if (
			reference.origin !== query.origin ||
			reference.kind !== query.kind ||
			(repositories &&
				!repositories.includes(`${owner}/${reference.name.toLowerCase()}`)) ||
			(owners && !owners.includes(owner))
		) {
			dropped += 1;
			continue;
		}
		items.push(result.value);
	}
	return {
		ok: true,
		value: {
			page: {
				items,
				...(value.nextCursor === undefined
					? {}
					: { nextCursor: value.nextCursor as string }),
				...(value.totalCount === undefined
					? {}
					: { totalCount: value.totalCount }),
			},
			dropped,
		},
	};
}

/** Validates an account list. Two accounts for one origin refuse the list. */
export function validateForgeAccounts(
	value: unknown,
): ForgeValidation<ForgeAccount[]> {
	if (!Array.isArray(value) || value.length > EXTENSION_LIMITS.forgeAccounts)
		return invalid('accounts must be a bounded list');
	const origins = new Set<string>();
	const accounts: ForgeAccount[] = [];
	for (const account of value) {
		if (!isRecord(account)) return invalid('account must be an object');
		if (!isHttpsOrigin(account.origin))
			return invalid('account origin must be an HTTPS origin');
		if (origins.has(account.origin))
			return invalid('two accounts for one origin');
		origins.add(account.origin);
		if (!isName(account.login, EXTENSION_LIMITS.forgeLoginLength))
			return invalid('account login is invalid');
		if (!credentialSources.includes(account.credentialSource as string))
			return invalid('account credentialSource is invalid');
		if (account.state !== 'ready' && account.state !== 'rejected')
			return invalid('account state is invalid');
		if (
			!Array.isArray(account.owners) ||
			account.owners.length > EXTENSION_LIMITS.forgeOwnersPerAccount ||
			!account.owners.every(isOwnerOrRepo)
		)
			return invalid('account owners is invalid');
		accounts.push({
			origin: account.origin,
			login: account.login,
			credentialSource: account.credentialSource as ForgeCredentialSource,
			state: account.state,
			owners: [...new Set(account.owners as string[])],
		});
	}
	return { ok: true, value: accounts };
}

/**
 * Validates a claim against the remote it answers: the claimed origin's host
 * must be the remote's host.
 */
export function validateForgeClaim(
	value: unknown,
	remote: ForgeRemote,
): ForgeValidation<ForgeRepository | null> {
	if (value === null || value === undefined) return { ok: true, value: null };
	const repository = validateForgeRepository(value);
	if (!repository.ok) return repository;
	const host = forgeRemoteHost(remote.url);
	if (!host || new URL(repository.value.origin).hostname.toLowerCase() !== host)
		return invalid('claim is for another host');
	return repository;
}

/** Validates a source contribution's own fields. */
export function isForgeAllReach(value: unknown): value is ForgeAllReach {
	return value === 'readable' || value === 'owners';
}

export function isForgeItemKind(value: unknown): value is ForgeItemKind {
	return kinds.includes(value as string);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(reason: string): { ok: false; reason: string } {
	return { ok: false, reason };
}
