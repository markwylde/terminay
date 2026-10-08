import { createHash } from 'node:crypto';
import { readdir, readFile, realpath, rm, stat } from 'node:fs/promises';
import {
	createRefreshSchedule,
	REFRESH_RAMP_MS,
	type RefreshSchedule,
} from '@terminay/protocol';
import {
	attributeGitDirChange,
	attributeWorkingTreeChange,
	classifyGitDirEntry,
	type GitChangeScope,
	linkedGitDirName,
	type ObservedRepositoryLayout,
	type ObservedWorktree,
	scopeName,
	workingTreeWatchRoots,
} from './observation.js';
import {
	dirname,
	isAbsolute,
	join,
	normalize,
	relative,
	resolve,
} from 'node:path';
import {
	parseDiff,
	parseStatus,
	type ParsedWorktree,
	parseWorktreeList,
	worktreeState,
} from './parse.js';
import { NodeGitCommandRunner } from './runner.js';
import {
	DEFAULT_GIT_SERVICE_LIMITS,
	type GitBranchResult,
	type GitBranchStatus,
	type GitCommandResult,
	type GitCommandRunner,
	type GitDiffResult,
	type GitDiscoveryState,
	type GitErrorInfo,
	type GitObservationChangeSummary,
	type GitObservationEntryClass,
	type GitObservationMeasuredWorktree,
	type GitObservationRaisedBy,
	type GitObservationReport,
	type GitObservationScope,
	type GitObservationWatchKind,
	type GitObservationWorktreeRef,
	type GitPathAdapter,
	type GitProgressPhase,
	type GitProjectBinding,
	type GitReadOnlyRequest,
	type GitRepositoryId,
	GitServiceError,
	type GitServiceEvent,
	type GitServiceLimits,
	type GitServiceListener,
	type GitServiceOperation,
	type GitServiceOptions,
	type GitServiceReplay,
	type GitStateWatcher,
	type GitStatusChangeEvent,
	type GitStatusEntry,
	type GitStatusResult,
	type GitWorktreeId,
	type GitWorktreeListResult,
	type GitWorktreeMoveRequest,
	type GitWorktreeMoveResult,
	type GitWorktreePullRequest,
	type GitWorktreePullResult,
	type GitWorktreeRemoveCleanRequest,
	type GitWorktreeRemoveRequest,
	type GitWorktreeRemoveResult,
	type GitWorktreeSummary,
	type GitWatchHandle,
} from './types.js';
import { NodeGitStateWatcher } from './watcher.js';

export class NodeGitPathAdapter implements GitPathAdapter {
	realpath(path: string): Promise<string> {
		return realpath(path);
	}
	async stat(path: string): Promise<{ isDirectory: boolean; isFile: boolean }> {
		const result = await stat(path);
		return { isDirectory: result.isDirectory(), isFile: result.isFile() };
	}
}

type GitTargetRequest = Omit<GitReadOnlyRequest, 'operation'>;

/**
 * Everything watched for one repository, shared by every project bound to it.
 * The cached listing is trusted only while the Git directory watch is live and
 * no event has arrived since it was measured.
 */
interface RepositoryObservation {
	readonly repositoryId: GitRepositoryId;
	readonly repositoryRoot: string;
	readonly projects: Set<string>;
	/** Keyed by the watched path. */
	readonly watches: Map<string, GitWatchHandle>;
	/** What each watch observes, for reports. Keyed like `watches`. */
	readonly watchKinds: Map<
		string,
		{ readonly kind: GitObservationWatchKind; readonly recursive: boolean }
	>;
	/** Changes counted since the last report. */
	changes: ChangeCounters;
	flushTimer: ReturnType<typeof setTimeout> | undefined;
	readonly schedule: RefreshSchedule;
	/** Aborts this observation's own refreshes when it is disposed. */
	readonly abort: AbortController;
	readonly dirty: Set<GitWorktreeId>;
	layout: ObservedRepositoryLayout;
	/** Null until the Git directory watch is established. */
	commonDir: string | null;
	listing: GitWorktreeListResult | undefined;
	dirtyAll: boolean;
	unavailable: boolean;
	closed: boolean;
	refreshing: boolean;
	refreshAgain: boolean;
	/** The measurement in progress. Measurements of one repository run one at a
	 *  time, so none can claim an empty dirty set while another still holds the
	 *  changes and then cache summaries that predate them. */
	measuring: Promise<unknown> | undefined;
}

interface ChangeCounters {
	byClass: Partial<Record<GitObservationEntryClass, number>>;
	byScope: Partial<Record<GitObservationScope, number>>;
	cachedListingsServed: number;
}

function emptyChanges(): ChangeCounters {
	return { byClass: {}, byScope: {}, cachedListingsServed: 0 };
}

function hasChanges(changes: ChangeCounters): boolean {
	return (
		changes.cachedListingsServed > 0 || Object.keys(changes.byClass).length > 0
	);
}

/** Why a measurement runs, and whether it must bypass the cache. */
interface MeasurementOrigin {
	readonly raisedBy: GitObservationRaisedBy;
	readonly fresh: boolean;
}

/** Re-measured worktrees named in one measurement report. */
const MAX_REPORTED_WORKTREES = 32;

function reportedError(error: unknown): {
	code: string | null;
	message: string;
} {
	const code = (error as { code?: unknown } | null)?.code;
	const message = error instanceof Error ? error.message : String(error);
	return {
		code: typeof code === 'string' ? code : null,
		message: message.slice(0, 1024),
	};
}

/** The invalidations a measurement took responsibility for. */
interface DirtyClaim {
	readonly all: boolean;
	readonly ids: ReadonlySet<GitWorktreeId>;
	/** Whether the cache could be trusted when the measurement began. */
	readonly trusted: boolean;
	/**
	 * True when something observed said every worktree is stale, such as the
	 * default branch moving. `all` is also true when there is merely no cached
	 * listing, which says nothing about any one worktree having changed.
	 */
	readonly stale: boolean;
}

interface Discovery {
	readonly state: GitDiscoveryState;
	readonly repositoryId: GitRepositoryId | null;
	readonly repositoryRoot: string | null;
	readonly worktreeId: GitWorktreeId | null;
	readonly worktreeRoot: string | null;
	readonly error?: GitErrorInfo;
}

interface NumstatDelta {
	readonly additions: number;
	readonly deletions: number;
	readonly hasChanges: boolean;
}

/**
 * Server-owned, read-only Git operations. Every command is selected by this
 * class, receives a canonical project/worktree cwd, and uses a bounded runner.
 * There is intentionally no method accepting an arbitrary executable or cwd.
 */
export class GitService {
	private readonly runner: GitCommandRunner;
	private readonly pathAdapter: GitPathAdapter;
	private readonly limits: Required<GitServiceLimits>;
	private readonly watcher: GitStateWatcher;
	private readonly refreshRampMs: readonly number[];
	private readonly onObservation:
		| ((report: GitObservationReport) => void)
		| undefined;
	private readonly observationFlushMs: number;
	/** Process-local names for repositories and worktrees in reports. The
	 *  canonical ids authorize requests, so reports never carry them. */
	private readonly diagnosticRepositoryIds = new Map<string, string>();
	private readonly diagnosticWorktrees = new Map<
		string,
		{ id: string; role: 'main' | 'linked'; listIndex: number }
	>();
	private readonly bindings = new Map<string, GitProjectBinding>();
	private readonly listeners = new Set<GitServiceListener>();
	private readonly mutatingWorktreeIds = new Set<string>();
	private readonly repositoryMutationTails = new Map<
		string,
		Promise<unknown>
	>();
	private readonly events: GitServiceEvent[] = [];
	private readonly maxEvents: number;
	private readonly observations = new Map<string, RepositoryObservation>();
	/** Watches a project root that is not yet a repository for `.git` to appear. */
	private readonly discoveryWatches = new Map<string, GitWatchHandle>();
	/** Changes on every bind and on release, so work started under an older
	 *  binding can tell it no longer applies. */
	private readonly projectGenerations = new Map<string, number>();
	private generationCounter = 0;
	private revisionValue = 0;
	private readonly statusFingerprints = new Map<string, string>();
	/** Last measured summary per worktree, by repository. Lets a listing that
	 *  names one worktree carry the others forward instead of re-running their
	 *  Git commands. */
	private readonly lastWorktreeSummaries = new Map<
		string,
		Map<GitWorktreeId, GitWorktreeSummary>
	>();
	private closed = false;

	constructor(options: GitServiceOptions = {}) {
		this.runner = options.runner ?? new NodeGitCommandRunner();
		this.pathAdapter = options.pathAdapter ?? new NodeGitPathAdapter();
		this.limits = { ...DEFAULT_GIT_SERVICE_LIMITS, ...options.limits };
		validateLimits(this.limits);
		this.maxEvents = options.maxEvents ?? 1024;
		if (!Number.isSafeInteger(this.maxEvents) || this.maxEvents <= 0)
			throw new RangeError('maxEvents must be positive');
		this.watcher = options.watcher ?? new NodeGitStateWatcher();
		this.refreshRampMs = options.refreshRampMs ?? REFRESH_RAMP_MS;
		this.onObservation = options.onObservation;
		this.observationFlushMs = options.observationFlushMs ?? 5_000;
		if (!Number.isFinite(this.observationFlushMs) || this.observationFlushMs < 0)
			throw new RangeError('observationFlushMs must be non-negative');
	}

	get revision(): number {
		return this.revisionValue;
	}

	subscribe(listener: GitServiceListener): () => void {
		if (typeof listener !== 'function')
			throw new TypeError('Git event listener must be a function');
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	replay(afterRevision = 0): GitServiceReplay {
		if (
			!Number.isSafeInteger(afterRevision) ||
			afterRevision < 0 ||
			afterRevision > this.revisionValue
		)
			throw new RangeError('Git replay revision is invalid');
		const oldest = this.events[0]?.revision;
		if (oldest !== undefined && afterRevision < oldest - 1)
			return { kind: 'resync', events: [] };
		return {
			kind: 'events',
			events: this.events.filter((event) => event.revision > afterRevision),
		};
	}

	/** Canonicalize and bind one server-owned workspace project. */
	async bindProject(
		projectId: string,
		projectRoot: string,
		signal?: AbortSignal,
	): Promise<GitProjectBinding> {
		validateProjectId(projectId);
		const canonicalRoot = await this.canonicalDirectory(projectRoot);
		const discovered = await this.discover(canonicalRoot, signal);
		const binding: GitProjectBinding = {
			projectId,
			projectRoot: canonicalRoot,
			repositoryId: discovered.repositoryId,
			repositoryRoot: discovered.repositoryRoot,
			worktreeId: discovered.worktreeId,
			worktreeRoot: discovered.worktreeRoot,
			state: discovered.state,
		};
		if (this.closed)
			throw new GitServiceError('invalid-project', 'Git service is closed');
		const previous = this.bindings.get(projectId);
		this.bindings.set(projectId, binding);
		this.projectGenerations.set(projectId, ++this.generationCounter);
		this.rebindObservation(projectId, previous, binding);
		return binding;
	}

	/**
	 * Release everything held for a project: its binding, its share of the
	 * repository's watches, and any pending refresh. Work already in flight for
	 * it finishes without publishing or caching anything.
	 */
	releaseProject(projectId: string): boolean {
		const binding = this.bindings.get(projectId);
		if (binding === undefined) return false;
		this.bindings.delete(projectId);
		this.projectGenerations.delete(projectId);
		this.stopObserving(projectId, binding);
		const prefix = `${projectId}\0`;
		for (const key of [...this.statusFingerprints.keys()])
			if (key.startsWith(prefix)) this.statusFingerprints.delete(key);
		return true;
	}

	unbindProject(projectId: string): boolean {
		return this.releaseProject(projectId);
	}

	close(): void {
		this.closed = true;
		for (const observation of [...this.observations.values()])
			this.disposeObservation(observation);
		for (const projectId of [...this.discoveryWatches.keys()])
			this.closeDiscoveryWatch(projectId);
		this.listeners.clear();
	}

	getBinding(projectId: string): GitProjectBinding | undefined {
		return this.bindings.get(projectId);
	}

	async status(
		request: GitTargetRequest | string,
		signal?: AbortSignal,
	): Promise<GitStatusResult> {
		const target = normalizeTarget(request, signal);
		const discovery = await this.resolveDiscovery(target);
		this.publishProgress(
			'status',
			'started',
			target.projectId,
			discovery.repositoryId,
			discovery.worktreeId,
			discovery.state,
			false,
		);
		const empty = this.emptyStatus(target.projectId, discovery);
		let status: GitStatusResult = empty;
		if (discovery.state === 'ready' && discovery.worktreeRoot !== null) {
			const result = await this.runGit(
				[
					'status',
					'--porcelain=v1',
					'-z',
					'--branch',
					'--untracked-files=all',
					'--ignored=no',
				],
				discovery.worktreeRoot,
				target.signal,
			);
			if (result.exitCode !== 0 || result.truncated) {
				status = {
					...empty,
					state: 'command-error',
					bounded: result.truncated,
					error: commandError(
						'status',
						result,
						result.truncated
							? 'Git status output exceeded the configured limit.'
							: 'Git status failed.',
					),
				};
			} else {
				const parsed = parseStatus(result.stdout, this.limits.maxStatusEntries);
				const head = await this.readHead(discovery.worktreeRoot, target.signal);
				const branch: GitBranchStatus = { ...parsed.branch, head };
				status = {
					...empty,
					state: 'ready',
					branch,
					entries: await this.markDirectoryEntries(
						parsed.entries,
						discovery.worktreeRoot,
						target.signal,
					),
					head,
					bounded: parsed.bounded,
				};
			}
		}
		this.publishProgress(
			'status',
			status.state === 'ready' ? 'completed' : 'failed',
			target.projectId,
			status.repositoryId,
			status.worktreeId,
			status.state,
			status.bounded,
		);
		this.publishStatusChange(status);
		return status;
	}

	async branch(
		request: GitTargetRequest | string,
		signal?: AbortSignal,
	): Promise<GitBranchResult> {
		const status = await this.status(request, signal);
		return { ...status, operation: 'branch' };
	}

	getStatus(
		request: GitTargetRequest | string,
		signal?: AbortSignal,
	): Promise<GitStatusResult> {
		return this.status(request, signal);
	}

	getBranch(
		request: GitTargetRequest | string,
		signal?: AbortSignal,
	): Promise<GitBranchResult> {
		return this.branch(request, signal);
	}

	async diff(
		request: GitTargetRequest | string,
		signal?: AbortSignal,
	): Promise<GitDiffResult> {
		const target = normalizeTarget(request, signal);
		const discovery = await this.resolveDiscovery(target);
		const empty: GitDiffResult = {
			projectId: target.projectId,
			repositoryId: discovery.repositoryId,
			worktreeId: discovery.worktreeId,
			state: discovery.state,
			compareTarget: 'HEAD',
			path: target.path ?? null,
			files: [],
			hunks: [],
			patch: '',
			binary: false,
			bounded: false,
			...(discovery.error === undefined ? {} : { error: discovery.error }),
		};
		if (discovery.state !== 'ready' || discovery.worktreeRoot === null)
			return empty;
		const path =
			target.path === undefined
				? undefined
				: await this.resolveProjectRelativePath(
						target.path,
						discovery.worktreeRoot,
						target.projectId,
					);
		const args = [
			'diff',
			'--no-ext-diff',
			'--binary',
			'--unified=3',
			'HEAD',
			'--',
			...(path === undefined ? [] : [path]),
		];
		const result = await this.runGit(
			args,
			discovery.worktreeRoot,
			target.signal,
			this.limits.maxDiffBytes,
		);
		if (result.exitCode !== 0 || result.truncated) {
			return {
				...empty,
				state: 'command-error',
				patch: result.stdout,
				bounded: result.truncated,
				error: commandError(
					'diff',
					result,
					result.truncated
						? 'Git diff output exceeded the configured limit.'
						: 'Git diff failed.',
				),
			};
		}
		const patch = truncateUtf8(result.stdout, this.limits.maxDiffBytes);
		const parsed = parseDiff(patch, {
			maxHunks: this.limits.maxDiffHunks,
			maxLines: this.limits.maxDiffLines,
			maxLineBytes: this.limits.maxDiffLineBytes,
		});
		const bounded =
			result.truncated ||
			parsed.bounded ||
			patch.length !== result.stdout.length;
		return {
			...empty,
			state: 'ready',
			files: parsed.files,
			hunks: parsed.hunks,
			patch,
			binary: parsed.binary,
			bounded,
		};
	}

	getDiff(
		request: GitTargetRequest | string,
		signal?: AbortSignal,
	): Promise<GitDiffResult> {
		return this.diff(request, signal);
	}

	/**
	 * `fresh` measures every worktree whatever the watches report, for a
	 * listing the user asked for explicitly, and reports any difference from
	 * the cached listing the watches had vouched for.
	 */
	async worktrees(
		request: (GitTargetRequest & { readonly fresh?: boolean }) | string,
		signal?: AbortSignal,
	): Promise<GitWorktreeListResult> {
		const fresh = typeof request !== 'string' && request.fresh === true;
		return this.listWorktreesFrom(normalizeTarget(request, signal), {
			raisedBy: fresh ? 'refresh' : 'request',
			fresh,
		});
	}

	private async listWorktreesFrom(
		target: GitTargetRequest,
		origin: MeasurementOrigin,
	): Promise<GitWorktreeListResult> {
		for (;;) {
			if (!origin.fresh) {
				const cached = this.cachedListing(target);
				if (cached !== undefined) {
					const serving = this.observationFor(target.projectId);
					if (serving !== undefined) {
						serving.changes.cachedListingsServed += 1;
						this.armChangeFlush(serving);
					}
					return cached;
				}
			}
			const pending = this.observationFor(target.projectId)?.measuring;
			if (pending === undefined) break;
			await pending.catch(() => undefined);
			target.signal?.throwIfAborted();
		}
		const generation = this.projectGenerations.get(target.projectId);
		const observation = this.observationFor(target.projectId);
		// The listing the watches vouch for right now, to compare against what a
		// forced measurement finds.
		const vouched =
			origin.fresh &&
			observation !== undefined &&
			this.observationTrusted(observation) &&
			!observation.dirtyAll &&
			observation.dirty.size === 0
				? observation.listing
				: undefined;
		if (origin.fresh && observation !== undefined) observation.dirtyAll = true;
		const claim =
			observation === undefined ? undefined : this.claimDirty(observation);
		// The changes counted so far are the ones this claim answers for. Any
		// that arrive while it runs belong to the measurement after it.
		const claimedChanges =
			observation === undefined
				? emptyChanges()
				: this.takeChanges(observation);
		const startedAt = Date.now();
		const measurement = this.measureWorktrees(
			target,
			generation,
			observation,
			claim,
			origin,
			startedAt,
			claimedChanges,
		).catch((error: unknown) => {
			if (observation !== undefined && claim !== undefined) {
				this.restoreDirty(observation, claim);
				this.returnChanges(observation, claimedChanges);
				this.report({
					// Released or re-bound mid-measurement, which also aborts the
					// observation's own Git commands, is not a failure to measure.
					kind:
						observation.closed ||
						(error instanceof GitServiceError &&
							error.code === 'invalid-project')
							? 'measurement.abandoned'
							: 'measurement.failed',
					repository: this.diagnosticRepositoryId(observation.repositoryId),
					raisedBy: origin.raisedBy,
					claim: claim.all ? 'all' : 'scoped',
					trusted: claim.trusted,
					durationMs: Date.now() - startedAt,
					restored: true,
					error: reportedError(error),
				});
			}
			throw error;
		});
		if (observation === undefined) return measurement;
		observation.measuring = measurement;
		try {
			const listing = await measurement;
			if (vouched !== undefined)
				this.reportCacheMismatch(observation, vouched, listing);
			return listing;
		} finally {
			if (observation.measuring === measurement)
				observation.measuring = undefined;
		}
	}

	private async measureWorktrees(
		target: GitTargetRequest,
		generation: number | undefined,
		observation: RepositoryObservation | undefined,
		claim: DirtyClaim | undefined,
		origin: MeasurementOrigin,
		startedAt: number,
		claimedChanges: ChangeCounters,
	): Promise<GitWorktreeListResult> {
		// The worktree a listing names only narrows what is re-measured. It may
		// have left the repository since the change that named it — removing a
		// worktree raises changes in it — so it is never resolved as a target.
		const { worktreeId: _scope, ...repository } = target;
		const discovery = await this.resolveDiscovery(repository);
		const unmeasured = (code: string, message: string): void => {
			if (observation === undefined || claim === undefined) return;
			this.restoreDirty(observation, claim);
			this.returnChanges(observation, claimedChanges);
			this.report({
				kind: 'measurement.failed',
				repository: this.diagnosticRepositoryId(observation.repositoryId),
				raisedBy: origin.raisedBy,
				claim: claim.all ? 'all' : 'scoped',
				trusted: claim.trusted,
				durationMs: Date.now() - startedAt,
				restored: true,
				error: { code, message },
			});
		};
		const empty: GitWorktreeListResult = {
			projectId: target.projectId,
			repositoryId: discovery.repositoryId,
			repositoryRoot: discovery.repositoryRoot,
			defaultBranch: null,
			state: discovery.state,
			worktrees: [],
			bounded: false,
			...(discovery.error === undefined ? {} : { error: discovery.error }),
		};
		if (discovery.state !== 'ready' || discovery.repositoryRoot === null) {
			unmeasured(discovery.state, 'repository discovery is not ready');
			return empty;
		}
		// Listing is repository-scoped. The requested worktree may itself be a
		// stale registration whose directory no longer exists, so it must never
		// be used as the command cwd.
		const result = await this.runGit(
			['worktree', 'list', '--porcelain'],
			discovery.repositoryRoot,
			target.signal,
		);
		if (result.exitCode !== 0 || result.truncated) {
			unmeasured(
				'command-error',
				result.truncated
					? 'Git worktree output exceeded the configured limit.'
					: 'Git worktree list failed.',
			);
			return {
				...empty,
				state: 'command-error',
				bounded: result.truncated,
				error: commandError(
					'worktrees',
					result,
					result.truncated
						? 'Git worktree output exceeded the configured limit.'
						: 'Git worktree list failed.',
				),
			};
		}
		const records = await this.worktreeRecords(result.stdout);
		const bounded = records.length > this.limits.maxWorktrees;
		const selected = records.slice(0, this.limits.maxWorktrees);
		const defaultBranch = await this.defaultBranch(
			discovery.repositoryRoot,
			target.signal,
		);
		const mainPath = records.find((record) => !record.isBare)?.path;
		const summaries: GitWorktreeSummary[] = [];
		// The observation only speaks for the repository it watches; a project
		// whose discovery moved to another repository is measured in full.
		const observed =
			observation !== undefined &&
			claim !== undefined &&
			observation.repositoryId === discovery.repositoryId
				? observation
				: undefined;
		if (
			observation !== undefined &&
			claim !== undefined &&
			observed === undefined
		) {
			this.restoreDirty(observation, claim);
			this.returnChanges(observation, claimedChanges);
		}
		let newlyWatched = false;
		if (observed !== undefined) {
			// Watch every worktree before measuring it, so a change made while it
			// is measured is an event rather than a gap.
			observed.layout = await this.observedLayout(
				observed.repositoryId,
				defaultBranch,
				mainPath,
				selected,
			);
			// A worktree newly watched has never been measured under its watch.
			if (this.syncWorkingTreeWatches(observed).length > 0) newlyWatched = true;
		}
		// A status change names the worktree it came from, so a listing raised by
		// one worktree's change need not re-run four Git commands against every
		// other worktree in the repository. Reuse is exact — the summary the
		// previous listing produced — rather than time-based. With live watches a
		// worktree is re-measured only when an event named it; without them, only
		// when the caller named it, and an unattributed listing measures all.
		const previous = this.lastWorktreeSummaries.get(
			discovery.repositoryId ?? '',
		);
		const watchedScope =
			observed !== undefined &&
			claim?.trusted === true &&
			!claim.all &&
			!newlyWatched
				? claim.ids
				: undefined;
		// A caller naming one worktree narrows a listing only while nothing has
		// said the others are stale. When something has, such as the default
		// branch moving under every worktree's delta, the claim is not narrowed:
		// that caller would take the claim, carry the others forward unmeasured,
		// and leave nobody owing them a measurement.
		const scopeTo =
			watchedScope === undefined &&
			!(observed !== undefined && claim?.stale === true) &&
			!origin.fresh &&
			!newlyWatched &&
			target.worktreeId !== undefined &&
			previous !== undefined
				? target.worktreeId
				: undefined;
		const carry = (id: GitWorktreeId): boolean =>
			watchedScope !== undefined
				? !watchedScope.has(id)
				: scopeTo !== undefined && id !== scopeTo;
		const current = () =>
			this.isCurrentGeneration(target.projectId, generation);
		const publishTo =
			observed === undefined ? [target.projectId] : [...observed.projects];
		const remeasure = new Set<GitWorktreeId>();
		const measured = new Map<GitWorktreeId, GitWorktreeSummary>();
		const reported: GitObservationMeasuredWorktree[] = [];
		let remeasuredCount = 0;
		let carriedCount = 0;
		let published = 0;
		let suppressed = 0;
		for (const [listIndex, record] of selected.entries()) {
			// Released or re-bound: stop spawning Git for a binding that is gone.
			if (!current())
				throw new GitServiceError(
					'invalid-project',
					'project is not bound to this server',
					{ projectId: target.projectId },
				);
			const canonicalPath = await this.canonicalWorktreePath(record.path);
			const id = worktreeId(
				discovery.repositoryId as GitRepositoryId,
				canonicalPath,
			);
			const diagnostic = this.diagnosticWorktree(
				id,
				mainPath !== undefined && samePath(mainPath, record.path),
				listIndex,
			);
			if (carry(id)) {
				const carried = previous?.get(id);
				if (carried !== undefined) {
					summaries.push(carried);
					measured.set(id, carried);
					carriedCount += 1;
					continue;
				}
				// No prior summary: this worktree is new since the last listing, so
				// it is measured even though the event named another one.
			}
			let entries: readonly import('./types.js').GitStatusEntry[] = [];
			let error: GitErrorInfo | undefined;
			let statusBounded = false;
			let branch: GitBranchStatus = {
				name: record.branch,
				detached: record.detached,
				head: record.head,
				upstream: null,
				upstreamState: 'none',
				ahead: null,
				behind: null,
			};
			let state = worktreeState(entries, record.detached, record.isPrunable);
			let aheadOfDefaultBranchCount: number | null = null;
			let lineAdditions: number | null = null;
			let lineDeletions: number | null = null;
			let hasCommittedChanges: boolean | null = null;
			let hasUnpushedCommits: boolean | null = null;
			let unpushedLineAdditions: number | null = null;
			let unpushedLineDeletions: number | null = null;
			let discoveryState: GitDiscoveryState = 'ready';
			const mutating = this.mutatingWorktreeIds.has(id);
			// A worktree skipped mid-mutation has not been measured.
			if (mutating) remeasure.add(id);
			if (!record.isBare && !record.isPrunable && !mutating) {
				const statusResult = await this.runGit(
					[
						'status',
						'--porcelain=v1',
						'-z',
						'--branch',
						'--untracked-files=all',
						'--ignored=no',
					],
					record.path,
					target.signal,
				);
				if (statusResult.exitCode === 0 && !statusResult.truncated) {
					const parsed = parseStatus(
						statusResult.stdout,
						this.limits.maxStatusEntries,
					);
					entries = await this.markDirectoryEntries(
						parsed.entries,
						record.path,
						target.signal,
					);
					statusBounded = parsed.bounded;
					branch = {
						...parsed.branch,
						name: parsed.branch.name ?? record.branch,
						detached: parsed.branch.detached || record.detached,
						head: record.head,
					};
					state = worktreeState(
						entries,
						parsed.branch.detached || record.detached,
						false,
					);
					const delta = await this.worktreeDelta(
						record.path,
						defaultBranch,
						target.signal,
						branch,
					);
					aheadOfDefaultBranchCount = delta.aheadCount;
					lineAdditions = delta.additions;
					lineDeletions = delta.deletions;
					hasCommittedChanges = delta.hasCommittedChanges;
					hasUnpushedCommits = delta.hasUnpushedCommits;
					unpushedLineAdditions = delta.unpushedAdditions;
					unpushedLineDeletions = delta.unpushedDeletions;
				} else {
					state = 'unknown';
					discoveryState = 'command-error';
					statusBounded = statusResult.truncated;
					error = commandError(
						'status',
						statusResult,
						statusResult.truncated
							? 'Worktree status output exceeded the configured limit.'
							: 'Worktree status failed.',
					);
				}
			}
			const summary = {
				id,
				repositoryId: discovery.repositoryId as GitRepositoryId,
				path: canonicalPath,
				branch: record.branch,
				detached: record.detached,
				head: record.head,
				isMain: mainPath !== undefined && samePath(mainPath, record.path),
				isBare: record.isBare,
				isPrunable: record.isPrunable,
				locked: record.locked,
				state,
				aheadOfDefaultBranchCount,
				lineAdditions,
				lineDeletions,
				hasCommittedChanges,
				hasUnpushedCommits,
				unpushedLineAdditions,
				unpushedLineDeletions,
				entries,
				...(error === undefined ? {} : { error }),
			} satisfies GitWorktreeSummary;
			summaries.push(summary);
			measured.set(id, summary);
			remeasuredCount += 1;
			if (reported.length < MAX_REPORTED_WORKTREES)
				reported.push({
					...diagnostic,
					ahead: aheadOfDefaultBranchCount,
					additions: lineAdditions,
					deletions: lineDeletions,
					changedFiles: entries.length,
				});
			if (!mutating && current()) {
				let publishedAny = false;
				for (const projectId of publishTo)
					publishedAny =
						this.publishStatusChange({
						projectId,
						repositoryId: discovery.repositoryId,
						repositoryRoot: discovery.repositoryRoot,
						worktreeId: id,
						worktreeRoot: canonicalPath,
						state: discoveryState,
						branch,
						entries,
						head: record.head,
						bounded: statusBounded,
						...(error === undefined ? {} : { error }),
					}) || publishedAny;
				if (publishedAny) published += 1;
				else suppressed += 1;
			}
		}
		const listing: GitWorktreeListResult = {
			...empty,
			state: 'ready',
			defaultBranch,
			worktrees: summaries,
			bounded,
		};
		if (!current()) {
			// Released or re-bound while measuring: nothing here may be kept.
			if (observed !== undefined && claim !== undefined) {
				this.restoreDirty(observed, claim);
				this.returnChanges(observed, claimedChanges);
				this.report({
					kind: 'measurement.abandoned',
					repository: this.diagnosticRepositoryId(observed.repositoryId),
					raisedBy: origin.raisedBy,
					claim: claim.all ? 'all' : 'scoped',
					trusted: claim.trusted,
					durationMs: Date.now() - startedAt,
					restored: true,
					error: {
						code: 'invalid-project',
						message: 'project was released or re-bound while measuring',
					},
				});
			}
			return listing;
		}
		// A worktree that left the listing has no status of its own left to
		// publish, so nothing above announced that it went. Say so to every
		// project of the repository, or whatever a host keeps per worktree would
		// only learn of the removal on some later, unrelated change.
		if (
			previous !== undefined &&
			[...previous.keys()].some((id) => !measured.has(id))
		)
			for (const projectId of publishTo) {
				const binding = this.getBinding(projectId);
				if (binding !== undefined) this.publishUnattributedChange(binding);
			}
		this.lastWorktreeSummaries.set(discovery.repositoryId ?? '', measured);
		if (observed !== undefined) {
			for (const id of remeasure) observed.dirty.add(id);
			// Cache only what was measured under watches that were already live and
			// are live still; otherwise the next request measures again.
			observed.listing =
				claim?.trusted === true && this.observationTrusted(observed)
					? listing
					: undefined;
			if (claim !== undefined)
				this.report({
					kind: 'measurement.completed',
					repository: this.diagnosticRepositoryId(observed.repositoryId),
					raisedBy: origin.raisedBy,
					claim: claim.all ? 'all' : 'scoped',
					trusted: claim.trusted,
					durationMs: Date.now() - startedAt,
					remeasured: remeasuredCount,
					carried: carriedCount,
					worktrees: reported,
					cached: observed.listing !== undefined,
					published,
					suppressed,
					changes: claimedChanges,
				});
			// Changes that arrived meanwhile and invalidated nothing have no
			// measurement coming to report them.
			if (hasChanges(observed.changes)) this.armChangeFlush(observed);
		}
		return listing;
	}

	listWorktrees(
		request: GitTargetRequest | string,
		signal?: AbortSignal,
	): Promise<GitWorktreeListResult> {
		return this.worktrees(request, signal);
	}

	async moveWorktree(
		request: GitWorktreeMoveRequest,
	): Promise<GitWorktreeMoveResult> {
		validateProjectId(request.projectId);
		const name = validateWorktreeDirectoryName(request.name);
		return this.enqueueRepositoryMutation(
			request.repositoryId,
			request.worktreeId,
			async () => {
				const listing = await this.listWorktreeIdentities({
					projectId: request.projectId,
					repositoryId: request.repositoryId,
					signal: request.signal,
				});
				const base = {
					operation: 'move' as const,
					projectId: request.projectId,
					repositoryId: request.repositoryId,
					worktreeIdBefore: request.worktreeId,
				};
				if (
					listing.state !== 'ready' ||
					listing.repositoryId !== request.repositoryId
				)
					return {
						...base,
						worktreeId: request.worktreeId,
						applied: false,
						state: 'command-error',
						headBefore: null,
						headAfter: null,
						path: null,
						error: listing.error ?? {
							code: 'repository-mismatch',
							message: 'worktree repository is no longer bound to this project',
							operation: 'worktree.move',
						},
					};
				const selected = listing.worktrees.find(
					(value) => value.id === request.worktreeId,
				);
				if (selected === undefined)
					throw new GitServiceError(
						'worktree-not-found',
						'worktree is not part of the project repository',
					);
				if (
					selected.isMain ||
					selected.isBare ||
					selected.locked ||
					selected.isPrunable
				)
					throw new GitServiceError(
						'mutation-failed',
						'worktree cannot be moved in its current state',
						{ worktreeId: request.worktreeId },
					);
				if (
					request.expectedHead !== undefined &&
					selected.head !== request.expectedHead
				)
					throw new GitServiceError(
						'stale-revision',
						'worktree HEAD changed since the move was reviewed',
						{ expectedHead: request.expectedHead, actualHead: selected.head },
					);
				const fresh = await this.status({
					projectId: request.projectId,
					repositoryId: request.repositoryId,
					worktreeId: request.worktreeId,
					signal: request.signal,
				});
				if (fresh.state !== 'ready' || fresh.entries.length > 0)
					throw new GitServiceError(
						'worktree-dirty',
						'refusing to move a dirty or unmerged worktree',
						{ worktreeId: request.worktreeId },
					);
				const destination = resolve(dirname(selected.path), name);
				if (
					dirname(destination) !== dirname(selected.path) ||
					samePath(destination, selected.path)
				)
					throw new GitServiceError(
						'mutation-failed',
						'worktree destination is invalid',
					);
				if (
					listing.worktrees.some((value) => samePath(value.path, destination))
				)
					throw new GitServiceError(
						'mutation-failed',
						'worktree destination already exists',
					);
				if (await filesystemPathExists(destination))
					throw new GitServiceError(
						'mutation-failed',
						'worktree destination already exists',
					);
				const binding = this.getBinding(request.projectId);
				const cwd = binding?.repositoryRoot ?? binding?.projectRoot;
				if (cwd === undefined)
					return {
						...base,
						worktreeId: request.worktreeId,
						applied: false,
						state: 'command-error',
						headBefore: selected.head,
						headAfter: selected.head,
						path: selected.path,
						error: {
							code: 'invalid-project',
							message: 'project is no longer bound to this server',
							operation: 'worktree.move',
						},
					};
				const moved = await this.runGit(
					['worktree', 'move', '--', selected.path, destination],
					cwd,
					request.signal,
				);
				if (moved.exitCode !== 0 || moved.truncated)
					return {
						...base,
						worktreeId: request.worktreeId,
						applied: false,
						state: 'command-error',
						headBefore: selected.head,
						headAfter: selected.head,
						path: selected.path,
						error: commandError(
							'worktree.move',
							moved,
							moved.truncated
								? 'Git worktree move exceeded the configured output limit.'
								: 'Git worktree move failed.',
						),
					};
				const after = await this.listWorktreeIdentities({
					projectId: request.projectId,
					repositoryId: request.repositoryId,
					signal: request.signal,
				});
				const canonicalDestination =
					await this.canonicalWorktreePath(destination);
				const replacement = after.worktrees.find((value) =>
					samePath(value.path, canonicalDestination),
				);
				if (
					after.state !== 'ready' ||
					replacement === undefined ||
					after.worktrees.some((value) => value.id === request.worktreeId)
				)
					return {
						...base,
						worktreeId: request.worktreeId,
						applied: false,
						state: 'command-error',
						headBefore: selected.head,
						headAfter: null,
						path: null,
						error: {
							code: 'mutation-failed',
							message:
								'Git reported movement but canonical registration did not change',
							operation: 'worktree.move',
						},
					};
				return {
					...base,
					worktreeId: replacement.id,
					applied: true,
					state: 'moved',
					headBefore: selected.head,
					headAfter: replacement.head,
					path: replacement.path,
				};
			},
		);
	}

	/**
	 * Remove a clean, non-main worktree after revalidating its server-owned
	 * identity and current Git state.  The request never carries a filesystem
	 * path; the path passed to Git comes from the immediately preceding
	 * canonical `worktree list` result.
	 */
	async removeWorktree(
		request: GitWorktreeRemoveRequest,
	): Promise<GitWorktreeRemoveResult> {
		validateProjectId(request.projectId);
		return this.enqueueRepositoryMutation(
			request.repositoryId,
			request.worktreeId,
			() => this.executeRemoveWorktree(request),
		);
	}

	/**
	 * Remove a worktree only while it is still effectively clean. This is the
	 * removal a bulk sweep uses: the caller reviewed a listing rather than this
	 * one worktree, so the reviewed HEAD is mandatory, cleanliness is recomputed
	 * here, and Git is never forced — a change that lands after the recheck
	 * makes Git itself refuse. A lock is lifted rather than forced through.
	 */
	async removeCleanWorktree(
		request: GitWorktreeRemoveCleanRequest,
	): Promise<GitWorktreeRemoveResult> {
		validateProjectId(request.projectId);
		if (typeof request.expectedHead !== 'string' || request.expectedHead === '')
			throw new GitServiceError(
				'invalid-operation',
				'clean-only worktree removal requires the reviewed HEAD',
			);
		return this.enqueueRepositoryMutation(
			request.repositoryId,
			request.worktreeId,
			() => this.executeRemoveWorktree(request, true),
		);
	}

	private async executeRemoveWorktree(
		request: GitWorktreeRemoveRequest,
		cleanOnly = false,
	): Promise<GitWorktreeRemoveResult> {
		const listing = await this.listWorktreeIdentities({
			projectId: request.projectId,
			repositoryId: request.repositoryId,
			...(request.signal === undefined ? {} : { signal: request.signal }),
		});
		const base = {
			operation: 'remove' as const,
			projectId: request.projectId,
			repositoryId: request.repositoryId,
			worktreeId: request.worktreeId,
		};
		if (
			listing.state !== 'ready' ||
			listing.repositoryId !== request.repositoryId
		) {
			return {
				...base,
				applied: false,
				state: 'command-error',
				headBefore: null,
				error: listing.error ?? {
					code: 'repository-mismatch',
					message: 'worktree repository is no longer bound to this project',
					operation: 'worktree.remove',
				},
			};
		}
		const selected = listing.worktrees.find(
			(worktree) => worktree.id === request.worktreeId,
		);
		if (selected === undefined)
			throw new GitServiceError(
				'worktree-not-found',
				'worktree is not part of the project repository',
			);
		assertRemovableWorktree(selected, request.expectedHead);
		if (cleanOnly) assertSweepableWorktree(selected);

		if (!selected.isPrunable) {
			// `worktrees` includes a status read, but perform a second status read
			// directly against the selected opaque ID immediately before mutation.
			// This closes the common stale-review window where a dirty change lands
			// after the list response was rendered to a client. A prunable entry has
			// no directory in which status can run; Git's fresh prunable marker is
			// the state revalidation for that cleanup case.
			const fresh = await this.status({
				projectId: request.projectId,
				repositoryId: request.repositoryId,
				worktreeId: request.worktreeId,
				...(request.signal === undefined ? {} : { signal: request.signal }),
			});
			if (fresh.state !== 'ready') {
				return {
					...base,
					applied: false,
					state: 'command-error',
					headBefore: selected.head,
					error: fresh.error ?? {
						code: 'mutation-failed',
						message: 'worktree status could not be revalidated',
						operation: 'worktree.remove',
					},
				};
			}
			if (
				request.expectedHead !== undefined &&
				selected.head !== request.expectedHead
			) {
				throw new GitServiceError(
					'stale-revision',
					'worktree HEAD changed since the removal was reviewed',
					{
						worktreeId: request.worktreeId,
						expectedHead: request.expectedHead,
						actualHead: selected.head,
					},
				);
			}
			if (cleanOnly) {
				// The same effective-cleanliness judgement the listing shows: no
				// working-tree entries and nothing committed that the default branch
				// lacks. An unknown delta is not proof of cleanliness.
				const delta = await this.worktreeDelta(
					selected.path,
					await this.defaultBranch(
						listing.repositoryRoot ?? selected.path,
						request.signal,
					),
					request.signal,
				);
				if (fresh.entries.length > 0 || delta.hasCommittedChanges !== false)
					throw new GitServiceError(
						'worktree-dirty',
						'worktree is no longer clean',
						{ worktreeId: request.worktreeId },
					);
			}
		}

		const binding = this.getBinding(request.projectId);
		const cwd = binding?.repositoryRoot ?? binding?.projectRoot;
		if (cwd === undefined || cwd.length === 0) {
			return {
				...base,
				applied: false,
				state: 'command-error',
				headBefore: selected.head,
				error: {
					code: 'invalid-project',
					message: 'project is no longer bound to this server',
					operation: 'worktree.remove',
				},
			};
		}
		if (selected.isPrunable) {
			const failure = await this.unregisterPrunableWorktree(
				selected.path,
				cwd,
				request.signal,
			);
			if (failure !== null)
				return {
					...base,
					applied: false,
					state: 'command-error',
					headBefore: selected.head,
					error: failure,
				};
			return this.confirmWorktreeRemoved(request, base, selected.head);
		}
		// A lock does not make a clean worktree worth keeping: agent sessions lock
		// the worktrees they create and leave the lock behind when they end. Git
		// removes a locked worktree only when forced twice, which would discard
		// changes too, so a clean-only removal lifts the lock and stays unforced.
		const relock =
			cleanOnly && selected.locked
				? await this.worktreeLockReason(selected.path, cwd, request.signal)
				: undefined;
		if (relock !== undefined) {
			const unlocked = await this.runGit(
				['worktree', 'unlock', '--', selected.path],
				cwd,
				request.signal,
			);
			if (unlocked.exitCode !== 0 || unlocked.truncated)
				return {
					...base,
					applied: false,
					state: 'command-error',
					headBefore: selected.head,
					error: commandError(
						'worktree.remove',
						unlocked,
						'Git worktree unlock failed.',
					),
				};
		}
		// The client confirmation explicitly authorizes deleting uncommitted,
		// untracked, and unmerged contents, including a leftover Git lock.
		// Git requires `--force` twice to remove a locked worktree.
		// A clean-only removal is never forced, so Git's own refusal of a modified
		// worktree stays in effect after the recheck above.
		const result = await this.runGit(
			cleanOnly
				? ['worktree', 'remove', '--', selected.path]
				: ['worktree', 'remove', '--force', '--force', '--', selected.path],
			cwd,
			request.signal,
		);
		if (result.exitCode !== 0 || result.truncated) {
			// Git refused, so the worktree stays and so does its owner's lock.
			if (relock !== undefined)
				await this.runGit(
					[
						'worktree',
						'lock',
						...(relock === null ? [] : ['--reason', relock]),
						'--',
						selected.path,
					],
					cwd,
				);
			return {
				...base,
				applied: false,
				state: 'command-error',
				headBefore: selected.head,
				error: commandError(
					'worktree.remove',
					result,
					result.truncated
						? 'Git worktree removal exceeded the configured output limit.'
						: 'Git worktree removal failed.',
				),
			};
		}

		return this.confirmWorktreeRemoved(request, base, selected.head);
	}

	/** The reason a locked worktree's lock carries, or null when it has none. */
	private async worktreeLockReason(
		worktreePath: string,
		cwd: string,
		signal: AbortSignal | undefined,
	): Promise<string | null> {
		const listed = await this.runGit(
			['worktree', 'list', '--porcelain'],
			cwd,
			signal,
		);
		if (listed.exitCode !== 0 || listed.truncated) return null;
		for (const record of parseWorktreeList(listed.stdout)) {
			if (record.lockReason === null) continue;
			if ((await this.canonicalWorktreePath(record.path)) === worktreePath)
				return record.lockReason;
		}
		return null;
	}

	/**
	 * Drop the registration of a worktree that no longer has a working tree:
	 * its folder is gone, or what sits at its path is no longer that worktree
	 * (the `.git` file was removed, or the path was replaced). `git worktree
	 * remove` refuses the second kind outright, and `git worktree prune` would
	 * sweep every other stale entry too, so this removes exactly the one
	 * administrative directory prune would have removed. Nothing at the
	 * worktree's own path is touched: it is not a worktree any more, and a
	 * reused path may hold someone else's files.
	 */
	private async unregisterPrunableWorktree(
		worktreePath: string,
		cwd: string,
		signal: AbortSignal | undefined,
	): Promise<GitErrorInfo | null> {
		const common = await this.runGit(
			['rev-parse', '--git-common-dir'],
			cwd,
			signal,
		);
		const reported = common.stdout.trim();
		if (common.exitCode !== 0 || common.truncated || reported.length === 0)
			return commandError(
				'worktree.remove',
				common,
				'Git common directory could not be read.',
			);
		const registry = join(
			await this.canonicalWorktreePath(resolve(cwd, reported)),
			'worktrees',
		);
		let names: string[];
		try {
			names = await readdir(registry);
		} catch {
			names = [];
		}
		for (const name of names) {
			let gitdir: string;
			try {
				gitdir = (await readFile(join(registry, name, 'gitdir'), 'utf8')).trim();
			} catch {
				continue;
			}
			if (gitdir.length === 0) continue;
			const registered = await this.canonicalWorktreePath(
				dirname(resolve(registry, name, gitdir)),
			);
			if (registered !== worktreePath) continue;
			try {
				await rm(join(registry, name), { recursive: true, force: true });
				return null;
			} catch {
				return {
					code: 'mutation-failed',
					message: 'Git worktree registration could not be removed.',
					operation: 'worktree.remove',
				};
			}
		}
		return {
			code: 'mutation-failed',
			message: 'Git worktree registration could not be found.',
			operation: 'worktree.remove',
		};
	}

	private async confirmWorktreeRemoved(
		request: GitWorktreeRemoveRequest,
		base: Pick<
			GitWorktreeRemoveResult,
			'operation' | 'projectId' | 'repositoryId' | 'worktreeId'
		>,
		headBefore: string | null,
	): Promise<GitWorktreeRemoveResult> {
		// Verify that the exact identity disappeared; a successful command that
		// leaves the worktree registered is reported as a deterministic failure.
		const after = await this.listWorktreeIdentities({
			projectId: request.projectId,
			repositoryId: request.repositoryId,
		});
		if (
			after.state !== 'ready' ||
			after.worktrees.some((worktree) => worktree.id === request.worktreeId)
		) {
			return {
				...base,
				applied: false,
				state: 'command-error',
				headBefore,
				error: {
					code: 'mutation-failed',
					message: 'Git reported removal but the worktree is still registered',
					operation: 'worktree.remove',
				},
			};
		}
		return {
			...base,
			applied: true,
			state: 'removed',
			headBefore,
		};
	}

	/** Pull one clean, attached worktree using its configured upstream. The
	 * caller supplies only opaque identities; the canonical path is re-read
	 * immediately before Git mutates it and status is verified afterwards. */
	async pullWorktree(
		request: GitWorktreePullRequest,
	): Promise<GitWorktreePullResult> {
		validateProjectId(request.projectId);
		return this.enqueueRepositoryMutation(
			request.repositoryId,
			request.worktreeId,
			() => this.executePullWorktree(request),
		);
	}

	private async executePullWorktree(
		request: GitWorktreePullRequest,
	): Promise<GitWorktreePullResult> {
		const base = {
			operation: 'pull' as const,
			projectId: request.projectId,
			repositoryId: request.repositoryId,
			worktreeId: request.worktreeId,
		};
		const listing = await this.listWorktreeIdentities({
			projectId: request.projectId,
			repositoryId: request.repositoryId,
			...(request.signal === undefined ? {} : { signal: request.signal }),
		});
		if (
			listing.state !== 'ready' ||
			listing.repositoryId !== request.repositoryId
		) {
			return {
				...base,
				applied: false,
				state: 'command-error',
				headBefore: null,
				headAfter: null,
				error: listing.error ?? {
					code: 'repository-mismatch',
					message: 'worktree repository is no longer bound to this project',
					operation: 'worktree.pull',
				},
			};
		}
		const selected = listing.worktrees.find(
			(worktree) => worktree.id === request.worktreeId,
		);
		if (selected === undefined)
			throw new GitServiceError(
				'worktree-not-found',
				'worktree is not part of the project repository',
			);
		if (selected.isBare)
			throw new GitServiceError(
				'worktree-bare',
				'refusing to pull a bare worktree',
				{ worktreeId: request.worktreeId },
			);
		if (selected.isPrunable || selected.locked)
			throw new GitServiceError(
				'worktree-locked',
				'refusing to pull a locked or prunable worktree',
				{ worktreeId: request.worktreeId },
			);
		if (selected.detached || selected.branch === null)
			throw new GitServiceError(
				'mutation-failed',
				'refusing to pull a detached worktree',
				{ worktreeId: request.worktreeId },
			);
		if (
			request.expectedHead !== undefined &&
			request.expectedHead !== selected.head
		)
			throw new GitServiceError(
				'stale-revision',
				'worktree HEAD changed since the pull was reviewed',
				{
					worktreeId: request.worktreeId,
					expectedHead: request.expectedHead,
					actualHead: selected.head,
				},
			);

		const fresh = await this.status({
			projectId: request.projectId,
			repositoryId: request.repositoryId,
			worktreeId: request.worktreeId,
			...(request.signal === undefined ? {} : { signal: request.signal }),
		});
		if (fresh.state !== 'ready')
			return {
				...base,
				applied: false,
				state: 'command-error',
				headBefore: selected.head,
				headAfter: fresh.head,
				error: fresh.error ?? {
					code: 'mutation-failed',
					message: 'worktree status could not be revalidated',
					operation: 'worktree.pull',
				},
			};
		if (
			fresh.entries.some(
				(entry) => entry.unmerged || entry.unstaged || entry.staged,
			)
		)
			throw new GitServiceError(
				'worktree-dirty',
				'refusing to pull a dirty or unmerged worktree',
				{ worktreeId: request.worktreeId },
			);
		if (
			!headsMatch(selected.head, fresh.head) ||
			(request.expectedHead !== undefined &&
				!headsMatch(request.expectedHead, fresh.head))
		)
			throw new GitServiceError(
				'stale-revision',
				'worktree changed since the pull was reviewed',
				{
					worktreeId: request.worktreeId,
					expectedHead: request.expectedHead ?? selected.head,
					actualHead: fresh.head,
				},
			);
		// A branch pushed without `-u`, or only ever updated with
		// `git pull <remote> <branch>`, has no configured upstream even though
		// the remote branch it belongs to exists. Ask Git which remote carries
		// the branch rather than assuming one, so an ambiguous repository is
		// reported instead of guessed at.
		const source =
			fresh.branch.upstreamState === 'configured'
				? { args: [] as readonly string[] }
				: await this.resolveWorktreePullSource(
						selected.path,
						selected.branch,
						request.signal,
					);
		if ('message' in source)
			return {
				...base,
				applied: false,
				state: 'command-error',
				headBefore: fresh.head,
				headAfter: fresh.head,
				error: {
					code: 'command-error',
					message: source.message,
					operation: 'worktree.pull',
				},
			};

		const result = await this.runGit(
			['pull', '--ff-only', ...source.args],
			selected.path,
			request.signal,
		);
		if (result.exitCode !== 0 || result.truncated)
			return {
				...base,
				applied: false,
				state: 'command-error',
				headBefore: fresh.head,
				headAfter: fresh.head,
				error: commandError(
					'worktree.pull',
					result,
					result.truncated
						? 'Git pull output exceeded the configured limit.'
						: 'Git pull failed.',
				),
			};
		const after = await this.status({
			projectId: request.projectId,
			repositoryId: request.repositoryId,
			worktreeId: request.worktreeId,
			...(request.signal === undefined ? {} : { signal: request.signal }),
		});
		if (
			after.state !== 'ready' ||
			after.entries.some(
				(entry) => entry.unmerged || entry.unstaged || entry.staged,
			)
		)
			return {
				...base,
				applied: false,
				state: 'command-error',
				headBefore: fresh.head,
				headAfter: after.head,
				error: after.error ?? {
					code: 'mutation-failed',
					message: 'Git pull did not leave a clean worktree',
					operation: 'worktree.pull',
				},
			};
		return {
			...base,
			applied: true,
			state: 'pulled',
			headBefore: fresh.head,
			headAfter: after.head,
		};
	}

	/** Decide which remote branch an unconfigured branch fast-forwards from.
	 * Returns the extra `git pull` arguments, or the reason no single remote
	 * branch answers for it. */
	private async resolveWorktreePullSource(
		path: string,
		branch: string,
		signal?: AbortSignal,
	): Promise<
		{ readonly args: readonly string[] } | { readonly message: string }
	> {
		const remotes = await this.runGit(['remote'], path, signal);
		if (remotes.exitCode !== 0 || remotes.truncated)
			return { message: 'worktree remotes could not be listed' };
		const names = remotes.stdout
			.split('\n')
			.map((name) => name.trim())
			.filter((name) => name.length > 0);
		if (names.length === 0)
			return { message: 'worktree repository has no remote to pull from' };
		const patterns = names.map((name) => `refs/remotes/${name}/${branch}`);
		const refs = await this.runGit(
			['for-each-ref', '--format=%(refname)', ...patterns],
			path,
			signal,
		);
		if (refs.exitCode !== 0 || refs.truncated)
			return { message: 'worktree remote branches could not be listed' };
		const present = refs.stdout
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
		const matches = names.filter((name) =>
			present.includes(`refs/remotes/${name}/${branch}`),
		);
		const [only] = matches;
		if (only === undefined || matches.length > 1)
			return {
				message:
					only === undefined
						? `worktree branch "${branch}" has no configured upstream and no matching remote branch`
						: `worktree branch "${branch}" has no configured upstream and matches more than one remote branch`,
			};
		return { args: [only, branch] };
	}

	pullWorktreeFromOrigin(
		request: GitWorktreePullRequest,
	): Promise<GitWorktreePullResult> {
		return this.pullWorktree(request);
	}

	async readOnly(
		request: GitReadOnlyRequest,
	): Promise<
		GitStatusResult | GitBranchResult | GitDiffResult | GitWorktreeListResult
	> {
		if (request.operation === 'status') return this.status(request);
		if (request.operation === 'branch') return this.branch(request);
		if (request.operation === 'diff') return this.diff(request);
		if (request.operation === 'worktrees') return this.worktrees(request);
		throw new GitServiceError(
			'invalid-operation',
			'unsupported Git read-only operation',
		);
	}

	runReadOnly(
		request: GitReadOnlyRequest,
	): Promise<
		GitStatusResult | GitBranchResult | GitDiffResult | GitWorktreeListResult
	> {
		return this.readOnly(request);
	}

	readOnlyCommand(
		request: GitReadOnlyRequest,
	): Promise<
		GitStatusResult | GitBranchResult | GitDiffResult | GitWorktreeListResult
	> {
		return this.readOnly(request);
	}

	private enqueueRepositoryMutation<T>(
		repositoryId: string,
		worktreeId: string,
		work: () => Promise<T>,
	): Promise<T> {
		const previous =
			this.repositoryMutationTails.get(repositoryId) ?? Promise.resolve();
		const run = previous
			.catch(() => undefined)
			.then(async () => {
				this.mutatingWorktreeIds.add(worktreeId);
				try {
					return await work();
				} finally {
					this.mutatingWorktreeIds.delete(worktreeId);
					// A mutation can move, remove, or rewrite any worktree; never
					// answer the next listing from a cache taken before it.
					const observation = this.observations.get(repositoryId);
					if (observation !== undefined) observation.dirtyAll = true;
				}
			});
		this.repositoryMutationTails.set(repositoryId, run);
		void run
			.finally(() => {
				if (this.repositoryMutationTails.get(repositoryId) === run)
					this.repositoryMutationTails.delete(repositoryId);
			})
			.then(
				() => undefined,
				() => undefined,
			);
		return run;
	}

	private async listWorktreeIdentities(target: GitTargetRequest): Promise<{
		readonly projectId: string;
		readonly repositoryId: GitRepositoryId | null;
		readonly repositoryRoot: string | null;
		readonly state: GitDiscoveryState;
		readonly worktrees: readonly GitWorktreeIdentity[];
		readonly error?: GitErrorInfo;
	}> {
		const discovery = await this.resolveDiscovery(target);
		const empty = {
			projectId: target.projectId,
			repositoryId: discovery.repositoryId,
			repositoryRoot: discovery.repositoryRoot,
			state: discovery.state,
			worktrees: [] as GitWorktreeIdentity[],
			...(discovery.error === undefined ? {} : { error: discovery.error }),
		};
		if (
			discovery.state !== 'ready' ||
			discovery.repositoryRoot === null ||
			discovery.repositoryId === null
		)
			return empty;
		const result = await this.runGit(
			['worktree', 'list', '--porcelain'],
			discovery.repositoryRoot,
			target.signal,
		);
		if (result.exitCode !== 0 || result.truncated) {
			return {
				...empty,
				state: 'command-error',
				error: commandError(
					'worktrees',
					result,
					result.truncated
						? 'Git worktree output exceeded the configured limit.'
						: 'Git worktree list failed.',
				),
			};
		}
		const records = await this.worktreeRecords(result.stdout);
		const mainPath = records.find((record) => !record.isBare)?.path;
		const worktrees: GitWorktreeIdentity[] = [];
		for (const record of records.slice(0, this.limits.maxWorktrees)) {
			const path = await this.canonicalWorktreePath(record.path);
			worktrees.push({
				id: worktreeId(discovery.repositoryId, path),
				path,
				branch: record.branch,
				detached: record.detached,
				head: record.head,
				isMain: mainPath !== undefined && samePath(mainPath, record.path),
				isBare: record.isBare,
				isPrunable: record.isPrunable,
				locked: record.locked,
			});
		}
		return { ...empty, state: 'ready', worktrees };
	}

	private async resolveDiscovery(target: GitTargetRequest): Promise<Discovery> {
		const binding = this.bindings.get(target.projectId);
		if (binding === undefined)
			throw new GitServiceError(
				'invalid-project',
				'project is not bound to this server',
				{ projectId: target.projectId },
			);
		const discovery = await this.discover(binding.projectRoot, target.signal);
		if (
			target.repositoryId !== undefined &&
			target.repositoryId !== discovery.repositoryId
		) {
			throw new GitServiceError(
				'repository-mismatch',
				'repository does not belong to the project binding',
				{
					expected: target.repositoryId,
					actual: discovery.repositoryId ?? null,
				},
			);
		}
		if (
			target.worktreeId !== undefined &&
			target.worktreeId !== discovery.worktreeId
		) {
			// A project request may address another worktree in the same repository.
			// Resolve it only through the bounded worktree listing; arbitrary paths
			// are never accepted as command cwd values.
			const listed = await this.findWorktree(target, discovery);
			return { ...discovery, worktreeId: listed.id, worktreeRoot: listed.path };
		}
		// Released while discovering: never resurrect the binding.
		if (this.bindings.get(target.projectId) !== binding) return discovery;
		const rediscovered: GitProjectBinding = {
			projectId: target.projectId,
			projectRoot: binding.projectRoot,
			repositoryId: discovery.repositoryId,
			repositoryRoot: discovery.repositoryRoot,
			worktreeId: discovery.worktreeId,
			worktreeRoot: discovery.worktreeRoot,
			state: discovery.state,
		};
		this.bindings.set(target.projectId, rediscovered);
		if (
			binding.repositoryId !== rediscovered.repositoryId ||
			binding.state !== rediscovered.state
		)
			this.rebindObservation(target.projectId, binding, rediscovered);
		return discovery;
	}

	private async findWorktree(
		target: GitTargetRequest,
		discovery: Discovery,
	): Promise<{ id: GitWorktreeId; path: string }> {
		if (
			discovery.state !== 'ready' ||
			discovery.repositoryRoot === null ||
			discovery.repositoryId === null
		)
			throw new GitServiceError(
				'worktree-not-found',
				'worktree is not available for this repository',
			);
		const result = await this.runGit(
			['worktree', 'list', '--porcelain'],
			discovery.repositoryRoot,
			target.signal,
		);
		if (result.exitCode !== 0 || result.truncated)
			throw new GitServiceError(
				'worktree-not-found',
				'worktree list could not be read',
			);
		for (const record of parseWorktreeList(result.stdout).slice(
			0,
			this.limits.maxWorktrees,
		)) {
			const canonical = await this.canonicalWorktreePath(record.path);
			if (worktreeId(discovery.repositoryId, canonical) === target.worktreeId)
				return { id: target.worktreeId as GitWorktreeId, path: canonical };
		}
		throw new GitServiceError(
			'worktree-not-found',
			'worktree is not part of the project repository',
		);
	}

	/**
	 * Git reports every status path as a plain name, so a symlinked directory
	 * (a worktree's `node_modules` linked to its main checkout, for example) is
	 * indistinguishable from a file. Only untracked entries can be directories,
	 * so one bounded stat per untracked entry settles it for the UI.
	 */
	private async markDirectoryEntries(
		entries: readonly GitStatusEntry[],
		worktreeRoot: string,
		signal?: AbortSignal,
	): Promise<readonly GitStatusEntry[]> {
		if (!entries.some((entry) => entry.kind === 'untracked')) return entries;
		const marked: GitStatusEntry[] = [];
		for (const entry of entries) {
			if (entry.kind !== 'untracked' || entry.isDirectory) {
				marked.push(entry);
				continue;
			}
			if (signal?.aborted === true) {
				marked.push(entry);
				continue;
			}
			let isDirectory = false;
			try {
				// `stat` follows symlinks, which is what makes a linked directory
				// present as the folder the user sees on disk.
				isDirectory =
					(await this.pathAdapter.stat(resolve(worktreeRoot, entry.path)))
						.isDirectory === true;
			} catch {
				isDirectory = false;
			}
			marked.push(isDirectory ? { ...entry, isDirectory: true } : entry);
		}
		return marked;
	}

	private async discover(
		projectRoot: string,
		signal?: AbortSignal,
	): Promise<Discovery> {
		// Distinguish an ordinary non-repository from a project whose `.git`
		// indirection exists but points at missing metadata. This check stays on
		// the server-side canonical path and never accepts a client-supplied cwd.
		let gitMetadataPresent = false;
		try {
			const metadata = await this.pathAdapter.stat(
				resolve(projectRoot, '.git'),
			);
			gitMetadataPresent =
				metadata.isFile === true || metadata.isDirectory === true;
		} catch {
			gitMetadataPresent = false;
		}
		const result = await this.runGit(
			['rev-parse', '--show-toplevel'],
			projectRoot,
			signal,
		);
		if (result.exitCode !== 0 || result.truncated) {
			const code = classifyDiscoveryError(
				result,
				result.truncated,
				gitMetadataPresent,
			);
			return {
				state: code,
				repositoryId: null,
				repositoryRoot: null,
				worktreeId: null,
				worktreeRoot: null,
				error: commandError('discover', result, discoveryMessage(code)),
			};
		}
		const rawRoot = result.stdout.trim();
		if (rawRoot.length === 0)
			return {
				state: 'command-error',
				repositoryId: null,
				repositoryRoot: null,
				worktreeId: null,
				worktreeRoot: null,
				error: {
					code: 'command-error',
					message: 'Git returned an empty repository root.',
					operation: 'discover',
				},
			};
		let repositoryRoot: string;
		try {
			repositoryRoot = await this.canonicalDirectory(rawRoot);
		} catch {
			return {
				state: 'missing-gitfile',
				repositoryId: null,
				repositoryRoot: null,
				worktreeId: null,
				worktreeRoot: null,
				error: {
					code: 'missing-gitfile',
					message: 'Git repository metadata is missing.',
					operation: 'discover',
				},
			};
		}
		const repositoryId = repositoryIdFor(repositoryRoot);
		const worktreeRoot = repositoryRoot;
		return {
			state: 'ready',
			repositoryId,
			repositoryRoot,
			worktreeId: worktreeId(repositoryId, worktreeRoot),
			worktreeRoot,
		};
	}

	private async canonicalDirectory(value: string): Promise<string> {
		if (
			typeof value !== 'string' ||
			value.length === 0 ||
			value.length > this.limits.maxPathBytes ||
			value.includes('\0')
		)
			throw new GitServiceError('invalid-project', 'project path is invalid');
		let canonical: string;
		try {
			canonical = await this.pathAdapter.realpath(value);
		} catch {
			throw new GitServiceError(
				'invalid-project',
				'project path does not exist',
			);
		}
		let pathStat: Awaited<ReturnType<GitPathAdapter['stat']>>;
		try {
			pathStat = await this.pathAdapter.stat(canonical);
		} catch {
			throw new GitServiceError(
				'invalid-project',
				'project path does not exist',
			);
		}
		if (pathStat.isDirectory === false)
			throw new GitServiceError(
				'invalid-project',
				'project path is not a directory',
			);
		return canonical;
	}

	/**
	 * Parse `worktree list --porcelain`, treating a locked linked worktree that
	 * has lost its working tree as prunable, exactly as Git would were it not
	 * locked: its `.git` file is gone, whether with the folder or not. Git
	 * withholds the `prunable` marker while a lock is held, yet such an entry
	 * has nowhere status can run, so without this it could be neither inspected
	 * nor removed. An agent session that dies holding its lock leaves these.
	 */
	private async worktreeRecords(stdout: string): Promise<ParsedWorktree[]> {
		const records = parseWorktreeList(stdout);
		const mainIndex = records.findIndex((record) => !record.isBare);
		return Promise.all(
			records.map(async (record, index) => {
				if (
					index === mainIndex ||
					!record.locked ||
					record.isBare ||
					record.isPrunable
				)
					return record;
				try {
					await this.pathAdapter.stat(join(record.path, '.git'));
					return record;
				} catch (error) {
					const code = (error as NodeJS.ErrnoException)?.code;
					if (code !== 'ENOENT' && code !== 'ENOTDIR') return record;
					return { ...record, isPrunable: true };
				}
			}),
		);
	}

	private async canonicalWorktreePath(value: string): Promise<string> {
		try {
			return await this.pathAdapter.realpath(value);
		} catch {
			return normalize(resolve(value));
		}
	}

	private async resolveProjectRelativePath(
		path: string,
		worktreeRoot: string,
		projectId: string,
	): Promise<string> {
		validateRelativePath(path, this.limits.maxPathBytes);
		const binding = this.bindings.get(projectId);
		if (binding === undefined)
			throw new GitServiceError(
				'invalid-project',
				'project is not bound to this server',
			);
		const candidate = resolve(binding.projectRoot, path);
		if (!isWithin(binding.projectRoot, candidate))
			throw new GitServiceError(
				'path-escape',
				'Git path is outside the project binding',
			);
		try {
			const canonical = await this.pathAdapter.realpath(candidate);
			if (!isWithin(binding.projectRoot, canonical))
				throw new GitServiceError(
					'path-escape',
					'Git path resolves outside the project binding',
				);
		} catch (error) {
			if (error instanceof GitServiceError) throw error;
			// Deleted files remain valid Git diff selectors. Lexical containment was
			// checked above, and Git receives only the relative selector.
		}
		// Git's cwd is the selected worktree root, while the request path is
		// relative to the bound project root. Translate only after containment
		// checks; the resulting selector remains relative and cannot escape.
		const repositoryRoot = binding.repositoryRoot ?? worktreeRoot;
		const gitPath = relative(repositoryRoot, candidate).replace(/\\/gu, '/');
		if (
			gitPath.length === 0 ||
			gitPath.startsWith('../') ||
			gitPath === '..' ||
			isAbsolute(gitPath)
		)
			throw new GitServiceError(
				'path-escape',
				'Git path is outside the repository binding',
			);
		return gitPath;
	}

	private async readHead(
		cwd: string,
		signal?: AbortSignal,
	): Promise<string | null> {
		const result = await this.runGit(
			['rev-parse', '--short', 'HEAD'],
			cwd,
			signal,
		);
		return result.exitCode === 0 && !result.truncated
			? result.stdout.trim() || null
			: null;
	}

	private async defaultBranch(
		cwd: string,
		signal?: AbortSignal,
	): Promise<string | null> {
		const remote = await this.runGit(
			['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
			cwd,
			signal,
		);
		if (remote.exitCode === 0 && !remote.truncated) {
			const value = remote.stdout.trim();
			if (value.startsWith('origin/')) return value.slice('origin/'.length);
			if (value.length > 0) return value;
		}
		for (const candidate of ['main', 'master']) {
			const local = await this.runGit(
				['show-ref', '--verify', '--quiet', `refs/heads/${candidate}`],
				cwd,
				signal,
			);
			if (local.exitCode === 0) return candidate;
		}
		const branches = await this.runGit(
			['branch', '--format=%(refname:short)'],
			cwd,
			signal,
		);
		if (branches.exitCode !== 0 || branches.truncated) return null;
		return (
			branches.stdout
				.split(/\r?\n/u)
				.map((value) => value.trim())
				.find((value) => value.length > 0) ?? null
		);
	}

	private async worktreeDelta(
		cwd: string,
		defaultBranch: string | null,
		signal?: AbortSignal,
		/** The worktree's branch as its status header gave it. Without it the
		 * unpushed measurement is skipped and reported as unknown. */
		branch?: GitBranchStatus,
	): Promise<{
		readonly aheadCount: number | null;
		readonly additions: number | null;
		readonly deletions: number | null;
		readonly hasCommittedChanges: boolean | null;
		readonly hasUnpushedCommits: boolean | null;
		readonly unpushedAdditions: number | null;
		readonly unpushedDeletions: number | null;
	}> {
		const ahead =
			defaultBranch === null
				? null
				: await this.runGit(
						['rev-list', '--count', `${defaultBranch}..HEAD`],
						cwd,
						signal,
					);
		const aheadCount =
			ahead !== null && ahead.exitCode === 0 && !ahead.truncated
				? parseNonNegativeInteger(ahead.stdout)
				: null;
		const branchDelta = await this.committedDelta(cwd, defaultBranch, signal);
		const workingDelta = await this.numstat(
			cwd,
			['diff', '--numstat', 'HEAD'],
			signal,
		);
		const unpushed =
			branch === undefined
				? { hasCommits: null, delta: null }
				: await this.unpushedCommits(cwd, branch, branchDelta, signal);
		const unpushedMeasured = unpushed.delta !== null && workingDelta !== null;
		const pushState = {
			hasUnpushedCommits: unpushed.hasCommits,
			unpushedAdditions: unpushedMeasured
				? unpushed.delta.additions + workingDelta.additions
				: null,
			unpushedDeletions: unpushedMeasured
				? unpushed.delta.deletions + workingDelta.deletions
				: null,
		};
		if (branchDelta === null && workingDelta === null) {
			return {
				aheadCount,
				additions: null,
				deletions: null,
				hasCommittedChanges: null,
				...pushState,
			};
		}
		return {
			aheadCount,
			additions: (branchDelta?.additions ?? 0) + (workingDelta?.additions ?? 0),
			deletions: (branchDelta?.deletions ?? 0) + (workingDelta?.deletions ?? 0),
			hasCommittedChanges: branchDelta?.hasChanges ?? null,
			...pushState,
		};
	}

	/**
	 * The commits of a checkout that are on no remote, and their size. Under a
	 * live upstream those are the commits the upstream lacks, which the status
	 * header already counted. With no upstream, or one that is gone, they are
	 * the commits no remote-tracking branch holds; a branch whose tree is
	 * already on the default branch has none, so a squash-merged worktree does
	 * not turn unpushed when its remote branch is deleted.
	 */
	private async unpushedCommits(
		cwd: string,
		branch: GitBranchStatus,
		branchDelta: NumstatDelta | null,
		signal?: AbortSignal,
	): Promise<{
		readonly hasCommits: boolean | null;
		readonly delta: NumstatDelta | null;
	}> {
		const none = {
			hasCommits: false,
			delta: { additions: 0, deletions: 0, hasChanges: false },
		};
		if (branch.upstreamState === 'configured') {
			if ((branch.ahead ?? 0) === 0) return none;
			return {
				hasCommits: true,
				delta: await this.numstat(
					cwd,
					['diff', '--numstat', '@{upstream}...HEAD'],
					signal,
				),
			};
		}
		if (branchDelta?.hasChanges === false) return none;
		const unpushed = await this.runGit(
			['rev-list', '--count', 'HEAD', '--not', '--remotes'],
			cwd,
			signal,
		);
		const count =
			unpushed.exitCode === 0 && !unpushed.truncated
				? parseNonNegativeInteger(unpushed.stdout)
				: null;
		if (count === null) return { hasCommits: null, delta: null };
		if (count === 0) return none;
		return { hasCommits: true, delta: branchDelta };
	}

	private async committedDelta(
		cwd: string,
		defaultBranch: string | null,
		signal?: AbortSignal,
	): Promise<NumstatDelta | null> {
		if (defaultBranch === null) return null;
		const [defaultTree, mergedTree] = await Promise.all([
			this.runGit(['rev-parse', `${defaultBranch}^{tree}`], cwd, signal),
			this.runGit(
				['merge-tree', '--write-tree', '--no-messages', defaultBranch, 'HEAD'],
				cwd,
				signal,
			),
		]);
		const defaultTreeId = validObjectId(defaultTree);
		const mergedTreeId = validObjectId(mergedTree);
		if (defaultTreeId !== null && mergedTreeId !== null) {
			if (defaultTreeId === mergedTreeId)
				return { additions: 0, deletions: 0, hasChanges: false };
			return this.numstat(
				cwd,
				['diff', '--numstat', defaultTreeId, mergedTreeId],
				signal,
			);
		}
		return this.numstat(
			cwd,
			['diff', '--numstat', `${defaultBranch}...HEAD`],
			signal,
		);
	}

	private async numstat(
		cwd: string,
		args: readonly string[],
		signal?: AbortSignal,
	): Promise<NumstatDelta | null> {
		const result = await this.runGit(args, cwd, signal);
		if (result.exitCode !== 0 || result.truncated) return null;
		let additions = 0;
		let deletions = 0;
		let hasChanges = false;
		for (const line of result.stdout.split(/\r?\n/u)) {
			if (line.length === 0) continue;
			hasChanges = true;
			const [rawAdditions, rawDeletions] = line.split('\t', 3);
			if (rawAdditions === undefined || rawDeletions === undefined) return null;
			if (rawAdditions !== '-') {
				const value = parseNonNegativeInteger(rawAdditions);
				if (value === null) return null;
				additions += value;
			}
			if (rawDeletions !== '-') {
				const value = parseNonNegativeInteger(rawDeletions);
				if (value === null) return null;
				deletions += value;
			}
			if (!Number.isSafeInteger(additions) || !Number.isSafeInteger(deletions))
				return null;
		}
		return { additions, deletions, hasChanges };
	}

	private async runGit(
		args: readonly string[],
		cwd: string,
		signal?: AbortSignal,
		maxOutputBytes = this.limits.maxOutputBytes,
	): Promise<GitCommandResult> {
		// Nothing spawns for a closed service or a cancelled caller.
		if (this.closed)
			throw new GitServiceError('invalid-project', 'Git service is closed');
		signal?.throwIfAborted();
		try {
			return await this.runner.run(args, cwd, { signal, maxOutputBytes });
		} catch (error) {
			if (isAbortError(error)) throw error;
			if (
				typeof error === 'object' &&
				error !== null &&
				['ENOENT', 'GIT_UNAVAILABLE'].includes(
					(error as { readonly code?: unknown }).code as string,
				)
			) {
				return {
					stdout: '',
					stderr: 'git executable is unavailable',
					exitCode: null,
					truncated: false,
				};
			}
			const message = error instanceof Error ? error.message : String(error);
			return { stdout: '', stderr: message, exitCode: null, truncated: false };
		}
	}

	private emptyStatus(
		projectId: string,
		discovery: Discovery,
	): GitStatusResult {
		return {
			projectId,
			repositoryId: discovery.repositoryId,
			repositoryRoot: discovery.repositoryRoot,
			worktreeId: discovery.worktreeId,
			worktreeRoot: discovery.worktreeRoot,
			state: discovery.state,
			branch: {
				name: null,
				detached: false,
				head: null,
				upstream: null,
				upstreamState: 'none',
				ahead: null,
				behind: null,
			},
			entries: [],
			head: null,
			bounded: false,
			...(discovery.error === undefined ? {} : { error: discovery.error }),
		};
	}

	/**
	 * Tell subscribers that something shown for a worktree changed outside Git,
	 * such as properties an extension published. Clients re-list as they do for
	 * any status change.
	 */
	announceWorktreeChange(projectId: string, worktreeId: string | null): void {
		const binding = this.bindings.get(projectId);
		if (binding === undefined || this.closed) return;
		this.record(
			Object.freeze({
				revision: this.nextRevision(),
				cursor: String(this.revisionValue),
				type: 'git.status.changed',
				projectId,
				repositoryId: binding.repositoryId,
				worktreeId,
				state: binding.state,
				branch: null,
				head: null,
				changedFiles: 0,
				bounded: false,
			}),
		);
	}

	private publishProgress(
		operation: GitServiceOperation,
		phase: GitProgressPhase,
		projectId: string,
		repositoryId: string | null,
		worktreeId: string | null,
		state: GitDiscoveryState | 'removed',
		bounded: boolean,
	): void {
		this.record(
			Object.freeze({
				revision: this.nextRevision(),
				cursor: String(this.revisionValue),
				type: 'git.progress',
				operation,
				phase,
				projectId,
				repositoryId,
				worktreeId,
				state,
				bounded,
			}),
		);
	}

	/** Returns whether an event was published rather than suppressed as a
	 *  repeat of the last one for this worktree. */
	private publishStatusChange(status: GitStatusResult): boolean {
		const key = `${status.projectId}\0${status.repositoryId ?? ''}\0${status.worktreeId ?? ''}`;
		const fingerprint = JSON.stringify({
			state: status.state,
			branch: status.branch,
			head: status.head,
			entries: status.entries,
			bounded: status.bounded,
		});
		if (this.statusFingerprints.get(key) === fingerprint) return false;
		this.statusFingerprints.set(key, fingerprint);
		const event: GitStatusChangeEvent = Object.freeze({
			revision: this.nextRevision(),
			cursor: String(this.revisionValue),
			type: 'git.status.changed',
			projectId: status.projectId,
			repositoryId: status.repositoryId,
			worktreeId: status.worktreeId,
			state: status.state,
			branch: status.branch.name,
			head: status.head,
			changedFiles: status.entries.length,
			bounded: status.bounded,
		});
		this.record(event);
		return true;
	}

	private nextRevision(): number {
		if (this.revisionValue === Number.MAX_SAFE_INTEGER)
			throw new RangeError('Git event revision exhausted');
		this.revisionValue += 1;
		return this.revisionValue;
	}

	private record(event: GitServiceEvent): void {
		this.events.push(event);
		while (this.events.length > this.maxEvents) this.events.shift();
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch {
				/* observer failures cannot roll back Git state */
			}
		}
	}

	// ---- Observation ------------------------------------------------------
	// Status follows watch events (ADR-0028). Nothing here runs on a timer
	// except the ramp that damps work after an observed change.

	private rebindObservation(
		projectId: string,
		previous: GitProjectBinding | undefined,
		next: GitProjectBinding,
	): void {
		if (
			previous !== undefined &&
			previous.repositoryId !== null &&
			previous.repositoryId === next.repositoryId &&
			this.observations.get(previous.repositoryId)?.projects.has(projectId)
		)
			return;
		if (previous !== undefined) this.stopObserving(projectId, previous);
		this.observe(next);
	}

	private observe(binding: GitProjectBinding): void {
		if (this.closed) return;
		if (
			binding.state !== 'ready' ||
			binding.repositoryId === null ||
			binding.repositoryRoot === null
		) {
			this.watchForRepository(binding);
			return;
		}
		const existing = this.observations.get(binding.repositoryId);
		if (existing !== undefined) {
			existing.projects.add(binding.projectId);
			return;
		}
		const observation: RepositoryObservation = {
			repositoryId: binding.repositoryId,
			repositoryRoot: binding.repositoryRoot,
			projects: new Set([binding.projectId]),
			watches: new Map(),
			watchKinds: new Map(),
			changes: emptyChanges(),
			flushTimer: undefined,
			schedule: createRefreshSchedule({
				rampMs: this.refreshRampMs,
				run: () => this.refreshObservation(observation),
				setTimer: (callback, delayMs) => {
					const timer = setTimeout(callback, delayMs);
					timer.unref?.();
					return timer;
				},
				clearTimer: (timer) =>
					clearTimeout(timer as ReturnType<typeof setTimeout>),
			}),
			abort: new AbortController(),
			dirty: new Set(),
			// Until a listing names the worktrees, the repository root is the only
			// working tree known, and it may be a linked worktree.
			layout: {
				mainWorktreeId: null,
				defaultBranch: null,
				worktrees:
					binding.worktreeId === null
						? []
						: [
								{
									id: binding.worktreeId,
									path: binding.repositoryRoot,
									branch: null,
									gitDirName: null,
									hasWorkingTree: true,
								},
							],
			},
			commonDir: null,
			listing: undefined,
			dirtyAll: true,
			unavailable: false,
			closed: false,
			refreshing: false,
			refreshAgain: false,
			measuring: undefined,
		};
		this.observations.set(binding.repositoryId, observation);
		this.syncWorkingTreeWatches(observation);
		void this.watchGitDirectory(observation);
	}

	private stopObserving(projectId: string, binding: GitProjectBinding): void {
		this.closeDiscoveryWatch(projectId);
		if (binding.repositoryId === null) return;
		const observation = this.observations.get(binding.repositoryId);
		if (observation === undefined) return;
		observation.projects.delete(projectId);
		if (observation.projects.size === 0) this.disposeObservation(observation);
	}

	private disposeObservation(observation: RepositoryObservation): void {
		observation.closed = true;
		observation.schedule.cancel();
		observation.abort.abort();
		this.flushChanges(observation);
		for (const path of [...observation.watches.keys()])
			this.closeWatch(observation, path);
		observation.listing = undefined;
		if (this.observations.get(observation.repositoryId) === observation) {
			this.observations.delete(observation.repositoryId);
			this.lastWorktreeSummaries.delete(observation.repositoryId);
		}
	}

	/** A project root that is not a repository yet becomes one when `.git`
	 *  appears in it; nothing else about it is observed. */
	private watchForRepository(binding: GitProjectBinding): void {
		const { projectId, projectRoot } = binding;
		this.closeDiscoveryWatch(projectId);
		const handle = this.watcher.watch(projectRoot, {
			recursive: false,
			onChange: (entry) => {
				if (entry !== null && entry !== '.git') return;
				if (this.discoveryWatches.get(projectId) !== handle) return;
				void this.rediscover(projectId, projectRoot);
			},
			// Without a watch the project is measured when a client asks.
			onError: (error) => {
				if (this.discoveryWatches.get(projectId) !== handle) return;
				this.report({
					kind: 'watch.failed',
					repository: null,
					watch: 'discovery',
					recursive: false,
					error: reportedError(error),
				});
				this.closeDiscoveryWatch(projectId);
			},
		});
		this.discoveryWatches.set(projectId, handle);
		this.report({
			kind: 'watch.opened',
			repository: null,
			watch: 'discovery',
			recursive: false,
		});
	}

	private closeDiscoveryWatch(projectId: string): void {
		const handle = this.discoveryWatches.get(projectId);
		if (handle === undefined) return;
		handle.close();
		this.discoveryWatches.delete(projectId);
		this.report({
			kind: 'watch.closed',
			repository: null,
			watch: 'discovery',
			recursive: false,
		});
	}

	private async rediscover(projectId: string, projectRoot: string) {
		const generation = this.projectGenerations.get(projectId);
		const current = this.bindings.get(projectId);
		if (current === undefined || current.projectRoot !== projectRoot) return;
		const discovered = await this.discover(projectRoot).catch(() => undefined);
		if (
			discovered === undefined ||
			discovered.state !== 'ready' ||
			this.projectGenerations.get(projectId) !== generation
		)
			return;
		const binding = await this.bindProject(projectId, projectRoot).catch(
			() => undefined,
		);
		if (binding !== undefined) this.publishUnattributedChange(binding);
	}

	private async watchGitDirectory(
		observation: RepositoryObservation,
	): Promise<void> {
		let commonDir: string;
		try {
			const result = await this.runGit(
				['rev-parse', '--git-common-dir'],
				observation.repositoryRoot,
			);
			const reported = result.stdout.trim();
			if (result.exitCode !== 0 || result.truncated || reported.length === 0)
				throw new Error('Git common directory is unavailable');
			commonDir = await this.pathAdapter.realpath(
				resolve(observation.repositoryRoot, reported),
			);
		} catch (error) {
			this.observationFailed(observation, error, 'git-directory', true);
			return;
		}
		if (observation.closed || observation.unavailable) return;
		this.addWatch(observation, commonDir, true, 'git-directory', (entry) => ({
			scope: attributeGitDirChange(entry, observation.layout),
			entryClass: classifyGitDirEntry(entry, observation.layout),
		}));
		observation.commonDir = commonDir;
	}

	private addWatch(
		observation: RepositoryObservation,
		path: string,
		recursive: boolean,
		kind: GitObservationWatchKind,
		attribute: (entry: string | null) => {
			scope: GitChangeScope;
			entryClass: GitObservationEntryClass;
		},
	): void {
		const handle = this.watcher.watch(path, {
			recursive,
			onChange: (entry) => {
				if (observation.watches.get(path) !== handle) return;
				const { scope, entryClass } = attribute(entry);
				this.observedChange(observation, scope, entryClass);
			},
			onError: (error) => {
				if (observation.watches.get(path) !== handle) return;
				this.observationFailed(observation, error, kind, recursive);
			},
		});
		observation.watches.set(path, handle);
		observation.watchKinds.set(path, { kind, recursive });
		this.report({
			kind: 'watch.opened',
			repository: this.diagnosticRepositoryId(observation.repositoryId),
			watch: kind,
			recursive,
		});
	}

	private closeWatch(observation: RepositoryObservation, path: string): void {
		const handle = observation.watches.get(path);
		if (handle === undefined) return;
		const described = observation.watchKinds.get(path);
		handle.close();
		observation.watches.delete(path);
		observation.watchKinds.delete(path);
		this.report({
			kind: 'watch.closed',
			repository: this.diagnosticRepositoryId(observation.repositoryId),
			watch: described?.kind ?? 'working-tree',
			recursive: described?.recursive ?? true,
		});
	}

	/** Watch every working tree the layout names, and stop watching any that
	 *  went away. A root inside another watched root is already covered. */
	private syncWorkingTreeWatches(
		observation: RepositoryObservation,
	): readonly string[] {
		const added: string[] = [];
		if (observation.closed || observation.unavailable) return added;
		const wanted = new Set(workingTreeWatchRoots(observation.layout));
		for (const path of [...observation.watches.keys()]) {
			if (path === observation.commonDir || wanted.has(path)) continue;
			this.closeWatch(observation, path);
		}
		for (const root of wanted) {
			if (observation.watches.has(root)) continue;
			added.push(root);
			this.addWatch(observation, root, true, 'working-tree', (entry) => ({
				scope: attributeWorkingTreeChange(root, entry, observation.layout),
				entryClass: 'working-tree',
			}));
		}
		return added;
	}

	private observedChange(
		observation: RepositoryObservation,
		scope: GitChangeScope,
		entryClass: GitObservationEntryClass,
	): void {
		if (observation.closed || observation.unavailable) return;
		const { byClass, byScope } = observation.changes;
		const scoped = scopeName(scope);
		byClass[entryClass] = (byClass[entryClass] ?? 0) + 1;
		byScope[scoped] = (byScope[scoped] ?? 0) + 1;
		this.armChangeFlush(observation);
		if (scope.kind === 'ignore') return;
		if (scope.kind === 'all') observation.dirtyAll = true;
		else for (const id of scope.ids) observation.dirty.add(id);
		observation.schedule.request();
	}

	private refreshObservation(observation: RepositoryObservation): void {
		if (observation.closed || observation.unavailable) return;
		if (observation.refreshing) {
			observation.refreshAgain = true;
			return;
		}
		const [projectId] = observation.projects;
		if (projectId === undefined) return;
		observation.refreshing = true;
		void this.listWorktreesFrom(
			{ projectId, signal: observation.abort.signal },
			{ raisedBy: 'watch', fresh: false },
		)
			.catch(() => undefined)
			.finally(() => {
				observation.refreshing = false;
				if (!observation.refreshAgain) return;
				observation.refreshAgain = false;
				observation.schedule.request();
			});
	}

	/**
	 * A watch that fails leaves the repository measured on demand. No timer
	 * replaces it (ADR-0028): clients re-query once, then whenever they ask.
	 */
	private observationFailed(
		observation: RepositoryObservation,
		error: unknown,
		kind: GitObservationWatchKind,
		recursive: boolean,
	): void {
		if (observation.closed || observation.unavailable) return;
		this.report({
			kind: 'watch.failed',
			repository: this.diagnosticRepositoryId(observation.repositoryId),
			watch: kind,
			recursive,
			error: reportedError(error),
		});
		this.flushChanges(observation);
		observation.unavailable = true;
		observation.schedule.cancel();
		for (const path of [...observation.watches.keys()])
			this.closeWatch(observation, path);
		observation.listing = undefined;
		observation.dirtyAll = true;
		for (const projectId of observation.projects) {
			const binding = this.bindings.get(projectId);
			if (binding !== undefined) this.publishUnattributedChange(binding);
		}
	}

	// ---- Observation reports ----------------------------------------------
	// The host decides where these go; nothing here may change a Git result.

	private report(report: GitObservationReport): void {
		if (this.onObservation === undefined) return;
		try {
			this.onObservation(report);
		} catch {
			/* a failing observer cannot affect observation or measurement */
		}
	}

	private diagnosticRepositoryId(repositoryId: string): string {
		let id = this.diagnosticRepositoryIds.get(repositoryId);
		if (id === undefined) {
			id = `r${this.diagnosticRepositoryIds.size + 1}`;
			this.diagnosticRepositoryIds.set(repositoryId, id);
		}
		return id;
	}

	private diagnosticWorktree(
		worktreeId: string,
		isMain: boolean,
		listIndex: number,
	): GitObservationWorktreeRef {
		let known = this.diagnosticWorktrees.get(worktreeId);
		if (known === undefined) {
			known = {
				id: `w${this.diagnosticWorktrees.size + 1}`,
				role: 'linked',
				listIndex,
			};
			this.diagnosticWorktrees.set(worktreeId, known);
		}
		known.role = isMain ? 'main' : 'linked';
		known.listIndex = listIndex;
		return { ...known };
	}

	private takeChanges(
		observation: RepositoryObservation,
	): GitObservationChangeSummary {
		const taken = observation.changes;
		observation.changes = emptyChanges();
		if (observation.flushTimer !== undefined) {
			clearTimeout(observation.flushTimer);
			observation.flushTimer = undefined;
		}
		return taken;
	}

	/** Hand back the counts a measurement took but did not report. */
	private returnChanges(
		observation: RepositoryObservation,
		returned: ChangeCounters,
	): void {
		const { byClass, byScope } = observation.changes;
		for (const [entryClass, count] of Object.entries(returned.byClass)) {
			const key = entryClass as GitObservationEntryClass;
			byClass[key] = (byClass[key] ?? 0) + count;
		}
		for (const [scope, count] of Object.entries(returned.byScope)) {
			const key = scope as GitObservationScope;
			byScope[key] = (byScope[key] ?? 0) + count;
		}
		observation.changes.cachedListingsServed += returned.cachedListingsServed;
		returned.byClass = {};
		returned.byScope = {};
		returned.cachedListingsServed = 0;
	}

	/** Report what was counted since the last report, when no measurement is
	 *  coming to carry it. Armed only by a counted change or a cached listing,
	 *  fires once, and runs no Git (ADR-0028). */
	private armChangeFlush(observation: RepositoryObservation): void {
		if (this.onObservation === undefined) return;
		if (observation.flushTimer !== undefined || observation.closed) return;
		observation.flushTimer = setTimeout(() => {
			observation.flushTimer = undefined;
			// A measurement that is running re-arms this when it completes, and
			// one that is owed takes these counts with its claim.
			if (
				observation.measuring !== undefined ||
				observation.dirtyAll ||
				observation.dirty.size > 0
			)
				return;
			this.flushChanges(observation);
		}, this.observationFlushMs);
		observation.flushTimer.unref?.();
	}

	private flushChanges(observation: RepositoryObservation): void {
		if (!hasChanges(observation.changes)) {
			this.takeChanges(observation);
			return;
		}
		this.report({
			kind: 'changes',
			repository: this.diagnosticRepositoryId(observation.repositoryId),
			changes: this.takeChanges(observation),
		});
	}

	/** Name what a forced measurement found that the vouched-for cache did not
	 *  have. Skipped when a change arrived meanwhile: that is an ordinary race,
	 *  not a cache the watches wrongly called current. */
	private reportCacheMismatch(
		observation: RepositoryObservation,
		vouched: GitWorktreeListResult,
		measured: GitWorktreeListResult,
	): void {
		if (observation.dirtyAll || observation.dirty.size > 0) return;
		// A listing that could not be measured says nothing about the cache.
		if (measured.state !== 'ready') return;
		const before = new Map(vouched.worktrees.map((entry) => [entry.id, entry]));
		const differing: (GitObservationWorktreeRef & { fields: string[] })[] = [];
		for (const [listIndex, after] of measured.worktrees.entries()) {
			const was = before.get(after.id);
			before.delete(after.id);
			const fields: string[] = [];
			if (was === undefined) fields.push('presence');
			else {
				if (was.head !== after.head) fields.push('head');
				if (was.state !== after.state) fields.push('state');
				if (was.aheadOfDefaultBranchCount !== after.aheadOfDefaultBranchCount)
					fields.push('ahead');
				if (was.lineAdditions !== after.lineAdditions)
					fields.push('lineAdditions');
				if (was.lineDeletions !== after.lineDeletions)
					fields.push('lineDeletions');
				if (
					was.hasUnpushedCommits !== after.hasUnpushedCommits ||
					was.unpushedLineAdditions !== after.unpushedLineAdditions ||
					was.unpushedLineDeletions !== after.unpushedLineDeletions
				)
					fields.push('unpushed');
				if (was.entries.length !== after.entries.length)
					fields.push('changedFiles');
			}
			if (fields.length > 0)
				differing.push({
					...this.diagnosticWorktree(after.id, after.isMain, listIndex),
					fields,
				});
		}
		for (const gone of before.values()) {
			const known = this.diagnosticWorktrees.get(gone.id);
			if (known !== undefined)
				differing.push({ ...known, fields: ['presence'] });
		}
		if (differing.length === 0) return;
		this.report({
			kind: 'cache.mismatch',
			repository: this.diagnosticRepositoryId(observation.repositoryId),
			worktrees: differing.slice(0, MAX_REPORTED_WORKTREES),
		});
	}

	private observationTrusted(observation: RepositoryObservation): boolean {
		return (
			!observation.closed &&
			!observation.unavailable &&
			observation.commonDir !== null
		);
	}

	private observationFor(projectId: string): RepositoryObservation | undefined {
		const repositoryId = this.bindings.get(projectId)?.repositoryId;
		if (repositoryId === null || repositoryId === undefined) return undefined;
		const observation = this.observations.get(repositoryId);
		return observation?.projects.has(projectId) === true
			? observation
			: undefined;
	}

	/** The last measured listing, when the watches say nothing has changed. */
	private cachedListing(
		target: GitTargetRequest,
	): GitWorktreeListResult | undefined {
		const observation = this.observationFor(target.projectId);
		if (
			observation === undefined ||
			!this.observationTrusted(observation) ||
			// A measurement in flight holds changes the cache does not have yet.
			observation.measuring !== undefined ||
			observation.listing === undefined ||
			observation.dirtyAll ||
			observation.dirty.size > 0
		)
			return undefined;
		if (
			target.repositoryId !== undefined &&
			target.repositoryId !== observation.repositoryId
		)
			return undefined;
		if (
			target.worktreeId !== undefined &&
			!observation.layout.worktrees.some(
				(worktree) => worktree.id === target.worktreeId,
			)
		)
			return undefined;
		return { ...observation.listing, projectId: target.projectId };
	}

	private claimDirty(observation: RepositoryObservation): DirtyClaim {
		const claim: DirtyClaim = {
			all: observation.dirtyAll || observation.listing === undefined,
			ids: new Set(observation.dirty),
			trusted: this.observationTrusted(observation),
			stale: observation.dirtyAll,
		};
		observation.dirtyAll = false;
		observation.dirty.clear();
		return claim;
	}

	private restoreDirty(
		observation: RepositoryObservation,
		claim: DirtyClaim,
	): void {
		if (claim.all) observation.dirtyAll = true;
		for (const id of claim.ids) observation.dirty.add(id);
	}

	/** Read each linked worktree's `.git` file for its registry name, so a
	 *  change under `worktrees/<name>/` is attributed without spawning Git. */
	private async observedLayout(
		repositoryId: GitRepositoryId,
		defaultBranch: string | null,
		mainPath: string | undefined,
		records: readonly {
			readonly path: string;
			readonly branch: string | null;
			readonly isBare: boolean;
			readonly isPrunable: boolean;
		}[],
	): Promise<ObservedRepositoryLayout> {
		const worktrees: ObservedWorktree[] = [];
		let mainWorktreeId: GitWorktreeId | null = null;
		for (const record of records) {
			const path = await this.canonicalWorktreePath(record.path);
			const id = worktreeId(repositoryId, path);
			const isMain = mainPath !== undefined && samePath(mainPath, record.path);
			if (isMain) mainWorktreeId = id;
			const hasWorkingTree = !record.isBare && !record.isPrunable;
			let gitDirName: string | null = null;
			if (!isMain && hasWorkingTree) {
				gitDirName = await readFile(resolve(path, '.git'), 'utf8')
					.then(linkedGitDirName)
					.catch(() => null);
			}
			worktrees.push({
				id,
				path,
				branch: record.branch,
				gitDirName,
				hasWorkingTree,
			});
		}
		return { mainWorktreeId, defaultBranch, worktrees };
	}

	private isCurrentGeneration(
		projectId: string,
		generation: number | undefined,
	) {
		return (
			generation !== undefined &&
			this.projectGenerations.get(projectId) === generation
		);
	}

	private publishUnattributedChange(binding: GitProjectBinding): void {
		const prefix = `${binding.projectId}\0`;
		for (const key of [...this.statusFingerprints.keys()])
			if (key.startsWith(prefix)) this.statusFingerprints.delete(key);
		this.record(
			Object.freeze({
				revision: this.nextRevision(),
				cursor: String(this.revisionValue),
				type: 'git.status.changed',
				projectId: binding.projectId,
				repositoryId: binding.repositoryId,
				worktreeId: null,
				state: binding.state,
				branch: null,
				head: null,
				changedFiles: 0,
				bounded: false,
			}),
		);
	}
}

export { GitService as ServerGitService, GitService as GitRepositoryService };

export function createGitService(options: GitServiceOptions = {}): GitService {
	return new GitService(options);
}

function normalizeTarget(
	value: GitTargetRequest | string,
	signal?: AbortSignal,
): GitTargetRequest {
	if (typeof value === 'string') {
		validateProjectId(value);
		return { projectId: value, ...(signal === undefined ? {} : { signal }) };
	}
	validateProjectId(value.projectId);
	return signal === undefined || value.signal !== undefined
		? value
		: { ...value, signal };
}

function validateProjectId(projectId: string): void {
	if (
		typeof projectId !== 'string' ||
		!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(projectId)
	)
		throw new GitServiceError('invalid-project', 'project id is invalid');
}

function validateWorktreeDirectoryName(value: string): string {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.length > 255 ||
		value === '.' ||
		value === '..' ||
		/[/\\\0\r\n]/u.test(value) ||
		value.trim() !== value
	) {
		throw new GitServiceError(
			'mutation-failed',
			'worktree directory name is invalid',
		);
	}
	return value;
}

async function filesystemPathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return false;
		throw new GitServiceError(
			'mutation-failed',
			'worktree destination could not be inspected',
		);
	}
}

function validateRelativePath(value: string, maxBytes: number): void {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.length > maxBytes ||
		value.includes('\0') ||
		isAbsolute(value) ||
		value.split(/[\\/]+/u).some((part) => part === '..')
	)
		throw new GitServiceError(
			'path-escape',
			'Git path must be project-relative',
		);
}

function validateLimits(limits: Required<GitServiceLimits>): void {
	for (const value of Object.values(limits))
		if (!Number.isSafeInteger(value) || value <= 0)
			throw new RangeError('Git service limits must be positive safe integers');
}

function parseNonNegativeInteger(value: string): number | null {
	if (!/^\d+$/u.test(value.trim())) return null;
	const parsed = Number.parseInt(value.trim(), 10);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function validObjectId(result: GitCommandResult): string | null {
	if (result.exitCode !== 0 || result.truncated) return null;
	const value = result.stdout.trim();
	return /^[0-9a-f]{40,64}$/iu.test(value) ? value : null;
}

type GitWorktreeIdentity = Pick<
	GitWorktreeSummary,
	| 'id'
	| 'path'
	| 'branch'
	| 'detached'
	| 'head'
	| 'isMain'
	| 'isBare'
	| 'isPrunable'
	| 'locked'
>;

function assertSweepableWorktree(worktree: GitWorktreeIdentity): void {
	if (worktree.isPrunable)
		throw new GitServiceError(
			'invalid-operation',
			'clean-only removal does not prune a missing worktree',
			{ worktreeId: worktree.id },
		);
}

function assertRemovableWorktree(
	worktree: GitWorktreeIdentity,
	expectedHead: string | null | undefined,
): void {
	if (worktree.isMain)
		throw new GitServiceError(
			'worktree-main',
			'refusing to remove the repository main worktree',
			{ worktreeId: worktree.id },
		);
	if (worktree.isBare)
		throw new GitServiceError(
			'worktree-bare',
			'refusing to remove a bare worktree',
			{ worktreeId: worktree.id },
		);
	if (worktree.isPrunable) {
		if (expectedHead !== undefined && worktree.head !== expectedHead) {
			throw new GitServiceError(
				'stale-revision',
				'worktree HEAD changed since the removal was reviewed',
				{
					worktreeId: worktree.id,
					expectedHead,
					actualHead: worktree.head,
				},
			);
		}
		return;
	}
	if (expectedHead !== undefined && worktree.head !== expectedHead) {
		throw new GitServiceError(
			'stale-revision',
			'worktree HEAD changed since the removal was reviewed',
			{
				worktreeId: worktree.id,
				expectedHead,
				actualHead: worktree.head,
			},
		);
	}
}

function repositoryIdFor(path: string): GitRepositoryId {
	return `repo-${digest(path)}`;
}
function worktreeId(
	repositoryId: GitRepositoryId,
	path: string,
): GitWorktreeId {
	return `worktree-${digest(`${repositoryId}\0${path}`)}`;
}
function digest(value: string): string {
	return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function samePath(first: string, second: string): boolean {
	return resolve(first) === resolve(second);
}
function isWithin(root: string, candidate: string): boolean {
	const rest = relative(resolve(root), resolve(candidate));
	return (
		rest === '' ||
		(rest.length > 0 && !rest.startsWith('..') && !isAbsolute(rest))
	);
}
function headsMatch(
	first: string | null | undefined,
	second: string | null | undefined,
): boolean {
	if (first === second) return true;
	if (
		first === null ||
		first === undefined ||
		second === null ||
		second === undefined
	)
		return false;
	return first.startsWith(second) || second.startsWith(first);
}

function classifyDiscoveryError(
	result: GitCommandResult,
	truncated: boolean,
	gitMetadataPresent = false,
): GitDiscoveryState {
	if (truncated) return 'command-error';
	const text = `${result.stderr}\n${result.stdout}`.toLowerCase();
	if (
		text.includes('git: not found') ||
		text.includes('executable is unavailable')
	)
		return 'git-unavailable';
	if (text.includes('not a git repository')) {
		if (gitMetadataPresent) return 'missing-gitfile';
		const pointsAtGitMetadata = /not a git repository:\s+\S+/u.test(text);
		const reportsMissingMetadata =
			/\.git(?:[\\/]|$)/u.test(text) &&
			/(does not exist|no such file|not a file|cannot open)/u.test(text);
		return pointsAtGitMetadata || reportsMissingMetadata
			? 'missing-gitfile'
			: 'not-repository';
	}
	return 'command-error';
}

function discoveryMessage(state: GitDiscoveryState): string {
	if (state === 'not-repository') return 'Project is not a Git repository.';
	if (state === 'git-unavailable')
		return 'Git executable is unavailable on the server.';
	if (state === 'missing-gitfile')
		return 'Git worktree metadata is missing or unreadable.';
	return 'Git repository discovery failed.';
}

function commandError(
	operation: string,
	result: GitCommandResult,
	message: string,
): GitErrorInfo {
	const stderr = result.stderr.trim();
	return {
		code: result.truncated ? 'output-too-large' : 'command-error',
		message,
		...(stderr.length === 0 ? {} : { stderr: truncateUtf8(stderr, 4 * 1024) }),
		operation,
	};
}

function isAbortError(error: unknown): boolean {
	if (typeof error !== 'object' || error === null) return false;
	const candidate = error as {
		readonly name?: unknown;
		readonly code?: unknown;
	};
	return candidate.name === 'AbortError' || candidate.code === 'ABORT_ERR';
}

function truncateUtf8(value: string, maxBytes: number): string {
	if (new TextEncoder().encode(value).byteLength <= maxBytes) return value;
	const bytes = new TextEncoder().encode(value).slice(0, maxBytes);
	return new TextDecoder().decode(bytes);
}
