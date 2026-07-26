import type { IpcMain } from 'electron';
import type { AgentStatusSnapshot } from '../../src/types/agentStatus';
import type { AgentStatusService } from './service';

export const AGENT_STATUS_SNAPSHOT_CHANNEL = 'agent-status:snapshot';

export interface RegisterAgentStatusIpcOptions {
	ipcMain: IpcMain;
	publishSnapshot: (snapshot: AgentStatusSnapshot) => void;
	service: AgentStatusService;
}

function requireIdentifier(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
		throw new Error(`${label} is required.`);
	}
	return value;
}

export function registerAgentStatusIpcHandlers({
	ipcMain,
	publishSnapshot,
	service,
}: RegisterAgentStatusIpcOptions): () => void {
	ipcMain.handle('agent-status:get-snapshot', () => service.getSnapshot());
	ipcMain.handle(
		'agent-status:acknowledge',
		(_event, payload?: { entryId?: unknown }) =>
			service.markAcknowledged(
				requireIdentifier(payload?.entryId, 'Agent status entry id'),
			),
	);
	ipcMain.handle(
		'agent-status:acknowledge-terminal',
		(_event, payload?: { terminalSessionId?: unknown }) =>
			service.markTerminalAcknowledged(
				requireIdentifier(payload?.terminalSessionId, 'Terminal session id'),
			),
	);

	return service.subscribe(publishSnapshot);
}
