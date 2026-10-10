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
 * Open the startup window on the server it last showed.
 *
 * The window holds its loading state until that server's transport is open and
 * then mounts it directly, so Local is never shown on the way to another
 * server. Local is what the window opens on when nothing else was remembered,
 * when the remembered server was forgotten or does not answer, and when the
 * person asks for it rather than wait.
 */
export async function openStartupWindowServer<Remote>(
	options: Readonly<{
		/** The profile the workspace window last showed, when one was recorded. */
		rememberedProfileId: string | undefined;
		localProfileId: string;
		isRemembered: (profileId: string) => boolean;
		connectRemote: (profileId: string) => Promise<Remote>;
		mountRemote: (profileId: string, remote: Remote) => Promise<void>;
		discardRemote: (remote: Remote) => Promise<void>;
		mountLocal: () => Promise<void>;
		/** Settles when the person chooses Local instead of waiting. */
		localRequested: Promise<void>;
		/** How long the server may take before Local is offered. */
		offerLocalAfterMs: number;
		/** Offer Local on the loading state. */
		offerLocal: () => void;
		/** Runs once, before the loading state is replaced by a workspace. */
		beforeMount?: () => void;
	}>,
): Promise<'remote' | 'local' | 'local-requested'> {
	let mounting = false;
	const beforeMount = () => {
		if (mounting) return;
		mounting = true;
		options.beforeMount?.();
	};
	const openLocal = async <Outcome extends 'local' | 'local-requested'>(
		outcome: Outcome,
	): Promise<Outcome> => {
		beforeMount();
		await options.mountLocal();
		return outcome;
	};
	const profileId = options.rememberedProfileId;
	if (
		profileId === undefined ||
		profileId === options.localProfileId ||
		!options.isRemembered(profileId)
	)
		return openLocal('local');
	const connecting = Promise.resolve().then(() =>
		options.connectRemote(profileId),
	);
	const offer = setTimeout(options.offerLocal, options.offerLocalAfterMs);
	let first: Readonly<{ remote: Remote }> | 'local-requested';
	try {
		first = await Promise.race([
			connecting.then((remote) => ({ remote })),
			options.localRequested.then(() => 'local-requested' as const),
		]);
	} catch {
		return openLocal('local');
	} finally {
		clearTimeout(offer);
	}
	if (first === 'local-requested') {
		// The attempt is abandoned, not awaited: whatever it opens is closed.
		void connecting
			.then((remote) => options.discardRemote(remote))
			.catch(() => undefined);
		return openLocal('local-requested');
	}
	try {
		beforeMount();
		await options.mountRemote(profileId, first.remote);
		return 'remote';
	} catch {
		await options.discardRemote(first.remote).catch(() => undefined);
		return openLocal('local');
	}
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
