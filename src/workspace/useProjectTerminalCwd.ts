import { useCallback } from 'react';
import type { TerminalPanelClientContextValue } from '../components/TerminalPanel';

type ProjectTerminalContext = Pick<
	TerminalPanelClientContextValue,
	'client' | 'projectId'
>;

/** Read live cwd from the server-owned PTY observer, never from the immutable
 * spawn projection or a renderer-side shell guess. */
export function useProjectTerminalCwd(
	context: ProjectTerminalContext | null,
): (sessionId: string) => Promise<string | null> {
	return useCallback(
		async (sessionId: string) => {
			if (context === null) {
				throw new Error('The server terminal client is unavailable.');
			}
			const liveCwdClient = context.client as typeof context.client & {
				currentCwd(
					projectId: string,
					targetSessionId: string,
				): Promise<{ cwd: string }>;
			};
			return (await liveCwdClient.currentCwd(context.projectId, sessionId)).cwd;
		},
		[context],
	);
}
