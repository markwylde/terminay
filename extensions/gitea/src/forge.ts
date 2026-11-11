import type {
	ForgeAccount,
	ForgeComment,
	ForgeCredentialSource,
	ForgeItemDetail,
	ForgeItemReference,
	ForgeItemState,
	ForgeItemSummary,
	ForgeLabel,
	ForgePage,
	ForgeQuery,
	ForgeRemote,
	ForgeSourceRuntime,
	WorktreeCredentials,
} from '@terminay/extension-api';
import { isSafeHttpsUrl } from './https.js';
import { type GiteaCommitStatus, toChecks } from './mapping.js';
import type { GiteaProbe } from './probe.js';
import { parseRemoteUrl } from './remote.js';
import type { TeaTokenStore } from './teaConfig.js';

/** A fetch that also exposes response headers, for `X-Total-Count`. */
export type ForgeFetch = (
	input: string,
	init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{
	readonly status: number;
	readonly ok: boolean;
	readonly headers?: { get(name: string): string | null };
	json(): Promise<unknown>;
}>;

export interface GiteaForgeOptions {
	fetch: ForgeFetch;
	probe: GiteaProbe;
	tea: TeaTokenStore;
	credentials: WorktreeCredentials;
}

const REQUEST_TIMEOUT_MS = 15_000;
const CHECK_CONCURRENCY = 6;
const MAX_COMMENTS = 10;

class Unauthorized extends Error {}

interface Credential {
	token: string;
	source: ForgeCredentialSource;
}

/** One Gitea issue or pull request as `/repos/issues/search` returns it. */
interface GiteaIssue {
	number?: unknown;
	title?: unknown;
	html_url?: unknown;
	state?: unknown;
	body?: unknown;
	comments?: unknown;
	created_at?: unknown;
	updated_at?: unknown;
	user?: { login?: unknown } | null;
	labels?: Array<{ name?: unknown; color?: unknown }> | null;
	repository?: { owner?: unknown; name?: unknown; full_name?: unknown } | null;
	pull_request?: { merged?: unknown; draft?: unknown } | null;
}

interface GiteaPull {
	number?: unknown;
	draft?: unknown;
	merged?: unknown;
	state?: unknown;
	head?: { ref?: unknown; sha?: unknown; repo?: { owner?: { login?: unknown } | null; name?: unknown } | null } | null;
	base?: { ref?: unknown } | null;
}

/**
 * A stream is one Gitea search request. Involved merges four of them; each
 * position in the cursor is that stream's page and how many of its items
 * have been consumed, or null once it is done.
 */
type StreamCursor = { p: number; o: number } | null;

/**
 * The Gitea forge source (ADR-0105). Accounts are the tea logins and tokens
 * stored through sign-in, one per origin, choosing the credential the insight
 * source uses: tea first, then sign-in. Every call is HTTPS to the origin;
 * nothing runs `tea`.
 */
export function createGiteaForgeSource(options: GiteaForgeOptions): ForgeSourceRuntime & {
	/** Origins seen through claims or sign-in, which may hold a stored token. */
	readonly knownOrigins: Set<string>;
} {
	const knownOrigins = new Set<string>();
	const logins = new Map<string, string>();

	const credential = async (origin: string): Promise<Credential | undefined> => {
		const tea = await options.tea.token(origin);
		if (tea !== undefined) return { token: tea, source: 'cli-config' };
		const stored = await options.credentials.token(origin);
		if (stored !== undefined && stored.length > 0)
			return { token: stored, source: 'sign-in' };
		return undefined;
	};

	const reject = async (origin: string, value: Credential) => {
		if (value.source === 'cli-config') options.tea.reject(origin);
		else await options.credentials.reject(origin);
	};

	const get = async (
		origin: string,
		path: string,
		token: string,
		signal: AbortSignal,
	): Promise<{ body: unknown; total: number | undefined }> => {
		const response = await options.fetch(`${origin}/api/v1${path}`, {
			headers: { accept: 'application/json', authorization: `token ${token}` },
			signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
		});
		if (response.status === 401) throw new Unauthorized('unauthorized');
		if (!response.ok) throw new Error(`Gitea answered ${response.status}`);
		const total = Number(response.headers?.get('x-total-count') ?? Number.NaN);
		return {
			body: await response.json(),
			total: Number.isSafeInteger(total) && total >= 0 ? total : undefined,
		};
	};

	/** Run with the account's credential; a 401 rejects that credential. */
	const withCredential = async <T>(
		origin: string,
		work: (token: string) => Promise<T>,
	): Promise<T> => {
		const value = await credential(origin);
		if (value === undefined) throw new Error(`no Gitea account for ${origin}`);
		try {
			return await work(value.token);
		} catch (error) {
			if (error instanceof Unauthorized) {
				await reject(origin, value);
				throw new Error(`${origin} refused the Gitea token`);
			}
			throw error;
		}
	};

	const login = async (origin: string, token: string, signal: AbortSignal) => {
		const known = logins.get(origin);
		if (known !== undefined) return known;
		const user = (await get(origin, '/user', token, signal)).body as { login?: unknown };
		if (typeof user?.login !== 'string' || user.login.length === 0)
			throw new Error('Gitea did not say who the token belongs to');
		logins.set(origin, user.login);
		return user.login;
	};

	return {
		knownOrigins,

		async accounts(signal) {
			const origins = new Set([...(await options.tea.origins()), ...knownOrigins]);
			const accounts: ForgeAccount[] = [];
			for (const origin of origins) {
				const value = await credential(origin);
				if (value === undefined) continue;
				try {
					const name = await login(origin, value.token, signal);
					const orgs = (await get(origin, '/user/orgs?limit=50', value.token, signal)).body;
					const owners = [
						name,
						...(Array.isArray(orgs)
							? orgs
									.map((org) => (org as { username?: unknown; name?: unknown }).username ?? (org as { name?: unknown }).name)
									.filter((owner): owner is string => typeof owner === 'string' && owner.length > 0)
							: []),
					].slice(0, 50);
					accounts.push({ origin, login: name, credentialSource: value.source, state: 'ready', owners });
				} catch (error) {
					if (signal.aborted) throw error;
					if (error instanceof Unauthorized) {
						await reject(origin, value);
						accounts.push({
							origin,
							login: logins.get(origin) ?? (await options.tea.user(origin)) ?? 'unknown',
							credentialSource: value.source,
							state: 'rejected',
							owners: [],
						});
					}
				}
			}
			return accounts;
		},

		async claim(remote: ForgeRemote, signal) {
			const parsed = parseRemoteUrl(remote.url);
			if (parsed === undefined) return null;
			const isGitea = await options.probe.isGitea(parsed.origin, signal);
			if (isGitea !== true) return null;
			knownOrigins.add(parsed.origin);
			return { origin: parsed.origin, owner: parsed.owner, name: parsed.repo };
		},

		query(query: ForgeQuery, signal: AbortSignal): Promise<ForgePage> {
			return withCredential(query.origin, async (token) => {
				const streams = searchStreams(query);
				const cursor = decodeCursor(query.cursor, streams.length);
				const merged = await mergeStreams(streams, cursor, query.pageSize, (params) =>
					get(query.origin, `/repos/issues/search?${params}`, token, signal),
				);
				let items = merged.items
					.map((issue) => toSummary(issue, query))
					.filter((item): item is ForgeItemSummary => item !== undefined)
					.filter((item) => matchesQuery(item, query));
				if (query.kind === 'pullRequest') {
					await addPullRequestFacts(items, (path) => get(query.origin, path, token, signal).then((value) => value.body));
					// A pull request is listed only with its branches.
					items = items.filter((item) => item.pullRequest !== undefined);
				}
				return {
					items,
					...(merged.next === undefined ? {} : { nextCursor: merged.next }),
					...(merged.total === undefined || streams.length !== 1 || hasClientFilter(query)
						? {}
						: { totalCount: merged.total }),
				};
			});
		},

		detail(reference: ForgeItemReference, signal: AbortSignal): Promise<ForgeItemDetail> {
			return withCredential(reference.origin, async (token) => {
				const base = `/repos/${encodeURIComponent(reference.owner)}/${encodeURIComponent(reference.name)}`;
				const issue = (await get(reference.origin, `${base}/issues/${reference.number}`, token, signal)).body as GiteaIssue;
				const summary = toSummary(
					{ ...issue, repository: { owner: reference.owner, name: reference.name } },
					{ kind: reference.kind, origin: reference.origin },
				);
				if (summary === undefined) throw new Error('Gitea answered with an item Terminay cannot read');
				if (reference.kind === 'pullRequest') {
					await addPullRequestFacts([summary], (path) => get(reference.origin, path, token, signal).then((value) => value.body));
					if (summary.pullRequest === undefined) throw new Error('Gitea did not answer with the pull request');
				}
				// The most recent comments, oldest first.
				const count = typeof issue.comments === 'number' ? issue.comments : 0;
				const page = Math.max(1, Math.ceil(count / MAX_COMMENTS));
				const raw = count === 0
					? []
					: ((await get(reference.origin, `${base}/issues/${reference.number}/comments?limit=${MAX_COMMENTS}&page=${page}`, token, signal)).body as unknown[]);
				const comments: ForgeComment[] = (Array.isArray(raw) ? raw : [])
					.map((comment) => comment as { user?: { login?: unknown }; created_at?: unknown; body?: unknown })
					.filter((comment) => typeof comment.body === 'string' && typeof comment.created_at === 'string')
					.map((comment) => ({
						author: typeof comment.user?.login === 'string' ? comment.user.login : 'unknown',
						createdAt: comment.created_at as string,
						body: (comment.body as string).slice(0, 8_192),
					}))
					.slice(-MAX_COMMENTS);
				return {
					summary,
					body: typeof issue.body === 'string' ? issue.body.slice(0, 65_536) : '',
					comments,
				};
			});
		},
	};
}

/** The search requests a query needs: one, or four for Involved. */
export function searchStreams(query: Pick<ForgeQuery, 'kind' | 'scope' | 'state' | 'owners' | 'repositories' | 'text'>): URLSearchParams[] {
	const base = new URLSearchParams();
	base.set('type', query.kind === 'pullRequest' ? 'pulls' : 'issues');
	// Gitea has no merged filter; merged is closed, narrowed after.
	base.set('state', query.state === 'merged' ? 'closed' : query.state);
	const owner = singleOwner(query);
	if (owner !== undefined) base.set('owner', owner);
	if (query.text !== undefined && query.text.length > 0) base.set('q', query.text);
	const flag = (name: string) => {
		const params = new URLSearchParams(base);
		params.set(name, 'true');
		return params;
	};
	switch (query.scope) {
		case 'reviewRequested':
			return [flag('review_requested')];
		case 'authored':
			return [flag('created')];
		case 'assigned':
			return [flag('assigned')];
		case 'mentioned':
			return [flag('mentioned')];
		case 'involved':
			return [flag('created'), flag('assigned'), flag('mentioned'), flag('review_requested')];
		default:
			return [base];
	}
}

/** The one owner every narrowing names, when there is exactly one. */
function singleOwner(query: Pick<ForgeQuery, 'owners' | 'repositories'>): string | undefined {
	const owners = new Set<string>([
		...(query.owners ?? []).map((owner) => owner.toLowerCase()),
		...(query.repositories ?? []).map((repository) => repository.owner.toLowerCase()),
	]);
	return owners.size === 1 ? [...owners][0] : undefined;
}

function hasClientFilter(query: ForgeQuery): boolean {
	return (
		query.state === 'merged' ||
		query.repositories !== undefined ||
		(query.owners !== undefined && query.owners.length > 1)
	);
}

function decodeCursor(value: string | undefined, streams: number): StreamCursor[] {
	const fresh = Array.from({ length: streams }, () => ({ p: 1, o: 0 }));
	if (value === undefined) return fresh;
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!Array.isArray(parsed) || parsed.length !== streams) return fresh;
		return parsed.map((entry) =>
			entry === null
				? null
				: typeof entry === 'object' && Number.isSafeInteger(entry.p) && entry.p >= 1 && Number.isSafeInteger(entry.o) && entry.o >= 0
					? { p: entry.p as number, o: entry.o as number }
					: { p: 1, o: 0 },
		);
	} catch {
		return fresh;
	}
}

const ITEM_ORDER = (left: GiteaIssue, right: GiteaIssue) =>
	String(right.updated_at).localeCompare(String(left.updated_at)) ||
	issueKey(left).localeCompare(issueKey(right));

function issueKey(issue: GiteaIssue): string {
	const repository = issue.repository;
	const name = typeof repository?.full_name === 'string'
		? repository.full_name
		: `${repoOwner(repository)}/${String(repository?.name)}`;
	return `${name.toLowerCase()}#${String(issue.number)}`;
}

function repoOwner(repository: GiteaIssue['repository']): string {
	const owner = repository?.owner;
	if (typeof owner === 'string') return owner;
	if (typeof owner === 'object' && owner !== null && typeof (owner as { login?: unknown }).login === 'string')
		return (owner as { login: string }).login;
	return '';
}

/**
 * Merge sorted streams newest first. The same item seen in several streams
 * is taken once: all streams sit at that item together because they order
 * alike. The page stops early when a stream needs its next page, so the
 * cursor can say exactly where each stream is.
 */
export async function mergeStreams(
	streams: readonly URLSearchParams[],
	cursor: StreamCursor[],
	pageSize: number,
	fetchPage: (params: string) => Promise<{ body: unknown; total: number | undefined }>,
): Promise<{ items: GiteaIssue[]; next?: string; total?: number }> {
	const limit = Math.max(1, Math.min(50, pageSize));
	let total: number | undefined;
	const buffers = await Promise.all(
		streams.map(async (stream, index) => {
			const position = cursor[index];
			if (position == null) return { items: [] as GiteaIssue[], full: false };
			const params = new URLSearchParams(stream);
			params.set('page', String(position.p));
			params.set('limit', String(limit));
			const answer = await fetchPage(params.toString());
			if (streams.length === 1) total = answer.total;
			const items = Array.isArray(answer.body) ? (answer.body as GiteaIssue[]) : [];
			return { items: items.slice(position.o), full: items.length >= limit };
		}),
	);
	const out: GiteaIssue[] = [];
	const state = cursor.map((position) => (position == null ? null : { ...position }));
	while (out.length < limit) {
		let best: GiteaIssue | undefined;
		for (const buffer of buffers) {
			const head = buffer.items[0];
			if (head !== undefined && (best === undefined || ITEM_ORDER(head, best) < 0)) best = head;
		}
		if (best === undefined) break;
		const key = issueKey(best);
		let stalled = false;
		for (const [index, buffer] of buffers.entries()) {
			const head = buffer.items[0];
			if (head === undefined || issueKey(head) !== key) continue;
			buffer.items.shift();
			const position = state[index];
			if (position != null) position.o += 1;
			if (buffer.items.length === 0 && buffer.full) stalled = true;
		}
		out.push(best);
		if (stalled) break;
	}
	// Advance each stream: to its next page once its page is used up.
	const next = state.map((position, index) => {
		if (position == null) return null;
		const buffer = buffers[index] as { items: GiteaIssue[]; full: boolean };
		if (buffer.items.length > 0) return position;
		return buffer.full ? { p: position.p + 1, o: 0 } : null;
	});
	const more = next.some((position) => position !== null);
	return {
		items: out,
		...(more ? { next: JSON.stringify(next) } : {}),
		...(total === undefined ? {} : { total }),
	};
}

function toSummary(
	issue: GiteaIssue,
	query: { kind: ForgeQuery['kind']; origin: string },
): ForgeItemSummary | undefined {
	const repository = issue.repository;
	const fullName = typeof repository?.full_name === 'string' ? repository.full_name.split('/') : undefined;
	const owner = fullName?.[0] ?? repoOwner(repository);
	const name = fullName?.[1] ?? (typeof repository?.name === 'string' ? repository.name : '');
	if (
		!Number.isSafeInteger(issue.number) ||
		(issue.number as number) < 1 ||
		typeof issue.title !== 'string' ||
		!isSafeHttpsUrl(issue.html_url) ||
		owner.length === 0 ||
		name.length === 0 ||
		typeof issue.created_at !== 'string' ||
		typeof issue.updated_at !== 'string'
	)
		return undefined;
	const isPull = issue.pull_request != null;
	if ((query.kind === 'pullRequest') !== isPull) return undefined;
	let state: ForgeItemState = issue.state === 'closed' ? 'closed' : 'open';
	if (isPull && issue.pull_request?.merged === true) state = 'merged';
	else if (isPull && state === 'open' && issue.pull_request?.draft === true) state = 'draft';
	const labels: ForgeLabel[] = (issue.labels ?? [])
		.filter((label) => typeof label.name === 'string' && typeof label.color === 'string' && /^#?[0-9a-fA-F]{6}$/u.test(label.color))
		.map((label) => ({ name: (label.name as string).slice(0, 64), color: (label.color as string).replace(/^#/u, '').toLowerCase() }))
		.slice(0, 20);
	return {
		reference: { kind: query.kind, origin: query.origin, owner, name, number: issue.number as number },
		title: issue.title.slice(0, 512),
		url: issue.html_url,
		state,
		author: typeof issue.user?.login === 'string' ? issue.user.login : 'unknown',
		labels,
		comments: typeof issue.comments === 'number' && issue.comments >= 0 ? issue.comments : 0,
		createdAt: issue.created_at,
		updatedAt: issue.updated_at,
	};
}

/** Narrowings Gitea's search cannot express, applied to the page. */
function matchesQuery(item: ForgeItemSummary, query: ForgeQuery): boolean {
	if (query.state === 'merged' && item.state !== 'merged') return false;
	if (query.state === 'closed' && item.state === 'merged') return false;
	const owner = item.reference.owner.toLowerCase();
	if (query.owners !== undefined && !query.owners.some((value) => value.toLowerCase() === owner))
		return false;
	if (
		query.repositories !== undefined &&
		!query.repositories.some(
			(repository) =>
				repository.owner.toLowerCase() === owner &&
				repository.name.toLowerCase() === item.reference.name.toLowerCase(),
		)
	)
		return false;
	return true;
}

/** Head and base branches, and checks for open pull requests. */
async function addPullRequestFacts(
	items: ForgeItemSummary[],
	get: (path: string) => Promise<unknown>,
): Promise<void> {
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const item = items[next++] as ForgeItemSummary;
			const base = `/repos/${encodeURIComponent(item.reference.owner)}/${encodeURIComponent(item.reference.name)}`;
			try {
				const pull = (await get(`${base}/pulls/${item.reference.number}`)) as GiteaPull;
				const headRef = pull.head?.ref;
				const baseRef = pull.base?.ref;
				if (typeof headRef !== 'string' || typeof baseRef !== 'string') continue;
				const headRepo = pull.head?.repo;
				const sha = typeof pull.head?.sha === 'string' && /^[0-9a-f]{7,64}$/iu.test(pull.head.sha) ? pull.head.sha : undefined;
				let checks: ReturnType<typeof toChecks>;
				if (sha !== undefined && (item.state === 'open' || item.state === 'draft')) {
					const status = (await get(`${base}/commits/${encodeURIComponent(sha)}/status?limit=100`)) as { statuses?: unknown };
					checks = Array.isArray(status?.statuses)
						? toChecks(status.statuses as GiteaCommitStatus[], item.reference.origin)
						: undefined;
				}
				item.pullRequest = {
					headBranch: headRef,
					baseBranch: baseRef,
					headOwner: typeof headRepo?.owner?.login === 'string' ? headRepo.owner.login : item.reference.owner,
					headName: typeof headRepo?.name === 'string' ? headRepo.name : item.reference.name,
					...(sha === undefined ? {} : { headCommit: sha }),
					...(checks === undefined ? {} : { checks }),
				};
			} catch {
				/* an item without facts is still listed */
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(CHECK_CONCURRENCY, items.length) }, worker));
}
