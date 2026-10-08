/**
 * The header's connections control.
 *
 * A window shows one server. Where the host remembers servers, this lists
 * them with Local first and marks the one the window is showing; choosing
 * another switches the window to it, and each other server can also be opened
 * in a window of its own. Nothing on the server being left is stopped: its
 * terminals keep running, and returning finds them where they were.
 */

import { AppWindow } from 'lucide-react';
import type { WorkspaceConnection } from '../shared/connections/connectionRegistry';
import type { ConnectionProfileSummary } from '../shared/connections/hostConnections';

export type ConnectionsControlProps = Readonly<{
	/** The window's own connection, for the status beside its row. */
	connection?: WorkspaceConnection;
	/** The servers the host remembers, Local first. Empty where the host does
	 * not list any, as in a browser session. */
	servers: readonly ConnectionProfileSummary[];
	/** The profile the window is showing. */
	currentProfileId?: string;
	/** Absent where this host cannot switch a window's server. */
	onSwitch?: (profileId: string) => void;
	onOpenWindow?: (profileId: string) => void;
	/** The server a switch is in progress to. */
	switchingProfileId?: string;
	/** Why the last switch did not happen. */
	switchError?: string;
	currentServerLabel: string;
}>;

/** What the control says about the window's connection. */
export function describeConnection(connection: WorkspaceConnection): Readonly<{
	tone: 'ready' | 'pending' | 'failed' | 'incompatible';
	summary: string;
	detail?: string;
}> {
	switch (connection.phase) {
		case 'ready':
			return connection.compatibility?.state === 'degraded'
				? Object.freeze({
						tone: 'ready',
						summary: 'Connected',
						detail: `Without ${connection.compatibility.missingOptionalCapabilities.join(', ')}`,
					})
				: Object.freeze({ tone: 'ready', summary: 'Connected' });
		case 'connecting':
			return Object.freeze({ tone: 'pending', summary: 'Connecting…' });
		case 'reconnecting':
			return Object.freeze({ tone: 'pending', summary: 'Reconnecting…' });
		case 'incompatible':
			return Object.freeze({
				tone: 'incompatible',
				summary: 'Needs updating',
				// The compatibility message names the side to upgrade, which is the
				// only actionable thing about an incompatible server.
				detail:
					connection.compatibility?.state === 'incompatible'
						? connection.compatibility.message
						: connection.error,
			});
		default:
			return Object.freeze({
				tone: 'failed',
				summary: 'Unreachable',
				...(connection.error === undefined
					? {}
					: { detail: connection.error }),
			});
	}
}

/** One row of the switcher: a remembered server and how it stands. */
export type ServerRow = Readonly<{
	profileId: string;
	label: string;
	isCurrent: boolean;
	isSwitching: boolean;
}>;

/** The servers to list, with Local first and the window's own marked. */
export function serverRows(
	servers: readonly ConnectionProfileSummary[],
	currentProfileId: string | undefined,
	switchingProfileId?: string,
): readonly ServerRow[] {
	const rows = servers.map((server) => ({
		profileId: server.id,
		label: server.label,
		isLocal: server.isLocal === true,
		isCurrent: server.id === currentProfileId,
		isSwitching: server.id === switchingProfileId,
	}));
	rows.sort((left, right) => Number(right.isLocal) - Number(left.isLocal));
	return Object.freeze(
		rows.map(({ profileId, label, isCurrent, isSwitching }) =>
			Object.freeze({ profileId, label, isCurrent, isSwitching }),
		),
	);
}

export function ConnectionsControl({
	connection,
	currentProfileId,
	currentServerLabel,
	onOpenWindow,
	onSwitch,
	servers,
	switchError,
	switchingProfileId,
}: ConnectionsControlProps) {
	const described =
		connection === undefined ? undefined : describeConnection(connection);
	const rows = serverRows(servers, currentProfileId, switchingProfileId);
	// A host that lists no servers shows the one this window is on.
	if (rows.length === 0 || onSwitch === undefined) {
		return (
			<div
				className={`remote-access-menu__connection-group${described === undefined ? '' : ` remote-access-menu__connection--${described.tone}`}`}
				data-connection-phase={connection?.phase}
			>
				<div className="remote-access-menu__connection remote-access-menu__connection--compact">
					<span className="remote-access-menu__connection-device">
						{connection?.label ?? currentServerLabel}
					</span>
					{described === undefined ? null : (
						<span
							className={`remote-access-menu__meta${described.tone === 'ready' ? ' remote-access-menu__meta--live' : ''}`}
						>
							{described.summary}
						</span>
					)}
				</div>
				{described?.detail === undefined ? null : (
					<p className="remote-access-menu__diagnostic">{described.detail}</p>
				)}
			</div>
		);
	}
	const busy = switchingProfileId !== undefined;
	return (
		<>
			{rows.map((row) => (
				<div
					key={row.profileId}
					className={`remote-access-menu__connection-group remote-access-menu__server${row.isCurrent && described !== undefined ? ` remote-access-menu__connection--${described.tone}` : ''}`}
					data-connection-profile-id={row.profileId}
					{...(row.isCurrent && connection !== undefined
						? { 'data-connection-phase': connection.phase }
						: {})}
				>
					<div className="remote-access-menu__server-row">
						{/* Named by the label alone, so the status text stays secondary
						    rather than becoming part of the name. */}
						<button
							type="button"
							className={`remote-access-menu__item${row.isCurrent ? ' remote-access-menu__item--current' : ''}`}
							role="menuitemradio"
							aria-checked={row.isCurrent}
							aria-label={row.label}
							disabled={busy}
							onClick={() => {
								if (!row.isCurrent) onSwitch(row.profileId);
							}}
						>
							<span className="remote-access-menu__connection-device">
								{row.label}
							</span>
							{row.isSwitching ? (
								<span className="remote-access-menu__meta" aria-hidden="true">
									Connecting…
								</span>
							) : row.isCurrent && described !== undefined ? (
								<span
									className={`remote-access-menu__meta${described.tone === 'ready' ? ' remote-access-menu__meta--live' : ''}`}
									aria-hidden="true"
								>
									{described.summary}
								</span>
							) : null}
						</button>
						{row.isCurrent || onOpenWindow === undefined ? null : (
							<button
								type="button"
								className="remote-access-menu__server-window"
								aria-label={`Open ${row.label} in new window`}
								title="Open in new window"
								disabled={busy}
								onClick={() => onOpenWindow(row.profileId)}
							>
								<AppWindow size={13} aria-hidden="true" />
							</button>
						)}
					</div>
					{row.isCurrent && described?.detail !== undefined ? (
						<p className="remote-access-menu__diagnostic">{described.detail}</p>
					) : null}
				</div>
			))}
			{switchError === undefined ? null : (
				<p className="remote-access-menu__diagnostic" role="alert">
					{switchError}
				</p>
			)}
		</>
	);
}
