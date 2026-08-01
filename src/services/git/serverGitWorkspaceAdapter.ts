import type {
	GitWorktreeReference,
	TerminayGitClient,
} from '@terminay/client-core';
import type { JsonValue } from '@terminay/protocol';
import type {
	FileExplorerGitStatus,
	GitChangeEntry,
	GitFileState,
	GitWorktreeStatus,
	WorktreePanelStatus,
} from '../../types/terminay';

export type ServerGitWorkspaceProjection = {
	referencesByPath: ReadonlyMap<string, GitWorktreeReference>;
	statuses: Record<string, FileExplorerGitStatus>;
	worktrees: WorktreePanelStatus;
};

export async function loadServerGitWorkspace(
	client: TerminayGitClient,
	projectId: string,
): Promise<ServerGitWorkspaceProjection> {
	const result = record(await client.list({ projectId }), 'Git worktree list');
	const repositoryRoot =
		result.repositoryRoot === null
			? null
			: text(result.repositoryRoot, 'repository root');
	const state = text(result.state, 'Git discovery state');
	const rawWorktrees = array(result.worktrees, 'Git worktrees');
	const referencesByPath = new Map<string, GitWorktreeReference>();
	const statuses: Record<string, FileExplorerGitStatus> = {};
	const worktrees = rawWorktrees.map((value) => {
		const worktree = record(value, 'Git worktree');
		const path = text(worktree.path, 'worktree path');
		const id = text(worktree.id, 'worktree id');
		const itemRepositoryId = text(
			worktree.repositoryId,
			'worktree repository id',
		);
		referencesByPath.set(path, {
			projectId,
			repositoryId: itemRepositoryId,
			worktreeId: id,
		});
		const entries = array(worktree.entries, 'Git status entries').map((entry) =>
			toChangeEntry(record(entry, 'Git status entry'), path),
		);
		for (const entry of entries) {
			statuses[entry.path] = entry.state === 'untracked' ? 'new' : 'modified';
		}
		return toWorktree(worktree, path, entries, repositoryRoot);
	}).sort(currentWorktreeFirst);
	return {
		referencesByPath,
		statuses,
		worktrees: {
			gitAvailable: state !== 'git-unavailable',
			repoRoot: repositoryRoot,
			defaultBranch:
				result.defaultBranch === null
					? null
					: text(result.defaultBranch, 'default branch'),
			worktrees,
		},
	};
}

function currentWorktreeFirst(
	left: GitWorktreeStatus,
	right: GitWorktreeStatus,
): number {
	if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1;
	if (left.isMain !== right.isMain) return left.isMain ? 1 : -1;
	return left.name.localeCompare(right.name);
}

function toWorktree(
	value: Record<string, JsonValue>,
	path: string,
	entries: GitChangeEntry[],
	repositoryRoot: string | null,
): GitWorktreeStatus {
	const branch = value.branch === null ? null : text(value.branch, 'branch');
	const detached = boolean(value.detached, 'detached state');
	const state = text(value.state, 'worktree state');
	const error =
		value.error === undefined
			? undefined
			: record(value.error, 'worktree error');
	return {
		path,
		name:
			path
				.replace(/[\\/]+$/u, '')
				.split(/[\\/]/u)
				.pop() ?? path,
		branch,
		head: value.head === null ? null : text(value.head, 'head'),
		aheadOfMainCount: null,
		lineAdditions: null,
		lineDeletions: null,
		lastChangedAt: null,
		isDirtyBranch: state === 'dirty' || state === 'unmerged',
		isCurrent: path === repositoryRoot,
		isMain: boolean(value.isMain, 'main worktree state'),
		isBare: boolean(value.isBare, 'bare worktree state'),
		isDetached: detached,
		isLocked: boolean(value.locked, 'locked worktree state'),
		isPrunable: boolean(value.isPrunable, 'prunable worktree state'),
		...(error === undefined
			? {}
			: { errorMessage: text(error.message, 'worktree error message') }),
		entries,
	};
}

function toChangeEntry(
	value: Record<string, JsonValue>,
	worktreeRoot: string,
): GitChangeEntry {
	const relativePath = text(value.path, 'Git status path');
	const previousPath =
		value.previousPath === null
			? null
			: text(value.previousPath, 'previous Git status path');
	const kind = text(value.kind, 'Git change kind');
	const state = toFileState(kind);
	return {
		path: joinPath(worktreeRoot, relativePath),
		relativePath,
		state,
		staged: boolean(value.staged, 'Git staged state'),
		...(previousPath === null
			? {}
			: {
					originalPath: joinPath(worktreeRoot, previousPath),
					originalRelativePath: previousPath,
				}),
	};
}

function toFileState(kind: string): GitFileState {
	if (kind === 'unmerged') return 'conflicted';
	if (
		kind === 'added' ||
		kind === 'modified' ||
		kind === 'deleted' ||
		kind === 'renamed' ||
		kind === 'copied' ||
		kind === 'untracked'
	) {
		return kind;
	}
	return 'modified';
}

function joinPath(root: string, relativePath: string): string {
	return `${root.replace(/[\\/]+$/u, '')}/${relativePath.replace(/^[\\/]+/u, '')}`;
}

function record(value: JsonValue, label: string): Record<string, JsonValue> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new TypeError(`${label} is invalid.`);
	}
	return value;
}

function array(value: JsonValue | undefined, label: string): JsonValue[] {
	if (!Array.isArray(value)) throw new TypeError(`${label} is invalid.`);
	return value;
}

function text(value: JsonValue | undefined, label: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new TypeError(`${label} is invalid.`);
	}
	return value;
}

function boolean(value: JsonValue | undefined, label: string): boolean {
	if (typeof value !== 'boolean') throw new TypeError(`${label} is invalid.`);
	return value;
}
