import {
	EXTENSION_LIMITS,
	type ForgeAccount,
	type ForgeAllReach,
	type ForgeItemDetail,
	type ForgeItemKind,
	type ForgeItemReference,
	type ForgeItemSummary,
	type ForgePageValidation,
	type ForgeQuery,
	type ForgeQueryState,
	type ForgeRemote,
	type ForgeRepository,
	type ForgeScope,
	type ForgeSourceContribution,
	forgeScopesFor,
	forgeStatesFor,
	isHttpsOrigin,
	type RepositoryContext,
	validateForgeReference,
} from '@terminay/extension-api';
import { randomUUID } from 'node:crypto';

/**
 * The host forge service (ADR-0105). It asks forge sources for accounts,
 * claims, pages, and details on demand; narrows every query by authority and
 * settings, failing closed; merges pages across accounts; joins pull requests
 * to open projects' worktrees; and keeps answers in memory for at most 60
 * seconds. Nothing a source returns is written to disk.
 */

export const FORGE_CACHE_MS = 60_000;
/** How many extra pages one merged page may pull from one account. */
const MAX_REFILLS = 3;

export interface ForgeServiceSourceEntry {
	readonly extensionId: string;
	readonly contribution: ForgeSourceContribution;
}

export type ForgeServiceHostEvent =
	| Readonly<{ kind: 'invalidate'; extensionId: string; sourceId: string; origin: string }>
	| Readonly<{ kind: 'stopped'; extensionId: string; sourceId: string }>;

/** The extension host manager, as the forge service uses it. */
export interface ForgeHosts {
	forgeSourceContributions(): readonly ForgeServiceSourceEntry[];
	forgeSourceAccounts(sourceId: string, signal?: AbortSignal): Promise<ForgeAccount[]>;
	claimForgeRemote(
		sourceId: string,
		remote: ForgeRemote,
		signal?: AbortSignal,
	): Promise<ForgeRepository | null>;
	queryForgeSource(
		sourceId: string,
		query: ForgeQuery,
		signal?: AbortSignal,
	): Promise<ForgePageValidation>;
	forgeSourceDetail(
		sourceId: string,
		reference: ForgeItemReference,
		signal?: AbortSignal,
	): Promise<ForgeItemDetail>;
	onContributionsChanged(listener: () => void | Promise<void>): () => void;
	onForgeSourceEvent(listener: (event: ForgeServiceHostEvent) => void): () => void;
	notifyForgeCredential?(extensionId: string, origin: string): Promise<void>;
}

/** Open projects' repository contexts, as the worktree insight service issues them. */
export interface ForgeProjects {
	repositoryContexts(): ReadonlyArray<{
		readonly projectId: string;
		readonly repositoryId?: string;
		readonly context: RepositoryContext;
	}>;
	onContextsChanged(listener: (projectId: string) => void): () => void;
}

/** Sign-in tokens, bound per extension and origin in the server vault. */
export interface ForgeCredentialStore {
	hasToken(extensionId: string, origin: string): boolean;
	storeToken(
		extensionId: string,
		origin: string,
		provider: string,
		token: string,
	): Promise<void>;
	removeToken(extensionId: string, origin: string): Promise<void>;
}

export type ForgeRepositoryScope = 'all' | 'openProjects' | 'owners';

export interface ForgeExtensionSettings {
	readonly repositories: ForgeRepositoryScope;
	readonly owners: readonly string[];
	readonly pullRequestsOnHome: boolean;
	readonly issuesOnHome: boolean;
	readonly projectTabs: boolean;
}

export const DEFAULT_FORGE_SETTINGS: ForgeExtensionSettings = Object.freeze({
	repositories: 'all',
	owners: Object.freeze([]) as readonly string[],
	pullRequestsOnHome: true,
	issuesOnHome: true,
	projectTabs: true,
});

export interface ForgeSettingsStore {
	load(): Promise<Readonly<Record<string, ForgeExtensionSettings>>>;
	save(settings: Readonly<Record<string, ForgeExtensionSettings>>): Promise<void>;
}

/** Who is asking: the same shape as Git authorization. */
export interface ForgeCaller {
	readonly scope: 'read' | 'write' | 'admin';
	/** Set when the client is bound to one project. */
	readonly projectId?: string;
}

export type ForgePurpose = 'home' | 'project';

export interface ForgeRepositoryFilter {
	readonly origin: string;
	readonly owner: string;
	readonly name: string;
}

export interface ForgeListRequest {
	readonly kind: ForgeItemKind;
	readonly scope: ForgeScope;
	readonly state: ForgeQueryState;
	readonly purpose: ForgePurpose;
	/** For `project`: the project whose claimed repositories are listed. */
	readonly projectId?: string;
	/** Narrow to these repositories (a project tab's or Home's filter). */
	readonly repositories?: readonly ForgeRepositoryFilter[];
	readonly text?: string;
	readonly pageSize?: number;
	readonly cursor?: string;
	/** Ignore cached pages. */
	readonly fresh?: boolean;
}

export interface ForgeWorktreeMatch {
	readonly projectId: string;
	readonly worktreeId: string;
	readonly branch: string;
	/** Where it is, so the client can select its folder; only for authorized projects. */
	readonly path?: string;
	readonly repositoryId?: string;
}

export interface ForgeListItem {
	readonly sourceId: string;
	readonly item: ForgeItemSummary;
	readonly worktrees: readonly ForgeWorktreeMatch[];
}

export interface ForgeSourceOutcome {
	readonly sourceId: string;
	readonly displayName: string;
	readonly origin: string;
	readonly state: 'ok' | 'failed';
	readonly error?: string;
}

export interface ForgeListResult {
	readonly items: readonly ForgeListItem[];
	readonly sources: readonly ForgeSourceOutcome[];
	readonly nextCursor?: string;
	readonly totalCount?: number;
	readonly fetchedAt: number;
	/** No account is set up on any source that serves this kind. */
	readonly noAccounts: boolean;
}

export interface ForgeSourceSummary {
	readonly sourceId: string;
	readonly extensionId: string;
	readonly displayName: string;
	readonly kinds: readonly ForgeItemKind[];
	readonly allReach: ForgeAllReach;
	readonly settings: ForgeExtensionSettings;
}

export interface ForgeProjectClaim {
	readonly sourceId: string;
	readonly origin: string;
	readonly owner: string;
	readonly name: string;
	readonly remotes: readonly string[];
	readonly kinds: readonly ForgeItemKind[];
	readonly projectTabs: boolean;
}

export class ForgeServiceError extends Error {
	constructor(
		readonly code: 'forbidden' | 'invalid' | 'unavailable' | 'not-found',
		message: string,
	) {
		super(message);
		this.name = 'ForgeServiceError';
	}
}

export interface ForgeServiceOptions {
	readonly hosts: ForgeHosts;
	readonly projects: ForgeProjects;
	readonly credentials?: ForgeCredentialStore;
	readonly settings?: ForgeSettingsStore;
	readonly now?: () => number;
	/** Something visible may have changed; clients refresh what they show. */
	readonly onChanged?: (change: ForgeChange) => void;
	readonly onError?: (message: string) => void;
}

export type ForgeChange = Readonly<{
	reason: 'sources' | 'invalidate' | 'settings' | 'accounts' | 'projects';
	origin?: string;
	projectId?: string;
}>;

interface CacheEntry<T> {
	readonly at: number;
	readonly generation: number;
	readonly value: Promise<T>;
}

interface Stream {
	readonly sourceId: string;
	readonly origin: string;
	readonly query: Omit<ForgeQuery, 'cursor'>;
	cursor?: string;
	done: boolean;
	buffer: ForgeItemSummary[];
	failed?: string;
	total?: number;
}

interface Continuation {
	readonly at: number;
	readonly key: string;
	readonly streams: Stream[];
	readonly emitted: Set<string>;
	readonly outcomes: ForgeSourceOutcome[];
}

export class ForgeService {
	private readonly now: () => number;
	private readonly generations = new Map<string, number>();
	private readonly accountCache = new Map<string, CacheEntry<ForgeAccount[]>>();
	private readonly claimCache = new Map<string, CacheEntry<ForgeRepository | null>>();
	private readonly pageCache = new Map<string, CacheEntry<ForgePageValidation>>();
	private readonly detailCache = new Map<string, CacheEntry<ForgeItemDetail>>();
	private readonly continuations = new Map<string, Continuation>();
	private settings: Record<string, ForgeExtensionSettings> | undefined;
	private settingsLoad: Promise<void> | undefined;
	private readonly unsubscribe: Array<() => void> = [];
	private readonly listeners = new Set<(change: ForgeChange) => void>();

	constructor(private readonly options: ForgeServiceOptions) {
		this.now = options.now ?? Date.now;
		this.unsubscribe.push(
			options.hosts.onContributionsChanged(() => {
				const live = new Set(this.entries().map((entry) => entry.contribution.id));
				for (const sourceId of [...this.generations.keys()])
					if (!live.has(sourceId)) this.dropSource(sourceId);
				this.emit({ reason: 'sources' });
			}),
			options.hosts.onForgeSourceEvent((event) => {
				if (event.kind === 'stopped') {
					this.dropSource(event.sourceId);
					this.emit({ reason: 'sources' });
					return;
				}
				this.dropOrigin(event.sourceId, event.origin);
				this.emit({ reason: 'invalidate', origin: event.origin });
			}),
			options.projects.onContextsChanged((projectId) => {
				this.emit({ reason: 'projects', projectId });
			}),
		);
	}

	dispose(): void {
		for (const stop of this.unsubscribe.splice(0)) stop();
		this.listeners.clear();
		this.clear();
	}

	/** Follow changes that may alter what a client shows. */
	subscribe(listener: (change: ForgeChange) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	// ── Sources and settings ────────────────────────────────────────────

	private entries(): readonly ForgeServiceSourceEntry[] {
		return this.options.hosts.forgeSourceContributions();
	}

	private entry(sourceId: string): ForgeServiceSourceEntry | undefined {
		return this.entries().find((entry) => entry.contribution.id === sourceId);
	}

	private async loadSettings(): Promise<Record<string, ForgeExtensionSettings>> {
		this.settingsLoad ??= (async () => {
			const stored = await this.options.settings?.load().catch(() => ({}));
			this.settings = {};
			for (const [extensionId, value] of Object.entries(stored ?? {}))
				this.settings[extensionId] = normalizeSettings(value);
		})();
		await this.settingsLoad;
		return this.settings ?? {};
	}

	async settingsFor(extensionId: string): Promise<ForgeExtensionSettings> {
		return (await this.loadSettings())[extensionId] ?? DEFAULT_FORGE_SETTINGS;
	}

	/** The sources a caller may see, with their settings. */
	async sources(caller: ForgeCaller): Promise<ForgeSourceSummary[]> {
		requireScope(caller, 'read');
		const result: ForgeSourceSummary[] = [];
		for (const entry of this.entries()) {
			const settings = await this.settingsFor(entry.extensionId);
			result.push({
				sourceId: entry.contribution.id,
				extensionId: entry.extensionId,
				displayName: entry.contribution.displayName,
				kinds: [...entry.contribution.kinds],
				allReach: entry.contribution.allReach,
				settings:
					caller.projectId === undefined
						? settings
						: {
								...DEFAULT_FORGE_SETTINGS,
								pullRequestsOnHome: false,
								issuesOnHome: false,
								projectTabs: settings.projectTabs,
							},
			});
		}
		return result;
	}

	async setSettings(
		caller: ForgeCaller,
		extensionId: string,
		value: unknown,
	): Promise<ForgeExtensionSettings> {
		requireScope(caller, 'admin');
		if (caller.projectId !== undefined)
			throw new ForgeServiceError('forbidden', 'forge settings need an unbound client');
		if (!this.entries().some((entry) => entry.extensionId === extensionId))
			throw new ForgeServiceError('not-found', 'the extension has no forge source');
		const settings = await this.loadSettings();
		const next = normalizeSettings(value, true);
		settings[extensionId] = next;
		await this.options.settings?.save({ ...settings });
		for (const entry of this.entries())
			if (entry.extensionId === extensionId) this.dropSource(entry.contribution.id);
		this.emit({ reason: 'settings' });
		return next;
	}

	// ── Accounts ────────────────────────────────────────────────────────

	private accountsOf(sourceId: string, fresh = false): Promise<ForgeAccount[]> {
		return this.cached(
			this.accountCache,
			sourceId,
			sourceId,
			fresh,
			(signal) => this.options.hosts.forgeSourceAccounts(sourceId, signal),
		);
	}

	async accounts(
		caller: ForgeCaller,
		fresh = false,
	): Promise<
		Array<{
			sourceId: string;
			extensionId: string;
			accounts: Array<ForgeAccount & { removable: boolean }>;
			error?: string;
		}>
	> {
		requireScope(caller, 'read');
		if (caller.projectId !== undefined)
			throw new ForgeServiceError('forbidden', 'accounts need an unbound client');
		return Promise.all(
			this.entries().map(async (entry) => {
				const sourceId = entry.contribution.id;
				try {
					const accounts = await this.accountsOf(sourceId, fresh);
					return {
						sourceId,
						extensionId: entry.extensionId,
						accounts: accounts.map((account) => ({
							...account,
							removable: account.credentialSource === 'sign-in',
						})),
					};
				} catch (error) {
					return {
						sourceId,
						extensionId: entry.extensionId,
						accounts: [],
						error: message(error),
					};
				}
			}),
		);
	}

	/** Owners each extension's accounts can act for: the Chosen owners catalogue. */
	async owners(caller: ForgeCaller): Promise<Record<string, string[]>> {
		const result: Record<string, string[]> = {};
		for (const source of await this.accounts(caller)) {
			const owners = new Set(result[source.extensionId] ?? []);
			for (const account of source.accounts)
				for (const owner of account.owners) owners.add(owner);
			result[source.extensionId] = [...owners].sort((a, b) =>
				a.localeCompare(b),
			);
		}
		return result;
	}

	/**
	 * Add an account through a token. The origin must be claimed by one of
	 * the extension's sources before anything is stored.
	 */
	async addAccount(
		caller: ForgeCaller,
		extensionId: string,
		origin: string,
		token: string,
	): Promise<void> {
		requireScope(caller, 'admin');
		if (caller.projectId !== undefined)
			throw new ForgeServiceError('forbidden', 'accounts need an unbound client');
		if (!isHttpsOrigin(origin))
			throw new ForgeServiceError('invalid', 'the origin must be an HTTPS origin');
		const sources = this.entries().filter((entry) => entry.extensionId === extensionId);
		if (sources.length === 0)
			throw new ForgeServiceError('not-found', 'the extension has no forge source');
		const credentials = this.options.credentials;
		if (credentials === undefined)
			throw new ForgeServiceError('unavailable', 'the server vault is unavailable');
		let claimed = false;
		for (const entry of sources) {
			const claim = await this.options.hosts
				.claimForgeRemote(entry.contribution.id, {
					name: 'origin',
					url: `${origin}/terminay-probe/terminay-probe.git`,
				})
				.catch(() => null);
			if (claim !== null && claim.origin === origin) claimed = true;
		}
		if (!claimed)
			throw new ForgeServiceError(
				'invalid',
				`${new URL(origin).host} is not a ${sources[0]?.contribution.displayName ?? 'forge'} server`,
			);
		await credentials.storeToken(
			extensionId,
			origin,
			sources[0]?.contribution.displayName ?? 'Forge',
			token,
		);
		await this.options.hosts
			.notifyForgeCredential?.(extensionId, origin)
			.catch(() => undefined);
		for (const entry of sources) this.dropSource(entry.contribution.id);
		this.emit({ reason: 'accounts', origin });
	}

	async removeAccount(
		caller: ForgeCaller,
		extensionId: string,
		origin: string,
	): Promise<void> {
		requireScope(caller, 'admin');
		if (caller.projectId !== undefined)
			throw new ForgeServiceError('forbidden', 'accounts need an unbound client');
		const sources = this.entries().filter((entry) => entry.extensionId === extensionId);
		for (const entry of sources) {
			const accounts = await this.accountsOf(entry.contribution.id).catch(() => []);
			const account = accounts.find((candidate) => candidate.origin === origin);
			if (account !== undefined && account.credentialSource !== 'sign-in')
				throw new ForgeServiceError(
					'forbidden',
					'an account from a CLI configuration cannot be removed here',
				);
		}
		await this.options.credentials?.removeToken(extensionId, origin);
		for (const entry of sources) this.dropSource(entry.contribution.id);
		this.emit({ reason: 'accounts', origin });
	}

	// ── Claims and joins ────────────────────────────────────────────────

	private claimOf(sourceId: string, remote: ForgeRemote): Promise<ForgeRepository | null> {
		return this.cached(
			this.claimCache,
			`${sourceId}\u0000${remote.url}`,
			sourceId,
			false,
			(signal) => this.options.hosts.claimForgeRemote(sourceId, remote, signal),
			Number.POSITIVE_INFINITY,
		);
	}

	/** Every claimed repository of one project, per source. */
	private async projectClaims(projectId: string): Promise<ForgeProjectClaim[]> {
		const project = this.options.projects
			.repositoryContexts()
			.find((candidate) => candidate.projectId === projectId);
		if (project === undefined) return [];
		const claims = new Map<string, ForgeProjectClaim>();
		for (const entry of this.entries()) {
			const sourceId = entry.contribution.id;
			const settings = await this.settingsFor(entry.extensionId);
			for (const remote of project.context.remotes) {
				const claim = await this.claimOf(sourceId, remote).catch(() => null);
				if (claim === null) continue;
				const key = `${sourceId}\u0000${repositoryKey(claim)}`;
				const existing = claims.get(key);
				claims.set(key, {
					sourceId,
					origin: claim.origin,
					owner: claim.owner,
					name: claim.name,
					remotes: [...(existing?.remotes ?? []), remote.name],
					kinds: [...entry.contribution.kinds],
					projectTabs: settings.projectTabs,
				});
			}
		}
		return [...claims.values()];
	}

	/**
	 * Server-internal: the project's remote names claimed for a repository, for
	 * worktree creation to choose from. The Git adapter has already checked
	 * the caller's authority for the project.
	 */
	async claimedRemotes(
		projectId: string,
		repository: Readonly<{ origin: string; owner: string; name: string }>,
	): Promise<string[]> {
		const key = repositoryKey(repository);
		const remotes = new Set<string>();
		for (const claim of await this.projectClaims(projectId))
			if (repositoryKey(claim) === key)
				for (const remote of claim.remotes) remotes.add(remote);
		return [...remotes];
	}

	/** The repositories a project's remotes map to. */
	async claims(caller: ForgeCaller, projectId: string): Promise<ForgeProjectClaim[]> {
		requireScope(caller, 'read');
		requireProject(caller, projectId);
		return this.projectClaims(projectId);
	}

	/** Pull request → worktrees of open projects (ADR-0105 §3). */
	private async matchWorktrees(
		item: ForgeItemSummary,
		sourceId: string,
		caller: ForgeCaller,
	): Promise<ForgeWorktreeMatch[]> {
		const facts = item.pullRequest;
		if (item.reference.kind !== 'pullRequest' || facts === undefined) return [];
		if (
			facts.headOwner.toLowerCase() !== item.reference.owner.toLowerCase() ||
			facts.headName.toLowerCase() !== item.reference.name.toLowerCase()
		)
			return [];
		const key = repositoryKey(item.reference);
		const matches: ForgeWorktreeMatch[] = [];
		for (const project of this.options.projects.repositoryContexts()) {
			if (caller.projectId !== undefined && caller.projectId !== project.projectId)
				continue;
			const claim = (await this.projectClaims(project.projectId)).find(
				(candidate) =>
					candidate.sourceId === sourceId && repositoryKey(candidate) === key,
			);
			if (claim === undefined) continue;
			for (const worktree of project.context.worktrees) {
				if (worktree.branch === null) continue;
				const tracks =
					worktree.upstream !== null &&
					worktree.upstream.branch === facts.headBranch &&
					claim.remotes.includes(worktree.upstream.remote);
				if (worktree.branch === facts.headBranch || tracks)
					matches.push({
						projectId: project.projectId,
						worktreeId: worktree.id,
						branch: worktree.branch,
						path: worktree.path,
						...(project.repositoryId === undefined
							? {}
							: { repositoryId: project.repositoryId }),
					});
			}
		}
		return matches;
	}

	// ── Queries ─────────────────────────────────────────────────────────

	/** One merged page of items (ADR-0105 §1, §5). */
	async list(caller: ForgeCaller, request: ForgeListRequest): Promise<ForgeListResult> {
		requireScope(caller, 'read');
		const checked = checkListRequest(request);
		if (caller.projectId !== undefined) {
			if (checked.purpose !== 'project')
				throw new ForgeServiceError('forbidden', 'Home lists need an unbound client');
			requireProject(caller, checked.projectId);
		}
		const pageSize = checked.pageSize;
		const key = listKey(caller, checked);
		let continuation: Continuation;
		if (checked.cursor !== undefined) {
			const found = this.continuations.get(checked.cursor);
			if (found === undefined || found.key !== key)
				throw new ForgeServiceError('invalid', 'the list has expired; refresh it');
			continuation = found;
			this.continuations.delete(checked.cursor);
		} else {
			const { streams, outcomes, noAccounts } = await this.openStreams(caller, checked);
			continuation = { at: this.now(), key, streams, emitted: new Set(), outcomes };
			if (noAccounts && streams.length === 0)
				return {
					items: [],
					sources: outcomes,
					fetchedAt: this.now(),
					noAccounts: true,
				};
		}
		const items: ForgeListItem[] = [];
		for (let round = 0; round <= MAX_REFILLS; round += 1) {
			await Promise.all(
				continuation.streams
					.filter((stream) => stream.buffer.length === 0 && !stream.done)
					.map((stream) => this.refill(stream, checked.fresh === true)),
			);
			this.drain(continuation, items, pageSize);
			if (
				items.length >= pageSize ||
				continuation.streams.every(
					(stream) => stream.done && stream.buffer.length === 0,
				)
			)
				break;
		}
		for (const listItem of items)
			(listItem as unknown as { worktrees: ForgeWorktreeMatch[] }).worktrees =
				await this.matchWorktrees(listItem.item, listItem.sourceId, caller);
		const outcomes = continuation.outcomes.map((outcome) => {
			const failed = continuation.streams.find(
				(stream) =>
					stream.sourceId === outcome.sourceId &&
					stream.origin === outcome.origin &&
					stream.failed !== undefined,
			);
			return failed === undefined
				? outcome
				: { ...outcome, state: 'failed' as const, error: failed.failed };
		});
		const more = continuation.streams.some(
			(stream) => !stream.done || stream.buffer.length > 0,
		);
		const totals = continuation.streams.map((stream) => stream.total);
		const result: ForgeListResult = {
			items,
			sources: outcomes,
			fetchedAt: continuation.at,
			noAccounts: false,
			...(totals.length > 0 && totals.every((total) => total !== undefined)
				? { totalCount: totals.reduce((sum, total) => (sum ?? 0) + (total ?? 0), 0) }
				: {}),
		};
		if (!more) return result;
		this.sweepContinuations();
		const token = randomUUID();
		this.continuations.set(token, { ...continuation, outcomes, at: this.now() });
		return { ...result, nextCursor: token };
	}

	/** Emit the newest items while no unfinished stream could hold a newer one. */
	private drain(continuation: Continuation, items: ForgeListItem[], pageSize: number): void {
		while (items.length < pageSize) {
			if (
				continuation.streams.some(
					(stream) => stream.buffer.length === 0 && !stream.done,
				)
			)
				return;
			let best: Stream | undefined;
			for (const stream of continuation.streams) {
				const head = stream.buffer[0];
				if (head === undefined) continue;
				if (
					best === undefined ||
					Date.parse(head.updatedAt) > Date.parse(best.buffer[0]!.updatedAt)
				)
					best = stream;
			}
			if (best === undefined) return;
			const item = best.buffer.shift()!;
			const key = itemKey(item.reference);
			if (continuation.emitted.has(key)) continue;
			continuation.emitted.add(key);
			items.push({ sourceId: best.sourceId, item, worktrees: [] });
		}
	}

	private async refill(stream: Stream, fresh: boolean): Promise<void> {
		const query: ForgeQuery = {
			...stream.query,
			...(stream.cursor === undefined ? {} : { cursor: stream.cursor }),
		};
		try {
			const page = await this.cached(
				this.pageCache,
				`${stream.sourceId}\u0000${JSON.stringify(query)}`,
				stream.sourceId,
				fresh,
				(signal) => this.options.hosts.queryForgeSource(stream.sourceId, query, signal),
			);
			stream.buffer.push(
				...[...page.page.items].sort(
					(a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
				),
			);
			if (stream.total === undefined && page.page.totalCount !== undefined)
				stream.total = page.page.totalCount;
			if (page.page.nextCursor === undefined) stream.done = true;
			else stream.cursor = page.page.nextCursor;
		} catch (error) {
			stream.done = true;
			stream.failed = message(error);
		}
	}

	/** One stream per account of every source that may answer, narrowed and checked. */
	private async openStreams(
		_caller: ForgeCaller,
		request: CheckedListRequest,
	): Promise<{ streams: Stream[]; outcomes: ForgeSourceOutcome[]; noAccounts: boolean }> {
		const streams: Stream[] = [];
		const outcomes: ForgeSourceOutcome[] = [];
		let anyAccount = false;
		const projectClaims =
			request.purpose === 'project' && request.projectId !== undefined
				? await this.projectClaims(request.projectId)
				: undefined;
		const openClaims = new Map<string, ForgeProjectClaim[]>();
		for (const entry of this.entries()) {
			const contribution = entry.contribution;
			if (!contribution.kinds.includes(request.kind)) continue;
			const sourceId = contribution.id;
			const settings = await this.settingsFor(entry.extensionId);
			if (request.purpose === 'home') {
				if (request.kind === 'pullRequest' && !settings.pullRequestsOnHome) continue;
				if (request.kind === 'issue' && !settings.issuesOnHome) continue;
			} else if (!settings.projectTabs) continue;
			let accounts: ForgeAccount[];
			try {
				accounts = await this.accountsOf(sourceId);
			} catch (error) {
				outcomes.push({
					sourceId,
					displayName: contribution.displayName,
					origin: '',
					state: 'failed',
					error: message(error),
				});
				continue;
			}
			for (const account of accounts) {
				anyAccount = true;
				if (account.state !== 'ready') continue;
				// Every restriction is a set of repositories or owners on this
				// origin. Absent is unrestricted; empty sends nothing (fail closed).
				let repositories: Set<string> | undefined;
				let owners: Set<string> | undefined;
				const intersect = (keys: Iterable<string>) => {
					const next = new Set(keys);
					repositories =
						repositories === undefined
							? next
							: new Set([...repositories].filter((key) => next.has(key)));
				};
				if (projectClaims !== undefined)
					intersect(
						projectClaims
							.filter(
								(claim) =>
									claim.sourceId === sourceId && claim.origin === account.origin,
							)
							.map((claim) => ownerName(claim)),
					);
				if (settings.repositories === 'openProjects') {
					if (!openClaims.has(sourceId)) {
						const all: ForgeProjectClaim[] = [];
						for (const project of this.options.projects.repositoryContexts())
							all.push(...(await this.projectClaims(project.projectId)));
						openClaims.set(
							sourceId,
							all.filter((claim) => claim.sourceId === sourceId),
						);
					}
					intersect(
						(openClaims.get(sourceId) ?? [])
							.filter((claim) => claim.origin === account.origin)
							.map((claim) => ownerName(claim)),
					);
				}
				if (settings.repositories === 'owners')
					owners = new Set(settings.owners.map((owner) => owner.toLowerCase()));
				if (request.repositories !== undefined)
					intersect(
						request.repositories
							.filter((repository) => repository.origin === account.origin)
							.map((repository) => ownerName(repository)),
					);
				if (repositories !== undefined && owners !== undefined) {
					const allowed = owners;
					repositories = new Set(
						[...repositories].filter((key) => allowed.has(key.split('/')[0]!)),
					);
					owners = undefined;
				}
				if (
					(repositories !== undefined && repositories.size === 0) ||
					(owners !== undefined && owners.size === 0)
				)
					continue;
				outcomes.push({
					sourceId,
					displayName: contribution.displayName,
					origin: account.origin,
					state: 'ok',
				});
				const repositoryList =
					repositories === undefined
						? undefined
						: [...repositories]
								.sort()
								.slice(0, EXTENSION_LIMITS.forgeQueryRepositories)
								.map((key) => {
									const [owner, name] = key.split('/');
									return { owner: owner!, name: name! };
								});
				streams.push({
					sourceId,
					origin: account.origin,
					query: {
						kind: request.kind,
						scope: request.scope,
						state: request.state,
						origin: account.origin,
						pageSize: request.pageSize,
						...(repositoryList === undefined ? {} : { repositories: repositoryList }),
						...(owners === undefined
							? {}
							: {
									owners: [...owners]
										.sort()
										.slice(0, EXTENSION_LIMITS.forgeQueryOwners),
								}),
						...(request.text === undefined ? {} : { text: request.text }),
					},
					done: false,
					buffer: [],
				});
			}
		}
		return { streams, outcomes, noAccounts: !anyAccount };
	}

	/** Badge counts: open pull requests requesting review, open issues assigned. */
	async counts(caller: ForgeCaller): Promise<{ pullRequests: number | null; issues: number | null }> {
		requireScope(caller, 'read');
		if (caller.projectId !== undefined)
			throw new ForgeServiceError('forbidden', 'Home counts need an unbound client');
		const count = async (kind: ForgeItemKind, scope: ForgeScope) => {
			const result = await this.list(caller, {
				kind,
				scope,
				state: 'open',
				purpose: 'home',
				pageSize: 1,
			}).catch(() => undefined);
			if (result === undefined || result.noAccounts) return null;
			if (result.sources.some((source) => source.state === 'failed')) return null;
			return result.totalCount ?? (result.nextCursor === undefined ? result.items.length : null);
		};
		const [pullRequests, issues] = await Promise.all([
			count('pullRequest', 'reviewRequested'),
			count('issue', 'assigned'),
		]);
		return { pullRequests, issues };
	}

	/** One item's detail, authorized before any cache is consulted. */
	async detail(
		caller: ForgeCaller,
		sourceId: string,
		reference: unknown,
		fresh = false,
	): Promise<{ detail: ForgeItemDetail; worktrees: ForgeWorktreeMatch[] }> {
		requireScope(caller, 'read');
		const checked = validateForgeReference(reference);
		if (!checked.ok) throw new ForgeServiceError('invalid', checked.reason);
		if (this.entry(sourceId) === undefined)
			throw new ForgeServiceError('not-found', 'the forge source is unavailable');
		if (caller.projectId !== undefined) {
			const claims = await this.projectClaims(caller.projectId);
			if (
				!claims.some(
					(claim) =>
						claim.sourceId === sourceId &&
						repositoryKey(claim) === repositoryKey(checked.value),
				)
			)
				throw new ForgeServiceError('forbidden', 'the repository is outside the authorized project');
		}
		const detail = await this.cached(
			this.detailCache,
			`${sourceId}\u0000${itemKey(checked.value)}`,
			sourceId,
			fresh,
			(signal) => this.options.hosts.forgeSourceDetail(sourceId, checked.value, signal),
		);
		return {
			detail,
			worktrees: await this.matchWorktrees(detail.summary, sourceId, caller),
		};
	}

	// ── Cache and generations ───────────────────────────────────────────

	private generation(sourceId: string): number {
		return this.generations.get(sourceId) ?? 0;
	}

	/**
	 * Answer from memory within the cache period, share an in-flight call,
	 * and discard a result whose source changed while it was running.
	 */
	private async cached<T>(
		cache: Map<string, CacheEntry<T>>,
		key: string,
		sourceId: string,
		fresh: boolean,
		load: (signal: AbortSignal) => Promise<T>,
		ttl = FORGE_CACHE_MS,
	): Promise<T> {
		const now = this.now();
		const generation = this.generation(sourceId);
		const existing = cache.get(key);
		if (
			!fresh &&
			existing !== undefined &&
			existing.generation === generation &&
			now - existing.at < ttl
		)
			return existing.value;
		if (!this.generations.has(sourceId)) this.generations.set(sourceId, 0);
		const controller = new AbortController();
		const value = load(controller.signal).then((result) => {
			if (this.generation(sourceId) !== generation)
				throw new ForgeServiceError('unavailable', 'the forge source changed; refresh');
			return result;
		});
		const entry: CacheEntry<T> = { at: now, generation, value };
		cache.set(key, entry);
		value.catch(() => {
			if (cache.get(key) === entry) cache.delete(key);
		});
		return value;
	}

	private bump(sourceId: string): void {
		this.generations.set(sourceId, this.generation(sourceId) + 1);
	}

	private dropSource(sourceId: string): void {
		this.bump(sourceId);
		const prefix = `${sourceId}\u0000`;
		for (const cache of [this.claimCache, this.pageCache, this.detailCache] as Map<string, unknown>[])
			for (const key of [...cache.keys()]) if (key.startsWith(prefix)) cache.delete(key);
		this.accountCache.delete(sourceId);
		for (const [token, continuation] of this.continuations)
			if (continuation.streams.some((stream) => stream.sourceId === sourceId))
				this.continuations.delete(token);
	}

	private dropOrigin(sourceId: string, origin: string): void {
		this.bump(sourceId);
		const prefix = `${sourceId}\u0000`;
		for (const cache of [this.pageCache, this.detailCache] as Map<string, unknown>[])
			for (const key of [...cache.keys()])
				if (key.startsWith(prefix) && key.includes(origin)) cache.delete(key);
		this.accountCache.delete(sourceId);
	}

	private clear(): void {
		this.accountCache.clear();
		this.claimCache.clear();
		this.pageCache.clear();
		this.detailCache.clear();
		this.continuations.clear();
	}

	private sweepContinuations(): void {
		const now = this.now();
		for (const [token, continuation] of this.continuations)
			if (now - continuation.at > FORGE_CACHE_MS * 5) this.continuations.delete(token);
		while (this.continuations.size > 256) {
			const oldest = this.continuations.keys().next().value;
			if (oldest === undefined) break;
			this.continuations.delete(oldest);
		}
	}

	private emit(change: ForgeChange): void {
		for (const listener of [this.options.onChanged, ...this.listeners]) {
			try {
				listener?.(change);
			} catch (error) {
				this.options.onError?.(message(error));
			}
		}
	}
}

interface CheckedListRequest extends ForgeListRequest {
	readonly pageSize: number;
}

function checkListRequest(request: ForgeListRequest): CheckedListRequest {
	if (request.kind !== 'pullRequest' && request.kind !== 'issue')
		throw new ForgeServiceError('invalid', 'kind is invalid');
	if (!forgeScopesFor(request.kind).includes(request.scope))
		throw new ForgeServiceError('invalid', 'scope is invalid');
	if (!forgeStatesFor(request.kind).includes(request.state))
		throw new ForgeServiceError('invalid', 'state is invalid');
	if (request.purpose !== 'home' && request.purpose !== 'project')
		throw new ForgeServiceError('invalid', 'purpose is invalid');
	if (request.purpose === 'project' && typeof request.projectId !== 'string')
		throw new ForgeServiceError('invalid', 'a project list needs a project');
	const pageSize = request.pageSize ?? EXTENSION_LIMITS.forgePageSize;
	if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > EXTENSION_LIMITS.forgePageSize)
		throw new ForgeServiceError('invalid', 'pageSize is invalid');
	if (
		request.text !== undefined &&
		(typeof request.text !== 'string' ||
			request.text.length > EXTENSION_LIMITS.forgeTextLength ||
			// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are refused
			/[\u0000-\u001f\u007f]/.test(request.text))
	)
		throw new ForgeServiceError('invalid', 'text is invalid');
	if (request.repositories !== undefined) {
		if (
			!Array.isArray(request.repositories) ||
			request.repositories.length > EXTENSION_LIMITS.forgeQueryRepositories
		)
			throw new ForgeServiceError('invalid', 'repositories is invalid');
		for (const repository of request.repositories)
			if (
				!isHttpsOrigin(repository?.origin) ||
				typeof repository.owner !== 'string' ||
				typeof repository.name !== 'string' ||
				repository.owner.length === 0 ||
				repository.name.length === 0
			)
				throw new ForgeServiceError('invalid', 'repository is invalid');
	}
	const text = request.text?.trim();
	return {
		...request,
		pageSize,
		...(text ? { text } : { text: undefined }),
	};
}

function normalizeSettings(value: unknown, strict = false): ForgeExtensionSettings {
	const record =
		typeof value === 'object' && value !== null && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	const fail = (reason: string) => {
		if (strict) throw new ForgeServiceError('invalid', reason);
	};
	const repositories = record.repositories;
	if (repositories !== 'all' && repositories !== 'openProjects' && repositories !== 'owners')
		fail('repositories is invalid');
	const owners = Array.isArray(record.owners)
		? record.owners.filter(
				(owner): owner is string =>
					typeof owner === 'string' && owner.length > 0 && owner.length <= 128,
			)
		: [];
	if (record.owners !== undefined && !Array.isArray(record.owners)) fail('owners is invalid');
	const flag = (key: keyof ForgeExtensionSettings) => {
		const flagValue = record[key];
		if (flagValue !== undefined && typeof flagValue !== 'boolean') fail(`${key} is invalid`);
		return typeof flagValue === 'boolean' ? flagValue : true;
	};
	return {
		repositories:
			repositories === 'openProjects' || repositories === 'owners' ? repositories : 'all',
		owners: [...new Set(owners)].slice(0, EXTENSION_LIMITS.forgeQueryOwners),
		pullRequestsOnHome: flag('pullRequestsOnHome'),
		issuesOnHome: flag('issuesOnHome'),
		projectTabs: flag('projectTabs'),
	};
}

function requireScope(caller: ForgeCaller, required: 'read' | 'write' | 'admin'): void {
	const rank = { read: 0, write: 1, admin: 2 } as const;
	if (rank[caller.scope] === undefined || rank[caller.scope] < rank[required])
		throw new ForgeServiceError('forbidden', `forge operation requires ${required} scope`);
}

function requireProject(caller: ForgeCaller, projectId: string | undefined): void {
	if (typeof projectId !== 'string' || projectId.length === 0)
		throw new ForgeServiceError('invalid', 'a project is required');
	if (caller.projectId !== undefined && caller.projectId !== projectId)
		throw new ForgeServiceError('forbidden', 'the project is outside the authorized scope');
}

function ownerName(repository: { owner: string; name: string }): string {
	return `${repository.owner.toLowerCase()}/${repository.name.toLowerCase()}`;
}

function repositoryKey(repository: { origin: string; owner: string; name: string }): string {
	return `${repository.origin}\u0000${ownerName(repository)}`;
}

function itemKey(reference: ForgeItemReference): string {
	return `${reference.kind}\u0000${repositoryKey(reference)}\u0000${reference.number}`;
}

function listKey(caller: ForgeCaller, request: CheckedListRequest): string {
	return JSON.stringify([
		caller.projectId ?? null,
		request.kind,
		request.scope,
		request.state,
		request.purpose,
		request.projectId ?? null,
		request.repositories ?? null,
		request.text ?? null,
		request.pageSize,
	]);
}

function message(error: unknown): string {
	return error instanceof Error ? error.message.slice(0, 500) : 'forge source failed';
}
