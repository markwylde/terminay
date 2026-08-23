import type { AuthScope, JsonValue } from '@terminay/protocol';
import { scopeAllows } from '../auth.js';
import type { CommandRequest, QueryRequest } from '../types.js';
import { boundGitQueryResult } from './protocolBound.js';
import type { GitQuickPushService } from './quickPush.js';
import { type GitService } from './service.js';
import {
	type GitQuickPushApprovalRequest,
	type GitQuickPushProposalRequest,
	type GitRepositoryId,
	type GitServiceEvent,
	type GitWorktreePullRequest,
	GitServiceError,
	type GitWorktreeId,
} from './types.js';

/** Stable application-protocol operation names for the server Git contract. */
export const GIT_OPERATIONS = Object.freeze({
	status: 'git.status',
	branch: 'git.branch',
	diff: 'git.diff',
	listWorktrees: 'git.worktrees.list',
	openTerminal: 'git.worktree.open-terminal',
	switchProject: 'git.worktree.switch-project',
	renamePresentation: 'git.worktree.rename',
	reveal: 'git.worktree.reveal',
	copy: 'git.worktree.copy',
	pull: 'git.worktree.pull',
	removeWorktree: 'git.worktree.remove',
	moveWorktree: 'git.worktree.move',
	quickPushPropose: 'git.quick-push.propose',
	quickPushApprove: 'git.quick-push.approve',
} as const);

export type GitHostCapability = 'nativeWindows' | 'clipboard';

export interface GitAuthorization {
	readonly serverId: string;
	readonly projectId?: string;
	readonly clientId?: string;
	readonly scope: AuthScope;
}

export interface GitWorktreeRef {
	readonly authorization: GitAuthorization;
	readonly projectId?: string;
	readonly repositoryId: GitRepositoryId;
	readonly worktreeId: GitWorktreeId;
}

export interface GitWorktreeListRequest {
	readonly authorization: GitAuthorization;
	readonly projectId?: string;
	readonly repositoryId?: GitRepositoryId;
}

export interface GitOpenTerminalRequest extends GitWorktreeRef {
	readonly name?: string;
}
export interface GitSwitchProjectRequest extends GitWorktreeRef {
	readonly presentationName?: string;
}
export interface GitRenamePresentationRequest extends GitWorktreeRef {
	readonly name: string;
}
export interface GitRevealRequest extends GitWorktreeRef {
	readonly userGesture?: boolean;
}
export interface GitCopyRequest extends GitWorktreeRef {
	readonly userGesture?: boolean;
}
export interface GitRemoveRequest extends GitWorktreeRef {
	readonly expectedHead?: string | null;
	readonly signal?: AbortSignal;
}
export interface GitPullRequest extends GitWorktreeRef {
	readonly expectedHead?: string | null;
	readonly signal?: AbortSignal;
}
export interface GitMoveRequest extends GitWorktreeRef {
	readonly name: string;
	readonly expectedHead?: string | null;
	readonly signal?: AbortSignal;
}

export interface GitWorktreeActionHandlers {
	readonly openTerminal?: (
		request: GitOpenTerminalRequest,
	) => JsonValue | Promise<JsonValue>;
	readonly switchProject?: (
		request: GitSwitchProjectRequest,
	) => JsonValue | Promise<JsonValue>;
	readonly renamePresentation?: (
		request: GitRenamePresentationRequest,
	) => JsonValue | Promise<JsonValue>;
	/** Native reveal/copy remain host capabilities and never expose paths remotely. */
	readonly reveal?: (
		request: GitRevealRequest,
	) => JsonValue | Promise<JsonValue>;
	readonly copy?: (request: GitCopyRequest) => JsonValue | Promise<JsonValue>;
}

export interface GitProtocolAdapterOptions {
	readonly serverId: string;
	readonly git: GitService;
	readonly quickPush?: GitQuickPushService;
	readonly actions?: GitWorktreeActionHandlers;
	/** Capabilities available on the server host for presentation actions. */
	readonly hostCapabilities?: readonly GitHostCapability[];
	/** Trusted server-side lookup for lazily binding workspace projects to Git. */
	readonly resolveProjectRoot?: (
		projectId: string,
	) => Promise<string | null | undefined> | string | null | undefined;
}

export interface GitOperationHandlers {
	readonly queries: Readonly<
		Record<string, (request: QueryRequest) => JsonValue | Promise<JsonValue>>
	>;
	readonly commands: Readonly<
		Record<string, (request: CommandRequest) => JsonValue | Promise<JsonValue>>
	>;
}

type GitQuickPushAdapterProposalRequest = Omit<
	GitQuickPushProposalRequest,
	'targetBranch'
> & {
	readonly targetBranch?: string;
	readonly authorization: GitAuthorization;
};

/**
 * Protocol/application boundary for Git and worktree operations. The Git
 * service supplies canonical IDs and default-branch facts; host callbacks are
 * intentionally optional for presentation/native capabilities that do not
 * belong in server-core. Every callback receives opaque IDs, never a path.
 */
export class ServerGitAdapter {
	readonly serverId: string;
	private readonly git: GitService;
	private readonly quickPush: GitQuickPushService | undefined;
	private readonly actions: GitWorktreeActionHandlers;
	private readonly hostCapabilities: ReadonlySet<GitHostCapability>;
	private readonly resolveProjectRoot: GitProtocolAdapterOptions['resolveProjectRoot'];
	private readonly proposalProjects = new Map<string, string>();

	constructor(options: GitProtocolAdapterOptions) {
		if (
			typeof options.serverId !== 'string' ||
			!ID_PATTERN.test(options.serverId)
		)
			throw new TypeError('Git server id is invalid');
		this.serverId = options.serverId;
		this.git = options.git;
		this.quickPush = options.quickPush;
		this.actions = options.actions ?? {};
		this.resolveProjectRoot = options.resolveProjectRoot;
		this.hostCapabilities = new Set(options.hostCapabilities ?? inferHostCapabilities(this.actions));
	}

	subscribeEvents(listener: (event: GitServiceEvent) => void): () => void {
		return this.git.subscribe(listener);
	}

	close(): void {
		this.git.close();
	}

	async list(request: GitWorktreeListRequest): Promise<JsonValue> {
		const projectId = this.requireProject(
			request.authorization,
			request.projectId,
		);
		this.requireScope(request.authorization, 'read');
		await this.ensureProjectBound(projectId);
		const result = await this.git.worktrees({
			projectId,
			...(request.repositoryId === undefined
				? {}
				: { repositoryId: request.repositoryId }),
		});
		return boundGitQueryResult(result as unknown as JsonValue);
	}

	async read(request: QueryRequest, operation: 'status' | 'branch' | 'diff'): Promise<JsonValue> {
		const payload = objectPayload(request);
		const authorization = this.authorization(request);
		this.requireScope(authorization, 'read');
		const projectId = this.requireProject(authorization, stringValue(payload.projectId));
		const repositoryId = payload.repositoryId === undefined ? undefined : requiredId(payload.repositoryId, 'repositoryId');
		const worktreeId = payload.worktreeId === undefined ? undefined : requiredId(payload.worktreeId, 'worktreeId');
		const path = payload.path === undefined ? undefined : boundedString(payload.path, 'path', 4096);
		await this.ensureProjectBound(projectId);
		const result = await this.git.readOnly({ operation, projectId, ...(repositoryId === undefined ? {} : { repositoryId }), ...(worktreeId === undefined ? {} : { worktreeId }), ...(path === undefined ? {} : { path }), signal: request.context.signal });
		if (operation === 'diff') return result as unknown as JsonValue;
		return boundGitQueryResult(result as unknown as JsonValue);
	}

	private async ensureProjectBound(projectId: string): Promise<void> {
		const root = await this.resolveProjectRoot?.(projectId);
		if (typeof root !== 'string' || root.length === 0) return;
		const binding = this.git.getBinding(projectId);
		if (binding?.projectRoot === root) return;
		await this.git.bindProject(projectId, root);
	}

	openTerminal(request: GitOpenTerminalRequest): Promise<JsonValue> {
		return this.action('open terminal', this.actions.openTerminal, request, 'nativeWindows');
	}
	switchProject(request: GitSwitchProjectRequest): Promise<JsonValue> {
		return this.action('switch project', this.actions.switchProject, request, 'nativeWindows');
	}
	renamePresentation(
		request: GitRenamePresentationRequest,
	): Promise<JsonValue> {
		if (
			typeof request.name !== 'string' ||
			request.name.trim().length === 0 ||
			request.name.length > 256 ||
			request.name.includes('\0') ||
			request.name.includes('\r') ||
			request.name.includes('\n')
		)
			throw new GitServiceError(
				'invalid-project',
				'worktree presentation name is invalid',
			);
		return this.action(
			'rename worktree',
			this.actions.renamePresentation,
			request,
		);
	}
	reveal(request: GitRevealRequest): Promise<JsonValue> {
		return this.action('reveal worktree', this.actions.reveal, request, 'nativeWindows');
	}
	copy(request: GitCopyRequest): Promise<JsonValue> {
		return this.action('copy worktree', this.actions.copy, request, 'clipboard');
	}

	async pull(request: GitPullRequest): Promise<JsonValue> {
		this.requireScope(request.authorization, 'write');
		const projectId = this.requireProject(request.authorization, request.projectId);
		const result = await this.git.pullWorktree({
			projectId,
			repositoryId: request.repositoryId,
			worktreeId: request.worktreeId,
			...(request.expectedHead === undefined ? {} : { expectedHead: request.expectedHead }),
			...(request.signal === undefined ? {} : { signal: request.signal }),
		} satisfies GitWorktreePullRequest);
		return result as unknown as JsonValue;
	}

	async remove(request: GitRemoveRequest): Promise<JsonValue> {
		this.requireScope(request.authorization, 'write');
		const projectId = this.requireProject(
			request.authorization,
			request.projectId,
		);
		const result = await this.git.removeWorktree({
			projectId,
			repositoryId: request.repositoryId,
			worktreeId: request.worktreeId,
			...(request.expectedHead === undefined
				? {}
				: { expectedHead: request.expectedHead }),
			...(request.signal === undefined ? {} : { signal: request.signal }),
		});
		return result as unknown as JsonValue;
	}

	async move(request: GitMoveRequest): Promise<JsonValue> {
		this.requireScope(request.authorization, 'write');
		const projectId = this.requireProject(request.authorization, request.projectId);
		return await this.git.moveWorktree({
			projectId, repositoryId: request.repositoryId, worktreeId: request.worktreeId,
			name: request.name,
			...(request.expectedHead === undefined ? {} : { expectedHead: request.expectedHead }),
			...(request.signal === undefined ? {} : { signal: request.signal }),
		}) as unknown as JsonValue;
	}

	async proposeQuickPush(
		request: GitQuickPushAdapterProposalRequest,
	): Promise<JsonValue> {
		this.requireScope(request.authorization, 'write');
		const projectId = this.requireProject(
			request.authorization,
			request.projectId,
		);
		let targetBranch = request.targetBranch;
		if (targetBranch === undefined) {
			const listing = await this.git.worktrees({
				projectId,
				repositoryId: request.repositoryId,
				...(request.signal === undefined ? {} : { signal: request.signal }),
			});
			if (listing.defaultBranch === null)
				throw new GitServiceError(
					'invalid-proposal',
					'repository default branch is unavailable',
				);
			targetBranch = listing.defaultBranch;
		}
		if (
			typeof targetBranch !== 'string' ||
			targetBranch.length === 0 ||
			targetBranch.length > 256 ||
			targetBranch.includes('\0') ||
			targetBranch.includes('\r') ||
			targetBranch.includes('\n')
		)
			throw new GitServiceError(
				'invalid-proposal',
				'Quick Push target branch is invalid',
			);
		if (this.quickPush === undefined)
			throw new GitServiceError(
				'invalid-proposal',
				'Quick Push provider is unavailable',
			);
		const proposal = await this.quickPush.propose({
			projectId,
			repositoryId: request.repositoryId,
			worktreeId: request.worktreeId,
			provider: request.provider,
			targetBranch,
			...(request.signal === undefined ? {} : { signal: request.signal }),
		});
		this.proposalProjects.set(proposal.proposalId, projectId);
		while (this.proposalProjects.size > 1024)
			this.proposalProjects.delete(
				this.proposalProjects.keys().next().value as string,
			);
		return proposal as unknown as JsonValue;
	}

	async approveQuickPush(
		request: GitQuickPushApprovalRequest & {
			readonly authorization: GitAuthorization;
		},
	): Promise<JsonValue> {
		this.requireScope(request.authorization, 'write');
		if (this.quickPush === undefined)
			throw new GitServiceError(
				'invalid-proposal',
				'Quick Push provider is unavailable',
			);
		const projectId = this.proposalProjects.get(request.proposalId);
		if (
			projectId === undefined ||
			(request.authorization.projectId !== undefined &&
				request.authorization.projectId !== projectId &&
				request.authorization.scope !== 'admin')
		)
			throw new GitServiceError(
				'repository-mismatch',
				'Quick Push proposal is outside the authorized project',
			);
		const result = await this.quickPush.approve(request);
		return result as unknown as JsonValue;
	}

	operations(): GitOperationHandlers {
		return {
			queries: {
				[GIT_OPERATIONS.status]: (request) => this.read(request, 'status'),
				[GIT_OPERATIONS.branch]: (request) => this.read(request, 'branch'),
				[GIT_OPERATIONS.diff]: (request) => this.read(request, 'diff'),
				[GIT_OPERATIONS.listWorktrees]: (request) =>
					this.list(this.listRequest(request)),
			},
			commands: {
				[GIT_OPERATIONS.openTerminal]: (request) =>
					this.openTerminal(this.refActionRequest(request, 'open')),
				[GIT_OPERATIONS.switchProject]: (request) =>
					this.switchProject(this.refActionRequest(request, 'switch')),
				[GIT_OPERATIONS.renamePresentation]: (request) =>
					this.renamePresentation(this.renameRequest(request)),
				[GIT_OPERATIONS.reveal]: (request) =>
					this.reveal(this.refActionRequest(request, 'reveal')),
				[GIT_OPERATIONS.copy]: (request) =>
					this.copy(this.refActionRequest(request, 'copy')),
				[GIT_OPERATIONS.pull]: (request) => this.pull(this.pullRequest(request)),
				[GIT_OPERATIONS.removeWorktree]: (request) =>
					this.remove(this.removeRequest(request)),
				[GIT_OPERATIONS.moveWorktree]: (request) =>
					this.move(this.moveRequest(request)),
				[GIT_OPERATIONS.quickPushPropose]: (request) =>
					this.commandResult(
						this.proposeQuickPush(this.quickPushProposalRequest(request)),
					),
				[GIT_OPERATIONS.quickPushApprove]: (request) =>
					this.approveQuickPush(this.quickPushApprovalRequest(request)),
			},
		};
	}

	private commandResult(value: JsonValue | Promise<JsonValue>): Promise<{ readonly result: JsonValue }> {
		return Promise.resolve(value).then((result) => ({ result }));
	}

	private action<T extends GitWorktreeRef>(
		label: string,
		handler: ((request: T) => JsonValue | Promise<JsonValue>) | undefined,
		request: T,
		capability?: GitHostCapability,
	): Promise<JsonValue> {
		this.requireScope(request.authorization, 'write');
		this.requireProject(request.authorization, request.projectId);
		if (capability !== undefined && !this.hostCapabilities.has(capability))
			return Promise.reject(new GitServiceError('invalid-operation', `${label} requires unavailable host capability: ${capability}`));
		if (handler === undefined)
			return Promise.reject(
				new GitServiceError(
					'invalid-operation',
					`${label} is unavailable in this server host`,
				),
			);
		return Promise.resolve(handler(request)).then(sanitizeHostResult);
	}

	private requireProject(
		authorization: GitAuthorization,
		requested?: string,
	): string {
		if (authorization.serverId !== this.serverId)
			throw new GitServiceError(
				'repository-mismatch',
				'Git request belongs to another server',
			);
		const projectId = requested ?? authorization.projectId;
		if (projectId === undefined || !ID_PATTERN.test(projectId))
			throw new GitServiceError(
				'invalid-project',
				'Git project identity is required',
			);
		if (
			authorization.projectId !== undefined &&
			authorization.projectId !== projectId &&
			authorization.scope !== 'admin'
		)
			throw new GitServiceError(
				'repository-mismatch',
				'Git project is outside the authorized scope',
			);
		return projectId;
	}

	private requireScope(
		authorization: GitAuthorization,
		required: AuthScope,
	): void {
		if (
			authorization.serverId !== this.serverId ||
			!scopeAllows(authorization.scope, required)
		)
			throw new GitServiceError(
				'repository-mismatch',
				`Git operation requires ${required} scope`,
			);
	}

	private authorization(
		request: QueryRequest | CommandRequest,
	): GitAuthorization {
		const projectId =
			request.context.claims &&
			typeof request.context.claims === 'object' &&
			!Array.isArray(request.context.claims) &&
			typeof request.context.claims.projectId === 'string'
				? request.context.claims.projectId
				: undefined;
		return {
			serverId: this.serverId,
			scope: request.context.authScope,
			...(projectId === undefined ? {} : { projectId }),
			clientId: request.context.clientId,
		};
	}

	private listRequest(request: QueryRequest): GitWorktreeListRequest {
		const payload = objectPayload(request);
		return {
			authorization: this.authorization(request),
			...(stringValue(payload.projectId) === undefined
				? {}
				: { projectId: stringValue(payload.projectId) }),
			...(stringValue(payload.repositoryId) === undefined
				? {}
				: { repositoryId: stringValue(payload.repositoryId) }),
		};
	}

	private refActionRequest(
		request: CommandRequest,
		_operation: 'open' | 'switch' | 'reveal' | 'copy',
	): GitOpenTerminalRequest &
		GitSwitchProjectRequest &
		GitRevealRequest &
		GitCopyRequest {
		const payload = objectPayload(request);
		const authorization = this.authorization(request);
		const projectId = stringValue(payload.projectId) ?? authorization.projectId;
		if (
			payload.userGesture !== undefined &&
			typeof payload.userGesture !== 'boolean'
		)
			throw new GitServiceError('invalid-project', 'userGesture is invalid');
		return {
			authorization,
			projectId: requiredId(projectId, 'projectId'),
			repositoryId: requiredId(payload.repositoryId, 'repositoryId'),
			worktreeId: requiredId(payload.worktreeId, 'worktreeId'),
			...(stringValue(payload.name) === undefined
				? {}
				: { name: stringValue(payload.name) }),
			...(stringValue(payload.presentationName) === undefined
				? {}
				: { presentationName: stringValue(payload.presentationName) }),
			...(payload.userGesture === undefined
				? {}
				: { userGesture: payload.userGesture }),
		} as GitOpenTerminalRequest &
			GitSwitchProjectRequest &
			GitRevealRequest &
			GitCopyRequest;
	}

	private renameRequest(request: CommandRequest): GitRenamePresentationRequest {
		const payload = objectPayload(request);
		return {
			...this.refActionRequest(request, 'switch'),
			name: boundedString(payload.name, 'name', 256),
		};
	}

	private removeRequest(request: CommandRequest): GitRemoveRequest {
		const value = this.refActionRequest(request, 'switch');
		const expectedHead = payloadValue(request, 'expectedHead');
		if (
			expectedHead !== undefined &&
			expectedHead !== null &&
			typeof expectedHead !== 'string'
		)
			throw new GitServiceError('invalid-project', 'expectedHead is invalid');
		return {
			...value,
			expectedHead: expectedHead as string | null | undefined,
			signal: request.context.signal,
		};
	}

	private pullRequest(request: CommandRequest): GitPullRequest {
		const payload = objectPayload(request);
		const authorization = this.authorization(request);
		const projectId = stringValue(payload.projectId) ?? authorization.projectId;
		const expectedHead = payload.expectedHead === undefined ? undefined : payload.expectedHead === null ? null : boundedString(payload.expectedHead, 'expectedHead', 256);
		return {
			authorization,
			projectId: requiredId(projectId, 'projectId'),
			repositoryId: requiredId(payload.repositoryId, 'repositoryId'),
			worktreeId: requiredId(payload.worktreeId, 'worktreeId'),
			...(expectedHead === undefined ? {} : { expectedHead }),
			signal: request.context.signal,
		};
	}

	private moveRequest(request: CommandRequest): GitMoveRequest {
		const payload = objectPayload(request);
		const value = this.refActionRequest(request, 'switch');
		const expectedHead = payload.expectedHead === undefined ? undefined : payload.expectedHead === null ? null : boundedString(payload.expectedHead, 'expectedHead', 256);
		const name = boundedString(payload.name, 'name', 255);
		if (name === '.' || name === '..' || name.trim() !== name || /[/\\]/u.test(name)) throw new GitServiceError('invalid-project', 'worktree directory name is invalid');
		return { ...value, name, ...(expectedHead === undefined ? {} : { expectedHead }), signal: request.context.signal };
	}

	private quickPushProposalRequest(
		request: CommandRequest,
	): GitQuickPushAdapterProposalRequest {
		const payload = objectPayload(request);
		const value = this.refActionRequest(request, 'switch');
		const authorization = this.authorization(request);
		const projectId = this.requireProject(
			authorization,
			stringValue(payload.projectId),
		);
		const provider = boundedString(payload.provider, 'provider', 64);
		const targetBranch =
			payload.targetBranch === undefined
				? undefined
				: boundedString(payload.targetBranch, 'targetBranch', 256);
		return {
			...value,
			projectId,
			authorization,
			provider,
			...(targetBranch === undefined ? {} : { targetBranch }),
			signal: request.context.signal,
		};
	}

	private quickPushApprovalRequest(
		request: CommandRequest,
	): GitQuickPushApprovalRequest & {
		readonly authorization: GitAuthorization;
	} {
		const payload = objectPayload(request);
		const revision = payload.revision;
		if (!isRecord(revision))
			throw new GitServiceError(
				'invalid-proposal',
				'Quick Push revision is required',
			);
		const value = {
			repositoryId: requiredId(revision.repositoryId, 'revision.repositoryId'),
			worktreeId: requiredId(revision.worktreeId, 'revision.worktreeId'),
			head:
				revision.head === null
					? null
					: boundedString(revision.head, 'revision.head', 256),
			branch:
				revision.branch === null
					? null
					: boundedString(revision.branch, 'revision.branch', 256),
			statusDigest: boundedString(
				revision.statusDigest,
				'revision.statusDigest',
				128,
			),
		};
		return {
			authorization: this.authorization(request),
			proposalId: boundedString(payload.proposalId, 'proposalId', 128),
			revision: value,
			actionDigest: boundedString(payload.actionDigest, 'actionDigest', 128),
			signal: request.context.signal,
		};
	}
}

function objectPayload(
	request: QueryRequest | CommandRequest,
): Record<string, unknown> {
	const value = request.envelope.payload;
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new GitServiceError(
			'invalid-project',
			'Git payload must be an object',
		);
	return value as Record<string, unknown>;
}
function payloadValue(
	request: QueryRequest | CommandRequest,
	name: string,
): unknown {
	return objectPayload(request)[name];
}
function stringValue(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}
function requiredId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !ID_PATTERN.test(value))
		throw new GitServiceError('invalid-project', `${name} is invalid`);
	return value;
}
function boundedString(value: unknown, name: string, max: number): string {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.length > max ||
		value.includes('\0') ||
		value.includes('\r') ||
		value.includes('\n')
	)
		throw new GitServiceError('invalid-project', `${name} is invalid`);
	return value;
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inferHostCapabilities(actions: GitWorktreeActionHandlers): readonly GitHostCapability[] {
	const capabilities: GitHostCapability[] = [];
	if (actions.openTerminal !== undefined || actions.switchProject !== undefined || actions.reveal !== undefined) capabilities.push('nativeWindows');
	if (actions.copy !== undefined) capabilities.push('clipboard');
	return capabilities;
}

/** Host callbacks are allowed to report completion metadata, never paths. */
function sanitizeHostResult(value: JsonValue): JsonValue {
	if (!isRecord(value)) return value;
	const result: Record<string, JsonValue> = {};
	for (const [key, item] of Object.entries(value)) {
		if (/^(?:path|worktreePath|repositoryPath|cwd)$/u.test(key)) continue;
		result[key] = item;
	}
	return result;
}
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
