const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f-]{27}$/iu;

/**
 * Claude's provider-owned project directory encoding for a canonical cwd:
 * every character outside `[A-Za-z0-9]` becomes `-`. Verified against the
 * real CLI, which wrote `/private/var/folders/gw/n_lr8lp.../T/x` as
 * `-private-var-folders-gw-n-lr8lp...-T-x`.
 */
export function claudeProjectDirectoryPath(cwd: string): string | undefined {
	if (!cwd.startsWith('/')) return undefined;
	const directory = cwd.replace(/[^A-Za-z0-9]/gu, '-');
	return directory ? `.claude/projects/${directory}` : undefined;
}

/** Claude's provider-owned project directory encoding for a canonical cwd. */
export function claudeProjectJournalPath(
	cwd: string,
	sessionId: string,
): string | undefined {
	const directory = claudeProjectDirectoryPath(cwd);
	return directory && SESSION_ID.test(sessionId)
		? `${directory}/${sessionId}.jsonl`
		: undefined;
}
