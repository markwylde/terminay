/** What raised a Git pane synchronisation. `root` (the project root changed)
 *  and `refresh` (the user asked) are measured by the server rather than
 *  answered from its watched cache. `mount` (a folder workspace loading the
 *  root it already had, on connect, first show, or remount) is not: the
 *  server's watches keep that cache current (ADR-0141). */
export type GitPaneSyncTrigger =
	| 'event'
	| 'resync'
	| 'mount'
	| 'root'
	| 'refresh'
	| 'directory'
	| 'action';

export type GitPaneSyncOutcome =
	| 'applied'
	| 'unchanged'
	| 'superseded'
	| 'failed';

export interface GitPaneSyncRecord {
	readonly trigger: GitPaneSyncTrigger;
	readonly scoped: boolean;
	readonly outcome: GitPaneSyncOutcome;
	readonly worktrees: number | null;
	readonly durationMs: number;
}

export interface GitPaneSyncLog {
	record(entry: GitPaneSyncRecord): void;
}

export function isFreshGitPaneSync(trigger: GitPaneSyncTrigger): boolean {
	return trigger === 'root' || trigger === 'refresh';
}

/**
 * What loading `root` in a mounted folder workspace is. It is a root change
 * only when this workspace already loaded a different root; the first load,
 * a reload of the same root, and a root that comes back after being empty
 * are mounts. `previousLoadedRoot` is the last non-empty root it loaded.
 */
export function rootLoadTrigger(
	previousLoadedRoot: string | undefined,
	root: string,
): 'mount' | 'root' {
	return previousLoadedRoot !== undefined &&
		previousLoadedRoot.length > 0 &&
		root.length > 0 &&
		previousLoadedRoot !== root
		? 'root'
		: 'mount';
}

/**
 * Evidence of what the Git pane did with each synchronisation, as one console
 * line that Desktop main already observes: the renderer has no diagnostics
 * channel and gets none. A synchronisation that changed nothing is counted
 * onto the next line rather than written, so an idle pane is silent. The line
 * carries no project id, path, branch name, or worktree id.
 */
export function createGitPaneSyncLog(
	write: (line: string) => void = (line) => console.info(line),
): GitPaneSyncLog {
	let unchangedSince = 0;
	return {
		record(entry) {
			if (entry.outcome === 'unchanged') {
				unchangedSince += 1;
				return;
			}
			write(
				`[terminay] git.pane.sync ${JSON.stringify({ ...entry, unchangedSince })}`,
			);
			unchangedSince = 0;
		},
	};
}
