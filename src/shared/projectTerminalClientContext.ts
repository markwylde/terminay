import type { TerminalPanelClientContextValue } from '../components/TerminalPanel';

export function composeProjectTerminalClientContext(
	connection: Omit<TerminalPanelClientContextValue, 'projectId'>,
	projectId: string,
	projectRoot: string,
): TerminalPanelClientContextValue {
	return Object.freeze({ ...connection, projectId, projectRoot });
}
