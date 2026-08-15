import type { ActivityClient, ActivityClosePreflight, ActivitySnapshot } from '@terminay/client-core';

export type TerminalCloseKind = 'project' | 'terminal';

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

function limitedClosePreflight(
	scope: {
		readonly projectId: string;
		readonly sessionId?: string;
	},
	snapshot?: ActivitySnapshot,
): ActivityClosePreflight {
	const sessions = snapshot === undefined
		? []
		: getRunningTerminalSessionIds(snapshot, scope.projectId)
			.filter((sessionId) => scope.sessionId === undefined || sessionId === scope.sessionId)
			.map((sessionId) => {
				const session = snapshot.sessions[sessionId];
				return Object.freeze({
					sessionId,
					projectId: session?.projectId ?? scope.projectId,
					observation: 'limited' as const,
					foregroundBusy: true,
				});
			});
	if (sessions.length === 0) {
		const committed = scope.sessionId === undefined
			? undefined
			: snapshot?.sessions[scope.sessionId];
		return Object.freeze({
			observation: 'limited',
			runningSessionIds: Object.freeze(
				committed?.foregroundBusy === true && scope.sessionId !== undefined
					? [scope.sessionId]
					: [],
			),
			sessions: Object.freeze([
				Object.freeze({
					sessionId: scope.sessionId ?? scope.projectId,
					projectId: committed?.projectId ?? scope.projectId,
					observation: 'limited' as const,
					foregroundBusy: committed?.foregroundBusy === true,
				}),
			]),
		});
	}
	return Object.freeze({
		observation: 'limited',
		runningSessionIds: Object.freeze(sessions.map((session) => session.sessionId).sort()),
		sessions: Object.freeze(sessions),
	});
}

/** Destructive close decisions use a bounded exact-session or project
 * preflight. Missing authority is a limited observation, never proof of idle. */
export async function observeTerminalClosePreflight(
	client: ActivityClient | undefined,
	scope: { readonly projectId: string; readonly sessionId?: string },
): Promise<ActivityClosePreflight> {
	if (client === undefined) return limitedClosePreflight(scope);
	try {
		return await client.closePreflight(scope);
	} catch {
		return limitedClosePreflight(scope, client.store?.snapshot);
	}
}

export async function confirmTerminalClose(
	kind: TerminalCloseKind,
	preflight: ActivityClosePreflight,
): Promise<boolean> {
	if (preflight.runningSessionIds.length > 0) {
		return confirmRunningTerminalClose(kind, preflight.runningSessionIds.length);
	}
	if (preflight.observation === 'limited') {
		return confirmLimitedTerminalClose(kind);
	}
	return true;
}

export async function confirmRunningTerminalClose(
	kind: TerminalCloseKind,
	runningTerminalCount: number,
): Promise<boolean> {
	if (runningTerminalCount === 0) return true;
	const noun = kind === 'terminal' ? 'this terminal' : 'this project';
	return window.confirm(`A process is still running in ${noun}. Close anyway?`);
}

export async function confirmLimitedTerminalClose(
	kind: TerminalCloseKind,
): Promise<boolean> {
	const noun = kind === 'terminal' ? 'this terminal' : 'this project';
	return window.confirm(
		`Terminay could not confirm whether a process is still running in ${noun}. Close anyway?`,
	);
}
