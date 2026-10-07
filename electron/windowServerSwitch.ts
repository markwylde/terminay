/**
 * Switch one window from the server it shows to another.
 *
 * Kept apart from Electron so its ordering is testable. A window keeps showing
 * its current server until the next one is ready: nothing of the current
 * binding is released before the new server's transport is open, so a server
 * that cannot be reached leaves the window exactly as it was.
 */
export async function switchWindowServer<Remote>(
	options: Readonly<{
		/** The remembered profile to show, or the Local profile's id. */
		profileId: string;
		/** What the window shows now. */
		currentProfileId: string;
		localProfileId: string;
		isRemembered: (profileId: string) => boolean;
		/** Open the authenticated transport and prepare the launch. Nothing of
		 * the window is touched. */
		connectRemote: (profileId: string) => Promise<Remote>;
		/** Replace the window's document with the remote server's workspace. */
		mountRemote: (profileId: string, remote: Remote) => Promise<void>;
		/** Close a transport that was opened and then not used. */
		discardRemote: (remote: Remote) => Promise<void>;
		/** Replace the window's document with the Local workspace. */
		mountLocal: () => Promise<void>;
		/** Runs once the switch is certain to go ahead, before the document is
		 * replaced. */
		beforeMount?: () => void;
	}>,
): Promise<'switched' | 'unchanged'> {
	const { profileId } = options;
	if (profileId === options.currentProfileId) return 'unchanged';
	if (profileId === options.localProfileId) {
		options.beforeMount?.();
		await options.mountLocal();
		return 'switched';
	}
	if (!options.isRemembered(profileId))
		throw new Error('That server is no longer saved on this computer.');
	const remote = await options.connectRemote(profileId);
	try {
		options.beforeMount?.();
		await options.mountRemote(profileId, remote);
	} catch (error) {
		await options.discardRemote(remote).catch(() => undefined);
		throw error;
	}
	return 'switched';
}

/**
 * Which window, if any, a newly paired server should be shown in.
 *
 * Pairing happens in Remote Control, an auxiliary window. The server is shown
 * in the workspace window Remote Control was opened from, and Remote Control
 * stays what it is. A workspace window that pairs shows the server itself.
 */
export function pairingTargetWindow<Window>(
	options: Readonly<{
		pairingWindow: Window;
		pairingWindowIsAuxiliary: boolean;
		/** The auxiliary window's parent, while it is still open. */
		parentWindow: Window | undefined;
	}>,
): Window | undefined {
	if (!options.pairingWindowIsAuxiliary) return options.pairingWindow;
	return options.parentWindow;
}
