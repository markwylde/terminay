import type {
	ForgeAccount,
	ForgeComment,
	ForgeCredentialSource,
	ForgeItemDetail,
	ForgeItemKind,
	ForgeItemReference,
	ForgeItemState,
	ForgeItemSummary,
	ForgeLabel,
	ForgePage,
	ForgeQuery,
	ForgeSourceRuntime,
	WorktreeCredentials,
} from '@terminay/extension-api';
import type { CliTokenStore } from './ghConfig.js';
import { isSafeHttpsUrl } from './https.js';
import { type GitHubCommit, toChecks } from './mapping.js';
import type { FetchLike, GitHubProbe } from './probe.js';
import { graphqlEndpoint, parseRemoteUrl } from './remote.js';

export interface GitHubForgeOptions {
	fetch: FetchLike;
	probe: GitHubProbe;
	cli: CliTokenStore;
	credentials: WorktreeCredentials;
	now?: () => number;
}

const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;

class Unauthorized extends Error {}
export class RateLimitedError extends Error {
	constructor(readonly until: number) {
		super(`GitHub's rate limit is spent until ${new Date(until).toISOString()}`);
	}
}

interface Credential {
	token: string;
	source: ForgeCredentialSource;
}

interface Viewer {
	login: string;
	owners: string[];
}

const ITEM_FIELDS = `number title url state createdAt updatedAt
      author { login }
      labels(first: 20) { nodes { name color } }
      comments { totalCount }
      repository { name owner { login } }`;

const PULL_FIELDS = `isDraft merged headRefName baseRefName headRefOid
      headRepository { name owner { login } }
      commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { totalCount nodes {
        __typename
        ... on CheckRun { name status conclusion detailsUrl }
        ... on StatusContext { context state targetUrl }
      } } } } } }`;

export const SEARCH_QUERY = `query($q: String!, $first: Int!, $after: String) {
  rateLimit { remaining resetAt }
  search(type: ISSUE, query: $q, first: $first, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      __typename
      ... on Issue { ${ITEM_FIELDS} }
      ... on PullRequest { ${ITEM_FIELDS} ${PULL_FIELDS} }
    }
  }
}`;

const DETAIL_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  rateLimit { remaining resetAt }
  repository(owner: $owner, name: $name) {
    issueOrPullRequest(number: $number) {
      __typename
      ... on Issue { ${ITEM_FIELDS} body comments(last: 10) { nodes { author { login } createdAt body } } }
      ... on PullRequest { ${ITEM_FIELDS} ${PULL_FIELDS} body comments(last: 10) { nodes { author { login } createdAt body } } }
    }
  }
}`;

const VIEWER_QUERY = `query {
  viewer { login organizations(first: 50) { nodes { login } } }
}`;

/** A login or organisation name, as GitHub allows them. */
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;
const REPOSITORY = /^[A-Za-z0-9._-]{1,100}$/u;

/**
 * The search string for one account's query. Every qualifier is fixed and
 * built from validated names; the person's text is one quoted phrase, so it
 * can never add a qualifier of its own.
 */
export function searchString(query: Pick<ForgeQuery, 'kind' | 'scope' | 'state' | 'owners' | 'repositories' | 'text'>, viewer: Viewer): string | undefined {
	const parts = [query.kind === 'pullRequest' ? 'is:pr' : 'is:issue', 'archived:false'];
	if (query.state === 'open') parts.push('is:open');
	else if (query.state === 'closed') parts.push('is:closed', ...(query.kind === 'pullRequest' ? ['is:unmerged'] : []));
	else if (query.state === 'merged') parts.push('is:merged');
	const scope: Record<string, string | undefined> = {
		reviewRequested: 'review-requested:@me',
		authored: 'author:@me',
		involved: 'involves:@me',
		assigned: 'assignee:@me',
		mentioned: 'mentions:@me',
	};
	let owners = query.owners?.filter((owner) => OWNER.test(owner));
	if (query.scope === 'all') {
		// All reaches the account's own and its organisations' repositories.
		const reach = viewer.owners.filter((owner) => OWNER.test(owner));
		owners =
			owners === undefined
				? reach
				: owners.filter((owner) => reach.some((value) => value.toLowerCase() === owner.toLowerCase()));
		if (owners.length === 0 && query.repositories === undefined) return undefined;
	} else {
		const qualifier = scope[query.scope];
		if (qualifier === undefined) return undefined;
		parts.push(qualifier);
	}
	if (query.repositories !== undefined) {
		const repositories = query.repositories.filter(
			(repository) => OWNER.test(repository.owner) && REPOSITORY.test(repository.name),
		);
		if (repositories.length === 0) return undefined;
		parts.push(...repositories.map((repository) => `repo:${repository.owner}/${repository.name}`));
	} else if (owners !== undefined) {
		if (owners.length === 0) return undefined;
		parts.push(...owners.map((owner) => `user:${owner}`));
	}
	const text = query.text?.replace(/["\\]/gu, ' ').replace(/\s+/gu, ' ').trim();
	if (text !== undefined && text.length > 0) parts.push(`"${text}"`);
	parts.push('sort:updated-desc');
	return parts.join(' ');
}

/**
 * The GitHub forge source (ADR-0106). Accounts are the hosts `gh` is logged
 * in to, the environment's token, and tokens stored through sign-in, one per
 * origin. Every call is GraphQL over HTTPS; `gh` runs only to read a keychain
 * token, as for worktree insights (ADR-0063).
 */
export function createGitHubForgeSource(options: GitHubForgeOptions): ForgeSourceRuntime & {
	readonly knownOrigins: Set<string>;
} {
	const now = options.now ?? Date.now;
	const knownOrigins = new Set<string>();
	const viewers = new Map<string, Viewer>();
	const notBefore = new Map<string, number>();

	const credential = async (origin: string): Promise<Credential | undefined> => {
		const cli = await options.cli.token(origin);
		if (cli !== undefined) return { token: cli, source: options.cli.sourceOf?.(origin) ?? 'cli' };
		const stored = await options.credentials.token(origin);
		if (stored !== undefined && stored.length > 0) return { token: stored, source: 'sign-in' };
		return undefined;
	};

	const reject = async (origin: string, value: Credential) => {
		viewers.delete(origin);
		if (value.source === 'sign-in') await options.credentials.reject(origin);
		else options.cli.reject(origin);
	};

	const graphql = async (
		origin: string,
		query: string,
		variables: Record<string, unknown>,
		token: string,
		signal: AbortSignal,
	): Promise<{ data: Record<string, unknown>; errors: readonly unknown[] }> => {
		const until = notBefore.get(origin) ?? 0;
		if (until > now()) throw new RateLimitedError(until);
		const response = await options.fetch(graphqlEndpoint(origin), {
			method: 'POST',
			headers: {
				accept: 'application/json',
				authorization: `bearer ${token}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify({ query, variables }),
			signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
		});
		if (response.status === 401) throw new Unauthorized('unauthorized');
		if (response.status === 403 || response.status === 429) {
			const retryAfter = Number(response.headers.get('retry-after'));
			const reset = Number(response.headers.get('x-ratelimit-reset'));
			const at =
				Number.isFinite(retryAfter) && retryAfter > 0
					? now() + retryAfter * 1_000
					: Number.isFinite(reset) && reset > 0
						? reset * 1_000
						: now() + DEFAULT_RATE_LIMIT_WAIT_MS;
			notBefore.set(origin, at);
			throw new RateLimitedError(at);
		}
		if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
		const body = (await response.json()) as { data?: unknown; errors?: unknown } | null;
		const errors = Array.isArray(body?.errors) ? body.errors : [];
		if (errors.some((error) => (error as { type?: unknown })?.type === 'RATE_LIMITED')) {
			const at = now() + DEFAULT_RATE_LIMIT_WAIT_MS;
			notBefore.set(origin, at);
			throw new RateLimitedError(at);
		}
		const data = (typeof body?.data === 'object' && body.data !== null ? body.data : {}) as Record<string, unknown>;
		const rateLimit = data.rateLimit as { remaining?: unknown; resetAt?: unknown } | undefined;
		if (rateLimit?.remaining === 0 && typeof rateLimit.resetAt === 'string') {
			const at = Date.parse(rateLimit.resetAt);
			if (Number.isFinite(at)) notBefore.set(origin, at);
		}
		return { data, errors };
	};

	const viewer = async (origin: string, token: string, signal: AbortSignal): Promise<Viewer> => {
		const known = viewers.get(origin);
		if (known !== undefined) return known;
		const { data } = await graphql(origin, VIEWER_QUERY, {}, token, signal);
		const value = data.viewer as { login?: unknown; organizations?: { nodes?: unknown } } | undefined;
		if (typeof value?.login !== 'string' || value.login.length === 0)
			throw new Error('GitHub did not say who the token belongs to');
		const orgs = Array.isArray(value.organizations?.nodes) ? value.organizations.nodes : [];
		const result = {
			login: value.login,
			owners: [
				value.login,
				...orgs
					.map((org) => (org as { login?: unknown } | null)?.login)
					.filter((login): login is string => typeof login === 'string' && login.length > 0),
			].slice(0, 50),
		};
		viewers.set(origin, result);
		return result;
	};

	const withCredential = async <T>(origin: string, work: (token: string) => Promise<T>): Promise<T> => {
		const value = await credential(origin);
		if (value === undefined) throw new Error(`no GitHub account for ${origin}`);
		try {
			return await work(value.token);
		} catch (error) {
			if (error instanceof Unauthorized) {
				await reject(origin, value);
				throw new Error(`${origin} refused the GitHub token`);
			}
			throw error;
		}
	};

	return {
		knownOrigins,

		async accounts(signal) {
			const origins = new Set([...(await options.cli.origins()), ...knownOrigins]);
			const accounts: ForgeAccount[] = [];
			for (const origin of origins) {
				const value = await credential(origin);
				if (value === undefined) continue;
				try {
					const found = await viewer(origin, value.token, signal);
					accounts.push({ origin, login: found.login, credentialSource: value.source, state: 'ready', owners: found.owners });
				} catch (error) {
					if (signal.aborted) throw error;
					if (error instanceof Unauthorized) {
						await reject(origin, value);
						accounts.push({ origin, login: 'unknown', credentialSource: value.source, state: 'rejected', owners: [] });
					}
				}
			}
			return accounts;
		},

		async claim(remote, signal) {
			const parsed = parseRemoteUrl(remote.url);
			if (parsed === undefined) return null;
			if ((await options.probe.isGitHub(parsed.origin, signal)) !== true) return null;
			knownOrigins.add(parsed.origin);
			return { origin: parsed.origin, owner: parsed.owner, name: parsed.repo };
		},

		query(query, signal): Promise<ForgePage> {
			return withCredential(query.origin, async (token) => {
				const q = searchString(query, await viewer(query.origin, token, signal));
				if (q === undefined) return { items: [], totalCount: 0 };
				const { data } = await graphql(
					query.origin,
					SEARCH_QUERY,
					{ q, first: Math.max(1, Math.min(50, query.pageSize)), ...(query.cursor === undefined ? {} : { after: query.cursor }) },
					token,
					signal,
				);
				const search = data.search as {
					issueCount?: unknown;
					pageInfo?: { hasNextPage?: unknown; endCursor?: unknown };
					nodes?: unknown;
				} | undefined;
				const nodes = Array.isArray(search?.nodes) ? search.nodes : [];
				const items = nodes
					.map((node) => toSummary(node as GitHubItem, query.kind, query.origin))
					.filter((item): item is ForgeItemSummary => item !== undefined);
				const next = search?.pageInfo?.hasNextPage === true && typeof search.pageInfo.endCursor === 'string'
					? search.pageInfo.endCursor
					: undefined;
				return {
					items,
					...(next === undefined ? {} : { nextCursor: next }),
					...(typeof search?.issueCount === 'number' ? { totalCount: search.issueCount } : {}),
				};
			});
		},

		detail(reference: ForgeItemReference, signal): Promise<ForgeItemDetail> {
			return withCredential(reference.origin, async (token) => {
				const { data } = await graphql(
					reference.origin,
					DETAIL_QUERY,
					{ owner: reference.owner, name: reference.name, number: reference.number },
					token,
					signal,
				);
				const node = (data.repository as { issueOrPullRequest?: unknown } | null)?.issueOrPullRequest as
					| (GitHubItem & { body?: unknown; comments?: { nodes?: unknown } })
					| undefined;
				const summary = node === undefined ? undefined : toSummary(node, reference.kind, reference.origin);
				if (node === undefined || summary === undefined) throw new Error('GitHub did not answer with that item');
				const raw = Array.isArray(node.comments?.nodes) ? node.comments.nodes : [];
				const comments: ForgeComment[] = raw
					.map((comment) => comment as { author?: { login?: unknown } | null; createdAt?: unknown; body?: unknown } | null)
					.filter((comment) => typeof comment?.body === 'string' && typeof comment?.createdAt === 'string')
					.map((comment) => ({
						author: typeof comment?.author?.login === 'string' ? comment.author.login : 'ghost',
						createdAt: comment?.createdAt as string,
						body: String(comment?.body ?? '').slice(0, 8_192),
					}))
					.slice(-10);
				return { summary, body: typeof node.body === 'string' ? node.body.slice(0, 65_536) : '', comments };
			});
		},
	};
}

interface GitHubItem {
	__typename?: unknown;
	number?: unknown;
	title?: unknown;
	url?: unknown;
	state?: unknown;
	createdAt?: unknown;
	updatedAt?: unknown;
	author?: { login?: unknown } | null;
	labels?: { nodes?: unknown } | null;
	comments?: { totalCount?: unknown } | null;
	repository?: { name?: unknown; owner?: { login?: unknown } | null } | null;
	isDraft?: unknown;
	merged?: unknown;
	headRefName?: unknown;
	baseRefName?: unknown;
	headRefOid?: unknown;
	headRepository?: { name?: unknown; owner?: { login?: unknown } | null } | null;
	commits?: { nodes?: unknown } | null;
}

function toSummary(node: GitHubItem, kind: ForgeItemKind, origin: string): ForgeItemSummary | undefined {
	const isPull = node.__typename === 'PullRequest';
	if ((kind === 'pullRequest') !== isPull) return undefined;
	const owner = node.repository?.owner?.login;
	const name = node.repository?.name;
	if (
		!Number.isSafeInteger(node.number) ||
		(node.number as number) < 1 ||
		typeof node.title !== 'string' ||
		!isSafeHttpsUrl(node.url) ||
		typeof owner !== 'string' ||
		typeof name !== 'string' ||
		typeof node.createdAt !== 'string' ||
		typeof node.updatedAt !== 'string'
	)
		return undefined;
	let state: ForgeItemState = node.state === 'OPEN' ? 'open' : 'closed';
	if (isPull && (node.merged === true || node.state === 'MERGED')) state = 'merged';
	else if (isPull && state === 'open' && node.isDraft === true) state = 'draft';
	const labels: ForgeLabel[] = (Array.isArray(node.labels?.nodes) ? node.labels.nodes : [])
		.map((label) => label as { name?: unknown; color?: unknown } | null)
		.filter((label) => typeof label?.name === 'string' && typeof label?.color === 'string' && /^[0-9a-fA-F]{6}$/u.test(label.color))
		.map((label) => ({ name: String(label?.name ?? '').slice(0, 64), color: String(label?.color ?? '').toLowerCase() }))
		.slice(0, 20);
	const summary: ForgeItemSummary = {
		reference: { kind, origin, owner, name, number: node.number as number },
		title: node.title.slice(0, 512),
		url: node.url,
		state,
		author: typeof node.author?.login === 'string' ? node.author.login : 'ghost',
		labels,
		comments: typeof node.comments?.totalCount === 'number' ? node.comments.totalCount : 0,
		createdAt: node.createdAt,
		updatedAt: node.updatedAt,
	};
	if (isPull) {
		if (typeof node.headRefName !== 'string' || typeof node.baseRefName !== 'string') return undefined;
		const commit = (Array.isArray(node.commits?.nodes) ? node.commits.nodes : [])
			.map((entry) => (entry as { commit?: GitHubCommit } | null)?.commit)
			.at(-1);
		const checks = state === 'open' || state === 'draft' ? toChecks(commit) : undefined;
		summary.pullRequest = {
			headBranch: node.headRefName,
			baseBranch: node.baseRefName,
			// A deleted fork has no head repository; it can never match a worktree.
			headOwner: typeof node.headRepository?.owner?.login === 'string' ? node.headRepository.owner.login : 'ghost',
			headName: typeof node.headRepository?.name === 'string' ? node.headRepository.name : name,
			...(typeof node.headRefOid === 'string' && /^[0-9a-f]{7,64}$/iu.test(node.headRefOid) ? { headCommit: node.headRefOid } : {}),
			...(checks === undefined ? {} : { checks }),
		};
	}
	return summary;
}
