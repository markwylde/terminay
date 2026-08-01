/** Test-only protocol retained for the isolated, unreferenced legacy
 * RemoteAccessService harness. Production browser enrollment no longer imports
 * or speaks these terminal-session messages. */
export type RemoteSessionSummary = {
	color: string; cols: number; emoji: string; exitCode: number | null; id: string;
	rows: number; title: string; viewportHeight?: number; viewportWidth?: number;
	projectId?: string; projectTitle?: string; projectEmoji?: string; projectColor?: string;
};
export type RemoteSessionSnapshot = RemoteSessionSummary & { buffer: string };
export type RemoteClientMessage =
	| { connectionId: string; seq: number; type: 'list-sessions' | 'ping' }
	| { connectionId: string; seq: number; sessionId: string; type: 'attach-session' | 'detach-session' }
	| { connectionId: string; payload: string; seq: number; sessionId: string; type: 'write' }
	| { cols: number; connectionId: string; rows: number; seq: number; sessionId: string; type: 'resize' };
export type RemoteServerMessage =
	| { connectionCount: number; connectionId: string; sessions: RemoteSessionSummary[]; type: 'session-list' }
	| { session: RemoteSessionSnapshot; type: 'session-opened' }
	| { id: string; type: 'session-closed' }
	| { session: RemoteSessionSummary; type: 'session-updated' }
	| { payload: string; sessionId: string; type: 'output' }
	| { exitCode: number; sessionId: string; signal?: number | null; type: 'exit' }
	| { message: string; type: 'error' }
	| { seq: number; type: 'pong' };

export function parseRemoteClientMessage(raw: string): RemoteClientMessage | null {
	let value: unknown;
	try { value = JSON.parse(raw); } catch { return null; }
	if (!record(value) || typeof value.connectionId !== 'string' || !Number.isFinite(value.seq)) return null;
	const common = { connectionId: value.connectionId, seq: value.seq as number };
	if (value.type === 'list-sessions' || value.type === 'ping') return { ...common, type: value.type };
	if ((value.type === 'attach-session' || value.type === 'detach-session') && typeof value.sessionId === 'string') {
		return { ...common, sessionId: value.sessionId, type: value.type };
	}
	if (value.type === 'write' && typeof value.sessionId === 'string' && typeof value.payload === 'string') {
		return { ...common, payload: value.payload, sessionId: value.sessionId, type: 'write' };
	}
	if (value.type === 'resize' && typeof value.sessionId === 'string' && Number.isFinite(value.cols) && Number.isFinite(value.rows)) {
		return { ...common, cols: value.cols as number, rows: value.rows as number, sessionId: value.sessionId, type: 'resize' };
	}
	return null;
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
