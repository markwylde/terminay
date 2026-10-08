import { useEffect, useState } from 'react';
import type {
	ConnectionProfileSummary,
	WorkspaceConnectionHost,
} from '../shared/connections';

/** The servers a window can leave for: every remembered one but its own,
 * Local first, then in the order the host lists them. */
export function otherServers(
	profiles: readonly ConnectionProfileSummary[],
	currentProfileId: string | undefined,
): readonly ConnectionProfileSummary[] {
	const others = profiles.filter((profile) => profile.id !== currentProfileId);
	return [
		...others.filter((profile) => profile.isLocal === true),
		...others.filter((profile) => profile.isLocal !== true),
	];
}

/**
 * The way out of a server that cannot be shown.
 *
 * The connection menu lives in the workspace, and a window whose server is
 * unreachable or needs updating has no workspace to hold it. This offers the
 * same switch from the connection state itself, so the window is never bound
 * to a server it cannot leave.
 */
export function ConnectionStateServers({
	host,
}: Readonly<{ host: WorkspaceConnectionHost }>): React.JSX.Element | null {
	const [profiles, setProfiles] = useState<readonly ConnectionProfileSummary[]>(
		[],
	);
	const [switchingTo, setSwitchingTo] = useState<string>();
	const [failure, setFailure] = useState<string>();
	const canSwitch = host.selectProfile !== undefined;

	useEffect(() => {
		if (!canSwitch) return;
		let current = true;
		void host
			.listProfiles()
			.then((listed) => {
				if (current) setProfiles(listed);
			})
			.catch(() => undefined);
		const unsubscribe = host.subscribeProfiles?.((listed) => {
			if (current) setProfiles(listed);
		});
		return () => {
			current = false;
			unsubscribe?.();
		};
	}, [canSwitch, host]);

	const servers = otherServers(profiles, host.currentProfileId);
	if (host.selectProfile === undefined) return null;
	const selectProfile = host.selectProfile;

	return (
		<ConnectionStateServerList
			servers={servers}
			switchingTo={switchingTo}
			failure={failure}
			onSwitch={(profileId) => {
				setSwitchingTo(profileId);
				setFailure(undefined);
				// A successful switch replaces this document, so only a failure
				// has anything left to report to.
				selectProfile(profileId).then(
					() => setSwitchingTo(undefined),
					(cause: unknown) => {
						setSwitchingTo(undefined);
						setFailure(
							cause instanceof Error
								? cause.message
								: 'That server could not be opened.',
						);
					},
				);
			}}
		/>
	);
}

export function ConnectionStateServerList({
	servers,
	switchingTo,
	failure,
	onSwitch,
}: Readonly<{
	servers: readonly ConnectionProfileSummary[];
	switchingTo?: string;
	failure?: string;
	onSwitch: (profileId: string) => void;
}>): React.JSX.Element | null {
	if (servers.length === 0) return null;
	return (
		<nav
			className="browser-host-shell__connection-servers"
			aria-label="Other servers"
		>
			<ul>
				{servers.map((profile) => (
					<li key={profile.id}>
						<button
							type="button"
							className="secondary"
							disabled={switchingTo !== undefined}
							aria-busy={switchingTo === profile.id}
							onClick={() => onSwitch(profile.id)}
						>
							{switchingTo === profile.id
								? `Switching to ${profile.label}…`
								: `Switch to ${profile.label}`}
						</button>
					</li>
				))}
			</ul>
			{failure !== undefined && <p role="alert">{failure}</p>}
		</nav>
	);
}
