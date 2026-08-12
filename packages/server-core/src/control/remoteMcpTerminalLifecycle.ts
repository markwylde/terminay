import type { TerminalSessionLifecycle } from '../terminalService/types.js';
import type { RemoteMcpEnvironmentCoordinator } from './remoteMcpEnvironmentCoordinator.js';

/** Decorate, never replace, a host terminal lifecycle. Bridge setup failure is
 * an explicit unavailable state: terminal creation remains valid while MCP
 * fails closed until a new session/reconnect establishes a fresh bridge. */
export function composeRemoteMcpTerminalLifecycle(
	coordinator: () => RemoteMcpEnvironmentCoordinator | undefined,
	base?: TerminalSessionLifecycle,
	onUnavailable?: (identity: Readonly<{ serverId: string; projectId: string; sessionId: string }>, error: unknown) => void,
): TerminalSessionLifecycle {
	return {
		prepareTerminalSession: (identity) => base?.prepareTerminalSession(identity) ?? {},
		terminalStarted: (identity, shellPid) => {
			base?.terminalStarted?.(identity, shellPid);
			const remote = coordinator();
			if (remote !== undefined) void remote.open(identity.projectId, identity.sessionId).catch((error) => onUnavailable?.(identity, error));
		},
		terminalExited: (identity, exit) => {
			base?.terminalExited(identity, exit);
			const remote = coordinator();
			if (remote !== undefined) void remote.onSessionExit(identity.sessionId).catch((error) => onUnavailable?.(identity, error));
		},
		...(base?.terminalInput === undefined ? {} : { terminalInput: (identity) => base.terminalInput?.(identity) }),
		...(base?.foregroundProcessChanged === undefined ? {} : { foregroundProcessChanged: (identity, event) => base.foregroundProcessChanged?.(identity, event) }),
		...(base?.agentJournalRecord === undefined ? {} : { agentJournalRecord: (identity, event) => base.agentJournalRecord?.(identity, event) }),
	};
}
