import type { ActivityClient, ActivitySnapshot } from '@terminay/client-core';

export function getRunningTerminalSessionIds(
	snapshot: ActivitySnapshot | undefined,
	projectId?: string,
): string[] {
	if (snapshot === undefined) return [];
	return Object.values(snapshot.sessions)
		.filter(
			(session) =>
				session.foregroundBusy &&
				(projectId === undefined || session.projectId === projectId),
		)
		.map((session) => session.sessionId)
		.sort();
}

/** Destructive close decisions use a fresh server snapshot rather than the
 * eventually delivered activity event projection. If the authority cannot be
 * refreshed, fail the close request instead of treating stale absence as proof
 * that no foreground process exists. */
export async function refreshRunningTerminalSessionIds(
	client: ActivityClient | undefined,
	projectId?: string,
): Promise<string[]> {
	if (client === undefined) return [];
	await client.refresh();
	return getRunningTerminalSessionIds(client.store.snapshot, projectId);
}

export async function confirmRunningTerminalClose(
	kind: 'project' | 'terminal',
	runningTerminalCount: number,
): Promise<boolean> {
	if (runningTerminalCount === 0) return true;
	const noun = kind === 'terminal' ? 'this terminal' : 'this project';
	return window.confirm(`A process is still running in ${noun}. Close anyway?`);
}
