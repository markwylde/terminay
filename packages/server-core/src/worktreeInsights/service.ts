import { createHash } from 'node:crypto';
import {
	type RepositoryContext,
	validateWorktreeProperties,
	validateWorktreeSignInRequest,
	type WorktreeProperties,
	type WorktreeSignInRequest,
} from '@terminay/extension-api';
import type { WorktreeInsightSourceProvider } from '../extensions/manager.js';
import type { ExtensionWorktreeBroker } from '../extensions/types.js';
import type { GitWorktreeListResult } from '../gitService/types.js';
import {
	readRepositoryGitConfig,
	type RepositoryGitConfig,
} from './gitConfig.js';

/** The slice of the extension host manager this service drives. */
export interface WorktreeInsightHosts {
	worktreeInsightContributions(): readonly WorktreeInsightSourceProvider[];
	onContributionsChanged(listener: () => void | Promise<void>): () => void;
	startWorktreeInsightSource(
		sourceId: string,
		contexts: readonly unknown[],
	): Promise<void>;
	stopWorktreeInsightSource(sourceId: string): Promise<void>;
	setWorktreeInsightContexts(
		sourceId: string,
		contexts: readonly unknown[],
	): Promise<void>;
	notifyWorktreeCredential(sourceId: string, origin: string): Promise<void>;
}

/** Where sign-in tokens live: the server vault, never extension storage. */
export interface WorktreeCredentialVault {
	has(id: string): boolean;
	put(id: string, label: string, value: Uint8Array): Promise<void>;
	read(id: string): Promise<string | undefined>;
	remove(id: string): Promise<void>;
}

/** Extensions whose sign-in prompts the user switched off. */
export interface WorktreePromptPreferences {
	load(): Promise<readonly string[]>;
	save(extensionIds: readonly string[]): Promise<void>;
}

export interface WorktreeSignInPrompt {
	readonly extensionId: string;
	readonly origin: string;
	readonly provider: string;
	readonly tokenPageUrl?: string;
}

export type WorktreeSignInChoice = 'accept' | 'later' | 'never';

export interface WorktreeInsightServiceOptions {
	readonly vault?: WorktreeCredentialVault;
	readonly preferences?: WorktreePromptPreferences;
	/** A worktree's properties, or a project's prompt, changed. */
	readonly onProjectChanged?: (
		projectId: string,
		worktreeId: string | null,
	) => void;
	readonly readGitConfig?: (
		repositoryRoot: string,
	) => Promise<RepositoryGitConfig>;
	readonly onError?: (message: string) => void;
	/** Whether a project is still open; closed projects' contexts are cancelled. */
	readonly isProjectOpen?: (projectId: string) => boolean;
	/** Projects a client has active; their contexts are marked `active`. */
	readonly activeProjectIds?: () => ReadonlySet<string>;
}

interface ProjectContext {
	readonly projectId: string;
	readonly context: RepositoryContext;
	readonly fingerprint: string;
	/** Lower-case hostnames of the context's remotes. */
	readonly hosts: ReadonlySet<string>;
}

interface PendingPrompt extends WorktreeSignInPrompt {
	readonly sourceId: string;
}

/**
 * Issues repository contexts to worktree insight sources, keeps what they
 * publish, and owns the sign-in prompt and its credentials.
 *
 * Every value from an extension is validated here, and accepted only for a
 * context this service issued and a worktree in it. Properties are stored per
 * project, so they reach only clients of that project.
 */
export class WorktreeInsightService implements ExtensionWorktreeBroker {
	private hosts: WorktreeInsightHosts | undefined;
	private readonly contexts = new Map<string, ProjectContext>();
	private readonly contextProjects = new Map<string, string>();
	/** projectId → worktreeId → sourceId → properties. */
	private readonly properties = new Map<
		string,
		Map<string, Map<string, WorktreeProperties>>
	>();
	private readonly running = new Set<string>();
	private readonly pending = new Map<string, PendingPrompt>();
	/** Origins the user answered "No, maybe later" for; cleared on restart. */
	private readonly later = new Set<string>();
	private suppressed = new Set<string>();
	private preferencesLoaded: Promise<void> | undefined;
	private reconciling: Promise<void> = Promise.resolve();
	private pushScheduled = false;
	private readonly unsubscribe: Array<() => void> = [];
	private disposed = false;

	constructor(private readonly options: WorktreeInsightServiceOptions = {}) {}

	/** Bind the host manager once the extension composition exists. */
	attach(hosts: WorktreeInsightHosts): void {
		this.hosts = hosts;
		this.unsubscribe.push(hosts.onContributionsChanged(() => this.reconcile()));
		void this.reconcile();
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		for (const stop of this.unsubscribe.splice(0)) stop();
		await this.reconcile();
	}

	/**
	 * Called with each Git worktree listing. A project's context is issued on
	 * its first listing and re-issued when its worktrees, branches, upstreams,
	 * heads, or remotes change.
	 */
	async observeListing(listing: GitWorktreeListResult): Promise<void> {
		const isOpen = this.options.isProjectOpen;
		if (isOpen !== undefined)
			for (const projectId of [...this.contexts.keys()])
				if (!isOpen(projectId)) this.closeProject(projectId);
		if (
			this.disposed ||
			listing.state !== 'ready' ||
			listing.repositoryRoot === null ||
			listing.repositoryId === null
		) {
			if (listing.state !== 'ready') this.closeProject(listing.projectId);
			return;
		}
		const config = await (
			this.options.readGitConfig ?? readRepositoryGitConfig
		)(listing.repositoryRoot);
		const contextId = opaqueId('ctx', listing.projectId, listing.repositoryId);
		const context: RepositoryContext = {
			id: contextId,
			active: this.isActive(listing.projectId),
			repositoryRoot: listing.repositoryRoot,
			remotes: config.remotes.map((remote) => ({ ...remote })),
			worktrees: listing.worktrees
				.filter((worktree) => !worktree.isBare)
				.map((worktree) => {
					const upstream =
						worktree.branch === null
							? undefined
							: config.upstreams.get(worktree.branch);
					return {
						id: worktree.id,
						path: worktree.path,
						branch: worktree.branch,
						upstream: upstream === undefined ? null : { ...upstream },
						head: worktree.head,
					};
				}),
		};
		const fingerprint = JSON.stringify(context);
		const previous = this.contexts.get(listing.projectId);
		if (previous?.fingerprint === fingerprint) return;
		this.contexts.set(listing.projectId, {
			projectId: listing.projectId,
			context,
			fingerprint,
			hosts: remoteHosts(context.remotes),
		});
		this.contextProjects.set(contextId, listing.projectId);
		if (previous !== undefined && previous.context.id !== contextId)
			this.contextProjects.delete(previous.context.id);
		this.dropDepartedWorktrees(listing.projectId, context);
		this.schedulePush();
	}

	/**
	 * Re-mark contexts after the set of active projects changed. A project
	 * that becomes active is re-issued, which its sources treat as focus.
	 */
	refreshActivity(): void {
		let changed = false;
		for (const [projectId, project] of this.contexts) {
			const active = this.isActive(projectId);
			if (project.context.active === active) continue;
			const context = { ...project.context, active };
			this.contexts.set(projectId, {
				...project,
				context,
				fingerprint: JSON.stringify(context),
			});
			changed = true;
		}
		if (changed) this.schedulePush();
	}

	private isActive(projectId: string): boolean {
		return this.options.activeProjectIds?.().has(projectId) ?? false;
	}

	/** Cancel a project's context and drop everything published for it. */
	closeProject(projectId: string): void {
		const previous = this.contexts.get(projectId);
		if (previous === undefined) return;
		this.contexts.delete(projectId);
		this.contextProjects.delete(previous.context.id);
		if (this.properties.delete(projectId))
			this.options.onProjectChanged?.(projectId, null);
		this.schedulePush();
	}

	/** Keep only the listed projects' contexts. */
	retainProjects(projectIds: Iterable<string>): void {
		const keep = new Set(projectIds);
		for (const projectId of [...this.contexts.keys()])
			if (!keep.has(projectId)) this.closeProject(projectId);
	}

	/** Properties for each worktree of one project, merged across sources. */
	propertiesFor(projectId: string): ReadonlyMap<string, WorktreeProperties> {
		const result = new Map<string, WorktreeProperties>();
		for (const [worktreeId, bySource] of this.properties.get(projectId) ?? []) {
			const merged: WorktreeProperties = {};
			for (const sourceId of [...bySource.keys()].sort()) {
				const value = bySource.get(sourceId) as WorktreeProperties;
				if (merged.pullRequest === undefined && value.pullRequest !== undefined)
					merged.pullRequest = value.pullRequest;
				if (merged.checks === undefined && value.checks !== undefined)
					merged.checks = value.checks;
			}
			if (merged.pullRequest !== undefined || merged.checks !== undefined)
				result.set(worktreeId, merged);
		}
		return result;
	}

	/** The sign-in prompt, if any, the project's clients should show. */
	signInFor(projectId: string): WorktreeSignInPrompt | undefined {
		const project = this.contexts.get(projectId);
		if (project === undefined) return undefined;
		for (const prompt of this.pending.values())
			if (project.hosts.has(new URL(prompt.origin).hostname.toLowerCase()))
				return publicPrompt(prompt);
		return undefined;
	}

	/** The user's answer to a sign-in prompt shown for a project. */
	async respond(
		projectId: string,
		origin: string,
		choice: WorktreeSignInChoice,
		token?: string,
	): Promise<void> {
		const prompt = this.pending.get(origin);
		if (prompt === undefined || this.signInFor(projectId)?.origin !== origin)
			throw new Error('there is no sign-in prompt for this origin');
		if (choice === 'accept') {
			const value = token?.trim() ?? '';
			if (value.length === 0 || value.length > 4_096 || /\s/.test(value))
				throw new Error('the token is invalid');
			const vault = this.options.vault;
			if (vault === undefined)
				throw new Error('the server vault is unavailable');
			await vault.put(
				credentialId(prompt.extensionId, origin),
				`${prompt.provider} token for ${new URL(origin).host}`,
				new TextEncoder().encode(value),
			);
			this.pending.delete(origin);
			this.notifyPromptChanged(origin, prompt);
			await this.hosts
				?.notifyWorktreeCredential(prompt.sourceId, origin)
				.catch(() => undefined);
			return;
		}
		if (choice === 'later') {
			this.later.add(origin);
			this.pending.delete(origin);
			this.notifyPromptChanged(origin, prompt);
			return;
		}
		await this.setPromptsSuppressed(prompt.extensionId, true);
	}

	/** Extensions whose sign-in prompts are switched off. */
	async suppressedExtensions(): Promise<readonly string[]> {
		await this.loadPreferences();
		return [...this.suppressed].sort();
	}

	async setPromptsSuppressed(
		extensionId: string,
		suppressed: boolean,
	): Promise<void> {
		await this.loadPreferences();
		if (suppressed === this.suppressed.has(extensionId)) return;
		if (suppressed) this.suppressed.add(extensionId);
		else this.suppressed.delete(extensionId);
		await this.options.preferences?.save([...this.suppressed].sort());
		if (!suppressed) return;
		for (const [origin, prompt] of [...this.pending])
			if (prompt.extensionId === extensionId) {
				this.pending.delete(origin);
				this.notifyPromptChanged(origin, prompt);
			}
	}

	// ExtensionWorktreeBroker

	publish: ExtensionWorktreeBroker['publish'] = (request) => {
		if (typeof request.contextId !== 'string') return;
		const projectId = this.contextProjects.get(request.contextId);
		const project =
			projectId === undefined ? undefined : this.contexts.get(projectId);
		if (projectId === undefined || project === undefined) return;
		if (
			typeof request.worktreeId !== 'string' ||
			!project.context.worktrees.some(
				(worktree) => worktree.id === request.worktreeId,
			)
		)
			return;
		const worktreeId = request.worktreeId;
		let value: WorktreeProperties | undefined;
		if (request.properties !== null && request.properties !== undefined) {
			const validated = validateWorktreeProperties(request.properties);
			if (!validated.ok) {
				this.options.onError?.(
					`worktree insight ${request.sourceId}: ${validated.reason}`,
				);
				return;
			}
			value = validated.value;
		}
		const byWorktree =
			this.properties.get(projectId) ??
			new Map<string, Map<string, WorktreeProperties>>();
		const bySource =
			byWorktree.get(worktreeId) ?? new Map<string, WorktreeProperties>();
		const before = JSON.stringify(bySource.get(request.sourceId) ?? null);
		if (value === undefined) bySource.delete(request.sourceId);
		else bySource.set(request.sourceId, value);
		if (before === JSON.stringify(value ?? null)) return;
		if (bySource.size === 0) byWorktree.delete(worktreeId);
		else byWorktree.set(worktreeId, bySource);
		if (byWorktree.size === 0) this.properties.delete(projectId);
		else this.properties.set(projectId, byWorktree);
		this.options.onProjectChanged?.(projectId, worktreeId);
	};

	requestSignIn: ExtensionWorktreeBroker['requestSignIn'] = (request) => {
		const validated = validateWorktreeSignInRequest(request.request);
		if (!validated.ok) {
			this.options.onError?.(
				`worktree insight ${request.sourceId}: ${validated.reason}`,
			);
			return;
		}
		void this.admitPrompt(
			request.extensionId,
			request.sourceId,
			validated.value,
		);
	};

	token: ExtensionWorktreeBroker['token'] = async (request) => {
		if (typeof request.origin !== 'string') return undefined;
		const vault = this.options.vault;
		const id = credentialId(request.extensionId, request.origin);
		if (vault === undefined || !vault.has(id)) return undefined;
		return vault.read(id).catch(() => undefined);
	};

	rejectToken: ExtensionWorktreeBroker['rejectToken'] = async (request) => {
		if (typeof request.origin !== 'string') return;
		const vault = this.options.vault;
		const id = credentialId(request.extensionId, request.origin);
		if (vault?.has(id) === true) await vault.remove(id);
	};

	sourceStopped: NonNullable<ExtensionWorktreeBroker['sourceStopped']> = (
		request,
	) => {
		this.running.delete(request.sourceId);
		for (const [projectId, byWorktree] of this.properties)
			for (const [worktreeId, bySource] of byWorktree)
				if (bySource.delete(request.sourceId)) {
					if (bySource.size === 0) byWorktree.delete(worktreeId);
					this.options.onProjectChanged?.(projectId, worktreeId);
				}
		for (const [projectId, byWorktree] of [...this.properties])
			if (byWorktree.size === 0) this.properties.delete(projectId);
		for (const [origin, prompt] of [...this.pending])
			if (prompt.sourceId === request.sourceId) {
				this.pending.delete(origin);
				this.notifyPromptChanged(origin, prompt);
			}
	};

	/** Start what should run, stop what should not, then re-send contexts. */
	reconcile(): Promise<void> {
		this.reconciling = this.reconciling
			.catch(() => undefined)
			.then(() => this.reconcileNow());
		return this.reconciling;
	}

	private async reconcileNow(): Promise<void> {
		const hosts = this.hosts;
		const wanted =
			this.disposed || hosts === undefined
				? []
				: hosts.worktreeInsightContributions();
		const wantedIds = new Set(
			wanted.map((provider) => provider.contribution.id),
		);
		for (const sourceId of [...this.running]) {
			if (wantedIds.has(sourceId)) continue;
			this.running.delete(sourceId);
			await hosts?.stopWorktreeInsightSource(sourceId).catch(() => undefined);
		}
		const contexts = this.liveContexts();
		for (const sourceId of wantedIds) {
			if (this.running.has(sourceId) || hosts === undefined) continue;
			try {
				await hosts.startWorktreeInsightSource(sourceId, contexts);
				this.running.add(sourceId);
			} catch (error) {
				this.options.onError?.(
					`worktree insight ${sourceId} failed to start: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	}

	private schedulePush(): void {
		if (this.pushScheduled) return;
		this.pushScheduled = true;
		queueMicrotask(() => {
			this.pushScheduled = false;
			this.reconciling = this.reconciling
				.catch(() => undefined)
				.then(async () => {
					const contexts = this.liveContexts();
					for (const sourceId of this.running)
						await this.hosts
							?.setWorktreeInsightContexts(sourceId, contexts)
							.catch(() => undefined);
				});
		});
	}

	private liveContexts(): RepositoryContext[] {
		return [...this.contexts.values()].map((project) => project.context);
	}

	private dropDepartedWorktrees(
		projectId: string,
		context: RepositoryContext,
	): void {
		const byWorktree = this.properties.get(projectId);
		if (byWorktree === undefined) return;
		const live = new Set(context.worktrees.map((worktree) => worktree.id));
		for (const worktreeId of [...byWorktree.keys()])
			if (!live.has(worktreeId)) {
				byWorktree.delete(worktreeId);
				this.options.onProjectChanged?.(projectId, worktreeId);
			}
		if (byWorktree.size === 0) this.properties.delete(projectId);
	}

	private async admitPrompt(
		extensionId: string,
		sourceId: string,
		request: WorktreeSignInRequest,
	): Promise<void> {
		await this.loadPreferences();
		if (
			this.disposed ||
			this.suppressed.has(extensionId) ||
			this.later.has(request.origin) ||
			this.pending.has(request.origin) ||
			this.options.vault?.has(credentialId(extensionId, request.origin)) ===
				true
		)
			return;
		const prompt: PendingPrompt = {
			extensionId,
			sourceId,
			origin: request.origin,
			provider: request.provider,
			...(request.tokenPageUrl === undefined
				? {}
				: { tokenPageUrl: request.tokenPageUrl }),
		};
		this.pending.set(request.origin, prompt);
		this.notifyPromptChanged(request.origin, prompt);
	}

	private notifyPromptChanged(origin: string, _prompt: PendingPrompt): void {
		const host = new URL(origin).hostname.toLowerCase();
		for (const project of this.contexts.values())
			if (project.hosts.has(host))
				this.options.onProjectChanged?.(project.projectId, null);
	}

	private loadPreferences(): Promise<void> {
		this.preferencesLoaded ??= (async () => {
			const stored = await this.options.preferences?.load().catch(() => []);
			for (const extensionId of stored ?? []) this.suppressed.add(extensionId);
		})();
		return this.preferencesLoaded;
	}
}

/** The vault id for one extension's token for one origin. */
export function credentialId(extensionId: string, origin: string): string {
	return opaqueId('worktree-token', extensionId, origin);
}

function opaqueId(prefix: string, ...parts: string[]): string {
	const digest = createHash('sha256').update(parts.join('\0')).digest('hex');
	return `${prefix}.${digest.slice(0, 32)}`;
}

function publicPrompt(prompt: PendingPrompt): WorktreeSignInPrompt {
	return Object.freeze({
		extensionId: prompt.extensionId,
		origin: prompt.origin,
		provider: prompt.provider,
		...(prompt.tokenPageUrl === undefined
			? {}
			: { tokenPageUrl: prompt.tokenPageUrl }),
	});
}

/** Hostnames of HTTPS, ssh://, and scp-style remote URLs. */
export function remoteHosts(
	remotes: readonly { readonly url: string }[],
): ReadonlySet<string> {
	const hosts = new Set<string>();
	for (const { url } of remotes) {
		const host = remoteHost(url);
		if (host !== undefined) hosts.add(host);
	}
	return hosts;
}

function remoteHost(url: string): string | undefined {
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
		try {
			return new URL(url).hostname.toLowerCase() || undefined;
		} catch {
			return undefined;
		}
	}
	const scp = /^(?:[^@/]+@)?([^:/]+):/.exec(url);
	return scp === null ? undefined : (scp[1] as string).toLowerCase();
}
