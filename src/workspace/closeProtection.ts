import type { ActivitySnapshot } from '@terminay/client-core';

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

export async function confirmRunningTerminalClose(
	kind: 'project' | 'terminal',
	runningTerminalCount: number,
): Promise<boolean> {
	if (runningTerminalCount === 0) return true;
	const noun = kind === 'terminal' ? 'this terminal' : 'this project';
	return window.confirm(`A process is still running in ${noun}. Close anyway?`);
}
