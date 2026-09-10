/**
 * The header's connections control.
 *
 * This used to be a server *switcher*: one window, one server, and picking a
 * different one replaced everything. A window now holds several connections at
 * once, so the control lists what is attached with its status and
 * compatibility, attaches a remembered profile, and detaches one.
 *
 * Detaching removes that server's tabs from this window's composition and
 * closes nothing on the server: its terminals keep running, and re-attaching
 * finds them where they were.
 */

import { Plug, Unplug } from 'lucide-react';
import type { WorkspaceConnection } from '../shared/connections/connectionRegistry';
import type { ConnectionProfileSummary } from '../shared/connections/hostConnections';

export type ConnectionsControlProps = Readonly<{
	connections: readonly WorkspaceConnection[];
	profiles: readonly ConnectionProfileSummary[];
	supportsAttach: boolean;
	onAttach: (profileId: string) => void;
	onDetach: (profileId: string) => void;
	/** Falls back to the old single-connection label when this host has no
	 * `connections` capability at all. */
	currentServerLabel: string;
}>;

/** What the control says about one connection, and whether it can be used. */
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

/** A profile this window could attach: remembered, and not already attached. */
export function attachableProfiles(
	profiles: readonly ConnectionProfileSummary[],
	connections: readonly WorkspaceConnection[],
): readonly ConnectionProfileSummary[] {
	const attached = new Set(
		connections.map((connection) => connection.profileId),
	);
	return Object.freeze(
		profiles.filter(
			(profile) => !attached.has(profile.id) && profile.attached !== true,
		),
	);
}

export function ConnectionsControl({
	connections,
	currentServerLabel,
	onAttach,
	onDetach,
	profiles,
	supportsAttach,
}: ConnectionsControlProps) {
	if (connections.length === 0) {
		return (
			<div className="remote-access-menu__connection remote-access-menu__connection--compact">
				<span className="remote-access-menu__connection-device">
					{currentServerLabel}
				</span>
			</div>
		);
	}
	const attachable = attachableProfiles(profiles, connections);
	return (
		<>
			{connections.map((connection) => {
				const described = describeConnection(connection);
				return (
					<div
						key={connection.profileId}
						className={`remote-access-menu__connection remote-access-menu__connection--compact remote-access-menu__connection--${described.tone}`}
						data-connection-profile-id={connection.profileId}
						data-connection-phase={connection.phase}
					>
						<span className="remote-access-menu__connection-device">
							{connection.label}
							{connection.role === 'primary' ? ' · this window' : ''}
						</span>
						<span className="remote-access-menu__meta">
							{described.summary}
						</span>
						{described.detail === undefined ? null : (
							<p className="remote-access-menu__diagnostic">
								{described.detail}
							</p>
						)}
						{connection.role === 'attached' ? (
							<button
								type="button"
								className="remote-access-menu__item"
								onClick={() => onDetach(connection.profileId)}
								aria-label={`Detach ${connection.label}`}
							>
								<Unplug size={12} aria-hidden="true" />
								<span>Detach</span>
							</button>
						) : null}
					</div>
				);
			})}
			{supportsAttach && attachable.length > 0 ? (
				<div className="remote-access-menu__section">
					<div className="remote-access-menu__section-label">Attach</div>
					{attachable.map((profile) => (
						<button
							key={profile.id}
							type="button"
							className="remote-access-menu__item"
							onClick={() => onAttach(profile.id)}
							aria-label={`Attach ${profile.label}`}
						>
							<Plug size={12} aria-hidden="true" />
							<span>{profile.label}</span>
							<span className="remote-access-menu__meta">{profile.status}</span>
						</button>
					))}
				</div>
			) : null}
		</>
	);
}
