/** What raised a Git pane synchronisation. `root` and `refresh` are the two
 *  the user asked for, so the server measures them rather than answering from
 *  its cached listing. */
export type GitPaneSyncTrigger =
	| 'event'
	| 'resync'
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
