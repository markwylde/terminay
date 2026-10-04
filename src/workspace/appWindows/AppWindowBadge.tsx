import { type ReactElement, useContext, useMemo, useSyncExternalStore } from 'react';
import {
	appWindowUnseenSnapshot,
	subscribeAppWindowUnseen,
} from './appWindowPanes';
import { AppWindowsContext, appWindowPaneKey } from './useServerAppWindows';
import './AppWindowBadge.css';

/**
 * Marks a tab whose terminals own app windows: a count when there is more than
 * one, and a pulse while one arrived that the user has not looked at.
 */
export function AppWindowBadge(props: {
	readonly count: number;
	readonly unseen: boolean;
}): ReactElement | null {
	if (props.count <= 0) return null;
	const label = `${props.count} app window${props.count === 1 ? '' : 's'}${
		props.unseen ? ', new' : ''
	}`;
	return (
		<span
			className={`app-window-badge${props.unseen ? ' app-window-badge--unseen' : ''}`}
			role="img"
			aria-label={label}
			title={label}
		>
			▣{props.count > 1 ? ` ${props.count}` : ''}
		</span>
	);
}

/** The badge for one terminal's tab. */
export function TerminalAppWindowBadge(props: {
	readonly serverId: string | undefined;
	readonly sessionId: string | undefined;
}): ReactElement | null {
	const byServer = useContext(AppWindowsContext);
	const unseen = useSyncExternalStore(
		subscribeAppWindowUnseen,
		appWindowUnseenSnapshot,
		appWindowUnseenSnapshot,
	);
	const { serverId, sessionId } = props;
	const count = useMemo(() => {
		if (serverId === undefined || sessionId === undefined) return 0;
		return (
			byServer
				.get(serverId)
				?.windows.filter((window) => window.terminalSessionId === sessionId)
				.length ?? 0
		);
	}, [byServer, serverId, sessionId]);
	if (serverId === undefined || sessionId === undefined) return null;
	return (
		<AppWindowBadge
			count={count}
			unseen={unseen.has(appWindowPaneKey(serverId, sessionId))}
		/>
	);
}

/** The badge for a project's tab: every window its terminals own. */
export function ProjectAppWindowBadge(props: {
	readonly serverId: string | undefined;
	readonly projectId: string;
}): ReactElement | null {
	const byServer = useContext(AppWindowsContext);
	const unseen = useSyncExternalStore(
		subscribeAppWindowUnseen,
		appWindowUnseenSnapshot,
		appWindowUnseenSnapshot,
	);
	const { serverId, projectId } = props;
	const summary = useMemo(() => {
		let count = 0;
		let isUnseen = false;
		for (const server of byServer.values()) {
			if (serverId !== undefined && server.serverId !== serverId) continue;
			for (const window of server.windows) {
				if (window.projectId !== projectId) continue;
				count += 1;
				if (unseen.has(appWindowPaneKey(server.serverId, window.terminalSessionId)))
					isUnseen = true;
			}
		}
		return { count, isUnseen };
	}, [byServer, unseen, serverId, projectId]);
	return <AppWindowBadge count={summary.count} unseen={summary.isUnseen} />;
}
